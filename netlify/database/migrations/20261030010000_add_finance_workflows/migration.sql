-- Table structure, indexes, and foreign keys were created by the preceding
-- generated migration. This migration adds the application security protections.
ALTER TABLE receipt_extractions ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipt_extractions FORCE ROW LEVEL SECURITY;
CREATE POLICY receipt_extractions_organization ON receipt_extractions
 USING (business_id = NULLIF(current_setting('app.business_id',true),'')::uuid)
 WITH CHECK (business_id = NULLIF(current_setting('app.business_id',true),'')::uuid);
--> statement-breakpoint
ALTER TABLE finance_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_transactions FORCE ROW LEVEL SECURITY;
CREATE POLICY finance_transactions_organization ON finance_transactions
 USING (business_id = NULLIF(current_setting('app.business_id',true),'')::uuid)
 WITH CHECK (business_id = NULLIF(current_setting('app.business_id',true),'')::uuid);
--> statement-breakpoint
ALTER TABLE consignors ENABLE ROW LEVEL SECURITY;
ALTER TABLE consignors FORCE ROW LEVEL SECURITY;
CREATE POLICY consignors_organization ON consignors
 USING (business_id = NULLIF(current_setting('app.business_id',true),'')::uuid)
 WITH CHECK (business_id = NULLIF(current_setting('app.business_id',true),'')::uuid);
--> statement-breakpoint
ALTER TABLE consignment_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE consignment_items FORCE ROW LEVEL SECURITY;
CREATE POLICY consignment_items_organization ON consignment_items
 USING (business_id = NULLIF(current_setting('app.business_id',true),'')::uuid)
 WITH CHECK (business_id = NULLIF(current_setting('app.business_id',true),'')::uuid);
--> statement-breakpoint
ALTER TABLE consignment_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE consignment_movements FORCE ROW LEVEL SECURITY;
CREATE POLICY consignment_movements_organization ON consignment_movements
 USING (business_id = NULLIF(current_setting('app.business_id',true),'')::uuid)
 WITH CHECK (business_id = NULLIF(current_setting('app.business_id',true),'')::uuid);
--> statement-breakpoint
ALTER TABLE consignment_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE consignment_sales FORCE ROW LEVEL SECURITY;
CREATE POLICY consignment_sales_organization ON consignment_sales
 USING (business_id = NULLIF(current_setting('app.business_id',true),'')::uuid)
 WITH CHECK (business_id = NULLIF(current_setting('app.business_id',true),'')::uuid);
--> statement-breakpoint
ALTER TABLE consignment_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE consignment_payouts FORCE ROW LEVEL SECURITY;
CREATE POLICY consignment_payouts_organization ON consignment_payouts
 USING (business_id = NULLIF(current_setting('app.business_id',true),'')::uuid)
 WITH CHECK (business_id = NULLIF(current_setting('app.business_id',true),'')::uuid);
--> statement-breakpoint
ALTER TABLE vendor_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_matches FORCE ROW LEVEL SECURITY;
CREATE POLICY vendor_matches_organization ON vendor_matches
 USING (business_id = NULLIF(current_setting('app.business_id',true),'')::uuid)
 WITH CHECK (business_id = NULLIF(current_setting('app.business_id',true),'')::uuid);
--> statement-breakpoint
ALTER TABLE finance_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_reviews FORCE ROW LEVEL SECURITY;
CREATE POLICY finance_reviews_organization ON finance_reviews
 USING (business_id = NULLIF(current_setting('app.business_id',true),'')::uuid)
 WITH CHECK (business_id = NULLIF(current_setting('app.business_id',true),'')::uuid);
--> statement-breakpoint
CREATE FUNCTION protect_confirmed_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF OLD.data->>'status'='posted' THEN RAISE EXCEPTION 'Posted receipts are immutable.'; END IF; RETURN NEW; END $$;
CREATE TRIGGER immutable_confirmed_receipt BEFORE UPDATE OR DELETE ON receipt_extractions FOR EACH ROW EXECUTE FUNCTION protect_confirmed_receipt();
CREATE FUNCTION protect_consignment_sale() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF TG_OP='DELETE' OR (NEW.data - ARRAY['paid','status','updatedAt','updatedBy']) IS DISTINCT FROM (OLD.data - ARRAY['paid','status','updatedAt','updatedBy']) THEN RAISE EXCEPTION 'Consignment sale details are immutable.'; END IF; RETURN NEW; END $$;
CREATE TRIGGER immutable_consignment_sale BEFORE UPDATE OR DELETE ON consignment_sales FOR EACH ROW EXECUTE FUNCTION protect_consignment_sale();
CREATE FUNCTION protect_finance_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF TG_OP='DELETE' OR (NEW.data - ARRAY['paid','reversedBy','updatedAt','updatedBy']) IS DISTINCT FROM (OLD.data - ARRAY['paid','reversedBy','updatedAt','updatedBy']) THEN RAISE EXCEPTION 'Posted financial details are immutable.'; END IF; RETURN NEW; END $$;
CREATE TRIGGER immutable_finance_record BEFORE UPDATE OR DELETE ON finance_transactions FOR EACH ROW EXECUTE FUNCTION protect_finance_record();
CREATE TRIGGER immutable_consignment_payout BEFORE UPDATE OR DELETE ON consignment_payouts FOR EACH ROW EXECUTE FUNCTION protect_finance_record();
CREATE TRIGGER immutable_consignment_movement BEFORE UPDATE OR DELETE ON consignment_movements FOR EACH ROW EXECUTE FUNCTION protect_finance_record();

CREATE TRIGGER immutable_finance_review BEFORE UPDATE OR DELETE ON finance_reviews FOR EACH ROW EXECUTE FUNCTION protect_finance_record();
--> statement-breakpoint
-- Defer existing tenant-scoped relationships until the transaction completes.
ALTER TABLE consignment_items ALTER CONSTRAINT "consignment_items_HWvn7hluSb1d_fkey" DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE consignment_sales ALTER CONSTRAINT "consignment_sales_wXZebYPTyktH_fkey" DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE consignment_movements ALTER CONSTRAINT "consignment_movements_0Z0OqLhie935_fkey" DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE consignment_payouts ALTER CONSTRAINT "consignment_payouts_2rHHG6qOC8m2_fkey" DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE finance_transactions ALTER CONSTRAINT "finance_transactions_BKKkUZk2RpAV_fkey" DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE finance_transactions ALTER CONSTRAINT "finance_transactions_3N1LkzkIanqB_fkey" DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE finance_reviews ALTER CONSTRAINT "finance_reviews_WNLeCEeKqwhC_fkey" DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE vendor_matches ALTER CONSTRAINT "vendor_matches_3nGgTRWfjeWD_fkey" DEFERRABLE INITIALLY DEFERRED;
