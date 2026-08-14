import { z } from 'zod';
import {
  APPOINTMENT_STATUSES,
  CUSTOMER_STATUSES,
  INVENTORY_MOVEMENT_REASONS,
  INVOICE_STATUSES,
  MEMBER_ROLES,
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PRODUCT_KINDS,
  TASK_PRIORITIES,
  TASK_STATUSES,
} from './enums.js';

/* -------------------------------------------------------------------------- */
/* Primitives                                                                 */
/* -------------------------------------------------------------------------- */

export const uuid = z.string().uuid();
export const isoDate = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), { message: 'Must be a valid ISO date' });

/** Money always crosses the wire as an integer count of minor units. */
export const money = z.number().int().min(0).max(1_000_000_000_000);
export const signedMoney = z.number().int().min(-1_000_000_000_000).max(1_000_000_000_000);

const trimmed = (max: number) => z.string().trim().max(max);

/**
 * An optional free-text field that treats an empty string as "not provided".
 *
 * The `.optional()` must wrap the transform, not precede it: applying it first
 * produces a *required* key typed `string | undefined`, which forces every
 * caller to pass explicit `undefined` for fields they don't care about.
 */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? undefined : value))
    .optional();

/**
 * The ceiling is 200 rather than 100 because pickers (choose a customer on an
 * invoice, a product on a sale) need a whole list in one request, not a page.
 * It stays bounded so a client cannot ask for an unbounded scan. Beyond this
 * size those pickers need type-ahead — see docs/roadmap.md.
 */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

export const dateRangeSchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
});

/* -------------------------------------------------------------------------- */
/* Auth                                                                        */
/* -------------------------------------------------------------------------- */

export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(200)
  .refine((value) => /[a-zA-Z]/.test(value) && /[0-9]/.test(value), {
    message: 'Include at least one letter and one number',
  });

export const registerSchema = z.object({
  fullName: trimmed(120).min(2),
  email: z.string().trim().toLowerCase().email().max(254),
  password: passwordSchema,
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(200),
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});

export const updateProfileSchema = z.object({
  fullName: trimmed(120).min(2).optional(),
  phone: optionalText(40),
  avatarUrl: optionalText(500),
  timezone: optionalText(60),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
});

/* -------------------------------------------------------------------------- */
/* Business onboarding                                                         */
/* -------------------------------------------------------------------------- */

export const createBusinessSchema = z.object({
  name: trimmed(160).min(2),
  industry: trimmed(80),
  businessType: optionalText(80),
  country: z.string().trim().length(2).toUpperCase(),
  currency: z.string().trim().length(3).toUpperCase().optional(),
  description: optionalText(1000),
  logoUrl: optionalText(500),
  phone: optionalText(40),
  email: z.string().trim().toLowerCase().email().max(254).optional().or(z.literal('')),
  addressLine1: optionalText(200),
  addressLine2: optionalText(200),
  city: optionalText(100),
  region: optionalText(100),
  postalCode: optionalText(30),
  website: optionalText(200),
  socialLinks: z.record(z.string(), z.string().max(300)).optional(),
  employeeCount: z.coerce.number().int().min(1).max(100000).optional(),
  primaryGoal: optionalText(60),
  goals: z.array(z.string().max(60)).max(8).optional(),
});

export const updateBusinessSchema = createBusinessSchema.partial();

export const updateBusinessSettingsSchema = z.object({
  taxEnabled: z.boolean().optional(),
  taxRate: z.number().min(0).max(100).optional(),
  taxLabel: optionalText(40),
  taxInclusive: z.boolean().optional(),
  invoicePrefix: optionalText(12),
  invoiceDueDays: z.coerce.number().int().min(0).max(365).optional(),
  invoiceNotes: optionalText(1000),
  invoiceFooter: optionalText(500),
  lowStockThreshold: z.coerce.number().int().min(0).max(100000).optional(),
  fiscalYearStartMonth: z.coerce.number().int().min(1).max(12).optional(),
  timezone: optionalText(60),
  notificationPreferences: z.record(z.string(), z.boolean()).optional(),
});

/* -------------------------------------------------------------------------- */
/* Customers                                                                   */
/* -------------------------------------------------------------------------- */

export const createCustomerSchema = z.object({
  name: trimmed(160).min(1),
  email: z.string().trim().toLowerCase().email().max(254).optional().or(z.literal('')),
  phone: optionalText(40),
  company: optionalText(160),
  addressLine1: optionalText(200),
  city: optionalText(100),
  region: optionalText(100),
  country: optionalText(2),
  notes: optionalText(4000),
  status: z.enum(CUSTOMER_STATUSES).optional(),
  tags: z.array(trimmed(40)).max(20).optional(),
  source: optionalText(80),
});

export const updateCustomerSchema = createCustomerSchema.partial();

