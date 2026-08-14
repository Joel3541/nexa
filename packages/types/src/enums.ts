/**
 * Domain enumerations shared by the database, API and web client.
 * These are the single source of truth — the Drizzle schema builds its
 * pg enums from these arrays so drift is impossible.
 */

export const MEMBER_ROLES = ['owner', 'admin', 'manager', 'staff', 'viewer'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const CUSTOMER_STATUSES = ['active', 'inactive', 'lead', 'blocked'] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

export const PRODUCT_KINDS = ['physical', 'service'] as const;
export type ProductKind = (typeof PRODUCT_KINDS)[number];

export const ORDER_STATUSES = ['draft', 'pending', 'confirmed', 'fulfilled', 'cancelled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_STATUSES = ['unpaid', 'partial', 'paid', 'refunded'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_METHODS = [
  'cash',
  'mobile_money',
  'bank_transfer',
  'card',
  'cheque',
  'credit',
  'other',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const INVOICE_STATUSES = ['draft', 'sent', 'partial', 'paid', 'overdue', 'void'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const TASK_STATUSES = ['todo', 'in_progress', 'waiting', 'completed'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const APPOINTMENT_STATUSES = [
  'scheduled',
  'confirmed',
  'completed',
  'cancelled',
  'no_show',
  'rescheduled',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const INVENTORY_MOVEMENT_REASONS = [
  'purchase',
  'sale',
  'adjustment',
  'return',
  'damage',
  'transfer',
  'opening_stock',
] as const;
export type InventoryMovementReason = (typeof INVENTORY_MOVEMENT_REASONS)[number];

export const ACTIVITY_SEVERITIES = ['info', 'success', 'warning', 'critical'] as const;
export type ActivitySeverity = (typeof ACTIVITY_SEVERITIES)[number];

export const ACTIVITY_SOURCES = ['system', 'user', 'ai'] as const;
export type ActivitySource = (typeof ACTIVITY_SOURCES)[number];

export const AI_ACTION_STATUSES = ['proposed', 'approved', 'rejected', 'executed', 'failed', 'expired'] as const;
export type AiActionStatus = (typeof AI_ACTION_STATUSES)[number];

export const AI_MESSAGE_ROLES = ['user', 'assistant', 'tool', 'system'] as const;
export type AiMessageRole = (typeof AI_MESSAGE_ROLES)[number];

export const AGENT_IDS = [
  'chief_of_staff',
  'sales',
  'customer',
  'finance',
  'inventory',
  'marketing',
] as const;
export type AgentId = (typeof AGENT_IDS)[number];

export const SUBSCRIPTION_PLANS = ['free', 'pro', 'business', 'enterprise'] as const;
export type SubscriptionPlan = (typeof SUBSCRIPTION_PLANS)[number];

export const SUBSCRIPTION_STATUSES = ['trialing', 'active', 'past_due', 'cancelled'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const NOTIFICATION_CHANNELS = ['in_app', 'email', 'sms', 'whatsapp', 'push'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const CAMPAIGN_STATUSES = ['draft', 'pending_approval', 'scheduled', 'sent', 'cancelled'] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

/**
 * Permission strings follow `resource:action`. Roles map to permission sets in
 * packages/types/src/permissions.ts. AI tools declare the permission they need,
 * so an AI acting for a `staff` member can never exceed that member's rights.
 */
export const PERMISSIONS = [
  'business:read',
  'business:update',
  'members:read',
  'members:manage',
  'customers:read',
  'customers:write',
  'customers:delete',
  'products:read',
  'products:write',
  'products:delete',
  'inventory:read',
  'inventory:write',
  'orders:read',
  'orders:write',
  'orders:refund',
  'invoices:read',
  'invoices:write',
  'invoices:send',
  'expenses:read',
  'expenses:write',
  'tasks:read',
  'tasks:write',
  'appointments:read',
  'appointments:write',
  'analytics:read',
  'campaigns:read',
  'campaigns:send',
  'ai:use',
  'ai:approve_actions',
  'audit:read',
  'settings:manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];
