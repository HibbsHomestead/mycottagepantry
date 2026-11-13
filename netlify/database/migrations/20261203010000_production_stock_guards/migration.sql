-- Extend the existing deferred ledger/balance check prospectively. Existing food
-- rows without the server-owned opt-in flag retain their original treatment.
CREATE OR REPLACE FUNCTION verify_finished_stock_ledger() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE stock_id text; stock_business uuid; balance numeric; moved numeric; tracked boolean;
BEGIN
  IF TG_TABLE_NAME = 'products' THEN stock_id := NEW.id; stock_business := NEW.business_id;
  ELSE stock_id := NEW.product_id; stock_business := NEW.business_id; END IF;
  IF stock_id IS NULL THEN RETURN NULL; END IF;
  SELECT quantity, (COALESCE(data->>'workflow','') IN ('handmade','resale') OR data->>'foodStockEnabled'='true' OR (data->>'workflow'='kit' AND data->>'stockCostKnown'='true')) INTO balance, tracked FROM products WHERE business_id=stock_business AND id=stock_id;
  IF tracked IS DISTINCT FROM true THEN RETURN NULL; END IF;
  SELECT COALESCE(SUM((data->>'quantity')::numeric),0) INTO moved FROM ledger WHERE business_id=stock_business AND product_id=stock_id;
  IF abs(balance - round(moved,8)) > 0.00000001 THEN
    RAISE EXCEPTION 'Finished stock must match its immutable movement ledger.';
  END IF;
  RETURN NULL;
END $$;
