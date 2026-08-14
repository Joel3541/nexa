CREATE TYPE "public"."activity_severity" AS ENUM('info', 'success', 'warning', 'critical');--> statement-breakpoint
CREATE TYPE "public"."activity_source" AS ENUM('system', 'user', 'ai');--> statement-breakpoint
CREATE TYPE "public"."ai_action_status" AS ENUM('proposed', 'approved', 'rejected', 'executed', 'failed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."ai_message_role" AS ENUM('user', 'assistant', 'tool', 'system');--> statement-breakpoint
CREATE TYPE "public"."appointment_status" AS ENUM('scheduled', 'confirmed', 'completed', 'cancelled', 'no_show', 'rescheduled');--> statement-breakpoint
CREATE TYPE "public"."campaign_status" AS ENUM('draft', 'pending_approval', 'scheduled', 'sent', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."customer_status" AS ENUM('active', 'inactive', 'lead', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."inventory_reason" AS ENUM('purchase', 'sale', 'adjustment', 'return', 'damage', 'transfer', 'opening_stock');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('draft', 'sent', 'partial', 'paid', 'overdue', 'void');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('owner', 'admin', 'manager', 'staff', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('in_app', 'email', 'sms', 'whatsapp', 'push');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('draft', 'pending', 'confirmed', 'fulfilled', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('cash', 'mobile_money', 'bank_transfer', 'card', 'cheque', 'credit', 'other');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('unpaid', 'partial', 'paid', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."product_kind" AS ENUM('physical', 'service');--> statement-breakpoint
CREATE TYPE "public"."subscription_plan" AS ENUM('free', 'pro', 'business', 'enterprise');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('trialing', 'active', 'past_due', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."task_priority" AS ENUM('low', 'medium', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('todo', 'in_progress', 'waiting', 'completed');--> statement-breakpoint
CREATE TABLE "activity_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"type" varchar(60) NOT NULL,
	"severity" "activity_severity" DEFAULT 'info' NOT NULL,
	"source" "activity_source" DEFAULT 'system' NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text,
	"entity_type" varchar(40),
	"entity_id" uuid,
	"action_label" varchar(60),
	"action_href" varchar(200),
	"actor_user_id" uuid,
	"dedupe_key" varchar(160),
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_action_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"action_id" uuid NOT NULL,
	"decided_by_user_id" uuid NOT NULL,
	"decision" varchar(20) NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"conversation_id" uuid,
	"message_id" uuid,
	"requested_by_user_id" uuid NOT NULL,
	"agent_id" varchar(40) DEFAULT 'chief_of_staff' NOT NULL,
	"tool" varchar(60) NOT NULL,
	"label" varchar(200) NOT NULL,
	"description" text NOT NULL,
	"payload" jsonb NOT NULL,
	"preview" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"impact" varchar(10) DEFAULT 'medium' NOT NULL,
	"status" "ai_action_status" DEFAULT 'proposed' NOT NULL,
	"result" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"title" varchar(200) DEFAULT 'New conversation' NOT NULL,
	"agent_id" varchar(40) DEFAULT 'chief_of_staff' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" "ai_message_role" NOT NULL,
	"content" text NOT NULL,
	"agent_id" varchar(40),
	"tool_calls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"provider" varchar(20),
	"model" varchar(60),
	"input_tokens" integer,
	"output_tokens" integer,
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"title" varchar(200) NOT NULL,
	"customer_id" uuid,
	"product_id" uuid,
	"staff_id" uuid,
	"starts_at" timestamp with time zone NOT NULL,
	"duration_minutes" integer DEFAULT 60 NOT NULL,
	"status" "appointment_status" DEFAULT 'scheduled' NOT NULL,
	"location" varchar(200),
	"notes" text,
	"external_calendar_id" varchar(200),
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid,
	"actor_user_id" uuid,
	"actor_type" "activity_source" DEFAULT 'user' NOT NULL,
	"actor_name" varchar(120),
	"action" varchar(80) NOT NULL,
	"entity_type" varchar(40),
	"entity_id" uuid,
	"summary" text NOT NULL,
	"metadata" jsonb,
	"ip_address" varchar(64),
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "member_role" DEFAULT 'staff' NOT NULL,
	"title" varchar(80),
	"active" boolean DEFAULT true NOT NULL,
	"invited_by_user_id" uuid,
	"invited_at" timestamp with time zone,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_settings" (
	"business_id" uuid PRIMARY KEY NOT NULL,
	"tax_enabled" boolean DEFAULT false NOT NULL,
	"tax_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"tax_label" varchar(40) DEFAULT 'VAT' NOT NULL,
	"tax_inclusive" boolean DEFAULT true NOT NULL,
	"invoice_prefix" varchar(12) DEFAULT 'INV' NOT NULL,
	"invoice_next_number" integer DEFAULT 1001 NOT NULL,
	"invoice_due_days" integer DEFAULT 14 NOT NULL,
	"invoice_notes" text,
	"invoice_footer" text,
	"order_next_number" integer DEFAULT 1001 NOT NULL,
	"low_stock_threshold" integer DEFAULT 5 NOT NULL,
	"fiscal_year_start_month" integer DEFAULT 1 NOT NULL,
	"notification_preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled_modules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "businesses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(160) NOT NULL,
	"slug" varchar(180) NOT NULL,
	"industry" varchar(80) DEFAULT 'Other' NOT NULL,
	"business_type" varchar(80),
	"country" varchar(2) DEFAULT 'GH' NOT NULL,
	"currency" varchar(3) DEFAULT 'GHS' NOT NULL,
	"locale" varchar(12) DEFAULT 'en-GH' NOT NULL,
	"timezone" varchar(60) DEFAULT 'Africa/Accra' NOT NULL,
	"description" text,
	"logo_url" text,
	"phone" varchar(40),
	"email" varchar(254),
	"website" varchar(200),
	"address_line1" varchar(200),
	"address_line2" varchar(200),
	"city" varchar(100),
	"region" varchar(100),
	"postal_code" varchar(30),
	"social_links" jsonb,
	"employee_count" integer,
	"primary_goal" varchar(60),
	"goals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"onboarded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"channel" varchar(20) DEFAULT 'email' NOT NULL,
	"status" "campaign_status" DEFAULT 'draft' NOT NULL,
	"subject" varchar(200),
	"body" text NOT NULL,
	"segment" varchar(60),
	"audience_count" integer DEFAULT 0 NOT NULL,
	"audience_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"scheduled_for" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"source" "activity_source" DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"type" varchar(40) NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text,
	"amount_minor" bigint,
	"link_id" uuid,
	"actor_user_id" uuid,
	"source" "activity_source" DEFAULT 'user' NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"tag" varchar(40) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"email" varchar(254),
	"phone" varchar(40),
	"company" varchar(160),
	"address_line1" varchar(200),
	"city" varchar(100),
	"region" varchar(100),
	"country" varchar(2),
	"status" "customer_status" DEFAULT 'active' NOT NULL,
	"notes" text,
	"source" varchar(80),
	"total_spent_minor" bigint DEFAULT 0 NOT NULL,
	"outstanding_minor" bigint DEFAULT 0 NOT NULL,
	"order_count" integer DEFAULT 0 NOT NULL,
	"last_purchase_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expense_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"name" varchar(80) NOT NULL,
	"color" varchar(12),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"category_id" uuid,
	"amount_minor" bigint DEFAULT 0 NOT NULL,
	"vendor" varchar(160),
	"description" text,
	"payment_method" "payment_method" DEFAULT 'cash' NOT NULL,
	"receipt_url" text,
	"recurring" boolean DEFAULT false NOT NULL,
	"spent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid,
	"source" "activity_source" DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity_delta" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"reason" "inventory_reason" DEFAULT 'adjustment' NOT NULL,
	"unit_cost_minor" bigint,
	"note" text,
	"order_id" uuid,
	"actor_user_id" uuid,
	"source" "activity_source" DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"product_id" uuid,
	"name" varchar(200) NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_minor" bigint DEFAULT 0 NOT NULL,
	"discount_minor" bigint DEFAULT 0 NOT NULL,
	"total_minor" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"number" varchar(40) NOT NULL,
	"customer_id" uuid NOT NULL,
	"order_id" uuid,
	"status" "invoice_status" DEFAULT 'draft' NOT NULL,
	"subtotal_minor" bigint DEFAULT 0 NOT NULL,
	"discount_minor" bigint DEFAULT 0 NOT NULL,
	"tax_minor" bigint DEFAULT 0 NOT NULL,
	"total_minor" bigint DEFAULT 0 NOT NULL,
	"paid_minor" bigint DEFAULT 0 NOT NULL,
	"issue_date" date NOT NULL,
	"due_date" date NOT NULL,
	"notes" text,
	"sent_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"source" "activity_source" DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"channel" varchar(20) NOT NULL,
	"provider" varchar(40) NOT NULL,
	"recipient" varchar(254) NOT NULL,
	"subject" varchar(200),
	"body" text NOT NULL,
	"status" varchar(20) DEFAULT 'queued' NOT NULL,
	"simulated" boolean DEFAULT true NOT NULL,
	"error" text,
	"campaign_id" uuid,
	"customer_id" uuid,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"channel" "notification_channel" DEFAULT 'in_app' NOT NULL,
	"title" varchar(200) NOT NULL,
	"body" text,
	"severity" "activity_severity" DEFAULT 'info' NOT NULL,
	"href" varchar(200),
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid,
	"name" varchar(200) NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_minor" bigint DEFAULT 0 NOT NULL,
	"unit_cost_minor" bigint DEFAULT 0 NOT NULL,
	"discount_minor" bigint DEFAULT 0 NOT NULL,
	"total_minor" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"reference" varchar(40) NOT NULL,
	"customer_id" uuid,
	"status" "order_status" DEFAULT 'confirmed' NOT NULL,
	"payment_status" "payment_status" DEFAULT 'unpaid' NOT NULL,
	"subtotal_minor" bigint DEFAULT 0 NOT NULL,
	"discount_minor" bigint DEFAULT 0 NOT NULL,
	"tax_minor" bigint DEFAULT 0 NOT NULL,
	"total_minor" bigint DEFAULT 0 NOT NULL,
	"paid_minor" bigint DEFAULT 0 NOT NULL,
	"cost_minor" bigint DEFAULT 0 NOT NULL,
	"channel" varchar(40),
	"note" text,
	"created_by_user_id" uuid,
	"source" "activity_source" DEFAULT 'user' NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"customer_id" uuid,
	"order_id" uuid,
	"invoice_id" uuid,
	"amount_minor" bigint DEFAULT 0 NOT NULL,
	"method" "payment_method" DEFAULT 'cash' NOT NULL,
	"reference" varchar(120),
	"note" text,
	"provider" varchar(40),
	"provider_ref" varchar(160),
	"is_refund" boolean DEFAULT false NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"name" varchar(80) NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"kind" "product_kind" DEFAULT 'physical' NOT NULL,
	"sku" varchar(60),
	"description" text,
	"category_id" uuid,
	"cost_price_minor" bigint DEFAULT 0 NOT NULL,
	"selling_price_minor" bigint DEFAULT 0 NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"min_stock" integer DEFAULT 0 NOT NULL,
	"track_inventory" boolean DEFAULT true NOT NULL,
	"supplier" varchar(160),
	"duration_minutes" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"user_agent" text,
	"ip_address" varchar(64),
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"plan" "subscription_plan" DEFAULT 'free' NOT NULL,
	"status" "subscription_status" DEFAULT 'trialing' NOT NULL,
	"seats" integer DEFAULT 1 NOT NULL,
	"provider" varchar(40),
	"provider_ref" varchar(120),
	"trial_ends_at" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text,
	"status" "task_status" DEFAULT 'todo' NOT NULL,
	"priority" "task_priority" DEFAULT 'medium' NOT NULL,
	"customer_id" uuid,
	"order_id" uuid,
	"invoice_id" uuid,
	"assignee_id" uuid,
	"due_date" timestamp with time zone,
	"recurrence" varchar(20) DEFAULT 'none' NOT NULL,
	"completed_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"source" "activity_source" DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid,
	"user_id" uuid,
	"name" varchar(60) NOT NULL,
	"properties" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(254) NOT NULL,
	"password_hash" text NOT NULL,
	"full_name" varchar(120) NOT NULL,
	"avatar_url" text,
	"phone" varchar(40),
	"timezone" varchar(60),
	"email_verified_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_business_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" varchar(40) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_action_approvals" ADD CONSTRAINT "ai_action_approvals_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_action_approvals" ADD CONSTRAINT "ai_action_approvals_action_id_ai_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."ai_actions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_action_approvals" ADD CONSTRAINT "ai_action_approvals_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_actions" ADD CONSTRAINT "ai_actions_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_actions" ADD CONSTRAINT "ai_actions_conversation_id_ai_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_actions" ADD CONSTRAINT "ai_actions_message_id_ai_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."ai_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_actions" ADD CONSTRAINT "ai_actions_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversation_id_ai_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_staff_id_users_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_members" ADD CONSTRAINT "business_members_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_members" ADD CONSTRAINT "business_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_settings" ADD CONSTRAINT "business_settings_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_events" ADD CONSTRAINT "customer_events_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_events" ADD CONSTRAINT "customer_events_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_tags" ADD CONSTRAINT "customer_tags_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_tags" ADD CONSTRAINT "customer_tags_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_id_expense_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."expense_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_outbox" ADD CONSTRAINT "message_outbox_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_outbox" ADD CONSTRAINT "message_outbox_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_outbox" ADD CONSTRAINT "message_outbox_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_product_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."product_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_tokens" ADD CONSTRAINT "verification_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_events_business_created_idx" ON "activity_events" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "activity_events_dedupe_unique" ON "activity_events" USING btree ("business_id","dedupe_key") WHERE "activity_events"."dedupe_key" is not null;--> statement-breakpoint
CREATE INDEX "ai_action_approvals_action_idx" ON "ai_action_approvals" USING btree ("action_id");--> statement-breakpoint
CREATE INDEX "ai_actions_business_status_idx" ON "ai_actions" USING btree ("business_id","status","created_at");--> statement-breakpoint
CREATE INDEX "ai_conversations_business_user_idx" ON "ai_conversations" USING btree ("business_id","user_id","updated_at");--> statement-breakpoint
CREATE INDEX "ai_messages_conversation_idx" ON "ai_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "appointments_business_start_idx" ON "appointments" USING btree ("business_id","starts_at");--> statement-breakpoint
CREATE INDEX "appointments_customer_idx" ON "appointments" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "audit_logs_business_created_idx" ON "audit_logs" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "business_members_unique" ON "business_members" USING btree ("business_id","user_id");--> statement-breakpoint
CREATE INDEX "business_members_user_idx" ON "business_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "businesses_slug_unique" ON "businesses" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "campaigns_business_idx" ON "campaigns" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE INDEX "customer_events_customer_idx" ON "customer_events" USING btree ("customer_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_tags_unique" ON "customer_tags" USING btree ("customer_id","tag");--> statement-breakpoint
CREATE INDEX "customer_tags_business_tag_idx" ON "customer_tags" USING btree ("business_id","tag");--> statement-breakpoint
CREATE INDEX "customers_business_idx" ON "customers" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "customers_business_name_idx" ON "customers" USING btree ("business_id","name");--> statement-breakpoint
CREATE INDEX "customers_business_last_purchase_idx" ON "customers" USING btree ("business_id","last_purchase_at");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_business_email_unique" ON "customers" USING btree ("business_id",lower("email")) WHERE "customers"."email" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "expense_categories_unique" ON "expense_categories" USING btree ("business_id",lower("name"));--> statement-breakpoint
CREATE INDEX "expenses_business_spent_idx" ON "expenses" USING btree ("business_id","spent_at");--> statement-breakpoint
CREATE INDEX "expenses_category_idx" ON "expenses" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "inventory_movements_product_idx" ON "inventory_movements" USING btree ("product_id","created_at");--> statement-breakpoint
CREATE INDEX "inventory_movements_business_idx" ON "inventory_movements" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE INDEX "invoice_items_invoice_idx" ON "invoice_items" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_business_number_unique" ON "invoices" USING btree ("business_id","number");--> statement-breakpoint
CREATE INDEX "invoices_business_status_idx" ON "invoices" USING btree ("business_id","status");--> statement-breakpoint
CREATE INDEX "invoices_customer_idx" ON "invoices" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "invoices_due_date_idx" ON "invoices" USING btree ("business_id","due_date");--> statement-breakpoint
CREATE INDEX "message_outbox_business_idx" ON "message_outbox" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "order_items_order_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_items_product_idx" ON "order_items" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_business_reference_unique" ON "orders" USING btree ("business_id","reference");--> statement-breakpoint
CREATE INDEX "orders_business_occurred_idx" ON "orders" USING btree ("business_id","occurred_at");--> statement-breakpoint
CREATE INDEX "orders_customer_idx" ON "orders" USING btree ("customer_id","occurred_at");--> statement-breakpoint
CREATE INDEX "orders_business_payment_status_idx" ON "orders" USING btree ("business_id","payment_status");--> statement-breakpoint
CREATE INDEX "payments_business_received_idx" ON "payments" USING btree ("business_id","received_at");--> statement-breakpoint
CREATE INDEX "payments_order_idx" ON "payments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "payments_invoice_idx" ON "payments" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_categories_unique" ON "product_categories" USING btree ("business_id",lower("name"));--> statement-breakpoint
CREATE INDEX "products_business_idx" ON "products" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "products_business_name_idx" ON "products" USING btree ("business_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "products_business_sku_unique" ON "products" USING btree ("business_id",lower("sku")) WHERE "products"."sku" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_unique" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_business_unique" ON "subscriptions" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "tasks_business_status_idx" ON "tasks" USING btree ("business_id","status");--> statement-breakpoint
CREATE INDEX "tasks_business_due_idx" ON "tasks" USING btree ("business_id","due_date");--> statement-breakpoint
CREATE INDEX "tasks_customer_idx" ON "tasks" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "usage_events_name_idx" ON "usage_events" USING btree ("name","created_at");--> statement-breakpoint
CREATE INDEX "usage_events_business_idx" ON "usage_events" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "verification_tokens_hash_unique" ON "verification_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "verification_tokens_user_idx" ON "verification_tokens" USING btree ("user_id","purpose");