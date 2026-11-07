CREATE TABLE "recipe_imports" (
	"id" text NOT NULL,
	"business_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'owner' NOT NULL,
	"updated_by" text DEFAULT 'owner' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "recipe_imports_org_id" ON "recipe_imports" ("business_id","id");--> statement-breakpoint
ALTER TABLE "recipe_imports" ADD CONSTRAINT "recipe_imports_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE;
--> statement-breakpoint
-- Enforce workspace isolation for private import drafts.
ALTER TABLE recipe_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_imports FORCE ROW LEVEL SECURITY;
CREATE POLICY recipe_imports_organization ON recipe_imports
USING (business_id = NULLIF(current_setting('app.business_id',true),'')::uuid)
WITH CHECK (business_id = NULLIF(current_setting('app.business_id',true),'')::uuid);
