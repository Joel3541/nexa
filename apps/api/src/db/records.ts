import {
  activityEvents,
  auditLogs,
  customerEvents,
  notifications,
  usageEvents,
  type Executor,
} from '@nexa/database';
import type { ActivitySeverity, ActivitySource } from '@nexa/types';
import { logger } from '../lib/logger.js';

/**
 * Cross-cutting record writers: audit trail, activity feed, customer timeline
 * and product analytics.
 *
 * These are intentionally best-effort for the *feed* paths and strict for the
 * *audit* path — a failure to write an activity card must not roll back a sale,
 * but an audit write failure is a genuine problem and is logged loudly.
 */

export interface AuditInput {
  businessId: string | null;
  actorUserId: string | null;
  actorName: string | null;
  actorType?: ActivitySource;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  summary: string;
  metadata?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export async function writeAudit(db: Executor, input: AuditInput): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      businessId: input.businessId,
      actorUserId: input.actorUserId,
      actorName: input.actorName,
      actorType: input.actorType ?? 'user',
      action: input.action,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      summary: input.summary,
      metadata: input.metadata ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    });
  } catch (error) {
    logger.error('audit write failed', { action: input.action, error: String(error) });
  }
}

export interface ActivityInput {
  businessId: string;
  type: string;
  title: string;
  description?: string | null;
  severity?: ActivitySeverity;
  source?: ActivitySource;
  entityType?: string | null;
  entityId?: string | null;
  actionLabel?: string | null;
  actionHref?: string | null;
  actorUserId?: string | null;
  /** Supplying this makes the insert idempotent for repeated agent scans. */
  dedupeKey?: string | null;
}

export async function emitActivity(db: Executor, input: ActivityInput): Promise<void> {
  try {
    await db
      .insert(activityEvents)
      .values({
        businessId: input.businessId,
        type: input.type,
        title: input.title,
        description: input.description ?? null,
        severity: input.severity ?? 'info',
        source: input.source ?? 'system',
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        actionLabel: input.actionLabel ?? null,
        actionHref: input.actionHref ?? null,
        actorUserId: input.actorUserId ?? null,
        dedupeKey: input.dedupeKey ?? null,
      })
      .onConflictDoNothing();
  } catch (error) {
    logger.warn('activity write failed', { type: input.type, error: String(error) });
  }
}

export interface CustomerEventInput {
  businessId: string;
  customerId: string;
  type: string;
  title: string;
  description?: string | null;
  amountMinor?: number | null;
  linkId?: string | null;
  actorUserId?: string | null;
  source?: ActivitySource;
  occurredAt?: Date;
}

export async function recordCustomerEvent(db: Executor, input: CustomerEventInput): Promise<void> {
  try {
    await db.insert(customerEvents).values({
      businessId: input.businessId,
      customerId: input.customerId,
      type: input.type,
      title: input.title,
      description: input.description ?? null,
      amountMinor: input.amountMinor ?? null,
      linkId: input.linkId ?? null,
      actorUserId: input.actorUserId ?? null,
      source: input.source ?? 'user',
      occurredAt: input.occurredAt ?? new Date(),
    });
  } catch (error) {
    logger.warn('customer event write failed', { type: input.type, error: String(error) });
  }
}

export async function notify(
  db: Executor,
  input: {
    businessId: string;
    userId: string;
    title: string;
    body?: string | null;
    severity?: ActivitySeverity;
    href?: string | null;
  },
): Promise<void> {
  try {
    await db.insert(notifications).values({
      businessId: input.businessId,
      userId: input.userId,
      title: input.title,
      body: input.body ?? null,
      severity: input.severity ?? 'info',
      href: input.href ?? null,
    });
  } catch (error) {
    logger.warn('notification write failed', { error: String(error) });
  }
}

/**
 * Product analytics. Names are a closed vocabulary so dashboards stay stable:
 * activation (first_customer_created…), engagement (ai_message_sent…),
 * retention (business_opened).
 */
export async function trackUsage(
  db: Executor,
  input: { businessId: string | null; userId: string | null; name: string; properties?: Record<string, unknown> },
): Promise<void> {
  try {
    await db.insert(usageEvents).values({
      businessId: input.businessId,
      userId: input.userId,
      name: input.name,
      properties: input.properties ?? null,
    });
  } catch {
    // Analytics must never break a request.
  }
}
