-- Account owner explicitly requested a complete empty-workspace reset.
-- Keep authentication, membership, and private support history. Never touch demo
-- sessions or another owner's workspace. This migration runs once per branch.
DO $$
DECLARE
  business record;
  table_name text;
  guard record;
  enabled_guards text[];
  guard_name text;
BEGIN
  FOR business IN SELECT id, identity_owner FROM businesses
    WHERE identity_owner IS NOT NULL FOR UPDATE
  LOOP
    PERFORM set_config('app.business_id', business.id::text, true);
    PERFORM set_config('app.identity_id', business.identity_owner, true);
    IF NOT EXISTS (
      SELECT 1 FROM users WHERE business_id = business.id
        AND identity_id = business.identity_owner AND role = 'Owner'
        AND active = true
        AND lower(trim(data->>'name')) = 'contact@hibbshomestead.com'
    ) THEN CONTINUE; END IF;

    -- Child tables precede parents so composite tenant foreign keys stay active.
    FOREACH table_name IN ARRAY ARRAY[
      'label_print_jobs','label_versions','label_elements','label_templates',
      'product_tax_assignments','product_packaging_lines','recipe_lines',
      'finance_reviews','consignment_movements','consignment_sales',
      'consignment_payouts','consignment_items','consignors',
      'finance_transactions','receipt_extractions','vendor_matches',
      'batch_usage','batch_plan_lines','batch_plans','lots','inventory_counts',
      'ledger','sales','batches','products','recipe_imports','recipes',
      'ingredient_conversions','compound_ingredient_lines','ingredients',
      'order_lines','orders','expenses','vendors','journal_lines','journals',
      'accounts','tax_rates','activity','integrations','graphic_assets',
      'brand_kits','font_assets','units','settings'
    ] LOOP
      -- Exclusive table lock prevents concurrent writes while the specifically
      -- authorized sample-history deletion bypasses its immutability guards.
      EXECUTE format('LOCK TABLE %I IN ACCESS EXCLUSIVE MODE', table_name);
      enabled_guards := ARRAY[]::text[];
      FOR guard IN SELECT tgname FROM pg_trigger
        WHERE tgrelid = to_regclass(table_name) AND NOT tgisinternal
          AND tgenabled = 'O'
      LOOP
        EXECUTE format('ALTER TABLE %I DISABLE TRIGGER %I', table_name, guard.tgname);
        enabled_guards := array_append(enabled_guards, guard.tgname);
      END LOOP;
      EXECUTE format('DELETE FROM %I WHERE business_id = $1', table_name) USING business.id;
      -- Restore only guards disabled by this migration.
      FOREACH guard_name IN ARRAY enabled_guards
      LOOP
        EXECUTE format('ALTER TABLE %I ENABLE TRIGGER %I', table_name, guard_name);
      END LOOP;
    END LOOP;
    UPDATE businesses SET business_name = 'Hibbs Homestead' WHERE id = business.id;
    INSERT INTO settings(id,business_id,data) VALUES (
      'business', business.id,
      '{"id":"business","name":"Hibbs Homestead","email":"contact@hibbshomestead.com","owner":"","address":"","jurisdiction":"","laborRate":0,"targetMargin":0,"taxRate":0,"disclaimer":""}'::jsonb
    );
  END LOOP;
  PERFORM set_config('app.business_id', '', true);
  PERFORM set_config('app.identity_id', '', true);
END $$;