export const listCustomersSchema = paginationSchema.extend({
  q: optionalText(200),
  status: z.enum(CUSTOMER_STATUSES).optional(),
  tag: optionalText(40),
  segment: z.enum(['vip', 'new', 'inactive', 'high_value', 'owes_money', 'repeat']).optional(),
  sort: z.enum(['name', 'recent', 'spend', 'orders', 'last_purchase']).default('recent'),
});

export const addCustomerNoteSchema = z.object({
  body: trimmed(4000).min(1),
});

/* -------------------------------------------------------------------------- */
/* Products & inventory                                                        */
/* -------------------------------------------------------------------------- */

export const createProductSchema = z
  .object({
    name: trimmed(200).min(1),
    kind: z.enum(PRODUCT_KINDS).default('physical'),
    sku: optionalText(60),
    description: optionalText(2000),
    categoryId: uuid.optional().nullable(),
    categoryName: optionalText(80),
    costPrice: money.default(0),
    sellingPrice: money,
    quantity: z.number().int().min(-1_000_000).max(1_000_000).default(0),
    minStock: z.number().int().min(0).max(1_000_000).default(0),
    supplier: optionalText(160),
    durationMinutes: z.coerce.number().int().min(0).max(24 * 60).optional(),
    trackInventory: z.boolean().optional(),
    active: z.boolean().optional(),
  })
  .refine((value) => value.kind === 'service' || value.sellingPrice >= 0, {
    message: 'Selling price is required',
    path: ['sellingPrice'],
  });

export const updateProductSchema = z.object({
  name: trimmed(200).min(1).optional(),
  kind: z.enum(PRODUCT_KINDS).optional(),
  sku: optionalText(60),
  description: optionalText(2000),
  categoryId: uuid.optional().nullable(),
  categoryName: optionalText(80),
  costPrice: money.optional(),
  sellingPrice: money.optional(),
  minStock: z.number().int().min(0).max(1_000_000).optional(),
  supplier: optionalText(160),
  durationMinutes: z.coerce.number().int().min(0).max(24 * 60).optional(),
  trackInventory: z.boolean().optional(),
  active: z.boolean().optional(),
});

export const listProductsSchema = paginationSchema.extend({
  q: optionalText(200),
  kind: z.enum(PRODUCT_KINDS).optional(),
  categoryId: uuid.optional(),
  lowStockOnly: z.coerce.boolean().optional(),
  active: z.coerce.boolean().optional(),
  sort: z.enum(['name', 'recent', 'stock', 'price', 'best_selling']).default('name'),
});

export const adjustInventorySchema = z.object({
  quantityDelta: z.number().int().min(-1_000_000).max(1_000_000).refine((v) => v !== 0, 'Adjustment cannot be zero'),
  reason: z.enum(INVENTORY_MOVEMENT_REASONS).default('adjustment'),
  unitCost: money.optional(),
  note: optionalText(500),
});

/* -------------------------------------------------------------------------- */
/* Orders / sales                                                              */
/* -------------------------------------------------------------------------- */

export const orderItemInputSchema = z.object({
  productId: uuid.optional(),
  name: trimmed(200).min(1).optional(),
  quantity: z.number().int().min(1).max(100000),
  unitPrice: money.optional(),
  discountMinor: money.default(0),
});

export const createOrderSchema = z.object({
  customerId: uuid.optional().nullable(),
  items: z.array(orderItemInputSchema).min(1, 'Add at least one item').max(200),
  discountMinor: money.default(0),
  taxRate: z.number().min(0).max(100).optional(),
  status: z.enum(ORDER_STATUSES).default('confirmed'),
  note: optionalText(1000),
  channel: optionalText(40),
  occurredAt: isoDate.optional(),
  payment: z
    .object({
      amountMinor: money,
      method: z.enum(PAYMENT_METHODS).default('cash'),
      reference: optionalText(120),
    })
    .optional(),
});

export const updateOrderSchema = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
  note: optionalText(1000),
});

