ALTER TABLE "ai_messages" ADD COLUMN "cache_read_tokens" integer;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD COLUMN "cache_write_tokens" integer;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD COLUMN "cost_micros" integer;--> statement-breakpoint
CREATE INDEX "ai_messages_business_created_idx" ON "ai_messages" USING btree ("business_id","created_at");