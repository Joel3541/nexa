import { auditLogs, getDb, users } from '@nexa/database';
import { analyticsQuerySchema, createCampaignSchema, searchQuerySchema } from '@nexa/types';
import { desc, eq } from 'drizzle-orm';
import { Router } from 'express';
import type { Request } from 'express';
import { z } from 'zod';
import { handler, noStore, param, parse } from '../lib/http.js';
import { periodFromRange, resolvePeriod, type PeriodKey } from '../lib/dates.js';
import { requireAuth, requireBusiness, requirePermission } from '../middleware/auth.js';
import { getAuth, getTenant } from '../middleware/context.js';
import { buildAnalytics } from '../services/analytics.service.js';
import {
  listActivity,
  listNotifications,
  markActivityRead,
  markNotificationsRead,
  runAgentScan,
} from '../services/activity.service.js';
import { createCampaign, listCampaigns, sendCampaign } from '../services/campaigns.service.js';
import { buildDashboard } from '../services/dashboard.service.js';
import { globalSearch } from '../services/search.service.js';
import { logger } from '../lib/logger.js';

export const insightsRouter: Router = Router();

insightsRouter.use(requireAuth, requireBusiness);

const actor = (req: Request) => {
  const auth = getAuth(req);
  return { id: auth.user.id, name: auth.user.fullName };
};

const PERIODS: PeriodKey[] = [
  'today',
  'yesterday',
  'last_7_days',
  'last_30_days',
  'last_90_days',
  'this_month',
  'last_month',
  'this_year',
];

insightsRouter.get(
  '/dashboard',
  requirePermission('analytics:read'),
  handler(async (req, res) => {
    noStore(res);
    const tenant = getTenant(req);
    const auth = getAuth(req);
    const period = parse(z.enum(PERIODS as [PeriodKey, ...PeriodKey[]]).default('last_30_days'), req.query.period ?? undefined);

    // The monitoring agents run on dashboard load: idempotent, deduplicated,
    // and cheap. A scheduled worker can call the same function unchanged.
    runAgentScan(tenant.business, tenant.settings).catch((error: unknown) =>
      logger.warn('agent scan failed', { error: String(error), businessId: tenant.business.id }),
    );

    res.json(await buildDashboard(tenant.business, tenant.settings, auth.user, period));
  }),
);

insightsRouter.get(
  '/analytics',
  requirePermission('analytics:read'),
  handler(async (req, res) => {
    const tenant = getTenant(req);
    const query = parse(analyticsQuerySchema, req.query);
    const period = query.from || query.to ? periodFromRange(query.from, query.to) : resolvePeriod('last_30_days');
    res.json(await buildAnalytics(tenant.business.id, period, query.granularity, tenant.business.currency));
  }),
);

insightsRouter.get(
  '/search',
  handler(async (req, res) => {
    const tenant = getTenant(req);
    const query = parse(searchQuerySchema, req.query);
    res.json(
      await globalSearch(tenant.business.id, query.q, query.limit, tenant.business.currency, tenant.business.locale),
    );
  }),
);

insightsRouter.get(
  '/activity',
  handler(async (req, res) => {
    const tenant = getTenant(req);
    const query = parse(
      z.object({
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(25),
        unreadOnly: z.coerce.boolean().optional(),
      }),
      req.query,
    );
    res.json(await listActivity(tenant.business.id, query));
  }),
);

insightsRouter.post(
  '/activity/read',
  handler(async (req, res) => {
    const tenant = getTenant(req);
    const input = parse(z.object({ id: z.string().uuid().nullable().default(null) }), req.body ?? {});
    await markActivityRead(tenant.business.id, input.id);
    res.json({ ok: true });
  }),
);

insightsRouter.get(
  '/notifications',
  handler(async (req, res) => {
    const tenant = getTenant(req);
    const auth = getAuth(req);
    res.json(await listNotifications(tenant.business.id, auth.user.id));
  }),
);

insightsRouter.post(
  '/notifications/read',
  handler(async (req, res) => {
    const tenant = getTenant(req);
    const auth = getAuth(req);
    const input = parse(z.object({ id: z.string().uuid().nullable().default(null) }), req.body ?? {});
    await markNotificationsRead(tenant.business.id, auth.user.id, input.id);
    res.json({ ok: true });
  }),
);

insightsRouter.get(
  '/campaigns',
  requirePermission('campaigns:read'),
  handler(async (req, res) => {
    res.json(await listCampaigns(getTenant(req).business.id));
  }),
);

insightsRouter.post(
  '/campaigns',
  requirePermission('campaigns:read'),
  handler(async (req, res) => {
    const input = parse(createCampaignSchema, req.body);
    res.status(201).json(await createCampaign(getTenant(req).business.id, input, actor(req)));
  }),
);

insightsRouter.post(
  '/campaigns/:id/send',
  requirePermission('campaigns:send'),
  handler(async (req, res) => {
    const result = await sendCampaign(getTenant(req).business.id, param(req, 'id'), actor(req));
    res.json({
      ...result,
      message: result.simulated
        ? `Prepared ${result.delivered} messages. No live provider is configured, so nothing was actually delivered — they are in your outbox.`
        : `Sent to ${result.delivered} customers.`,
    });
  }),
);

insightsRouter.get(
  '/audit',
  requirePermission('audit:read'),
  handler(async (req, res) => {
    const tenant = getTenant(req);
    const query = parse(z.object({ limit: z.coerce.number().int().min(1).max(200).default(100) }), req.query);
    const db = await getDb();
    const rows = await db
      .select({ log: auditLogs, actorName: users.fullName })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorUserId))
      .where(eq(auditLogs.businessId, tenant.business.id))
      .orderBy(desc(auditLogs.createdAt))
      .limit(query.limit);

    res.json(
      rows.map(({ log, actorName }) => ({
        id: log.id,
        action: log.action,
        entityType: log.entityType,
        entityId: log.entityId,
        actorName: log.actorName ?? actorName,
        actorType: log.actorType,
        summary: log.summary,
        metadata: log.metadata,
        ipAddress: log.ipAddress,
        createdAt: log.createdAt.toISOString(),
      })),
    );
  }),
);
