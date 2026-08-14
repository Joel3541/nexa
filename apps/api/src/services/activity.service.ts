import { formatMoney } from '@nexa/config';
import { activityEvents, getDb, notifications, type Business, type BusinessSettingsRow } from '@nexa/database';
import type { ActivityEventView, NotificationView } from '@nexa/types';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { emitActivity } from '../db/records.js';
import { ownedRow } from '../db/scope.js';
import { customerStats, rangeTotals } from './analytics.service.js';
import { overdueInvoices } from './invoices.service.js';
import { lowStockProducts } from './products.service.js';
import { resolvePeriod } from '../lib/dates.js';

export async function listActivity(
  businessId: string,
  query: { page: number; pageSize: number; unreadOnly?: boolean },
): Promise<{ rows: ActivityEventView[]; total: number; unread: number }> {
  const db = await getDb();
  const filters = [eq(activityEvents.businessId, businessId)];
  if (query.unreadOnly) filters.push(isNull(activityEvents.readAt));
  const where = and(...filters)!;

  const [rows, [countRow], [unreadRow]] = await Promise.all([
    db
      .select()
      .from(activityEvents)
      .where(where)
      .orderBy(desc(activityEvents.createdAt))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db.select({ count: sql<number>`count(*)::int` }).from(activityEvents).where(where),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(activityEvents)
      .where(and(eq(activityEvents.businessId, businessId), isNull(activityEvents.readAt))),
  ]);

  return {
    rows: rows.map((row) => ({
      id: row.id,
      type: row.type,
      severity: row.severity,
      source: row.source,
      title: row.title,
      description: row.description,
      entityType: row.entityType,
      entityId: row.entityId,
      actionLabel: row.actionLabel,
      actionHref: row.actionHref,
      readAt: row.readAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    })),
    total: Number(countRow?.count ?? 0),
    unread: Number(unreadRow?.count ?? 0),
  };
}

export async function markActivityRead(businessId: string, id: string | null): Promise<void> {
  const db = await getDb();
  if (id) {
    await db.update(activityEvents).set({ readAt: new Date() }).where(ownedRow(activityEvents, id, businessId));
    return;
  }
  await db
    .update(activityEvents)
    .set({ readAt: new Date() })
    .where(and(eq(activityEvents.businessId, businessId), isNull(activityEvents.readAt)));
}

export async function listNotifications(
  businessId: string,
  userId: string,
  limit = 30,
): Promise<{ rows: NotificationView[]; unread: number }> {
  const db = await getDb();
  const [rows, [unreadRow]] = await Promise.all([
    db
      .select()
      .from(notifications)
      .where(and(eq(notifications.businessId, businessId), eq(notifications.userId, userId)))
      .orderBy(desc(notifications.createdAt))
      .limit(limit),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.businessId, businessId), eq(notifications.userId, userId), isNull(notifications.readAt))),
  ]);

  return {
    rows: rows.map((row) => ({
      id: row.id,
      title: row.title,
      body: row.body,
      severity: row.severity,
      href: row.href,
      readAt: row.readAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    })),
    unread: Number(unreadRow?.count ?? 0),
  };
}

export async function markNotificationsRead(businessId: string, userId: string, id: string | null): Promise<void> {
  const db = await getDb();
  const filters = [eq(notifications.businessId, businessId), eq(notifications.userId, userId)];
  if (id) filters.push(eq(notifications.id, id));
  else filters.push(isNull(notifications.readAt));
  await db.update(notifications).set({ readAt: new Date() }).where(and(...filters));
}

/* -------------------------------------------------------------------------- */
/* Monitoring agents                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Runs the monitoring pass that the specialist agents are responsible for.
 *
 * These are *scans*, not autonomous actors: each agent looks at real data and
 * may raise an activity card. None of them can change a record. Cards are
 * deduplicated by a stable key so a daily scan does not spam the feed.
 *
 * Invoked on dashboard load (cheap, idempotent). A scheduled worker can call
 * the same function without any change.
 */
