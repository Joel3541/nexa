import { formatMoney } from '@nexa/config';
import { getDb, type Business, type BusinessSettingsRow } from '@nexa/database';
import type {
  BriefHighlight,
  BusinessHealth,
  BusinessHealthFactor,
  DailyBrief,
  DashboardResponse,
} from '@nexa/types';
import { resolvePeriod, type Period } from '../lib/dates.js';
import { overdueInvoices, outstandingTotals } from './invoices.service.js';
import { inventoryValuation, lowStockProducts } from './products.service.js';
import { listAppointments, listTasks } from './work.service.js';
import {
  customerStats,
  delta,
  expenseSeries,
  expenseTotal,
  rangeTotals,
  revenueSeries,
  topCustomers,
  topProducts,
} from './analytics.service.js';

/* -------------------------------------------------------------------------- */
/* Business health                                                             */
/* -------------------------------------------------------------------------- */

interface HealthInput {
  revenueNow: number;
  revenueBefore: number;
  expensesNow: number;
  profitNow: number;
  activeCustomers: number;
  totalCustomers: number;
  inactiveCustomers: number;
  overdueMinor: number;
  outstandingMinor: number;
  lowStockCount: number;
  trackedProductCount: number;
  ordersNow: number;
  ordersBefore: number;
  openTasks: number;
  overdueTasks: number;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * Composite health score.
 *
 * Each factor is scored 0–100 independently and then weighted, so the headline
 * number is explainable: the UI shows the factor breakdown rather than an
 * unexplained score. Weights favour cash and customers, which is what actually
 * kills small businesses.
 */
export function computeHealth(input: HealthInput, now: Date): BusinessHealth {
  const factors: BusinessHealthFactor[] = [];

  const revenueChange =
    input.revenueBefore > 0 ? ((input.revenueNow - input.revenueBefore) / input.revenueBefore) * 100 : input.revenueNow > 0 ? 50 : 0;
  factors.push({
    key: 'revenue_trend',
    label: 'Revenue trend',
    score: clamp(60 + revenueChange * 1.5),
    weight: 25,
    status: revenueChange >= 0 ? 'good' : revenueChange > -15 ? 'watch' : 'risk',
    detail:
      input.revenueBefore > 0
        ? `${revenueChange >= 0 ? 'Up' : 'Down'} ${Math.abs(Math.round(revenueChange))}% versus the previous period.`
        : 'Not enough history yet to compare periods.',
  });

  const activeShare = input.totalCustomers > 0 ? (input.activeCustomers / input.totalCustomers) * 100 : 0;
  factors.push({
    key: 'customer_activity',
    label: 'Customer activity',
    score: clamp(input.totalCustomers === 0 ? 40 : activeShare * 1.25),
    weight: 20,
    status: activeShare >= 60 ? 'good' : activeShare >= 35 ? 'watch' : 'risk',
    detail:
      input.totalCustomers === 0
        ? 'No customers recorded yet.'
        : `${input.activeCustomers} of ${input.totalCustomers} customers bought in the last 60 days; ${input.inactiveCustomers} have gone quiet.`,
  });

  const overdueShare = input.revenueNow > 0 ? (input.overdueMinor / input.revenueNow) * 100 : input.overdueMinor > 0 ? 100 : 0;
  factors.push({
    key: 'receivables',
    label: 'Money owed to you',
    score: clamp(100 - overdueShare * 2),
    weight: 20,
    status: overdueShare < 5 ? 'good' : overdueShare < 20 ? 'watch' : 'risk',
    detail:
      input.overdueMinor > 0
        ? `Overdue balances equal ${Math.round(overdueShare)}% of period revenue.`
        : 'Nothing is overdue.',
  });

  const lowStockShare = input.trackedProductCount > 0 ? (input.lowStockCount / input.trackedProductCount) * 100 : 0;
  factors.push({
    key: 'inventory',
    label: 'Stock position',
    score: clamp(input.trackedProductCount === 0 ? 75 : 100 - lowStockShare * 1.6),
    weight: 15,
    status: lowStockShare < 10 ? 'good' : lowStockShare < 30 ? 'watch' : 'risk',
    detail:
      input.trackedProductCount === 0
        ? 'No stock-tracked products.'
        : `${input.lowStockCount} of ${input.trackedProductCount} tracked products are at or below their minimum.`,
  });

  const margin = input.revenueNow > 0 ? (input.profitNow / input.revenueNow) * 100 : 0;
  factors.push({
    key: 'profitability',
    label: 'Profitability',
    score: clamp(input.revenueNow === 0 ? 40 : 50 + margin * 1.5),
    weight: 12,
    status: margin >= 15 ? 'good' : margin >= 0 ? 'watch' : 'risk',
    detail:
      input.revenueNow > 0
        ? `Net margin is ${Math.round(margin)}% after cost of goods and expenses.`
        : 'No revenue recorded in this period.',
  });

  const orderChange =
    input.ordersBefore > 0 ? ((input.ordersNow - input.ordersBefore) / input.ordersBefore) * 100 : input.ordersNow > 0 ? 25 : 0;
  factors.push({
    key: 'operations',
    label: 'Operating rhythm',
    score: clamp(55 + orderChange - input.overdueTasks * 5),
    weight: 8,
    status: input.overdueTasks === 0 && orderChange >= 0 ? 'good' : input.overdueTasks > 3 ? 'risk' : 'watch',
    detail: `${input.ordersNow} orders this period; ${input.openTasks} open tasks${input.overdueTasks > 0 ? `, ${input.overdueTasks} overdue` : ''}.`,
  });

  const totalWeight = factors.reduce((sum, factor) => sum + factor.weight, 0);
  const score = clamp(factors.reduce((sum, factor) => sum + factor.score * factor.weight, 0) / totalWeight);

  return {
    score,
    grade: score >= 80 ? 'excellent' : score >= 65 ? 'good' : score >= 45 ? 'fair' : 'at_risk',
    factors,
    computedAt: now.toISOString(),
  };
}

/* -------------------------------------------------------------------------- */
/* Shared snapshot                                                             */
/* -------------------------------------------------------------------------- */

export interface BusinessSnapshot {
  period: Period;
  current: Awaited<ReturnType<typeof rangeTotals>>;
  previous: Awaited<ReturnType<typeof rangeTotals>>;
  expensesNow: number;
  expensesBefore: number;
  profitNow: number;
  profitBefore: number;
  outstanding: Awaited<ReturnType<typeof outstandingTotals>>;
  stats: Awaited<ReturnType<typeof customerStats>>;
  lowStock: Awaited<ReturnType<typeof lowStockProducts>>;
  valuation: Awaited<ReturnType<typeof inventoryValuation>>;
  openTaskCount: number;
  overdueTaskCount: number;
  upcomingAppointmentCount: number;
  health: BusinessHealth;
}

/**
 * The single computation behind the dashboard, the health score and the AI's
 * `get_business_summary` tool.
 *
 * Having one implementation is the point: an earlier version computed health in
 * two places with slightly different inputs, and the assistant reported a
 * different score than the dashboard for the same business on the same day.
 * That class of contradiction is fatal to trust in an AI-native product, so
 * both paths now read from here.
 */
export async function collectSnapshot(
  businessId: string,
  settings: BusinessSettingsRow,
  periodKey: Parameters<typeof resolvePeriod>[0] = 'last_30_days',
  now = new Date(),
): Promise<BusinessSnapshot> {
  const db = await getDb();
  const period = resolvePeriod(periodKey, now);

  const [current, previous, expensesNow, expensesBefore, outstanding, stats, lowStock, valuation, openTasks, overdueTasks, appointments] =
    await Promise.all([
      rangeTotals(db, businessId, period.from, period.to),
      rangeTotals(db, businessId, period.previous.from, period.previous.to),
      expenseTotal(db, businessId, period.from, period.to),
      expenseTotal(db, businessId, period.previous.from, period.previous.to),
      outstandingTotals(db, businessId, now),
      customerStats(db, businessId, period, 60, now),
      lowStockProducts(businessId, settings.lowStockThreshold, 50, now),
      inventoryValuation(businessId),
      listTasks(businessId, { page: 1, pageSize: 1, status: 'todo' }, now),
      listTasks(businessId, { page: 1, pageSize: 50, status: 'todo', dueBefore: now.toISOString() }, now),
      listAppointments(businessId, {
        page: 1,
        pageSize: 1,
        from: now.toISOString(),
        to: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      }),
    ]);

  const profitNow = current.revenueMinor - current.taxMinor - current.costMinor - expensesNow;
  const profitBefore = previous.revenueMinor - previous.taxMinor - previous.costMinor - expensesBefore;

  const health = computeHealth(
    {
      revenueNow: current.revenueMinor,
      revenueBefore: previous.revenueMinor,
      expensesNow,
      profitNow,
      activeCustomers: stats.activeCount,
      totalCustomers: stats.total,
      inactiveCustomers: stats.inactiveCount,
      overdueMinor: outstanding.overdueMinor,
      outstandingMinor: outstanding.totalMinor,
      lowStockCount: lowStock.length,
      trackedProductCount: Math.max(valuation.trackedCount, 1),
      ordersNow: current.orderCount,
      ordersBefore: previous.orderCount,
      openTasks: openTasks.total,
      overdueTasks: overdueTasks.total,
    },
    now,
  );

  return {
    period,
    current,
    previous,
    expensesNow,
    expensesBefore,
    profitNow,
    profitBefore,
    outstanding,
    stats,
    lowStock,
    valuation,
    openTaskCount: openTasks.total,
    overdueTaskCount: overdueTasks.total,
    upcomingAppointmentCount: appointments.total,
    health,
  };
}

/* -------------------------------------------------------------------------- */
/* Daily brief                                                                 */
/* -------------------------------------------------------------------------- */

function greetingFor(now: Date, name: string): string {
  const hour = now.getUTCHours();
  const part = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  return `${part}, ${name.split(' ')[0]}.`;
}

/**
 * Composes the NEXA Morning Brief.
 *
 * Every sentence is templated from a retrieved metric — there is no generative
 * step here, which is exactly why `aiGenerated` is reported as false. The brief
 * is allowed to be quiet: if nothing needs attention, it says so rather than
 * manufacturing urgency.
 */
export function buildBrief(args: {
  userName: string;
  currency: string;
  locale: string;
  now: Date;
  revenue: { value: number; previous: number; changePercent: number | null };
  overdue: { count: number; amountMinor: number; oldestDays: number };
  lowStock: Array<{ name: string; quantity: number; daysRemaining: number | null; confidence: string | null }>;
  inactiveCustomers: number;
  inactiveValueMinor: number;
  openTasks: number;
  overdueTasks: number;
  appointmentsToday: number;
}): DailyBrief {
  const money = (minor: number) => formatMoney(minor, args.currency, { locale: args.locale });
  const highlights: BriefHighlight[] = [];

  const changeText =
    args.revenue.changePercent === null
      ? `Revenue is ${money(args.revenue.value)} so far.`
      : `Revenue is ${money(args.revenue.value)}, ${Math.abs(Math.round(args.revenue.changePercent))}% ${
          args.revenue.changePercent >= 0 ? 'up on' : 'down on'
        } the previous period.`;

  highlights.push({
    id: 'revenue',
    severity: (args.revenue.changePercent ?? 0) >= 0 ? 'success' : 'warning',
    title: changeText,
    detail: `Previous period: ${money(args.revenue.previous)}.`,
    metric: money(args.revenue.value),
    actionLabel: 'See analytics',
    actionHref: '/app/analytics',
  });

  if (args.overdue.count > 0) {
    highlights.push({
      id: 'overdue',
      severity: args.overdue.oldestDays > 30 ? 'critical' : 'warning',
      title: `${args.overdue.count} overdue invoice${args.overdue.count === 1 ? '' : 's'} worth ${money(args.overdue.amountMinor)}.`,
      detail: `The oldest is ${args.overdue.oldestDays} days past due.`,
      metric: money(args.overdue.amountMinor),
      actionLabel: 'Chase payments',
      actionHref: '/app/invoices?overdue=1',
    });
  }

  const urgentStock = args.lowStock.filter((item) => item.daysRemaining !== null && item.daysRemaining <= 14);
  if (urgentStock.length > 0) {
    const first = urgentStock[0]!;
    highlights.push({
      id: 'stock',
      severity: first.quantity === 0 ? 'critical' : 'warning',
      title:
        urgentStock.length === 1
          ? `${first.name} is projected to run out in about ${first.daysRemaining} days.`
          : `${urgentStock.length} products are projected to run out within 14 days.`,
      detail: `${first.name}: ${first.quantity} in stock${first.confidence ? ` (${first.confidence} confidence projection)` : ''}.`,
      metric: `${urgentStock.length}`,
      actionLabel: 'Review stock',
      actionHref: '/app/products?lowStock=1',
    });
  }

  if (args.inactiveCustomers > 0) {
    highlights.push({
      id: 'inactive',
      severity: 'info',
      title: `${args.inactiveCustomers} customers haven't purchased in more than 60 days.`,
      detail: `They represent ${money(args.inactiveValueMinor)} of past spend.`,
      metric: `${args.inactiveCustomers}`,
      actionLabel: 'View customers',
      actionHref: '/app/customers?segment=inactive',
    });
  }

  if (args.openTasks > 0 || args.appointmentsToday > 0) {
    highlights.push({
      id: 'today',
      severity: args.overdueTasks > 0 ? 'warning' : 'info',
      title: `${args.openTasks} open task${args.openTasks === 1 ? '' : 's'}${
        args.appointmentsToday > 0 ? ` and ${args.appointmentsToday} appointment${args.appointmentsToday === 1 ? '' : 's'} today` : ''
      }.`,
      detail:
        args.overdueTasks > 0
          ? `${args.overdueTasks} ${args.overdueTasks === 1 ? 'is' : 'are'} already past ${args.overdueTasks === 1 ? 'its' : 'their'} due date.`
          : 'Nothing overdue.',
      metric: `${args.openTasks}`,
      actionLabel: 'Open tasks',
      actionHref: '/app/tasks',
    });
  }

  // One recommendation, chosen by financial impact — not a menu of options.
  let recommendation: DailyBrief['recommendation'] = null;
  if (args.overdue.count > 0) {
    recommendation = {
      title: `Follow up on ${args.overdue.count} overdue invoice${args.overdue.count === 1 ? '' : 's'}`,
      rationale: `${money(args.overdue.amountMinor)} is money you have already earned. It is the fastest cash you can collect today.`,
      actionLabel: 'Review overdue invoices',
      actionHref: '/app/invoices?overdue=1',
    };
  } else if (urgentStock.length > 0) {
    recommendation = {
      title: `Reorder ${urgentStock[0]!.name}`,
      rationale: `At the current rate of sale it runs out in roughly ${urgentStock[0]!.daysRemaining} days. Running out costs you sales you would otherwise make.`,
      actionLabel: 'Review stock',
      actionHref: '/app/products?lowStock=1',
    };
  } else if (args.inactiveCustomers >= 5) {
    recommendation = {
      title: `Reactivate ${args.inactiveCustomers} lapsed customers`,
      rationale: `They already know and trust you — ${money(args.inactiveValueMinor)} of historic spend is sitting idle.`,
      actionLabel: 'Build a campaign',
      actionHref: '/app/customers?segment=inactive',
    };
  }

  const headline =
    args.overdue.count > 0
      ? `${money(args.overdue.amountMinor)} is overdue — that's today's priority.`
      : urgentStock.length > 0
        ? 'Stock needs attention before it costs you sales.'
        : (args.revenue.changePercent ?? 0) >= 0
          ? 'Things are moving in the right direction.'
          : 'Revenue softened — worth a look.';

  return {
    greeting: greetingFor(args.now, args.userName),
    generatedAt: args.now.toISOString(),
    headline,
    highlights,
    recommendation,
    // Composed from retrieved metrics, not written by a model. Reported
    // honestly so the UI never implies more than actually happened.
    aiGenerated: false,
  };
}

/* -------------------------------------------------------------------------- */
/* Dashboard                                                                   */
/* -------------------------------------------------------------------------- */

export async function buildDashboard(
  business: Business,
  settings: BusinessSettingsRow,
  user: { fullName: string },
  periodKey: Parameters<typeof resolvePeriod>[0] = 'last_30_days',
  now = new Date(),
): Promise<DashboardResponse> {
  const db = await getDb();
  const businessId = business.id;
  const snapshot = await collectSnapshot(businessId, settings, periodKey, now);
  const { period, current, previous, outstanding, stats } = snapshot;

  const [series, expenseDaily, products, customersTop, overdue, tasksResult, appointmentsResult] = await Promise.all([
    revenueSeries(db, businessId, period.from, period.to, 'day'),
    expenseSeries(db, businessId, period.from, period.to, 'day'),
    topProducts(db, businessId, period.from, period.to, 5),
    topCustomers(db, businessId, 5),
    overdueInvoices(businessId, 8, now),
    listTasks(businessId, { page: 1, pageSize: 5, status: 'todo' }, now),
    listAppointments(businessId, {
      page: 1,
      pageSize: 5,
      from: now.toISOString(),
      to: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    }),
  ]);

  const expenseSeriesByDate = new Map(expenseDaily.map((row) => [row.date, row.value]));

  const brief = buildBrief({
    userName: user.fullName,
    currency: business.currency,
    locale: business.locale,
    now,
    revenue: {
      value: current.revenueMinor,
      previous: previous.revenueMinor,
      changePercent: delta(current.revenueMinor, previous.revenueMinor).changePercent,
    },
    overdue: {
      // The true count, not the length of the display-capped list.
      count: outstanding.overdueCount,
      amountMinor: outstanding.overdueMinor,
      oldestDays: overdue[0]?.daysOverdue ?? 0,
    },
    lowStock: snapshot.lowStock.map((product) => ({
      name: product.name,
      quantity: product.quantity,
      daysRemaining: product.daysOfStockRemaining,
      confidence: product.stockConfidence,
    })),
    inactiveCustomers: stats.inactiveCount,
    inactiveValueMinor: stats.inactiveValueMinor,
    openTasks: snapshot.openTaskCount,
    overdueTasks: snapshot.overdueTaskCount,
    appointmentsToday: appointmentsResult.rows.filter(
      (appointment) => appointment.startsAt.slice(0, 10) === now.toISOString().slice(0, 10),
    ).length,
  });

  return {
    range: { from: period.from.toISOString(), to: period.to.toISOString(), label: period.label },
    currency: business.currency,
    finance: {
      revenue: delta(current.revenueMinor, previous.revenueMinor),
      expenses: delta(snapshot.expensesNow, snapshot.expensesBefore),
      profit: delta(snapshot.profitNow, snapshot.profitBefore),
      outstandingMinor: outstanding.totalMinor,
      overdueMinor: outstanding.overdueMinor,
      ordersCount: delta(current.orderCount, previous.orderCount),
      averageOrderMinor: current.orderCount > 0 ? Math.round(current.revenueMinor / current.orderCount) : 0,
    },
    health: snapshot.health,
    brief,
    series: series.map((row) => ({
      date: row.date,
      revenue: row.revenue,
      expenses: expenseSeriesByDate.get(row.date) ?? 0,
      profit: row.revenue - (expenseSeriesByDate.get(row.date) ?? 0),
      orders: row.orders,
    })),
    topProducts: products.map((product) => ({
      id: product.id,
      name: product.name,
      unitsSold: product.unitsSold,
      revenueMinor: product.revenueMinor,
    })),
    topCustomers: customersTop,
    lowStock: snapshot.lowStock.slice(0, 8).map((product) => ({
      id: product.id,
      name: product.name,
      quantity: product.quantity,
      minStock: product.minStock,
      daysRemaining: product.daysOfStockRemaining,
    })),
    overdueInvoices: overdue.map((invoice) => ({
      id: invoice.id,
      number: invoice.number,
      customerName: invoice.customerName,
      balanceMinor: invoice.balanceMinor,
      daysOverdue: invoice.daysOverdue,
    })),
    upcoming: { tasks: tasksResult.rows, appointments: appointmentsResult.rows },
  };
}
