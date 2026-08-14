import { formatMoney } from '@nexa/config';
import {
  businessSettings,
  businesses,
  customers,
  getDb,
  invoices,
  orders,
  products,
  type Business,
  type BusinessSettingsRow,
} from '@nexa/database';
import {
  ToolError,
  defineTool,
  toolRegistry,
  type ToolContext,
  type ToolDefinition,
  type BusinessSummaryResult,
  type CustomerDetailResult,
  type CustomerRow,
  type CustomersResult,
  type ExpensesResult,
  type InventoryResult,
  type InvoicesResult,
  type LowStockResult,
  type OrdersResult,
  type OverdueInvoicesResult,
  type RevenueResult,
  type SalesAnalysisResult,
  type SegmentAnalysisResult,
} from '@nexa/ai';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { DAY_MS, resolvePeriod, type PeriodKey } from '../lib/dates.js';
import {
  busiestWeekday,
  customerStats,
  expenseTotal,
  productMomentum,
  rangeTotals,
  revenueByCustomerType,
  revenueSeries,
  topProducts,
} from '../services/analytics.service.js';
import { createCampaign } from '../services/campaigns.service.js';
import {
  createCustomer,
  favouriteProducts,
  findInactiveCustomers,
  segmentsFor,
} from '../services/customers.service.js';
import { collectSnapshot } from '../services/dashboard.service.js';
import { expenseBreakdown, largestExpenses } from '../services/expenses.service.js';
import { createInvoice, listInvoices, outstandingTotals, overdueInvoices } from '../services/invoices.service.js';
import { inventoryValuation, lowStockProducts, salesVelocity, projectStock } from '../services/products.service.js';
import { listOrders } from '../services/orders.service.js';
import { createTask, listTasks, listAppointments } from '../services/work.service.js';

/**
 * Concrete AI tool implementations.
 *
 * Every tool here is a thin, validated wrapper over the *same services the REST
 * API uses*. There is no second data path for the AI: if the dashboard says
 * revenue is X, a tool cannot report Y. The model never sees SQL, never
 * receives a database handle, and cannot reach a service that is not wrapped
 * by a registered tool.
 */

const periodSchema = z
  .enum(['today', 'yesterday', 'last_7_days', 'last_30_days', 'last_90_days', 'this_month', 'last_month', 'this_year'])
  .default('last_30_days');

async function loadBusiness(businessId: string): Promise<{ business: Business; settings: BusinessSettingsRow }> {
  const db = await getDb();
  const [row] = await db
    .select({ business: businesses, settings: businessSettings })
    .from(businesses)
    .innerJoin(businessSettings, eq(businessSettings.businessId, businesses.id))
    .where(eq(businesses.id, businessId))
    .limit(1);
  if (!row) throw new ToolError('not_found', 'That business could not be loaded.');
  return { business: row.business, settings: row.settings };
}

function fmt(ctx: ToolContext, minor: number): string {
  return formatMoney(minor, ctx.currency, { locale: ctx.locale });
}

function daysSince(date: Date | string | null, now: Date): number | null {
  if (!date) return null;
  const value = typeof date === 'string' ? new Date(date) : date;
  // Clamped at zero: a timestamp a few hours in the future (a booking, a
  // clock skew) must read as "today", never as "-1 days ago".
  return Math.max(0, Math.floor((now.getTime() - value.getTime()) / DAY_MS));
}

async function toCustomerRows(
  rows: Array<typeof customers.$inferSelect>,
  now: Date,
  averageSpendMinor: number,
): Promise<CustomerRow[]> {
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    totalSpentMinor: Number(row.totalSpentMinor),
    orderCount: row.orderCount,
    outstandingMinor: Number(row.outstandingMinor),
    lastPurchaseAt: row.lastPurchaseAt?.toISOString() ?? null,
    daysSinceLastPurchase: daysSince(row.lastPurchaseAt, now),
    segments: segmentsFor(
      {
        totalSpentMinor: Number(row.totalSpentMinor),
        orderCount: row.orderCount,
        outstandingMinor: Number(row.outstandingMinor),
        lastPurchaseAt: row.lastPurchaseAt,
        createdAt: row.createdAt,
        status: row.status,
      },
      { averageSpendMinor, now },
    ),
  }));
}

/* -------------------------------------------------------------------------- */
/* Read tools                                                                  */
/* -------------------------------------------------------------------------- */

