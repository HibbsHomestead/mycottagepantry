-- Additive only: preserves existing data, forced RLS and immutable history.
ALTER TABLE "ledger" ADD COLUMN "product_id" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "quantity" numeric(20,8) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "cost" numeric(20,8) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger" ALTER COLUMN "ingredient_id" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX "ledger_product_stock" ON "ledger" ("business_id","product_id") WHERE "product_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger" ADD CONSTRAINT "ledger_business_id_product_id_products_business_id_id_fkey" FOREIGN KEY ("business_id","product_id") REFERENCES "products"("business_id","id");--> statement-breakpoint
ALTER TABLE "ledger" ADD CONSTRAINT "ledger_one_stock_identity" CHECK (("ingredient_id" IS NULL) <> ("product_id" IS NULL));--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_nonnegative_stock" CHECK ("quantity" >= 0);--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_nonnegative_cost" CHECK ("cost" >= 0);
--> statement-breakpoint

-- Check at commit, after both the balance and its immutable movement are written.
CREATE FUNCTION verify_finished_stock_ledger() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE stock_id text; stock_business uuid; balance numeric; moved numeric; workflow text;
BEGIN
  IF TG_TABLE_NAME = 'products' THEN stock_id := NEW.id; stock_business := NEW.business_id;
  ELSE stock_id := NEW.product_id; stock_business := NEW.business_id; END IF;
  IF stock_id IS NULL THEN RETURN NULL; END IF;
  SELECT quantity, data->>'workflow' INTO balance, workflow FROM products WHERE business_id=stock_business AND id=stock_id;
  IF workflow NOT IN ('handmade','resale') OR workflow IS NULL THEN RETURN NULL; END IF;
  SELECT COALESCE(SUM((data->>'quantity')::numeric),0) INTO moved FROM ledger WHERE business_id=stock_business AND product_id=stock_id;
  IF abs(balance - round(moved,8)) > 0.00000001 THEN
    RAISE EXCEPTION 'Finished stock must match its immutable movement ledger.';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER finished_stock_product_balance AFTER INSERT OR UPDATE ON products
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_finished_stock_ledger();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER finished_stock_movement_balance AFTER INSERT ON ledger
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_finished_stock_ledger();
