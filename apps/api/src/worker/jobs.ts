import {
  businessMembers,
  businessSettings,
  businesses,
  getDb,
  notifications,
  users,
  type Business,
  type BusinessSettingsRow,
} from '@nexa/database';
import { and, eq, gte, isNull, sql } from 'drizzle-orm';
import { logger } from '../lib/logger.js';
import { buildDashboard } from '../services/dashboard.service.js';
import { runAgentScan } from '../services/activity.service.js';
import type { Job } from './scheduler.js';

/**
 * The proactive side of NEXA.
 *
 * Everything here answers one question: what does a business owner need to know
 * *before* they think to ask? The scans themselves already existed and ran when
 * someone opened the dashboard — which is exactly backwards, because the owner
 * who has not opened the dashboard in three days is the one who most needs to
 * hear that eight invoices went overdue.
 *
 * Two rules these jobs hold to:
 *
 *  - **Never invent urgency.** A notification is raised only from a metric that
 *    crossed a threshold in real data. A quiet week produces a quiet inbox.
 *  - **Never notify twice for the same thing.** Every notification carries a
 *    stable dedupe key in its href/title pair, and the daily brief is gated on
 *    "has this user already been told today".
 */

const HOUR_MS = 60 * 60 * 1000;

/** The dashboard is the index route of /app — there is no /app/dashboard. */
const DASHBOARD_HREF = '/app';

interface BusinessContext {
  business: Business;
  settings: BusinessSettingsRow;
}

async function activeBusinesses(): Promise<BusinessContext[]> {
  const db = await getDb();
  const rows = await db
    .select({ business: businesses, settings: businessSettings })
    .from(businesses)
    .innerJoin(businessSettings, eq(businessSettings.businessId, businesses.id));
  return rows.filter((row): row is BusinessContext => row.settings !== null);
}

/**
 * Runs the monitoring agents for every business.
 *
 * Sequential rather than parallel on purpose: this is background work competing
 * with live requests for the same database, and finishing five minutes later
 * costs nobody anything. Fanning out would trade an invisible benefit for a
 * visible latency spike on the dashboard.
 */
export const agentScanJob: Job = {
  name: 'agent-scan',
  everyMs: 6 * HOUR_MS,
  lockKey: 0x4e455801, // 'NEX' + 01
  async run(now) {
    const contexts = await activeBusinesses();
    let raised = 0;
    for (const { business, settings } of contexts) {
      try {
        raised += await runAgentScan(business, settings, now);
      } catch (error) {
        // One business's bad data must not stop the scan for everyone else.
        logger.error('agent scan failed for business', {
          businessId: business.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return `scanned ${contexts.length} business(es), raised ${raised} card(s)`;
  },
};

/**
 * Delivers the Morning Brief as an in-app notification, once per user per day.
 *
 * The brief itself is the same one the dashboard renders — templated from
 * retrieved metrics with no generative step, so it cannot invent a number. What
 * changes here is only *when* the owner sees it.
 */
export const dailyBriefJob: Job = {
  name: 'daily-brief',
  everyMs: HOUR_MS,
  lockKey: 0x4e455802,
  async run(now) {
    const db = await getDb();
    const contexts = await activeBusinesses();
    let delivered = 0;

    for (const { business, settings } of contexts) {
      try {
        // Fire in the business's own morning, not the server's. An Accra owner
        // should not get their brief at 3am because the host is in Virginia.
        const localHour = hourInZone(now, business.timezone);
        if (localHour !== 7) continue;

        const members = await db
          .select({ userId: users.id, fullName: users.fullName })
          .from(businessMembers)
          .innerJoin(users, eq(users.id, businessMembers.userId))
          .where(
            and(
              eq(businessMembers.businessId, business.id),
              // Owners and admins run the business; staff do not need a daily
              // financial summary pushed at them.
              sql`${businessMembers.role} in ('owner', 'admin')`,
            ),
          );

        for (const member of members) {
          if (await alreadyBriefedToday(business.id, member.userId, now)) continue;

          const dashboard = await buildDashboard(
            business,
            settings,
            { fullName: member.fullName },
            'last_30_days',
            now,
          );
          const brief = dashboard.brief;

          await db.insert(notifications).values({
            businessId: business.id,
            userId: member.userId,
            channel: 'in_app',
            title: brief.headline,
            body: brief.highlights
              .slice(0, 3)
              .map((highlight) => highlight.title)
              .join('\n'),
            severity: brief.highlights.some((h) => h.severity === 'critical')
              ? 'critical'
              : brief.highlights.some((h) => h.severity === 'warning')
                ? 'warning'
                : 'info',
            href: DASHBOARD_HREF,
          });
          delivered += 1;
        }
      } catch (error) {
        logger.error('daily brief failed for business', {
          businessId: business.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return `delivered ${delivered} brief(s)`;
  },
};

/**
 * Has this user already received today's brief?
 *
 * Checked per user rather than per business because members join at different
 * times, and because a re-run after a deploy must not re-notify anyone.
 */
async function alreadyBriefedToday(businessId: string, userId: string, now: Date): Promise<boolean> {
  const db = await getDb();
  const since = new Date(now.getTime() - 20 * HOUR_MS);
  const [row] = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.businessId, businessId),
        eq(notifications.userId, userId),
        eq(notifications.href, DASHBOARD_HREF),
        gte(notifications.createdAt, since),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/**
 * Local hour in an IANA timezone.
 *
 * Uses Intl rather than arithmetic on a UTC offset so that DST, and zones with
 * non-hour offsets, are handled by the platform's own tz database instead of by
 * assumptions that go stale.
 */
function hourInZone(instant: Date, timeZone: string): number {
  try {
    const formatted = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: 'numeric',
      hour12: false,
    }).format(instant);
    return Number.parseInt(formatted, 10);
  } catch {
    // An invalid timezone on a business row should not stop the whole job.
    return instant.getUTCHours();
  }
}

/**
 * Expires AI action proposals nobody decided on.
 *
 * A proposal that has sat unanswered past its TTL must not remain approvable:
 * the data it was computed from has moved on, and executing it later would
 * apply a decision made against a business that no longer looks like that.
 */
export const expireProposalsJob: Job = {
  name: 'expire-ai-actions',
  everyMs: HOUR_MS,
  lockKey: 0x4e455803,
  async run(now) {
    const db = await getDb();
    const { aiActions } = await import('@nexa/database');
    const expired = await db
      .update(aiActions)
      .set({ status: 'expired', updatedAt: now })
      .where(
        and(
          eq(aiActions.status, 'proposed'),
          isNull(aiActions.result),
          sql`${aiActions.expiresAt} is not null and ${aiActions.expiresAt} < ${now}`,
        ),
      )
      .returning({ id: aiActions.id });
    return `expired ${expired.length} stale proposal(s)`;
  },
};

export const ALL_JOBS: Job[] = [agentScanJob, dailyBriefJob, expireProposalsJob];