const getBusinessSummary = defineTool({
  name: 'get_business_summary',
  label: 'Business summary',
  description:
    'Overall state of the business for a period: revenue vs the previous period, expenses, profit, order count, ' +
    'new and active customers, outstanding and overdue money, low-stock count, open tasks and the health score. ' +
    'Start here for broad questions like "how is my business doing" or "what should I focus on".',
  schema: z.object({ period: periodSchema }),
  kind: 'read',
  permission: 'analytics:read',
  requiresApproval: false,
  execute: async (input, ctx) => {
    const { business, settings } = await loadBusiness(ctx.businessId);
    // Same snapshot the dashboard renders from — the assistant and the UI can
    // never disagree about a figure because there is only one computation.
    const snapshot = await collectSnapshot(ctx.businessId, settings, input.period as PeriodKey, ctx.now);
    const { period, current, previous, outstanding, stats, health } = snapshot;

    const changePercent =
      previous.revenueMinor > 0 ? ((current.revenueMinor - previous.revenueMinor) / previous.revenueMinor) * 100 : null;

    const data: BusinessSummaryResult = {
      periodLabel: period.label,
      from: period.from.toISOString(),
      to: period.to.toISOString(),
      revenueMinor: current.revenueMinor,
      previousRevenueMinor: previous.revenueMinor,
      revenueChangePercent: changePercent,
      expensesMinor: snapshot.expensesNow,
      profitMinor: snapshot.profitNow,
      orderCount: current.orderCount,
      averageOrderMinor: current.orderCount > 0 ? Math.round(current.revenueMinor / current.orderCount) : 0,
      newCustomerCount: stats.newCount,
      activeCustomerCount: stats.activeCount,
      outstandingMinor: outstanding.totalMinor,
      overdueMinor: outstanding.overdueMinor,
      overdueInvoiceCount: outstanding.overdueCount,
      lowStockCount: snapshot.lowStock.length,
      openTaskCount: snapshot.openTaskCount,
      upcomingAppointmentCount: snapshot.upcomingAppointmentCount,
      healthScore: health.score,
      healthGrade: health.grade,
    };

    return {
      summary: `${business.name}, ${period.label}: revenue ${fmt(ctx, current.revenueMinor)}, profit ${fmt(ctx, snapshot.profitNow)}, health ${health.score}/100.`,
      data,
      citations: [{ label: 'Dashboard', href: '/app' }],
    };
  },
});

const getRevenue = defineTool({
  name: 'get_revenue',
  label: 'Revenue',
  description:
    'Revenue for a period with a daily series, order count, average order value, the best single day, and the ' +
    'equivalent previous period for comparison. Use for questions about sales totals or revenue movement.',
  schema: z.object({ period: periodSchema, compare: z.boolean().default(true) }),
  kind: 'read',
  permission: 'analytics:read',
  requiresApproval: false,
  execute: async (input, ctx) => {
    const db = await getDb();
    const period = resolvePeriod(input.period as PeriodKey, ctx.now);
    const [current, previous, series] = await Promise.all([
      rangeTotals(db, ctx.businessId, period.from, period.to),
      rangeTotals(db, ctx.businessId, period.previous.from, period.previous.to),
      revenueSeries(db, ctx.businessId, period.from, period.to, 'day'),
    ]);

    const best = series.reduce<{ date: string; value: number } | null>(
      (top, row) => (top === null || row.revenue > top.value ? { date: row.date, value: row.revenue } : top),
      null,
    );

    const data: RevenueResult = {
      from: period.from.toISOString(),
      to: period.to.toISOString(),
      totalMinor: current.revenueMinor,
      previousTotalMinor: previous.revenueMinor,
      changePercent:
        previous.revenueMinor > 0 ? ((current.revenueMinor - previous.revenueMinor) / previous.revenueMinor) * 100 : null,
      orderCount: current.orderCount,
      previousOrderCount: previous.orderCount,
      averageOrderMinor: current.orderCount > 0 ? Math.round(current.revenueMinor / current.orderCount) : 0,
      series: series.map((row) => ({ date: row.date, value: row.revenue })),
      bestDay: best && best.value > 0 ? best : null,
    };

    return {
      summary: `Revenue ${fmt(ctx, current.revenueMinor)} across ${current.orderCount} orders (${period.label}).`,
      data,
      citations: [{ label: 'Analytics', href: '/app/analytics' }],
    };
  },
});

const getExpenses = defineTool({
  name: 'get_expenses',
  label: 'Expenses',
  description:
    'Expense total for a period, the split by category with percentage shares, the largest individual expenses, ' +
    'and the previous period for comparison.',
  schema: z.object({ period: periodSchema, compare: z.boolean().default(true) }),
  kind: 'read',
  permission: 'expenses:read',
  requiresApproval: false,
  execute: async (input, ctx) => {
    const db = await getDb();
    const period = resolvePeriod(input.period as PeriodKey, ctx.now);
    const [total, previousTotal, byCategory, largest] = await Promise.all([
      expenseTotal(db, ctx.businessId, period.from, period.to),
      expenseTotal(db, ctx.businessId, period.previous.from, period.previous.to),
      expenseBreakdown(db, ctx.businessId, period.from, period.to),
      largestExpenses(db, ctx.businessId, period.from, period.to, 5),
    ]);

    const data: ExpensesResult = {
      from: period.from.toISOString(),
      to: period.to.toISOString(),
      totalMinor: total,
      previousTotalMinor: previousTotal,
      changePercent: previousTotal > 0 ? ((total - previousTotal) / previousTotal) * 100 : null,
      byCategory,
      largest,
    };

    return {
      summary: `Expenses ${fmt(ctx, total)} across ${byCategory.length} categories (${period.label}).`,
      data,
      citations: [{ label: 'Expenses', href: '/app/expenses' }],
    };
  },
});

