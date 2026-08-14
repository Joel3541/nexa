import {
  customers,
  expenses,
  getDb,
  orderItems,
  orders,
  payments,
  products,
  type Executor,
} from '@nexa/database';
import type { AnalyticsResponse, MetricDelta } from '@nexa/types';
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { DAY_MS, bucketKey, enumerateDays, isoDay, percentChange, changeDirection, type Period } from '../lib/dates.js';
import { expenseBreakdown } from './expenses.service.js';
import { outstandingTotals } from './invoices.service.js';

/**
 * Analytics primitives.
 *
 * Every figure the product shows — dashboard, charts, AI answers, daily brief —
 * comes from these functions. There is exactly one definition of "revenue" in
 * the codebase, so the AI can never quote a number the dashboard disagrees with.
 *
 * Revenue is recognised on **order value at the time of sale**, excluding
 * cancelled orders. Profit is revenue minus tax minus recorded cost of goods.
 */

/**
 * Must stay table-qualified: several of these queries join `customers`, which
 * also has a `status` column, and an unqualified reference is ambiguous.
 */
const ACTIVE_ORDER = sql`${orders.status} <> 'cancelled'`;

export interface RangeTotals {
  revenueMinor: number;
  orderCount: number;
  costMinor: number;
  taxMinor: number;
  discountMinor: number;
}

export async function rangeTotals(db: Executor, businessId: string, from: Date, to: Date): Promise<RangeTotals> {
  const [row] = await db
    .select({
      revenue: sql<number>`coalesce(sum(${orders.totalMinor}), 0)::bigint`,
      count: sql<number>`count(*)::int`,
      cost: sql<number>`coalesce(sum(${orders.costMinor}), 0)::bigint`,
      tax: sql<number>`coalesce(sum(${orders.taxMinor}), 0)::bigint`,
      discount: sql<number>`coalesce(sum(${orders.discountMinor}), 0)::bigint`,
    })
    .from(orders)
    .where(and(eq(orders.businessId, businessId), gte(orders.occurredAt, from), lte(orders.occurredAt, to), ACTIVE_ORDER));

  return {
    revenueMinor: Number(row?.revenue ?? 0),
    orderCount: Number(row?.count ?? 0),
    costMinor: Number(row?.cost ?? 0),
    taxMinor: Number(row?.tax ?? 0),
    discountMinor: Number(row?.discount ?? 0),
  };
}

export async function expenseTotal(db: Executor, businessId: string, from: Date, to: Date): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${expenses.amountMinor}), 0)::bigint` })
    .from(expenses)
    .where(and(eq(expenses.businessId, businessId), gte(expenses.spentAt, from), lte(expenses.spentAt, to)));
  return Number(row?.total ?? 0);
}

export async function revenueSeries(
  db: Executor,
  businessId: string,
  from: Date,
  to: Date,
  granularity: 'day' | 'week' | 'month' = 'day',
): Promise<Array<{ date: string; revenue: number; orders: number }>> {
  const rows = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${orders.occurredAt}), 'YYYY-MM-DD')`,
      revenue: sql<number>`coalesce(sum(${orders.totalMinor}), 0)::bigint`,
      count: sql<number>`count(*)::int`,
    })
    .from(orders)
    .where(and(eq(orders.businessId, businessId), gte(orders.occurredAt, from), lte(orders.occurredAt, to), ACTIVE_ORDER))
    .groupBy(sql`date_trunc('day', ${orders.occurredAt})`);

  return densify(rows.map((r) => ({ date: r.day, value: Number(r.revenue), count: Number(r.count) })), from, to, granularity).map(
    (bucket) => ({ date: bucket.date, revenue: bucket.value, orders: bucket.count }),
  );
}

