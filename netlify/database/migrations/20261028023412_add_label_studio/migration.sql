CREATE TABLE "brand_kits" (
	"id" text NOT NULL,
	"business_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'owner' NOT NULL,
	"updated_by" text DEFAULT 'owner' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "graphic_assets" (
	"id" text NOT NULL,
	"business_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'owner' NOT NULL,
	"updated_by" text DEFAULT 'owner' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "label_elements" (
	"id" text NOT NULL,
	"business_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'owner' NOT NULL,
	"updated_by" text DEFAULT 'owner' NOT NULL,
	"template_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "label_print_jobs" (
	"id" text NOT NULL,
	"business_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'owner' NOT NULL,
	"updated_by" text DEFAULT 'owner' NOT NULL,
	"template_id" text NOT NULL,
	"product_id" text,
	"batch_id" text
);
--> statement-breakpoint
CREATE TABLE "label_templates" (
	"id" text NOT NULL,
	"business_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'owner' NOT NULL,
	"updated_by" text DEFAULT 'owner' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "label_versions" (
	"id" text NOT NULL,
	"business_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'owner' NOT NULL,
	"updated_by" text DEFAULT 'owner' NOT NULL,
	"template_id" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "brand_kits_org_id" ON "brand_kits" ("business_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "graphic_assets_org_id" ON "graphic_assets" ("business_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "label_elements_org_id" ON "label_elements" ("business_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "label_print_jobs_org_id" ON "label_print_jobs" ("business_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "label_templates_org_id" ON "label_templates" ("business_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "label_versions_org_id" ON "label_versions" ("business_id","id");--> statement-breakpoint
ALTER TABLE "brand_kits" ADD CONSTRAINT "brand_kits_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "graphic_assets" ADD CONSTRAINT "graphic_assets_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "label_elements" ADD CONSTRAINT "label_elements_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "label_elements" ADD CONSTRAINT "label_elements_BRprC0JOQ7C4_fkey" FOREIGN KEY ("business_id","template_id") REFERENCES "label_templates"("business_id","id");--> statement-breakpoint
ALTER TABLE "label_print_jobs" ADD CONSTRAINT "label_print_jobs_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "label_print_jobs" ADD CONSTRAINT "label_print_jobs_9R4Y10c5PRUh_fkey" FOREIGN KEY ("business_id","template_id") REFERENCES "label_templates"("business_id","id");--> statement-breakpoint
ALTER TABLE "label_print_jobs" ADD CONSTRAINT "label_print_jobs_ubrqgEyvoApa_fkey" FOREIGN KEY ("business_id","product_id") REFERENCES "products"("business_id","id");--> statement-breakpoint
ALTER TABLE "label_print_jobs" ADD CONSTRAINT "label_print_jobs_msZLxtWblm1x_fkey" FOREIGN KEY ("business_id","batch_id") REFERENCES "batches"("business_id","id");--> statement-breakpoint
ALTER TABLE "label_templates" ADD CONSTRAINT "label_templates_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "label_versions" ADD CONSTRAINT "label_versions_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "label_versions" ADD CONSTRAINT "label_versions_HpoeehqfO8IM_fkey" FOREIGN KEY ("business_id","template_id") REFERENCES "label_templates"("business_id","id");
--> statement-breakpoint
ALTER TABLE label_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE label_templates FORCE ROW LEVEL SECURITY;
CREATE POLICY label_templates_organization ON label_templates USING (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid) WITH CHECK (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid);

--> statement-breakpoint
ALTER TABLE label_elements ENABLE ROW LEVEL SECURITY;
ALTER TABLE label_elements FORCE ROW LEVEL SECURITY;
CREATE POLICY label_elements_organization ON label_elements USING (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid) WITH CHECK (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid);

--> statement-breakpoint
ALTER TABLE label_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE label_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY label_versions_organization ON label_versions USING (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid) WITH CHECK (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid);

--> statement-breakpoint
ALTER TABLE brand_kits ENABLE ROW LEVEL SECURITY;
ALTER TABLE brand_kits FORCE ROW LEVEL SECURITY;
CREATE POLICY brand_kits_organization ON brand_kits USING (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid) WITH CHECK (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid);

--> statement-breakpoint
ALTER TABLE graphic_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE graphic_assets FORCE ROW LEVEL SECURITY;
CREATE POLICY graphic_assets_organization ON graphic_assets USING (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid) WITH CHECK (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid);

--> statement-breakpoint
ALTER TABLE label_print_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE label_print_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY label_print_jobs_organization ON label_print_jobs USING (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid) WITH CHECK (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid);

--> statement-breakpoint
CREATE FUNCTION protect_label_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Label history is immutable. Save a new version or print job.'; END $$;
CREATE TRIGGER immutable_label_version BEFORE UPDATE OR DELETE ON label_versions FOR EACH ROW EXECUTE FUNCTION protect_label_history();
CREATE TRIGGER immutable_label_print_job BEFORE UPDATE OR DELETE ON label_print_jobs FOR EACH ROW EXECUTE FUNCTION protect_label_history();