const getCustomers = defineTool({
  name: 'get_customers',
  label: 'Customers',
  description:
    'Customer list with lifetime spend, order count, outstanding balance and days since last purchase. ' +
    'Filter by segment: vip, high_value, inactive, repeat, new, owes_money. Sort by spend, orders or recency. ' +
    'Use `inactiveDays` to change what counts as lapsed (default 60).',
  schema: z.object({
    segment: z.enum(['vip', 'high_value', 'inactive', 'repeat', 'new', 'owes_money']).optional(),
    sort: z.enum(['spend', 'orders', 'recent', 'last_purchase']).default('spend'),
    inactiveDays: z.number().int().min(1).max(3650).default(60),
    limit: z.number().int().min(1).max(100).default(10),
  }),
  kind: 'read',
  permission: 'customers:read',
  requiresApproval: false,
  execute: async (input, ctx) => {
    const db = await getDb();
    const [avgRow] = await db
      .select({
        average: sql<number>`coalesce(avg(${customers.totalSpentMinor}) filter (where ${customers.orderCount} > 0), 0)`,
        total: sql<number>`count(*)::int`,
      })
      .from(customers)
      .where(eq(customers.businessId, ctx.businessId));
    const averageSpendMinor = Math.round(Number(avgRow?.average ?? 0));
    const totalCount = Number(avgRow?.total ?? 0);

    let rows: Array<typeof customers.$inferSelect>;
    if (input.segment === 'inactive') {
      rows = await findInactiveCustomers(ctx.businessId, input.inactiveDays, input.limit, ctx.now);
    } else {
      const filters = [eq(customers.businessId, ctx.businessId)];
      if (input.segment === 'owes_money') filters.push(sql`${customers.outstandingMinor} > 0`);
      if (input.segment === 'repeat') filters.push(sql`${customers.orderCount} >= 2`);
      if (input.segment === 'vip') filters.push(sql`${customers.orderCount} >= 4 and ${customers.totalSpentMinor} > ${averageSpendMinor * 2}`);
      if (input.segment === 'high_value') filters.push(sql`${customers.totalSpentMinor} > ${Math.max(averageSpendMinor, 1)}`);
      if (input.segment === 'new') {
        filters.push(sql`${customers.createdAt} > ${new Date(ctx.now.getTime() - 30 * DAY_MS)}`);
      }
      if (!input.segment) filters.push(sql`${customers.orderCount} > 0`);

      const orderBy = {
        spend: desc(customers.totalSpentMinor),
        orders: desc(customers.orderCount),
        recent: desc(customers.createdAt),
        last_purchase: sql`${customers.lastPurchaseAt} desc nulls last`,
      }[input.sort];

      rows = await db.select().from(customers).where(and(...filters)).orderBy(orderBy).limit(input.limit);
    }

    const list = await toCustomerRows(rows, ctx.now, averageSpendMinor);
    const combined = list.reduce((sum, row) => sum + row.totalSpentMinor, 0);

    const data: CustomersResult = {
      segment: input.segment ?? null,
      count: list.length,
      totalCount,
      combinedSpendMinor: combined,
      customers: list,
    };

    return {
      summary: `${list.length} customer${list.length === 1 ? '' : 's'}${input.segment ? ` in segment "${input.segment}"` : ''}, combined spend ${fmt(ctx, combined)}.`,
      data,
      citations: [{ label: 'Customers', href: '/app/customers' }],
    };
  },
});

const getCustomer = defineTool({
  name: 'get_customer',
  label: 'Customer detail',
  description:
    'Full detail for one customer: lifetime value, recent orders, open invoices with days overdue, and the ' +
    'products they buy most. Requires the customer id, which you can get from get_customers.',
  schema: z.object({ customerId: z.string().uuid() }),
  kind: 'read',
  permission: 'customers:read',
  requiresApproval: false,
  execute: async (input, ctx) => {
    const db = await getDb();
    const [row] = await db
      .select()
      .from(customers)
      .where(and(eq(customers.id, input.customerId), eq(customers.businessId, ctx.businessId)))
      .limit(1);
    if (!row) throw new ToolError('not_found', 'No customer with that id belongs to this business.');

    const [orderRows, invoiceRows, favourites] = await Promise.all([
      db
        .select()
        .from(orders)
        .where(and(eq(orders.businessId, ctx.businessId), eq(orders.customerId, input.customerId)))
        .orderBy(desc(orders.occurredAt))
        .limit(10),
      listInvoices(ctx.businessId, { page: 1, pageSize: 10, customerId: input.customerId, status: 'unpaid' }, ctx.now),
      favouriteProducts(db, ctx.businessId, input.customerId, 5),
    ]);

    const [base] = await toCustomerRows([row], ctx.now, 0);
    const data: CustomerDetailResult = {
      customer: { ...base!, status: row.status, tags: [], notes: row.notes, createdAt: row.createdAt.toISOString() },
      recentOrders: orderRows.map((order) => ({
        id: order.id,
        reference: order.reference,
        totalMinor: Number(order.totalMinor),
        occurredAt: order.occurredAt.toISOString(),
        paymentStatus: order.paymentStatus,
      })),
      openInvoices: invoiceRows.rows.map((invoice) => ({
        id: invoice.id,
        number: invoice.number,
        balanceMinor: invoice.balanceMinor,
        dueDate: invoice.dueDate,
        daysOverdue: invoice.daysOverdue,
      })),
      favouriteProducts: favourites,
    };

    return {
      summary: `${row.name}: ${fmt(ctx, Number(row.totalSpentMinor))} lifetime across ${row.orderCount} orders.`,
      data,
      citations: [{ label: row.name, href: `/app/customers/${row.id}` }],
    };
  },
});

