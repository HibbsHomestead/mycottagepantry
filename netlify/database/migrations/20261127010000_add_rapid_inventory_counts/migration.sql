-- Extend existing tenant-scoped count documents without changing legacy counts.
ALTER TABLE inventory_counts DROP CONSTRAINT inventory_counts_shape;
ALTER TABLE inventory_counts ADD CONSTRAINT inventory_counts_shape CHECK ((
  data->>'status' IN ('draft','ready','completed','cancelled')
  AND jsonb_typeof(data->'lines') = 'array'
  AND jsonb_typeof(data->'revision') = 'number'
) IS TRUE);
CREATE OR REPLACE FUNCTION validate_inventory_count() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.data->>'status' IN ('completed','cancelled') AND NEW.data IS DISTINCT FROM OLD.data THEN
    RAISE EXCEPTION 'Applied and cancelled inventory counts are immutable';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(NEW.data->'lines') line
    WHERE NOT EXISTS (SELECT 1 FROM ingredients i WHERE i.business_id = NEW.business_id AND i.id = line->>'ingredientId')
  ) THEN RAISE EXCEPTION 'Count items must belong to the authorized workspace'; END IF;
  IF NEW.data->>'version' = '2' THEN
    IF jsonb_typeof(NEW.data->'events') IS DISTINCT FROM 'array'
      OR jsonb_typeof(NEW.data->'scope') IS DISTINCT FROM 'array'
      OR COALESCE(NEW.data->>'ownerId','') = '' THEN
      RAISE EXCEPTION 'Rapid counts require saved scope, evidence and ownership';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(NEW.data->'scope') line
      WHERE NOT EXISTS (SELECT 1 FROM ingredients i WHERE i.business_id=NEW.business_id AND i.id=line->>'ingredientId')
    ) THEN RAISE EXCEPTION 'Count scope must belong to the authorized workspace'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
