CREATE TABLE "catalog_identifiers" (
	"identifier" text PRIMARY KEY,
	"item_id" text NOT NULL,
	"raw" text NOT NULL,
	"format" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "catalog_identifiers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "catalog_items" (
	"id" text PRIMARY KEY,
	"kind" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_kind" CHECK ("kind" IN ('ingredient','packaging','supply')),
	CONSTRAINT "catalog_status" CHECK ("status" IN ('active','withdrawn','superseded'))
);
--> statement-breakpoint
ALTER TABLE "catalog_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "catalog_revisions" (
	"id" text PRIMARY KEY,
	"item_id" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "catalog_revisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "catalog_submissions" (
	"id" text NOT NULL,
	"business_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'owner' NOT NULL,
	"updated_by" text DEFAULT 'owner' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	CONSTRAINT "submission_status" CHECK ("status" IN ('pending','approved','rejected'))
);
--> statement-breakpoint
ALTER TABLE "catalog_submissions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ingredient_catalog_sources" (
	"id" text NOT NULL,
	"business_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'owner' NOT NULL,
	"updated_by" text DEFAULT 'owner' NOT NULL,
	"ingredient_id" text NOT NULL,
	"revision_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ingredient_catalog_sources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "product_lookup_usage" (
	"id" text NOT NULL,
	"business_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'owner' NOT NULL,
	"updated_by" text DEFAULT 'owner' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_lookup_usage" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_submissions_org_id" ON "catalog_submissions" ("business_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "ingredient_catalog_sources_org_id" ON "ingredient_catalog_sources" ("business_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_lookup_usage_org_id" ON "product_lookup_usage" ("business_id","id");--> statement-breakpoint
ALTER TABLE "catalog_identifiers" ADD CONSTRAINT "catalog_identifiers_item_id_catalog_items_id_fkey" FOREIGN KEY ("item_id") REFERENCES "catalog_items"("id");--> statement-breakpoint
ALTER TABLE "catalog_revisions" ADD CONSTRAINT "catalog_revisions_item_id_catalog_items_id_fkey" FOREIGN KEY ("item_id") REFERENCES "catalog_items"("id");--> statement-breakpoint
ALTER TABLE "catalog_submissions" ADD CONSTRAINT "catalog_submissions_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ingredient_catalog_sources" ADD CONSTRAINT "ingredient_catalog_sources_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ingredient_catalog_sources" ADD CONSTRAINT "ingredient_catalog_sources_gSZj5GxznfUZ_fkey" FOREIGN KEY ("revision_id") REFERENCES "catalog_revisions"("id");--> statement-breakpoint
ALTER TABLE "ingredient_catalog_sources" ADD CONSTRAINT "ingredient_catalog_sources_pH3r6vV8c4vD_fkey" FOREIGN KEY ("business_id","ingredient_id") REFERENCES "ingredients"("business_id","id");--> statement-breakpoint
ALTER TABLE "product_lookup_usage" ADD CONSTRAINT "product_lookup_usage_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE;-- Shared records expose approved reference snapshots only. Tenant sources and
-- submissions remain isolated; platform review reads explicitly shared submissions.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['catalog_items','catalog_revisions','catalog_identifiers'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY catalog_member_read ON %I FOR SELECT USING (EXISTS (SELECT 1 FROM users WHERE identity_id=current_setting(''app.identity_id'',true) AND business_id::text=current_setting(''app.business_id'',true) AND active=true) OR current_setting(''app.platform_gateway'',true)=''true'')',t);
    EXECUTE format('CREATE POLICY catalog_admin_write ON %I FOR ALL USING (current_setting(''app.platform_gateway'',true)=''true'') WITH CHECK (current_setting(''app.platform_gateway'',true)=''true'')',t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['ingredient_catalog_sources','catalog_submissions','product_lookup_usage'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY tenant_catalog ON %I USING (business_id::text=current_setting(''app.business_id'',true)) WITH CHECK (business_id::text=current_setting(''app.business_id'',true))',t);
  END LOOP;
END $$;
CREATE POLICY submission_admin ON catalog_submissions USING (current_setting('app.platform_gateway',true)='true') WITH CHECK (current_setting('app.platform_gateway',true)='true');
-- Counters contain only operation names and counts, never product/draft content.
CREATE POLICY lookup_counter_worker ON product_lookup_usage USING (current_setting('app.lookup_counter_worker',true)='true') WITH CHECK (current_setting('app.lookup_counter_worker',true)='true');
CREATE FUNCTION protect_catalog_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Catalog revision and acceptance history is immutable'; END $$;
CREATE TRIGGER catalog_revision_immutable BEFORE UPDATE OR DELETE ON catalog_revisions FOR EACH ROW EXECUTE FUNCTION protect_catalog_history();
CREATE TRIGGER catalog_source_immutable BEFORE UPDATE OR DELETE ON ingredient_catalog_sources FOR EACH ROW EXECUTE FUNCTION protect_catalog_history();
-- Generic starters deliberately contain no brand, identifiers, sizes or allergen claims.
SELECT set_config('app.platform_gateway','true',true);
INSERT INTO catalog_items(id,kind) VALUES ('starter-flour','ingredient'),('starter-sugar','ingredient'),('starter-box','packaging'),('starter-liner','packaging'),('starter-parchment','supply'),('starter-gloves','supply');
INSERT INTO catalog_revisions(id,item_id,data,created_by)
SELECT id||'-r1', id, jsonb_build_object('kind',kind,'entryType','generic','fields',jsonb_build_object('name',CASE id WHEN 'starter-flour' THEN 'All-purpose flour' WHEN 'starter-sugar' THEN 'Granulated sugar' WHEN 'starter-box' THEN 'Bakery box' WHEN 'starter-liner' THEN 'Cupcake liner' WHEN 'starter-parchment' THEN 'Parchment paper' ELSE 'Disposable gloves' END),'sources','[]'::jsonb,'reviewScope','Generic name and item type only; product details and allergens are unknown.','reviewedAt','2026-11-07'), 'system-starter' FROM catalog_items WHERE id LIKE 'starter-%';

SELECT set_config('app.platform_gateway','',true);
