-- Usage rows inherit existing forced tenant policies. New immutable records use
-- the existing ledger-history protection function; no legacy rows are rewritten.
CREATE TRIGGER immutable_production_usage BEFORE UPDATE OR DELETE ON batch_usage FOR EACH ROW EXECUTE FUNCTION protect_ledger_history();