export const listOrdersSchema = paginationSchema.extend({
  q: optionalText(200),
  customerId: uuid.optional(),
  status: z.enum(ORDER_STATUSES).optional(),
  paymentStatus: z.enum(['unpaid', 'partial', 'paid', 'refunded']).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export const recordPaymentSchema = z.object({
  amountMinor: money.refine((v) => v > 0, 'Amount must be greater than zero'),
  method: z.enum(PAYMENT_METHODS).default('cash'),
  reference: optionalText(120),
  note: optionalText(500),
  receivedAt: isoDate.optional(),
});

/* -------------------------------------------------------------------------- */
/* Invoices                                                                    */
/* -------------------------------------------------------------------------- */

export const createInvoiceSchema = z.object({
  customerId: uuid,
  orderId: uuid.optional().nullable(),
  items: z.array(orderItemInputSchema).min(1).max(200),
  issueDate: isoDate.optional(),
  dueDate: isoDate.optional(),
  discountMinor: money.default(0),
  taxRate: z.number().min(0).max(100).optional(),
  notes: optionalText(2000),
  status: z.enum(['draft', 'sent']).default('draft'),
});

export const updateInvoiceSchema = z.object({
  status: z.enum(INVOICE_STATUSES).optional(),
  dueDate: isoDate.optional(),
  notes: optionalText(2000),
});

export const listInvoicesSchema = paginationSchema.extend({
  q: optionalText(200),
  customerId: uuid.optional(),
  status: z.enum(INVOICE_STATUSES).optional(),
  overdueOnly: z.coerce.boolean().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

/* -------------------------------------------------------------------------- */
/* Expenses                                                                    */
/* -------------------------------------------------------------------------- */

export const createExpenseSchema = z.object({
  amountMinor: money.refine((v) => v > 0, 'Amount must be greater than zero'),
  categoryId: uuid.optional().nullable(),
  categoryName: optionalText(80),
  vendor: optionalText(160),
  description: optionalText(1000),
  spentAt: isoDate.optional(),
  paymentMethod: z.enum(PAYMENT_METHODS).default('cash'),
  receiptUrl: optionalText(500),
  recurring: z.boolean().optional(),
});

export const updateExpenseSchema = createExpenseSchema.partial();

export const listExpensesSchema = paginationSchema.extend({
  q: optionalText(200),
  categoryId: uuid.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

/* -------------------------------------------------------------------------- */
/* Tasks & appointments                                                        */
/* -------------------------------------------------------------------------- */

export const createTaskSchema = z.object({
  title: trimmed(200).min(1),
  description: optionalText(2000),
  customerId: uuid.optional().nullable(),
  orderId: uuid.optional().nullable(),
  invoiceId: uuid.optional().nullable(),
  dueDate: isoDate.optional().nullable(),
  priority: z.enum(TASK_PRIORITIES).default('medium'),
  assigneeId: uuid.optional().nullable(),
  status: z.enum(TASK_STATUSES).default('todo'),
  recurrence: z.enum(['none', 'daily', 'weekly', 'monthly']).default('none'),
});

export const updateTaskSchema = createTaskSchema.partial();

export const listTasksSchema = paginationSchema.extend({
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  customerId: uuid.optional(),
  assigneeId: uuid.optional(),
  dueBefore: isoDate.optional(),
  q: optionalText(200),
});

export const createAppointmentSchema = z.object({
  customerId: uuid.optional().nullable(),
  productId: uuid.optional().nullable(),
  title: trimmed(200).min(1),
  startsAt: isoDate,
  durationMinutes: z.coerce.number().int().min(5).max(24 * 60).default(60),
  staffId: uuid.optional().nullable(),
  status: z.enum(APPOINTMENT_STATUSES).default('scheduled'),
  notes: optionalText(2000),
  location: optionalText(200),
});

export const updateAppointmentSchema = createAppointmentSchema.partial();

export const listAppointmentsSchema = paginationSchema.extend({
  status: z.enum(APPOINTMENT_STATUSES).optional(),
  customerId: uuid.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

/* -------------------------------------------------------------------------- */
/* Analytics, search, AI                                                       */
/* -------------------------------------------------------------------------- */

export const analyticsQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  granularity: z.enum(['day', 'week', 'month']).default('day'),
  compare: z.coerce.boolean().default(true),
});

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const aiChatSchema = z.object({
  conversationId: uuid.optional().nullable(),
  message: z.string().trim().min(1).max(4000),
  agentId: z.string().max(40).optional(),
});

export const aiActionDecisionSchema = z.object({
  note: optionalText(500),
});

export const inviteMemberSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  role: z.enum(MEMBER_ROLES).default('staff'),
  fullName: optionalText(120),
});

export const updateMemberSchema = z.object({
  role: z.enum(MEMBER_ROLES).optional(),
  active: z.boolean().optional(),
});

export const createCampaignSchema = z.object({
  name: trimmed(160).min(1),
  channel: z.enum(['email', 'sms', 'whatsapp']).default('email'),
  subject: optionalText(200),
  body: trimmed(4000).min(1),
  segment: optionalText(60),
  customerIds: z.array(uuid).max(2000).optional(),
});

/* -------------------------------------------------------------------------- */
/* Inferred request types                                                      */
/* -------------------------------------------------------------------------- */

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateBusinessInput = z.infer<typeof createBusinessSchema>;
export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type CreateProductInput = z.infer<typeof createProductSchema>;
export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;
export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>;
export type AiChatInput = z.infer<typeof aiChatSchema>;
export type ListCustomersInput = z.infer<typeof listCustomersSchema>;
export type ListProductsInput = z.infer<typeof listProductsSchema>;