const getOrders = defineTool({
  name: 'get_orders',
  label: 'Sales',
  description: 'Recent sales with totals, payment status and outstanding balances. Optionally filter by customer or period.',
  schema: z.object({
    period: periodSchema,
    customerId: z.string().uuid().optional(),
    paymentStatus: z.enum(['unpaid', 'partial', 'paid', 'refunded']).optional(),
    limit: z.number().int().min(1).max(100).default(20),
  }),
  kind: 'read',
  permission: 'orders:read',
  requiresApproval: false,
  execute: async (input, ctx) => {
    const period = resolvePeriod(input.period as PeriodKey, ctx.now);
    const result = await listOrders(ctx.businessId, {
      page: 1,
      pageSize: input.limit,
      customerId: input.customerId,
      paymentStatus: input.paymentStatus,
      from: period.from.toISOString(),
      to: period.to.toISOString(),
    });

    const totalMinor = result.rows.reduce((sum, order) => sum + order.totalMinor, 0);
    const unpaid = result.rows.filter((order) => order.balanceMinor > 0);

    const data: OrdersResult = {
      from: period.from.toISOString(),
      to: period.to.toISOString(),
      count: result.total,
      totalMinor,
      unpaidCount: unpaid.length,
      unpaidMinor: unpaid.reduce((sum, order) => sum + order.balanceMinor, 0),
      orders: result.rows.map((order) => ({
        id: order.id,
        reference: order.reference,
        customerName: order.customerName,
        totalMinor: order.totalMinor,
        balanceMinor: order.balanceMinor,
        paymentStatus: order.paymentStatus,
        status: order.status,
        occurredAt: order.occurredAt,
      })),
    };

    return {
      summary: `${result.total} sales in ${period.label}, ${fmt(ctx, totalMinor)} in the returned rows.`,
      data,
      citations: [{ label: 'Sales', href: '/app/sales' }],
    };
  },
});

const getInventory = defineTool({
  name: 'get_inventory',
  label: 'Inventory',
  description: 'Current stock position: product count, total stock value at cost, and per-product quantities.',
  schema: z.object({ limit: z.number().int().min(1).max(100).default(25) }),
  kind: 'read',
  permission: 'inventory:read',
  requiresApproval: false,
  execute: async (input, ctx) => {
    const db = await getDb();
    const { settings } = await loadBusiness(ctx.businessId);
    const [valuation, rows, low] = await Promise.all([
      inventoryValuation(ctx.businessId),
      db
        .select()
        .from(products)
        .where(and(eq(products.businessId, ctx.businessId), eq(products.active, true)))
        .orderBy(desc(products.quantity))
        .limit(input.limit),
      lowStockProducts(ctx.businessId, settings.lowStockThreshold, 100, ctx.now),
    ]);

    const data: InventoryResult = {
      productCount: valuation.productCount,
      trackedCount: valuation.trackedCount,
      totalStockValueMinor: valuation.totalStockValueMinor,
      lowStockCount: low.length,
      outOfStockCount: valuation.outOfStockCount,
      products: rows.map((product) => ({
        id: product.id,
        name: product.name,
        sku: product.sku,
        quantity: product.quantity,
        minStock: product.minStock,
        sellingPriceMinor: Number(product.sellingPriceMinor),
        costPriceMinor: Number(product.costPriceMinor),
        stockValueMinor: product.quantity * Number(product.costPriceMinor),
      })),
    };

    return {
      summary: `${valuation.productCount} active products worth ${fmt(ctx, valuation.totalStockValueMinor)} at cost; ${low.length} low.`,
      data,
      citations: [{ label: 'Products', href: '/app/products' }],
    };
  },
});

const getLowStockProducts = defineTool({
  name: 'get_low_stock_products',
  label: 'Low stock',
  description:
    'Products at or below their minimum stock level, with 30-day sales velocity and a projected days-of-cover ' +
    'estimate. The projection includes a confidence rating and the data it is based on — always report both.',
  schema: z.object({ limit: z.number().int().min(1).max(50).default(20) }),
  kind: 'read',
  permission: 'inventory:read',
  requiresApproval: false,
  execute: async (input, ctx) => {
    const db = await getDb();
    const { settings } = await loadBusiness(ctx.businessId);
    const rows = await lowStockProducts(ctx.businessId, settings.lowStockThreshold, input.limit, ctx.now);
    const velocity = await salesVelocity(db, ctx.businessId, rows.map((row) => row.id), 30, ctx.now);

    const data: LowStockResult = {
      count: rows.length,
      products: rows.map((product) => {
        const projection = projectStock(product.quantity, velocity.get(product.id));
        return {
          id: product.id,
          name: product.name,
          quantity: product.quantity,
          minStock: product.minStock,
          unitsSold30d: product.unitsSold30d,
          dailyVelocity: Number(projection.dailyVelocity.toFixed(2)),
          daysRemaining: projection.daysRemaining,
          confidence: projection.confidence ?? 'low',
          projectionBasis: projection.basis,
        };
      }),
    };

    return {
      summary: `${rows.length} product${rows.length === 1 ? '' : 's'} at or below minimum stock.`,
      data,
      citations: [{ label: 'Low stock', href: '/app/products?lowStock=1' }],
    };
  },
});

const getInvoices = defineTool({
  name: 'get_invoices',
  label: 'Invoices',
  description: 'Invoices with balances and due dates. Use status "unpaid" for everything still owed.',
  schema: z.object({
    status: z.enum(['draft', 'sent', 'partial', 'paid', 'overdue', 'unpaid', 'void']).optional(),
    customerId: z.string().uuid().optional(),
    limit: z.number().int().min(1).max(100).default(25),
  }),
  kind: 'read',
  permission: 'invoices:read',
  requiresApproval: false,
  execute: async (input, ctx) => {
    const db = await getDb();
    const [result, outstanding] = await Promise.all([
      listInvoices(
        ctx.businessId,
        { page: 1, pageSize: input.limit, status: input.status, customerId: input.customerId },
        ctx.now,
      ),
      outstandingTotals(db, ctx.businessId, ctx.now),
    ]);

    const data: InvoicesResult = {
      count: result.total,
      totalMinor: result.rows.reduce((sum, invoice) => sum + invoice.totalMinor, 0),
      outstandingMinor: outstanding.totalMinor,
      invoices: result.rows.map((invoice) => ({
        id: invoice.id,
        number: invoice.number,
        customerId: invoice.customerId,
        customerName: invoice.customerName,
        totalMinor: invoice.totalMinor,
        balanceMinor: invoice.balanceMinor,
        status: invoice.status,
        dueDate: invoice.dueDate,
        daysOverdue: invoice.daysOverdue,
      })),
    };

    return {
      summary: `${result.total} invoices; ${fmt(ctx, outstanding.totalMinor)} outstanding overall.`,
      data,
      citations: [{ label: 'Invoices', href: '/app/invoices' }],
    };
  },
});

