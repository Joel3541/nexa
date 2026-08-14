import type {
  ActivitySeverity,
  ActivitySource,
  AgentId,
  AiActionStatus,
  AppointmentStatus,
  CustomerStatus,
  InvoiceStatus,
  MemberRole,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  Permission,
  ProductKind,
  SubscriptionPlan,
  TaskPriority,
  TaskStatus,
} from './enums.js';

/**
 * API view models.
 *
 * These are deliberately *not* the database row types — the API never exposes
 * database internals. Adding a column does not change the public contract.
 */

export interface ApiError {
  error: {
    code: string;
    message: string;
    /** Field-level messages for form rendering. */
    fields?: Record<string, string>;
    requestId?: string;
  };
}

export interface Paginated<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  avatarUrl: string | null;
  phone: string | null;
  emailVerified: boolean;
  timezone: string | null;
  createdAt: string;
}

export interface BusinessSummary {
  id: string;
  name: string;
  slug: string;
  industry: string;
  businessType: string | null;
  country: string;
  currency: string;
  locale: string;
  timezone: string;
  logoUrl: string | null;
  description: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  addressLine1: string | null;
  city: string | null;
  region: string | null;
  socialLinks: Record<string, string> | null;
  employeeCount: number | null;
  primaryGoal: string | null;
  goals: string[];
  isDemo: boolean;
  onboardedAt: string | null;
  createdAt: string;
}

export interface BusinessSettings {
  taxEnabled: boolean;
  taxRate: number;
  taxLabel: string;
  taxInclusive: boolean;
  invoicePrefix: string;
  invoiceDueDays: number;
  invoiceNotes: string | null;
  invoiceFooter: string | null;
  lowStockThreshold: number;
  fiscalYearStartMonth: number;
  timezone: string;
  notificationPreferences: Record<string, boolean>;
  enabledModules: string[];
}

export interface SessionContext {
  user: SessionUser;
  business: BusinessSummary | null;
  businesses: Array<{ id: string; name: string; slug: string; role: MemberRole; logoUrl: string | null }>;
  role: MemberRole | null;
  permissions: Permission[];
  settings: BusinessSettings | null;
  plan: SubscriptionPlan;
}

