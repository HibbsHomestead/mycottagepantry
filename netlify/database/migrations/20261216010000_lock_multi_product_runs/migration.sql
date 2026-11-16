-- Roll forward only. Existing runs and stock history are not rewritten.
CREATE FUNCTION protect_finalized_multi_product_run() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.data->>'productionVersion' = '2' AND OLD.data->>'status' IN ('completed', 'canceled') THEN
    IF TG_OP = 'DELETE' OR NEW.data IS DISTINCT FROM OLD.data THEN
      RAISE EXCEPTION 'Finalized or cancelled production runs are immutable; use linked corrections';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER immutable_multi_product_run BEFORE UPDATE OR DELETE ON batches
FOR EACH ROW EXECUTE FUNCTION protect_finalized_multi_product_run();