const getOverdueInvoices = defineTool({
  name: 'get_overdue_invoices',
  label: 'Overdue invoices',
  description: 'Invoices past their due date with an outstanding balance, ordered by how late they are.',
  schema: z.object({ limit: z.number().int().min(1).max(100).default(25) }),
  kind: 'read',
  permission: 'invoices:read',
  requiresApproval: false,
  execute: async (input, ctx) => {
    const db = await getDb();
    // `rows` is a capped sample for display; the count and value must come from
    // the aggregate, or the assistant would report the page size as the total.
    const [rows, outstanding] = await Promise.all([
      overdueInvoices(ctx.businessId, input.limit, ctx.now),
      outstandingTotals(db, ctx.businessId, ctx.now),
    ]);

    const data: OverdueInvoicesResult = {
      count: outstanding.overdueCount,
      totalOverdueMinor: outstanding.overdueMinor,
      oldestDays: rows[0]?.daysOverdue ?? 0,
      invoices: rows.map((invoice) => ({
        id: invoice.id,
        number: invoice.number,
        customerId: invoice.customerId,
        customerName: invoice.customerName,
        totalMinor: invoice.totalMinor,
        balanceMinor: invoice.balanceMinor,
        status: invoice.status,
        dueDate: invoice.dueDate,
        daysOverdue: invoice.daysOverdue,
      })),
    };

    return {
      summary: `${outstanding.overdueCount} overdue invoices worth ${fmt(ctx, outstanding.overdueMinor)}.`,
      data,
      citations: [{ label: 'Overdue invoices', href: '/app/invoices?overdue=1' }],
    };
  },
});

const analyzeSales = defineTool({
  name: 'analyze_sales',
  label: 'Sales analysis',
  description:
    'Deeper sales analysis: top products by revenue and profit, products rising and declining versus the previous ' +
    'period, gross margin, the strongest weekday, and the split of revenue between new and returning customers. ' +
    'Use this to explain *why* revenue moved.',
  schema: z.object({ period: periodSchema }),
  kind: 'read',
  permission: 'analytics:read',
  requiresApproval: false,
  execute: async (input, ctx) => {
    const db = await getDb();
    const period = resolvePeriod(input.period as PeriodKey, ctx.now);
    const [totals, top, momentum, weekday, mix, previousMix] = await Promise.all([
      rangeTotals(db, ctx.businessId, period.from, period.to),
      topProducts(db, ctx.businessId, period.from, period.to, 8),
      productMomentum(db, ctx.businessId, period),
      busiestWeekday(db, ctx.businessId, period.from, period.to),
      revenueByCustomerType(db, ctx.businessId, period.from, period.to),
      revenueByCustomerType(db, ctx.businessId, period.previous.from, period.previous.to),
    ]);

    const grossProfit = totals.revenueMinor - totals.taxMinor - totals.costMinor;
    const data: SalesAnalysisResult = {
      from: period.from.toISOString(),
      to: period.to.toISOString(),
      totalRevenueMinor: totals.revenueMinor,
      totalProfitMinor: grossProfit,
      marginPercent: totals.revenueMinor > 0 ? (grossProfit / totals.revenueMinor) * 100 : null,
      topProducts: top,
      decliningProducts: momentum.declining,
      risingProducts: momentum.rising,
      busiestWeekday: weekday,
      repeatRevenueMinor: mix.repeatMinor,
      newCustomerRevenueMinor: mix.newMinor,
      previousRepeatRevenueMinor: previousMix.repeatMinor,
    };

    return {
      summary: `${period.label}: ${fmt(ctx, totals.revenueMinor)} revenue, ${fmt(ctx, grossProfit)} gross profit, ${momentum.declining.length} declining products.`,
      data,
      citations: [{ label: 'Analytics', href: '/app/analytics' }],
    };
  },
});

