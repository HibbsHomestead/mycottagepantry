-- New postings cannot silently alter a statement that has already been balanced.
-- Applies to every existing purchase/sale/correction route, not just the register.
CREATE FUNCTION guard_bookkeeping_statement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.data->>'status' = 'posted' AND EXISTS (
   SELECT 1 FROM finance_reviews r
   WHERE r.business_id = NEW.business_id AND r.data->>'kind' = 'statement'
     AND r.data->>'date' >= NEW.data->>'date'
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.data->'lines') l WHERE l->>'account' = r.data->>'account')
 ) THEN RAISE EXCEPTION 'This date is in a balanced statement period. Choose a later correction date.';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER bookkeeping_statement_lock BEFORE INSERT ON journals FOR EACH ROW EXECUTE FUNCTION guard_bookkeeping_statement();
