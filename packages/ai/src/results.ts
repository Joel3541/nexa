/**
 * Tool result contracts.
 *
 * The API implements the tools; the deterministic MockAiProvider composes prose
 * from their output. Both sides depend on these interfaces, so the development
 * assistant is grounded in exactly the same data the production model sees.
 */

export interface BusinessSummaryResult {
  periodLabel: string;
  from: string;
  to: string;
  revenueMinor: number;
  previousRevenueMinor: number;
  revenueChangePercent: number | null;
  expensesMinor: number;
  profitMinor: number;
  orderCount: number;
  averageOrderMinor: number;
  newCustomerCount: number;
  activeCustomerCount: number;
  outstandingMinor: number;
  overdueMinor: number;
  overdueInvoiceCount: number;
  lowStockCount: number;
  openTaskCount: number;
  upcomingAppointmentCount: number;
  healthScore: number;
  healthGrade: string;
}

export interface RevenueResult {
  from: string;
  to: string;
  totalMinor: number;
  previousTotalMinor: number;
  changePercent: number | null;
  orderCount: number;
  previousOrderCount: number;
  averageOrderMinor: number;
  series: Array<{ date: string; value: number }>;
  bestDay: { date: string; value: number } | null;
}

export interface ExpensesResult {
  from: string;
  to: string;
  totalMinor: number;
  previousTotalMinor: number;
  changePercent: number | null;
  byCategory: Array<{ category: string; amountMinor: number; share: number }>;
  largest: Array<{ id: string; vendor: string | null; description: string | null; amountMinor: number; spentAt: string }>;
}

export interface CustomerRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  totalSpentMinor: number;
  orderCount: number;
  outstandingMinor: number;
  lastPurchaseAt: string | null;
  daysSinceLastPurchase: number | null;
  segments: string[];
}

export interface CustomersResult {
  segment: string | null;
  count: number;
  totalCount: number;
  combinedSpendMinor: number;
  customers: CustomerRow[];
}

export interface CustomerDetailResult {
  customer: CustomerRow & { status: string; tags: string[]; notes: string | null; createdAt: string };
  recentOrders: Array<{ id: string; reference: string; totalMinor: number; occurredAt: string; paymentStatus: string }>;
  openInvoices: Array<{ id: string; number: string; balanceMinor: number; dueDate: string; daysOverdue: number }>;
  favouriteProducts: Array<{ name: string; unitsBought: number }>;
}

export interface OrdersResult {
  from: string | null;
  to: string | null;
  count: number;
  totalMinor: number;
  unpaidCount: number;
  unpaidMinor: number;
  orders: Array<{
    id: string;
    reference: string;
    customerName: string | null;
    totalMinor: number;
    balanceMinor: number;
    paymentStatus: string;
    status: string;
    occurredAt: string;
  }>;
}

export interface InventoryResult {
  productCount: number;
  trackedCount: number;
  totalStockValueMinor: number;
  lowStockCount: number;
  outOfStockCount: number;
  products: Array<{
    id: string;
    name: string;
    sku: string | null;
    quantity: number;
    minStock: number;
    sellingPriceMinor: number;
    costPriceMinor: number;
    stockValueMinor: number;
  }>;
}

export interface LowStockResult {
  count: number;
  products: Array<{
    id: string;
    name: string;
    quantity: number;
    minStock: number;
    unitsSold30d: number;
    dailyVelocity: number;
    daysRemaining: number | null;
    /** Derived from how much sales history backs the velocity estimate. */
    confidence: 'high' | 'medium' | 'low';
    projectionBasis: string;
  }>;
}

export interface InvoicesResult {
  count: number;
  totalMinor: number;
  outstandingMinor: number;
  invoices: Array<{
    id: string;
    number: string;
    customerId: string;
    customerName: string;
    totalMinor: number;
    balanceMinor: number;
    status: string;
    dueDate: string;
    daysOverdue: number;
  }>;
}

export interface OverdueInvoicesResult {
  count: number;
  totalOverdueMinor: number;
  oldestDays: number;
  invoices: InvoicesResult['invoices'];
}

export interface SalesAnalysisResult {
  from: string;
  to: string;
  totalRevenueMinor: number;
  totalProfitMinor: number;
  marginPercent: number | null;
  topProducts: Array<{ id: string; name: string; unitsSold: number; revenueMinor: number; profitMinor: number }>;
  decliningProducts: Array<{ id: string; name: string; unitsSold: number; previousUnitsSold: number; changePercent: number }>;
  risingProducts: Array<{ id: string; name: string; unitsSold: number; previousUnitsSold: number; changePercent: number }>;
  busiestWeekday: { weekday: string; revenueMinor: number } | null;
  repeatRevenueMinor: number;
  newCustomerRevenueMinor: number;
  previousRepeatRevenueMinor: number;
}

export interface SegmentAnalysisResult {
  totalCustomers: number;
  segments: Array<{ key: string; label: string; count: number; totalSpentMinor: number; share: number; description: string }>;
  inactive: { count: number; valueAtRiskMinor: number; averageDaysSincePurchase: number; customers: CustomerRow[] };
  repeatRatePercent: number | null;
  newThisPeriod: number;
}

export interface ProposalResult {
  proposed: true;
  actionLabel: string;
  detail: string;
  itemCount?: number;
}