const analyzeCustomerSegments = defineTool({
  name: 'analyze_customer_segments',
  label: 'Customer segments',
  description:
    'Breaks the customer base into segments with counts and value, and quantifies the revenue at risk from ' +
    'customers who have gone quiet. Use before recommending a campaign.',
  schema: z.object({ inactiveDays: z.number().int().min(1).max(3650).default(60) }),
  kind: 'read',
  permission: 'customers:read',
  requiresApproval: false,
  execute: async (input, ctx) => {
    const db = await getDb();
    const period = resolvePeriod('last_30_days', ctx.now);
    const stats = await customerStats(db, ctx.businessId, period, input.inactiveDays, ctx.now);
    const inactiveRows = await findInactiveCustomers(ctx.businessId, input.inactiveDays, 25, ctx.now);

    const [avgRow] = await db
      .select({ average: sql<number>`coalesce(avg(${customers.totalSpentMinor}) filter (where ${customers.orderCount} > 0), 0)` })
      .from(customers)
      .where(eq(customers.businessId, ctx.businessId));
    const averageSpendMinor = Math.round(Number(avgRow?.average ?? 0));

    const [segmentRow] = await db
      .select({
        vip: sql<number>`count(*) filter (where ${customers.orderCount} >= 4 and ${customers.totalSpentMinor} > ${averageSpendMinor * 2})::int`,
        vipValue: sql<number>`coalesce(sum(${customers.totalSpentMinor}) filter (where ${customers.orderCount} >= 4 and ${customers.totalSpentMinor} > ${averageSpendMinor * 2}), 0)::bigint`,
        repeat: sql<number>`count(*) filter (where ${customers.orderCount} >= 2)::int`,
        repeatValue: sql<number>`coalesce(sum(${customers.totalSpentMinor}) filter (where ${customers.orderCount} >= 2), 0)::bigint`,
        owing: sql<number>`count(*) filter (where ${customers.outstandingMinor} > 0)::int`,
        owingValue: sql<number>`coalesce(sum(${customers.outstandingMinor}), 0)::bigint`,
      })
      .from(customers)
      .where(eq(customers.businessId, ctx.businessId));

    const total = Math.max(stats.total, 1);
    const data: SegmentAnalysisResult = {
      totalCustomers: stats.total,
      segments: [
        {
          key: 'vip',
          label: 'VIP',
          count: Number(segmentRow?.vip ?? 0),
          totalSpentMinor: Number(segmentRow?.vipValue ?? 0),
          share: (Number(segmentRow?.vip ?? 0) / total) * 100,
          description: 'Four or more orders and more than double the average lifetime spend.',
        },
        {
          key: 'repeat',
          label: 'Repeat buyers',
          count: Number(segmentRow?.repeat ?? 0),
          totalSpentMinor: Number(segmentRow?.repeatValue ?? 0),
          share: (Number(segmentRow?.repeat ?? 0) / total) * 100,
          description: 'Bought more than once.',
        },
        {
          key: 'owes_money',
          label: 'Owes money',
          count: Number(segmentRow?.owing ?? 0),
          totalSpentMinor: Number(segmentRow?.owingValue ?? 0),
          share: (Number(segmentRow?.owing ?? 0) / total) * 100,
          description: 'Has an outstanding balance on an order or invoice.',
        },
        {
          key: 'inactive',
          label: 'Inactive',
          count: stats.inactiveCount,
          totalSpentMinor: stats.inactiveValueMinor,
          share: (stats.inactiveCount / total) * 100,
          description: `Bought before but not in the last ${input.inactiveDays} days.`,
        },
      ],
      inactive: {
        count: stats.inactiveCount,
        valueAtRiskMinor: stats.inactiveValueMinor,
        averageDaysSincePurchase: stats.averageDaysSincePurchase,
        customers: await toCustomerRows(inactiveRows, ctx.now, averageSpendMinor),
      },
      repeatRatePercent: stats.repeatRate,
      newThisPeriod: stats.newCount,
    };

    return {
      summary: `${stats.total} customers; ${stats.inactiveCount} inactive holding ${fmt(ctx, stats.inactiveValueMinor)} of past spend.`,
      data,
      citations: [{ label: 'Customers', href: '/app/customers' }],
    };
  },
});

/* -------------------------------------------------------------------------- */
/* Write tools — proposed, never executed inline                               */
/* -------------------------------------------------------------------------- */

const createTaskTool = defineTool({
  name: 'create_task',
  label: 'Create task',
  description:
    'Prepares one task, or — with forEachOverdueInvoice — one follow-up task per overdue invoice. ' +
    'This is a proposal: nothing is created until the user approves it.',
  schema: z.object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).optional(),
    customerId: z.string().uuid().optional(),
    dueDate: z.string().optional(),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
    forEachOverdueInvoice: z.boolean().default(false),
  }),
  kind: 'write',
  permission: 'tasks:write',
  requiresApproval: true,
  propose: async (input, ctx) => {
    if (input.forEachOverdueInvoice) {
      const rows = await overdueInvoices(ctx.businessId, 50, ctx.now);
      return {
        label: `Create ${rows.length} follow-up task${rows.length === 1 ? '' : 's'}`,
        description: `One task per overdue invoice, each linked to the customer and due tomorrow. Total outstanding: ${fmt(
          ctx,
          rows.reduce((sum, invoice) => sum + invoice.balanceMinor, 0),
        )}.`,
        preview: rows.slice(0, 8).map((invoice) => ({
          label: invoice.customerName,
          value: `${invoice.number} — ${fmt(ctx, invoice.balanceMinor)}, ${invoice.daysOverdue} days overdue`,
        })),
        impact: rows.length > 10 ? 'medium' : 'low',
      };
    }
    if (!input.title) throw new ToolError('invalid_input', 'A task needs a title.');
    return {
      label: `Create task: ${input.title}`,
      description: input.description ?? 'A new task on your list.',
      preview: [
        { label: 'Title', value: input.title },
        { label: 'Priority', value: input.priority },
        { label: 'Due', value: input.dueDate ? input.dueDate.slice(0, 10) : 'No due date' },
      ],
      impact: 'low',
    };
  },
  execute: async (input, ctx) => {
    const actor = { id: ctx.userId, name: 'NEXA AI', source: 'ai' as const };

    if (input.forEachOverdueInvoice) {
      const rows = await overdueInvoices(ctx.businessId, 50, ctx.now);
      const due = new Date(ctx.now.getTime() + DAY_MS).toISOString();
      let created = 0;
      for (const invoice of rows) {
        await createTask(
          ctx.businessId,
          {
            title: `Follow up: ${invoice.customerName} — ${invoice.number}`,
            description: `${fmt(ctx, invoice.balanceMinor)} outstanding, ${invoice.daysOverdue} days overdue.`,
            customerId: invoice.customerId,
            invoiceId: invoice.id,
            dueDate: due,
            priority: invoice.daysOverdue > 30 ? 'urgent' : 'high',
            status: 'todo',
            recurrence: 'none',
          },
          actor,
        );
        created += 1;
      }
      return { summary: `Created ${created} follow-up tasks.`, data: { created }, citations: [{ label: 'Tasks', href: '/app/tasks' }] };
    }

    const task = await createTask(
      ctx.businessId,
      {
        title: input.title!,
        description: input.description,
        customerId: input.customerId,
        dueDate: input.dueDate,
        priority: input.priority,
        status: 'todo',
        recurrence: 'none',
      },
      actor,
    );
    return { summary: `Created task "${task.title}".`, data: { id: task.id }, citations: [{ label: 'Tasks', href: '/app/tasks' }] };
  },
});