export async function runAgentScan(
  business: Business,
  settings: BusinessSettingsRow,
  now = new Date(),
): Promise<number> {
  const db = await getDb();
  const businessId = business.id;
  const money = (minor: number) => formatMoney(minor, business.currency, { locale: business.locale });
  const day = now.toISOString().slice(0, 10);
  let raised = 0;

  // Finance agent — overdue receivables.
  const overdue = await overdueInvoices(businessId, 50, now);
  if (overdue.length > 0) {
    const total = overdue.reduce((sum, invoice) => sum + invoice.balanceMinor, 0);
    const worst = overdue[0]!;
    await emitActivity(db, {
      businessId,
      type: 'agent.finance.overdue',
      severity: worst.daysOverdue > 30 ? 'critical' : 'warning',
      source: 'ai',
      title: `${overdue.length} invoice${overdue.length === 1 ? '' : 's'} overdue — ${money(total)}`,
      description: `Oldest: ${worst.number} for ${worst.customerName}, ${worst.daysOverdue} days past due.`,
      actionLabel: 'Chase payments',
      actionHref: '/app/invoices?overdue=1',
      dedupeKey: `finance.overdue:${day}:${overdue.length}`,
    });
    raised += 1;
  }

  // Inventory agent — projected stock-outs.
  const lowStock = await lowStockProducts(businessId, settings.lowStockThreshold, 20, now);
  const runningOut = lowStock.filter((product) => product.daysOfStockRemaining !== null && product.daysOfStockRemaining <= 10);
  if (runningOut.length > 0) {
    const first = runningOut[0]!;
    await emitActivity(db, {
      businessId,
      type: 'agent.inventory.stockout_risk',
      severity: first.quantity === 0 ? 'critical' : 'warning',
      source: 'ai',
      title: `${first.name} may run out in about ${first.daysOfStockRemaining} days`,
      description: `Sold ${first.unitsSold30d} in the last 30 days with ${first.quantity} left. Projection confidence: ${first.stockConfidence ?? 'unknown'}.`,
      entityType: 'product',
      entityId: first.id,
      actionLabel: 'Restock',
      actionHref: `/app/products/${first.id}`,
      dedupeKey: `inventory.stockout:${day}:${first.id}`,
    });
    raised += 1;
  }

  // Customer agent — lapsing relationships.
  const period = resolvePeriod('last_30_days', now);
  const stats = await customerStats(db, businessId, period, 60, now);
  if (stats.inactiveCount >= 5) {
    await emitActivity(db, {
      businessId,
      type: 'agent.customer.inactive',
      severity: 'info',
      source: 'ai',
      title: `${stats.inactiveCount} customers have gone quiet`,
      description: `They represent ${money(stats.inactiveValueMinor)} of past spend, averaging ${stats.averageDaysSincePurchase} days since their last purchase.`,
      actionLabel: 'Review them',
      actionHref: '/app/customers?segment=inactive',
      dedupeKey: `customer.inactive:${day}:${stats.inactiveCount}`,
    });
    raised += 1;
  }

  // Sales agent — momentum worth naming.
  const [current, previous] = await Promise.all([
    rangeTotals(db, businessId, period.from, period.to),
    rangeTotals(db, businessId, period.previous.from, period.previous.to),
  ]);
  if (previous.revenueMinor > 0) {
    const change = ((current.revenueMinor - previous.revenueMinor) / previous.revenueMinor) * 100;
    if (Math.abs(change) >= 15) {
      await emitActivity(db, {
        businessId,
        type: change > 0 ? 'agent.sales.growth' : 'agent.sales.decline',
        severity: change > 0 ? 'success' : 'warning',
        source: 'ai',
        title: `Revenue is ${Math.abs(Math.round(change))}% ${change > 0 ? 'higher' : 'lower'} than the previous 30 days`,
        description: `${money(current.revenueMinor)} versus ${money(previous.revenueMinor)} across ${current.orderCount} orders.`,
        actionLabel: 'See analytics',
        actionHref: '/app/analytics',
        dedupeKey: `sales.trend:${day}:${Math.round(change)}`,
      });
      raised += 1;
    }
  }

  return raised;
}
