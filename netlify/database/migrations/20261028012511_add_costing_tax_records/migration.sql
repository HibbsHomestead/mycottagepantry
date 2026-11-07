CREATE TABLE "product_tax_assignments" (
	"id" text NOT NULL,
	"business_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'owner' NOT NULL,
	"updated_by" text DEFAULT 'owner' NOT NULL,
	"product_id" text NOT NULL,
	"tax_rate_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_rates" (
	"id" text NOT NULL,
	"business_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'owner' NOT NULL,
	"updated_by" text DEFAULT 'owner' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "product_tax_assignments_org_id" ON "product_tax_assignments" ("business_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_rates_org_id" ON "tax_rates" ("business_id","id");--> statement-breakpoint
ALTER TABLE "product_tax_assignments" ADD CONSTRAINT "product_tax_assignments_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "product_tax_assignments" ADD CONSTRAINT "product_tax_assignments_Kq4Nasa44ivZ_fkey" FOREIGN KEY ("business_id","product_id") REFERENCES "products"("business_id","id");--> statement-breakpoint
ALTER TABLE "product_tax_assignments" ADD CONSTRAINT "product_tax_assignments_IXNq7IAlRgwl_fkey" FOREIGN KEY ("business_id","tax_rate_id") REFERENCES "tax_rates"("business_id","id");--> statement-breakpoint
ALTER TABLE "tax_rates" ADD CONSTRAINT "tax_rates_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE tax_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_rates FORCE ROW LEVEL SECURITY;
CREATE POLICY tax_rates_organization ON tax_rates USING (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid) WITH CHECK (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid);
ALTER TABLE product_tax_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_tax_assignments FORCE ROW LEVEL SECURITY;
CREATE POLICY product_tax_assignments_organization ON product_tax_assignments USING (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid) WITH CHECK (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid);
CREATE FUNCTION protect_recorded_sale() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Recorded sales and their cost/tax snapshots are immutable. Use a refund.'; END $$;
CREATE TRIGGER immutable_recorded_sale BEFORE UPDATE OR DELETE ON sales FOR EACH ROW EXECUTE FUNCTION protect_recorded_sale();
