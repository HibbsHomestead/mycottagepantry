CREATE TABLE "accounts" (
	"id" text NOT NULL,
	"business_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'owner' NOT NULL,
	"updated_by" text DEFAULT 'owner' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity" (
	"id" text NOT NULL,
	"business_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'owner' NOT NULL,
	"updated_by" text DEFAULT 'owner' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "batch_plan_lines" (
	"id" text NOT NULL,
	"business_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'owner' NOT NULL,
	"updated_by" text DEFAULT 'owner' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "batch_plans" (
	"id" text NOT NULL,
	"business_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'owner' NOT NULL,
	"updated_by" text DEFAULT 'owner' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "batch_usage" (
	"id" text NOT NULL,
	"business_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'owner' NOT NULL,
	"updated_by" text DEFAULT 'owner' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "batches" (
	"id" text NOT NULL,
	"business_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'owner' NOT NULL,
	"updated_by" text DEFAULT 'owner' NOT NULL,
	"recipe_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "businesses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"business_name" text NOT NULL,
	"identity_owner" text UNIQUE,
	"session_hash" text UNIQUE,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compound_ingredient_lines" (
	"id" text NOT NULL,
	"business_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'owner' NOT NULL,
	"updated_by" text DEFAULT 'owner' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" text NOT NULL,
	"business_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'owner' NOT NULL,
	"updated_by" text DEFAULT 'owner' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingredient_conversions" (
	"id" text NOT NULL,
	"business_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'owner' NOT NULL,
	"updated_by" text DEFAULT 'owner' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingredients" (
	"id" text NOT NULL,
	"business_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'owner' NOT NULL,
	"updated_by" text DEFAULT 'owner' NOT NULL,
	"quantity" numeric(20,8) DEFAULT '0' NOT NULL,
	"cost" numeric(20,8) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" text NOT NULL,
	"business_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'owner' NOT NULL,
	"updated_by" text DEFAULT 'owner' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_lines" (
	"id" text NOT NULL,
	"business_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'owner' NOT NULL,
	"updated_by" text DEFAULT 'owner' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journals" (
	"id" text NOT NULL,
	"business_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'owner' NOT NULL,
	"updated_by" text DEFAULT 'owner' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger" (
	"id" text NOT NULL,
	"business_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'owner' NOT NULL,
	"updated_by" text DEFAULT 'owner' NOT NULL,
	"ingredient_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lots" (
	"id" text NOT NULL,
	"business_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'owner' NOT NULL,
	"updated_by" text DEFAULT 'owner' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_lines" (
	"id" text NOT NULL,
	"business_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'owner' NOT NULL,
	"updated_by" text DEFAULT 'owner' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text NOT NULL,
	"business_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'owner' NOT NULL,
	"updated_by" text DEFAULT 'owner' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_packaging_lines" (
	"id" text NOT NULL,
	"business_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'owner' NOT NULL,
	"updated_by" text DEFAULT 'owner' NOT NULL,
	"product_id" text NOT NULL,
	"ingredient_id" text NOT NULL,
	"quantity" numeric(20,8) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" text NOT NULL,
	"business_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'owner' NOT NULL,
	"updated_by" text DEFAULT 'owner' NOT NULL,
	"recipe_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipe_lines" (
	"id" text NOT NULL,
	"business_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'owner' NOT NULL,
	"updated_by" text DEFAULT 'owner' NOT NULL,
	"recipe_id" text NOT NULL,
	"ingredient_id" text NOT NULL,
	"quantity" numeric(20,8) NOT NULL,
	"unit" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipes" (
	"id" text NOT NULL,
	"business_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'owner' NOT NULL,
	"updated_by" text DEFAULT 'owner' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales" (
	"id" text NOT NULL,
	"business_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'owner' NOT NULL,
	"updated_by" text DEFAULT 'owner' NOT NULL,
	"product_id" text
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" text NOT NULL,
	"business_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'owner' NOT NULL,
	"updated_by" text DEFAULT 'owner' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "units" (
	"id" text NOT NULL,
	"business_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'owner' NOT NULL,
	"updated_by" text DEFAULT 'owner' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text NOT NULL,
	"business_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'owner' NOT NULL,
	"updated_by" text DEFAULT 'owner' NOT NULL,
	"identity_id" text NOT NULL,
	"role" text DEFAULT 'Owner' NOT NULL,
	"active" boolean DEFAULT true
);
--> statement-breakpoint
CREATE TABLE "vendors" (
	"id" text NOT NULL,
	"business_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'owner' NOT NULL,
	"updated_by" text DEFAULT 'owner' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_org_id" ON "accounts" ("business_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "activity_org_id" ON "activity" ("business_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "batch_plan_lines_org_id" ON "batch_plan_lines" ("business_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "batch_plans_org_id" ON "batch_plans" ("business_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "batch_usage_org_id" ON "batch_usage" ("business_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "batches_org_id" ON "batches" ("business_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "compound_ingredient_lines_org_id" ON "compound_ingredient_lines" ("business_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "expenses_org_id" ON "expenses" ("business_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "ingredient_conversions_org_id" ON "ingredient_conversions" ("business_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "ingredients_org_id" ON "ingredients" ("business_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_org_id" ON "integrations" ("business_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_lines_org_id" ON "journal_lines" ("business_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "journals_org_id" ON "journals" ("business_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_org_id" ON "ledger" ("business_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "lots_org_id" ON "lots" ("business_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "order_lines_org_id" ON "order_lines" ("business_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_org_id" ON "orders" ("business_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_packaging_lines_org_id" ON "product_packaging_lines" ("business_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "products_org_id" ON "products" ("business_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "recipe_lines_org_id" ON "recipe_lines" ("business_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "recipes_org_id" ON "recipes" ("business_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_org_id" ON "sales" ("business_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "settings_org_id" ON "settings" ("business_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "units_org_id" ON "units" ("business_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_org_id" ON "users" ("business_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_identity" ON "users" ("identity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vendors_org_id" ON "vendors" ("business_id","id");--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "batch_plan_lines" ADD CONSTRAINT "batch_plan_lines_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "batch_plans" ADD CONSTRAINT "batch_plans_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "batch_usage" ADD CONSTRAINT "batch_usage_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_business_id_recipe_id_recipes_business_id_id_fkey" FOREIGN KEY ("business_id","recipe_id") REFERENCES "recipes"("business_id","id");--> statement-breakpoint
ALTER TABLE "compound_ingredient_lines" ADD CONSTRAINT "compound_ingredient_lines_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ingredient_conversions" ADD CONSTRAINT "ingredient_conversions_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ingredients" ADD CONSTRAINT "ingredients_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "journals" ADD CONSTRAINT "journals_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ledger" ADD CONSTRAINT "ledger_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ledger" ADD CONSTRAINT "ledger_j4zyiZgcfTWq_fkey" FOREIGN KEY ("business_id","ingredient_id") REFERENCES "ingredients"("business_id","id");--> statement-breakpoint
ALTER TABLE "lots" ADD CONSTRAINT "lots_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "product_packaging_lines" ADD CONSTRAINT "product_packaging_lines_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "product_packaging_lines" ADD CONSTRAINT "product_packaging_lines_npOKX9MqhWg2_fkey" FOREIGN KEY ("business_id","product_id") REFERENCES "products"("business_id","id");--> statement-breakpoint
ALTER TABLE "product_packaging_lines" ADD CONSTRAINT "product_packaging_lines_ujNxyocXS762_fkey" FOREIGN KEY ("business_id","ingredient_id") REFERENCES "ingredients"("business_id","id");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_business_id_recipe_id_recipes_business_id_id_fkey" FOREIGN KEY ("business_id","recipe_id") REFERENCES "recipes"("business_id","id");--> statement-breakpoint
ALTER TABLE "recipe_lines" ADD CONSTRAINT "recipe_lines_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "recipe_lines" ADD CONSTRAINT "recipe_lines_business_id_recipe_id_recipes_business_id_id_fkey" FOREIGN KEY ("business_id","recipe_id") REFERENCES "recipes"("business_id","id");--> statement-breakpoint
ALTER TABLE "recipe_lines" ADD CONSTRAINT "recipe_lines_moTCG0Hoa53X_fkey" FOREIGN KEY ("business_id","ingredient_id") REFERENCES "ingredients"("business_id","id");--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_business_id_product_id_products_business_id_id_fkey" FOREIGN KEY ("business_id","product_id") REFERENCES "products"("business_id","id");--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE;
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
CREATE POLICY "users_organization" ON "users" USING (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid OR identity_id = NULLIF(current_setting('app.identity_id', true),'')) WITH CHECK (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid);

ALTER TABLE "vendors" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vendors" FORCE ROW LEVEL SECURITY;
CREATE POLICY "vendors_organization" ON "vendors" USING (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid) WITH CHECK (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid);

ALTER TABLE "units" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "units" FORCE ROW LEVEL SECURITY;
CREATE POLICY "units_organization" ON "units" USING (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid) WITH CHECK (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid);

ALTER TABLE "ingredients" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ingredients" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ingredients_organization" ON "ingredients" USING (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid) WITH CHECK (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid);

ALTER TABLE "ingredient_conversions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ingredient_conversions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ingredient_conversions_organization" ON "ingredient_conversions" USING (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid) WITH CHECK (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid);

ALTER TABLE "compound_ingredient_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "compound_ingredient_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY "compound_ingredient_lines_organization" ON "compound_ingredient_lines" USING (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid) WITH CHECK (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid);

ALTER TABLE "recipes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recipes" FORCE ROW LEVEL SECURITY;
CREATE POLICY "recipes_organization" ON "recipes" USING (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid) WITH CHECK (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid);

ALTER TABLE "recipe_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recipe_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY "recipe_lines_organization" ON "recipe_lines" USING (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid) WITH CHECK (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid);

ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "products" FORCE ROW LEVEL SECURITY;
CREATE POLICY "products_organization" ON "products" USING (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid) WITH CHECK (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid);

ALTER TABLE "product_packaging_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_packaging_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY "product_packaging_lines_organization" ON "product_packaging_lines" USING (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid) WITH CHECK (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid);

ALTER TABLE "batch_plans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "batch_plans" FORCE ROW LEVEL SECURITY;
CREATE POLICY "batch_plans_organization" ON "batch_plans" USING (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid) WITH CHECK (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid);

ALTER TABLE "batch_plan_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "batch_plan_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY "batch_plan_lines_organization" ON "batch_plan_lines" USING (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid) WITH CHECK (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid);

ALTER TABLE "batches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "batches" FORCE ROW LEVEL SECURITY;
CREATE POLICY "batches_organization" ON "batches" USING (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid) WITH CHECK (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid);

ALTER TABLE "batch_usage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "batch_usage" FORCE ROW LEVEL SECURITY;
CREATE POLICY "batch_usage_organization" ON "batch_usage" USING (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid) WITH CHECK (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid);

ALTER TABLE "lots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lots" FORCE ROW LEVEL SECURITY;
CREATE POLICY "lots_organization" ON "lots" USING (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid) WITH CHECK (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid);

ALTER TABLE "ledger" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ledger" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ledger_organization" ON "ledger" USING (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid) WITH CHECK (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid);

ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "orders" FORCE ROW LEVEL SECURITY;
CREATE POLICY "orders_organization" ON "orders" USING (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid) WITH CHECK (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid);

ALTER TABLE "order_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "order_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY "order_lines_organization" ON "order_lines" USING (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid) WITH CHECK (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid);

ALTER TABLE "expenses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "expenses" FORCE ROW LEVEL SECURITY;
CREATE POLICY "expenses_organization" ON "expenses" USING (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid) WITH CHECK (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid);

ALTER TABLE "sales" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sales" FORCE ROW LEVEL SECURITY;
CREATE POLICY "sales_organization" ON "sales" USING (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid) WITH CHECK (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid);

ALTER TABLE "accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "accounts" FORCE ROW LEVEL SECURITY;
CREATE POLICY "accounts_organization" ON "accounts" USING (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid) WITH CHECK (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid);

ALTER TABLE "journals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "journals" FORCE ROW LEVEL SECURITY;
CREATE POLICY "journals_organization" ON "journals" USING (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid) WITH CHECK (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid);

ALTER TABLE "journal_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "journal_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY "journal_lines_organization" ON "journal_lines" USING (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid) WITH CHECK (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid);

ALTER TABLE "activity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "activity" FORCE ROW LEVEL SECURITY;
CREATE POLICY "activity_organization" ON "activity" USING (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid) WITH CHECK (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid);

ALTER TABLE "settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "settings" FORCE ROW LEVEL SECURITY;
CREATE POLICY "settings_organization" ON "settings" USING (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid) WITH CHECK (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid);

ALTER TABLE "integrations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "integrations" FORCE ROW LEVEL SECURITY;
CREATE POLICY "integrations_organization" ON "integrations" USING (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid) WITH CHECK (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid);

CREATE FUNCTION protect_posted_journal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF OLD.data->>'status'='posted' THEN RAISE EXCEPTION 'Posted journals are immutable. Use a reversing entry.'; END IF; RETURN NEW; END $$;
CREATE TRIGGER immutable_posted_journal BEFORE UPDATE OR DELETE ON journals FOR EACH ROW EXECUTE FUNCTION protect_posted_journal();
ALTER TABLE ingredients ADD CONSTRAINT nonnegative_stock CHECK(quantity >= 0), ADD CONSTRAINT nonnegative_unit_cost CHECK(cost >= 0);
CREATE FUNCTION validate_posted_journal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE debit_total numeric; credit_total numeric;
BEGIN
IF NEW.data->>'status'='posted' THEN
SELECT SUM((line->>'debit')::numeric), SUM((line->>'credit')::numeric) INTO debit_total, credit_total FROM jsonb_array_elements(NEW.data->'lines') AS line;
IF debit_total IS NULL OR debit_total<=0 OR debit_total<>credit_total THEN RAISE EXCEPTION 'Posted entries must balance.'; END IF;
END IF; RETURN NEW; END $$;
CREATE TRIGGER balanced_journal BEFORE INSERT OR UPDATE ON journals FOR EACH ROW EXECUTE FUNCTION validate_posted_journal();

ALTER TABLE users ADD CONSTRAINT valid_workspace_role CHECK(role IN ('Owner','Manager','Production Staff','Read-only Accountant'));
CREATE FUNCTION protect_completed_batch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF OLD.data->>'status'='completed' THEN RAISE EXCEPTION 'Completed batches are immutable. Create a new batch.'; END IF; RETURN NEW; END $$;
CREATE TRIGGER immutable_completed_batch BEFORE UPDATE OR DELETE ON batches FOR EACH ROW EXECUTE FUNCTION protect_completed_batch();
CREATE FUNCTION protect_ledger_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Inventory history is immutable. Record a correction transaction.'; END $$;
CREATE TRIGGER immutable_ledger BEFORE UPDATE OR DELETE ON ledger FOR EACH ROW EXECUTE FUNCTION protect_ledger_history();
