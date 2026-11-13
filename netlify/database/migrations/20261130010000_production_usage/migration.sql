DROP INDEX "batch_usage_org_id";--> statement-breakpoint
ALTER TABLE "batch_usage" ADD COLUMN "batch_id" text;--> statement-breakpoint
ALTER TABLE "batch_usage" ADD COLUMN "ingredient_id" text;--> statement-breakpoint
ALTER TABLE "batch_usage" ADD COLUMN "product_id" text;--> statement-breakpoint
ALTER TABLE "batch_usage" ADD COLUMN "quantity" numeric(20,8);--> statement-breakpoint
ALTER TABLE "batch_usage" ADD CONSTRAINT "batch_usage_business_id_batch_id_batches_business_id_id_fkey" FOREIGN KEY ("business_id","batch_id") REFERENCES "batches"("business_id","id");--> statement-breakpoint
ALTER TABLE "batch_usage" ADD CONSTRAINT "batch_usage_Y2eNwTBOYEHz_fkey" FOREIGN KEY ("business_id","ingredient_id") REFERENCES "ingredients"("business_id","id");--> statement-breakpoint
ALTER TABLE "batch_usage" ADD CONSTRAINT "batch_usage_business_id_product_id_products_business_id_id_fkey" FOREIGN KEY ("business_id","product_id") REFERENCES "products"("business_id","id");--> statement-breakpoint
ALTER TABLE "batch_usage" ADD CONSTRAINT "production_usage_reference" CHECK ("batch_id" IS NULL OR (("ingredient_id" IS NULL) <> ("product_id" IS NULL) AND "quantity" >= 0));