ALTER TABLE "batches" ADD COLUMN "product_id" text;--> statement-breakpoint
ALTER TABLE "batches" ALTER COLUMN "recipe_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_business_id_product_id_products_business_id_id_fkey" FOREIGN KEY ("business_id","product_id") REFERENCES "products"("business_id","id");--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "product_run_has_target" CHECK (("data"->>'productionVersion') IS NULL OR "product_id" IS NOT NULL);