export interface CustomerView {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  addressLine1: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  status: CustomerStatus;
  tags: string[];
  notes: string | null;
  source: string | null;
  totalSpentMinor: number;
  orderCount: number;
  outstandingMinor: number;
  averageOrderMinor: number;
  lastPurchaseAt: string | null;
  segments: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CustomerTimelineEntry {
  id: string;
  type: 'created' | 'order' | 'invoice' | 'payment' | 'note' | 'task' | 'appointment' | 'campaign' | 'status';
  title: string;
  description: string | null;
  amountMinor: number | null;
  occurredAt: string;
  linkId: string | null;
}

export interface ProductView {
  id: string;
  name: string;
  kind: ProductKind;
  sku: string | null;
  description: string | null;
  categoryId: string | null;
  categoryName: string | null;
  costPriceMinor: number;
  sellingPriceMinor: number;
  marginMinor: number;
  marginPercent: number | null;
  quantity: number;
  minStock: number;
  trackInventory: boolean;
  supplier: string | null;
  durationMinutes: number | null;
  active: boolean;
  unitsSold30d: number;
  revenue30dMinor: number;
  daysOfStockRemaining: number | null;
  stockConfidence: 'high' | 'medium' | 'low' | null;
  isLowStock: boolean;
  createdAt: string;
}

export interface InventoryMovementView {
  id: string;
  productId: string;
  productName: string;
  quantityDelta: number;
  balanceAfter: number;
  reason: string;
  unitCostMinor: number | null;
  note: string | null;
  createdAt: string;
  actorName: string | null;
}

export interface OrderItemView {
  id: string;
  productId: string | null;
  name: string;
  quantity: number;
  unitPriceMinor: number;
  discountMinor: number;
  totalMinor: number;
}

export interface OrderView {
  id: string;
  reference: string;
  customerId: string | null;
  customerName: string | null;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  paidMinor: number;
  balanceMinor: number;
  costMinor: number;
  profitMinor: number;
  channel: string | null;
  note: string | null;
  items: OrderItemView[];
  payments: PaymentView[];
  occurredAt: string;
  createdAt: string;
}

export interface PaymentView {
  id: string;
  amountMinor: number;
  method: PaymentMethod;
  reference: string | null;
  note: string | null;
  provider: string | null;
  providerRef: string | null;
  receivedAt: string;
}

export interface InvoiceView {
  id: string;
  number: string;
  customerId: string;
  customerName: string;
  customerEmail: string | null;
  orderId: string | null;
  status: InvoiceStatus;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  paidMinor: number;
  balanceMinor: number;
  issueDate: string;
  dueDate: string;
  daysOverdue: number;
  notes: string | null;
  items: OrderItemView[];
  payments: PaymentView[];
  sentAt: string | null;
  createdAt: string;
}

export interface ExpenseView {
  id: string;
  amountMinor: number;
  categoryId: string | null;
  categoryName: string | null;
  vendor: string | null;
  description: string | null;
  paymentMethod: PaymentMethod;
  receiptUrl: string | null;
  recurring: boolean;
  spentAt: string;
  createdAt: string;
}

export interface TaskView {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  customerId: string | null;
  customerName: string | null;
  orderId: string | null;
  invoiceId: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  dueDate: string | null;
  isOverdue: boolean;
  recurrence: string;
  createdBySource: ActivitySource;
  completedAt: string | null;
  createdAt: string;
}

export interface AppointmentView {
  id: string;
  title: string;
  customerId: string | null;
  customerName: string | null;
  productId: string | null;
  productName: string | null;
  staffId: string | null;
  staffName: string | null;
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  status: AppointmentStatus;
  location: string | null;
  notes: string | null;
  createdAt: string;
}

export interface MetricDelta {
  value: number;
  previous: number;
  changePercent: number | null;
  direction: 'up' | 'down' | 'flat';
}

export interface DashboardResponse {
  range: { from: string; to: string; label: string };
  currency: string;
  finance: {
    revenue: MetricDelta;
    expenses: MetricDelta;
    profit: MetricDelta;
    outstandingMinor: number;
    overdueMinor: number;
    ordersCount: MetricDelta;
    averageOrderMinor: number;
  };
  health: BusinessHealth;
  brief: DailyBrief;
  series: Array<{ date: string; revenue: number; expenses: number; profit: number; orders: number }>;
  topProducts: Array<{ id: string; name: string; unitsSold: number; revenueMinor: number }>;
  topCustomers: Array<{ id: string; name: string; totalSpentMinor: number; orderCount: number }>;
  lowStock: Array<{ id: string; name: string; quantity: number; minStock: number; daysRemaining: number | null }>;
  overdueInvoices: Array<{ id: string; number: string; customerName: string; balanceMinor: number; daysOverdue: number }>;
  upcoming: { tasks: TaskView[]; appointments: AppointmentView[] };
}

export interface BusinessHealthFactor {
  key: string;
  label: string;
  score: number;
  weight: number;
  status: 'good' | 'watch' | 'risk';
  detail: string;
}

export interface BusinessHealth {
  score: number;
  grade: 'excellent' | 'good' | 'fair' | 'at_risk';
  factors: BusinessHealthFactor[];
  computedAt: string;
}

export interface BriefHighlight {
  id: string;
  severity: ActivitySeverity;
  title: string;
  detail: string;
  metric: string | null;
  actionLabel: string | null;
  actionHref: string | null;
}

export interface DailyBrief {
  greeting: string;
  generatedAt: string;
  headline: string;
  highlights: BriefHighlight[];
  recommendation: { title: string; rationale: string; actionLabel: string; actionHref: string } | null;
  /** True when a real model composed the prose; false for the deterministic adapter. */
  aiGenerated: boolean;
}

export interface ActivityEventView {
  id: string;
  type: string;
  severity: ActivitySeverity;
  source: ActivitySource;
  title: string;
  description: string | null;
  entityType: string | null;
  entityId: string | null;
  actionLabel: string | null;
  actionHref: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationView {
  id: string;
  title: string;
  body: string | null;
  severity: ActivitySeverity;
  href: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface AiToolCallView {
  id: string;
  name: string;
  label: string;
  status: 'ok' | 'error';
  summary: string;
  arguments: Record<string, unknown>;
  durationMs: number;
}

export interface AiActionView {
  id: string;
  tool: string;
  label: string;
  description: string;
  status: AiActionStatus;
  payload: Record<string, unknown>;
  preview: Array<{ label: string; value: string }>;
  impact: 'low' | 'medium' | 'high';
  requestedAt: string;
  decidedAt: string | null;
  result: string | null;
}

export interface AiMessageView {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  agentId: AgentId | null;
  toolCalls: AiToolCallView[];
  pendingActions: AiActionView[];
  citations: Array<{ label: string; href: string }>;
  createdAt: string;
}

export interface AiChatResponse {
  conversationId: string;
  message: AiMessageView;
  provider: 'mock' | 'anthropic';
}

export interface AnalyticsResponse {
  range: { from: string; to: string; granularity: string };
  currency: string;
  revenue: { series: Array<{ date: string; value: number }>; total: number; previousTotal: number };
  expenses: { series: Array<{ date: string; value: number }>; total: number; previousTotal: number };
  profit: { series: Array<{ date: string; value: number }>; total: number; previousTotal: number };
  orders: { series: Array<{ date: string; value: number }>; total: number; previousTotal: number };
  customers: {
    newCount: number;
    returningCount: number;
    activeCount: number;
    inactiveCount: number;
    retentionRate: number | null;
    repeatRate: number | null;
  };
  expenseBreakdown: Array<{ category: string; amountMinor: number; share: number }>;
  productPerformance: Array<{ id: string; name: string; unitsSold: number; revenueMinor: number; profitMinor: number }>;
  paymentMix: Array<{ method: string; amountMinor: number; share: number }>;
  outstanding: { totalMinor: number; overdueMinor: number; invoiceCount: number; overdueCount: number };
}

export interface SearchResultGroup {
  type: 'customer' | 'product' | 'invoice' | 'order' | 'task' | 'appointment' | 'expense';
  label: string;
  results: Array<{ id: string; title: string; subtitle: string | null; href: string; meta: string | null }>;
}

export interface AuditLogView {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  actorName: string | null;
  actorType: ActivitySource;
  summary: string;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
}