const createCustomerTool = defineTool({
  name: 'create_customer',
  label: 'Add customer',
  description: 'Prepares a new customer record for approval.',
  schema: z.object({
    name: z.string().trim().min(1).max(160),
    email: z.string().email().max(254).optional(),
    phone: z.string().trim().max(40).optional(),
    notes: z.string().trim().max(2000).optional(),
  }),
  kind: 'write',
  permission: 'customers:write',
  requiresApproval: true,
  propose: async (input) => ({
    label: `Add customer: ${input.name}`,
    description: 'A new customer record will be created in your CRM.',
    preview: [
      { label: 'Name', value: input.name },
      { label: 'Phone', value: input.phone ?? '—' },
      { label: 'Email', value: input.email ?? '—' },
    ],
    impact: 'low',
  }),
  execute: async (input, ctx) => {
    const customer = await createCustomer(
      ctx.businessId,
      { name: input.name, email: input.email, phone: input.phone, notes: input.notes },
      { id: ctx.userId, name: 'NEXA AI', source: 'ai' },
    );
    return {
      summary: `Added customer ${customer.name}.`,
      data: { id: customer.id },
      citations: [{ label: customer.name, href: `/app/customers/${customer.id}` }],
    };
  },
});

const createInvoiceDraft = defineTool({
  name: 'create_invoice_draft',
  label: 'Draft invoice',
  description:
    'Prepares a draft invoice for a customer. The invoice is created as a draft only — it is never sent, ' +
    'and the user must approve its creation first.',
  schema: z.object({
    customerId: z.string().uuid(),
    items: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(200),
          quantity: z.number().int().min(1).max(10000),
          unitPriceMinor: z.number().int().min(0),
        }),
      )
      .min(1)
      .max(50),
    notes: z.string().trim().max(2000).optional(),
    dueInDays: z.number().int().min(0).max(365).default(14),
  }),
  kind: 'write',
  permission: 'invoices:write',
  requiresApproval: true,
  propose: async (input, ctx) => {
    const db = await getDb();
    const [customer] = await db
      .select({ name: customers.name })
      .from(customers)
      .where(and(eq(customers.id, input.customerId), eq(customers.businessId, ctx.businessId)))
      .limit(1);
    if (!customer) throw new ToolError('not_found', 'No customer with that id belongs to this business.');

    const total = input.items.reduce((sum, item) => sum + item.quantity * item.unitPriceMinor, 0);
    return {
      label: `Draft invoice for ${customer.name} — ${fmt(ctx, total)}`,
      description: `A draft invoice with ${input.items.length} line item${input.items.length === 1 ? '' : 's'}, due in ${input.dueInDays} days. It will not be sent.`,
      preview: [
        { label: 'Customer', value: customer.name },
        ...input.items.slice(0, 6).map((item) => ({
          label: item.name,
          value: `${item.quantity} × ${fmt(ctx, item.unitPriceMinor)} = ${fmt(ctx, item.quantity * item.unitPriceMinor)}`,
        })),
        { label: 'Total', value: fmt(ctx, total) },
      ],
      impact: 'medium',
    };
  },
  execute: async (input, ctx) => {
    const { business, settings } = await loadBusiness(ctx.businessId);
    const invoice = await createInvoice(
      ctx.businessId,
      {
        customerId: input.customerId,
        items: input.items.map((item) => ({
          name: item.name,
          quantity: item.quantity,
          unitPrice: item.unitPriceMinor,
          discountMinor: 0,
        })),
        discountMinor: 0,
        dueDate: new Date(ctx.now.getTime() + input.dueInDays * DAY_MS).toISOString(),
        notes: input.notes,
        status: 'draft',
      },
      { id: ctx.userId, name: 'NEXA AI', source: 'ai' },
      {
        enabled: settings.taxEnabled,
        rate: Number(settings.taxRate),
        inclusive: settings.taxInclusive,
        label: settings.taxLabel,
        currency: business.currency,
        locale: business.locale,
        businessName: business.name,
        dueDays: settings.invoiceDueDays,
      },
    );
    return {
      summary: `Created draft invoice ${invoice.number} for ${fmt(ctx, invoice.totalMinor)}.`,
      data: { id: invoice.id, number: invoice.number },
      citations: [{ label: invoice.number, href: `/app/invoices/${invoice.id}` }],
    };
  },
});