export async function expenseSeries(
  db: Executor,
  businessId: string,
  from: Date,
  to: Date,
  granularity: 'day' | 'week' | 'month' = 'day',
): Promise<Array<{ date: string; value: number }>> {
  const rows = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${expenses.spentAt}), 'YYYY-MM-DD')`,
      total: sql<number>`coalesce(sum(${expenses.amountMinor}), 0)::bigint`,
    })
    .from(expenses)
    .where(and(eq(expenses.businessId, businessId), gte(expenses.spentAt, from), lte(expenses.spentAt, to)))
    .groupBy(sql`date_trunc('day', ${expenses.spentAt})`);

  return densify(rows.map((r) => ({ date: r.day, value: Number(r.total), count: 0 })), from, to, granularity).map((bucket) => ({
    date: bucket.date,
    value: bucket.value,
  }));
}

/** Fills missing days with zeros and rolls them into week/month buckets. */
function densify(
  rows: Array<{ date: string; value: number; count: number }>,
  from: Date,
  to: Date,
  granularity: 'day' | 'week' | 'month',
): Array<{ date: string; value: number; count: number }> {
  const byDay = new Map(rows.map((row) => [row.date, row]));
  const buckets = new Map<string, { date: string; value: number; count: number }>();

  for (const day of enumerateDays(from, to)) {
    const key = bucketKey(new Date(`${day}T00:00:00.000Z`), granularity);
    const existing = buckets.get(key) ?? { date: key, value: 0, count: 0 };
    const source = byDay.get(day);
    if (source) {
      existing.value += source.value;
      existing.count += source.count;
    }
    buckets.set(key, existing);
  }
  return [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export async function topProducts(
  db: Executor,
  businessId: string,
  from: Date,
  to: Date,
  limit = 5,
): Promise<Array<{ id: string; name: string; unitsSold: number; revenueMinor: number; profitMinor: number }>> {
  const rows = await db
    .select({
      id: orderItems.productId,
      name: orderItems.name,
      units: sql<number>`sum(${orderItems.quantity})::int`,
      revenue: sql<number>`sum(${orderItems.totalMinor})::bigint`,
      cost: sql<number>`sum(${orderItems.quantity} * ${orderItems.unitCostMinor})::bigint`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(
      and(
        eq(orderItems.businessId, businessId),
        gte(orders.occurredAt, from),
        lte(orders.occurredAt, to),
        sql`${orders.status} <> 'cancelled'`,
      ),
    )
    .groupBy(orderItems.productId, orderItems.name)
    .orderBy(desc(sql`sum(${orderItems.totalMinor})`))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id ?? '',
    name: row.name,
    unitsSold: Number(row.units),
    revenueMinor: Number(row.revenue),
    profitMinor: Number(row.revenue) - Number(row.cost),
  }));
}

/** Units per product for a window — used to detect rising/declining lines. */
async function productUnits(db: Executor, businessId: string, from: Date, to: Date): Promise<Map<string, { name: string; units: number }>> {
  const rows = await db
    .select({
      id: orderItems.productId,
      name: orderItems.name,
      units: sql<number>`sum(${orderItems.quantity})::int`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(
      and(
        eq(orderItems.businessId, businessId),
        gte(orders.occurredAt, from),
        lte(orders.occurredAt, to),
        sql`${orders.status} <> 'cancelled'`,
      ),
    )
    .groupBy(orderItems.productId, orderItems.name);

  const map = new Map<string, { name: string; units: number }>();
  for (const row of rows) {
    if (!row.id) continue;
    map.set(row.id, { name: row.name, units: Number(row.units) });
  }
  return map;
}

export async function productMomentum(
  db: Executor,
  businessId: string,
  period: Period,
): Promise<{
  rising: Array<{ id: string; name: string; unitsSold: number; previousUnitsSold: number; changePercent: number }>;
  declining: Array<{ id: string; name: string; unitsSold: number; previousUnitsSold: number; changePercent: number }>;
}> {
  const [current, previous] = await Promise.all([
    productUnits(db, businessId, period.from, period.to),
    productUnits(db, businessId, period.previous.from, period.previous.to),
  ]);

  const rising: Array<{ id: string; name: string; unitsSold: number; previousUnitsSold: number; changePercent: number }> = [];
  const declining: typeof rising = [];

  for (const [id, before] of previous) {
    const now = current.get(id);
    const unitsSold = now?.units ?? 0;
    const change = percentChange(unitsSold, before.units);
    if (change === null) continue;
    // Ignore noise from products that barely moved in the baseline window.
    if (before.units < 3 && unitsSold < 3) continue;
    if (change <= -20) declining.push({ id, name: before.name, unitsSold, previousUnitsSold: before.units, changePercent: change });
    if (change >= 20) rising.push({ id, name: now?.name ?? before.name, unitsSold, previousUnitsSold: before.units, changePercent: change });
  }

  for (const [id, now] of current) {
    if (previous.has(id)) continue;
    if (now.units < 3) continue;
    rising.push({ id, name: now.name, unitsSold: now.units, previousUnitsSold: 0, changePercent: 100 });
  }

  declining.sort((a, b) => a.changePercent - b.changePercent);
  rising.sort((a, b) => b.changePercent - a.changePercent);
  return { rising: rising.slice(0, 5), declining: declining.slice(0, 5) };
}

export async function topCustomers(
  db: Executor,
  businessId: string,
  limit = 5,
): Promise<Array<{ id: string; name: string; totalSpentMinor: number; orderCount: number }>> {
  const rows = await db
    .select({
      id: customers.id,
      name: customers.name,
      total: customers.totalSpentMinor,
      count: customers.orderCount,
    })
    .from(customers)
    .where(and(eq(customers.businessId, businessId), sql`${customers.orderCount} > 0`))
    .orderBy(desc(customers.totalSpentMinor))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    totalSpentMinor: Number(row.total),
    orderCount: row.count,
  }));
}

export interface CustomerStats {
  total: number;
  newCount: number;
  activeCount: number;
  inactiveCount: number;
  returningCount: number;
  repeatRate: number | null;
  inactiveValueMinor: number;
  averageDaysSincePurchase: number;
}

export async function customerStats(
  db: Executor,
  businessId: string,
  period: Period,
  inactiveDays = 60,
  now = new Date(),
): Promise<CustomerStats> {
  const inactiveCutoff = new Date(now.getTime() - inactiveDays * DAY_MS);

  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      newCount: sql<number>`count(*) filter (where ${customers.createdAt} >= ${period.from} and ${customers.createdAt} <= ${period.to})::int`,
      activeCount: sql<number>`count(*) filter (where ${customers.lastPurchaseAt} >= ${inactiveCutoff})::int`,
      inactiveCount: sql<number>`count(*) filter (where ${customers.orderCount} > 0 and ${customers.lastPurchaseAt} < ${inactiveCutoff})::int`,
      returningCount: sql<number>`count(*) filter (where ${customers.orderCount} >= 2)::int`,
      purchasers: sql<number>`count(*) filter (where ${customers.orderCount} > 0)::int`,
      inactiveValue: sql<number>`coalesce(sum(${customers.totalSpentMinor}) filter (where ${customers.orderCount} > 0 and ${customers.lastPurchaseAt} < ${inactiveCutoff}), 0)::bigint`,
      avgDays: sql<number>`coalesce(avg(extract(epoch from (${now} - ${customers.lastPurchaseAt})) / 86400) filter (where ${customers.orderCount} > 0 and ${customers.lastPurchaseAt} < ${inactiveCutoff}), 0)`,
    })
    .from(customers)
    .where(eq(customers.businessId, businessId));

  const purchasers = Number(row?.purchasers ?? 0);
  const returning = Number(row?.returningCount ?? 0);

  return {
    total: Number(row?.total ?? 0),
    newCount: Number(row?.newCount ?? 0),
    activeCount: Number(row?.activeCount ?? 0),
    inactiveCount: Number(row?.inactiveCount ?? 0),
    returningCount: returning,
    repeatRate: purchasers > 0 ? (returning / purchasers) * 100 : null,
    inactiveValueMinor: Number(row?.inactiveValue ?? 0),
    averageDaysSincePurchase: Math.round(Number(row?.avgDays ?? 0)),
  };
}

/** Splits revenue between first-time and returning buyers within a window. */
export async function revenueByCustomerType(
  db: Executor,
  businessId: string,
  from: Date,
  to: Date,
): Promise<{ repeatMinor: number; newMinor: number }> {
  const [row] = await db
    .select({
      repeat: sql<number>`coalesce(sum(${orders.totalMinor}) filter (where ${customers.createdAt} < ${from}), 0)::bigint`,
      fresh: sql<number>`coalesce(sum(${orders.totalMinor}) filter (where ${customers.createdAt} >= ${from}), 0)::bigint`,
    })
    .from(orders)
    .innerJoin(customers, eq(customers.id, orders.customerId))
    .where(and(eq(orders.businessId, businessId), gte(orders.occurredAt, from), lte(orders.occurredAt, to), ACTIVE_ORDER));

  return { repeatMinor: Number(row?.repeat ?? 0), newMinor: Number(row?.fresh ?? 0) };
}

export async function paymentMix(
  db: Executor,
  businessId: string,
  from: Date,
  to: Date,
): Promise<Array<{ method: string; amountMinor: number; share: number }>> {
  const rows = await db
    .select({ method: payments.method, total: sql<number>`coalesce(sum(${payments.amountMinor}), 0)::bigint` })
    .from(payments)
    .where(and(eq(payments.businessId, businessId), gte(payments.receivedAt, from), lte(payments.receivedAt, to)))
    .groupBy(payments.method)
    .orderBy(desc(sql`sum(${payments.amountMinor})`));

  const total = rows.reduce((sum, row) => sum + Number(row.total), 0);
  return rows.map((row) => ({
    method: row.method,
    amountMinor: Number(row.total),
    share: total > 0 ? (Number(row.total) / total) * 100 : 0,
  }));
}

export async function busiestWeekday(
  db: Executor,
  businessId: string,
  from: Date,
  to: Date,
): Promise<{ weekday: string; revenueMinor: number } | null> {
  const rows = await db
    .select({
      weekday: sql<string>`trim(to_char(${orders.occurredAt}, 'Day'))`,
      revenue: sql<number>`coalesce(sum(${orders.totalMinor}), 0)::bigint`,
    })
    .from(orders)
    .where(and(eq(orders.businessId, businessId), gte(orders.occurredAt, from), lte(orders.occurredAt, to), ACTIVE_ORDER))
    .groupBy(sql`trim(to_char(${orders.occurredAt}, 'Day'))`)
    .orderBy(desc(sql`sum(${orders.totalMinor})`))
    .limit(1);

  const row = rows[0];
  return row ? { weekday: row.weekday, revenueMinor: Number(row.revenue) } : null;
}

export function delta(current: number, previous: number): MetricDelta {
  const change = percentChange(current, previous);
  return { value: current, previous, changePercent: change, direction: changeDirection(change) };
}

/* -------------------------------------------------------------------------- */
/* Full analytics response                                                     */
/* -------------------------------------------------------------------------- */

export async function buildAnalytics(
  businessId: string,
  period: Period,
  granularity: 'day' | 'week' | 'month',
  currency: string,
  now = new Date(),
): Promise<AnalyticsResponse> {
  const db = await getDb();

  const [current, previous, expenseNow, expenseBefore, revSeries, expSeries, breakdown, perf, mix, stats, outstanding] =
    await Promise.all([
      rangeTotals(db, businessId, period.from, period.to),
      rangeTotals(db, businessId, period.previous.from, period.previous.to),
      expenseTotal(db, businessId, period.from, period.to),
      expenseTotal(db, businessId, period.previous.from, period.previous.to),
      revenueSeries(db, businessId, period.from, period.to, granularity),
      expenseSeries(db, businessId, period.from, period.to, granularity),
      expenseBreakdown(db, businessId, period.from, period.to),
      topProducts(db, businessId, period.from, period.to, 10),
      paymentMix(db, businessId, period.from, period.to),
      customerStats(db, businessId, period, 60, now),
      outstandingTotals(db, businessId, now),
    ]);

  const profitNow = current.revenueMinor - current.taxMinor - current.costMinor - expenseNow;
  const profitBefore = previous.revenueMinor - previous.taxMinor - previous.costMinor - expenseBefore;

  const expenseByDate = new Map(expSeries.map((row) => [row.date, row.value]));

  return {
    range: { from: period.from.toISOString(), to: period.to.toISOString(), granularity },
    currency,
    revenue: {
      series: revSeries.map((row) => ({ date: row.date, value: row.revenue })),
      total: current.revenueMinor,
      previousTotal: previous.revenueMinor,
    },
    expenses: { series: expSeries, total: expenseNow, previousTotal: expenseBefore },
    profit: {
      series: revSeries.map((row) => ({ date: row.date, value: row.revenue - (expenseByDate.get(row.date) ?? 0) })),
      total: profitNow,
      previousTotal: profitBefore,
    },
    orders: {
      series: revSeries.map((row) => ({ date: row.date, value: row.orders })),
      total: current.orderCount,
      previousTotal: previous.orderCount,
    },
    customers: {
      newCount: stats.newCount,
      returningCount: stats.returningCount,
      activeCount: stats.activeCount,
      inactiveCount: stats.inactiveCount,
      retentionRate: stats.total > 0 ? (stats.activeCount / stats.total) * 100 : null,
      repeatRate: stats.repeatRate,
    },
    expenseBreakdown: breakdown,
    productPerformance: perf,
    paymentMix: mix,
    outstanding,
  };
}

export { isoDay };
