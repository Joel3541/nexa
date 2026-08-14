CREATE TABLE "payment_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"invoice_id" uuid,
	"order_id" uuid,
	"reference" varchar(120) NOT NULL,
	"provider" varchar(40) NOT NULL,
	"provider_ref" varchar(160),
	"amount_minor" bigint DEFAULT 0 NOT NULL,
	"currency" varchar(3) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"checkout_url" text,
	"settled_at" timestamp with time zone,
	"failure_reason" text,
	"created_by_user_id" uuid,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_links_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_links_business_idx" ON "payment_links" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE INDEX "payment_links_invoice_idx" ON "payment_links" USING btree ("invoice_id");