const createCampaignDraft = defineTool({
  name: 'create_campaign_draft',
  label: 'Draft campaign',
  description:
    'Prepares a campaign draft aimed at a customer segment. The draft is saved unsent — sending is a separate ' +
    'action that requires the campaigns:send permission, which this tool never exercises.',
  schema: z.object({
    name: z.string().trim().max(160).optional(),
    channel: z.enum(['email', 'sms', 'whatsapp']).default('email'),
    subject: z.string().trim().max(200).optional(),
    body: z.string().trim().max(4000).optional(),
    segment: z.enum(['inactive', 'vip', 'repeat', 'owes_money']).default('inactive'),
    inactiveDays: z.number().int().min(1).max(3650).default(60),
  }),
  kind: 'write',
  permission: 'campaigns:read',
  requiresApproval: true,
  propose: async (input, ctx) => {
    const audience = await resolveCampaignAudience(ctx, input.segment, input.inactiveDays);
    const value = audience.reduce((sum, row) => sum + Number(row.totalSpentMinor), 0);
    return {
      label: `Draft ${input.channel} campaign to ${audience.length} ${input.segment} customers`,
      description: `This group has spent ${fmt(ctx, value)} with you historically. The draft is saved unsent; you choose whether to send it.`,
      preview: [
        { label: 'Audience', value: `${audience.length} customers (${input.segment})` },
        { label: 'Channel', value: input.channel },
        { label: 'Subject', value: input.subject ?? defaultSubject(input.segment) },
        ...audience.slice(0, 5).map((row) => ({ label: row.name, value: fmt(ctx, Number(row.totalSpentMinor)) })),
      ],
      impact: audience.length > 50 ? 'high' : 'medium',
    };
  },
  execute: async (input, ctx) => {
    const audience = await resolveCampaignAudience(ctx, input.segment, input.inactiveDays);
    const campaign = await createCampaign(
      ctx.businessId,
      {
        name: input.name ?? `${defaultSubject(input.segment)} — ${ctx.now.toISOString().slice(0, 10)}`,
        channel: input.channel,
        subject: input.subject ?? defaultSubject(input.segment),
        body: input.body ?? defaultBody(input.segment, ctx.businessName),
        segment: input.segment,
        customerIds: audience.map((row) => row.id),
      },
      { id: ctx.userId, name: 'NEXA AI', source: 'ai' },
    );
    return {
      summary: `Saved campaign draft "${campaign.name}" for ${campaign.audienceCount} customers. Not sent.`,
      data: { id: campaign.id, audienceCount: campaign.audienceCount },
      citations: [{ label: 'Campaigns', href: '/app/campaigns' }],
    };
  },
});

async function resolveCampaignAudience(
  ctx: ToolContext,
  segment: string,
  inactiveDays: number,
): Promise<Array<{ id: string; name: string; totalSpentMinor: number }>> {
  const db = await getDb();
  if (segment === 'inactive') {
    const rows = await findInactiveCustomers(ctx.businessId, inactiveDays, 500, ctx.now);
    return rows.map((row) => ({ id: row.id, name: row.name, totalSpentMinor: Number(row.totalSpentMinor) }));
  }
  const filters = [eq(customers.businessId, ctx.businessId)];
  if (segment === 'owes_money') filters.push(sql`${customers.outstandingMinor} > 0`);
  if (segment === 'repeat') filters.push(sql`${customers.orderCount} >= 2`);
  if (segment === 'vip') filters.push(sql`${customers.orderCount} >= 4`);

  const rows = await db
    .select({ id: customers.id, name: customers.name, totalSpentMinor: customers.totalSpentMinor })
    .from(customers)
    .where(and(...filters))
    .orderBy(desc(customers.totalSpentMinor))
    .limit(500);
  return rows.map((row) => ({ id: row.id, name: row.name, totalSpentMinor: Number(row.totalSpentMinor) }));
}

function defaultSubject(segment: string): string {
  return {
    inactive: 'We miss you',
    vip: 'A thank you from us',
    repeat: 'Something new for you',
    owes_money: 'A gentle reminder',
  }[segment] ?? 'An update from us';
}

function defaultBody(segment: string, businessName: string): string {
  if (segment === 'owes_money') {
    return `Hi {{name}},\n\nThis is a friendly reminder about your outstanding balance with ${businessName}. Let us know if you'd like to arrange payment.\n\nThank you,\n${businessName}`;
  }
  if (segment === 'vip') {
    return `Hi {{name}},\n\nYou're one of our best customers, and we wanted to say thank you. Reply to this message and we'll take care of you on your next order.\n\n${businessName}`;
  }
  return `Hi {{name}},\n\nIt's been a while since your last visit to ${businessName} and we'd love to see you again. Reply to this message and we'll look after you.\n\n${businessName}`;
}

/* -------------------------------------------------------------------------- */
/* Registration                                                                */
/* -------------------------------------------------------------------------- */

const ALL_TOOLS: ToolDefinition[] = [
  getBusinessSummary,
  getRevenue,
  getExpenses,
  getCustomers,
  getCustomer,
  getOrders,
  getInventory,
  getLowStockProducts,
  getInvoices,
  getOverdueInvoices,
  analyzeSales,
  analyzeCustomerSegments,
  createTaskTool,
  createCustomerTool,
  createInvoiceDraft,
  createCampaignDraft,
] as ToolDefinition[];

let registered = false;

export function registerTools(): void {
  if (registered) return;
  toolRegistry.registerAll(ALL_TOOLS);
  registered = true;
}

export { ALL_TOOLS };
