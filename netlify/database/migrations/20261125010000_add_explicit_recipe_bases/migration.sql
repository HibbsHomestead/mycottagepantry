CREATE TABLE "recipe_base_links" (
	"id" text NOT NULL,
	"business_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'owner' NOT NULL,
	"updated_by" text DEFAULT 'owner' NOT NULL,
	"recipe_id" text NOT NULL,
	"base_recipe_id" text NOT NULL,
	"multiplier" numeric(20,8) NOT NULL,
	CONSTRAINT "recipe_base_links_positive" CHECK ("multiplier" > 0),
	CONSTRAINT "recipe_base_links_no_self" CHECK ("recipe_id" <> "base_recipe_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "recipe_base_links_org_id" ON "recipe_base_links" ("business_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "recipe_base_links_parent" ON "recipe_base_links" ("business_id","recipe_id");--> statement-breakpoint
ALTER TABLE "recipe_base_links" ADD CONSTRAINT "recipe_base_links_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "recipe_base_links" ADD CONSTRAINT "recipe_base_links_zYe5jssiVVPp_fkey" FOREIGN KEY ("business_id","recipe_id") REFERENCES "recipes"("business_id","id");--> statement-breakpoint
ALTER TABLE "recipe_base_links" ADD CONSTRAINT "recipe_base_links_XSDJ1REXk9c1_fkey" FOREIGN KEY ("business_id","base_recipe_id") REFERENCES "recipes"("business_id","id");
--> statement-breakpoint
-- No backfill: existing recipes, lines, yields and inventory remain untouched.
ALTER TABLE recipe_base_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_base_links FORCE ROW LEVEL SECURITY;
CREATE POLICY recipe_base_links_organization ON recipe_base_links
USING (business_id = NULLIF(current_setting('app.business_id',true),'')::uuid)
WITH CHECK (business_id = NULLIF(current_setting('app.business_id',true),'')::uuid);
