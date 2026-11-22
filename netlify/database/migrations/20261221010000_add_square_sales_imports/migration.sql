CREATE TABLE "sales_imports" (
	"id" text NOT NULL,
	"business_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'owner' NOT NULL,
	"updated_by" text DEFAULT 'owner' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_product_mappings" (
	"id" text NOT NULL,
	"business_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'owner' NOT NULL,
	"updated_by" text DEFAULT 'owner' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "sales_imports_org_id" ON "sales_imports" ("business_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_product_mappings_org_id" ON "sales_product_mappings" ("business_id","id");--> statement-breakpoint
ALTER TABLE "sales_imports" ADD CONSTRAINT "sales_imports_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "sales_product_mappings" ADD CONSTRAINT "sales_product_mappings_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE sales_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_imports FORCE ROW LEVEL SECURITY;
CREATE POLICY sales_imports_organization ON sales_imports
USING (business_id = NULLIF(current_setting('app.business_id',true),'')::uuid)
WITH CHECK (business_id = NULLIF(current_setting('app.business_id',true),'')::uuid);
ALTER TABLE sales_product_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_product_mappings FORCE ROW LEVEL SECURITY;
CREATE POLICY sales_product_mappings_organization ON sales_product_mappings
USING (business_id = NULLIF(current_setting('app.business_id',true),'')::uuid)
WITH CHECK (business_id = NULLIF(current_setting('app.business_id',true),'')::uuid);
ALTER TABLE sales_imports ADD CONSTRAINT sales_imports_status CHECK (data->>'status' IN ('staged','committed','reversed') AND data->>'provider'='square');
