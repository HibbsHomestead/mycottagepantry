CREATE TABLE "inventory_counts" (
	"id" text NOT NULL,
	"business_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'owner' NOT NULL,
	"updated_by" text DEFAULT 'owner' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_counts_org_id" ON "inventory_counts" ("business_id","id");--> statement-breakpoint
ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE;
--> statement-breakpoint

-- Tenant isolation and inventory-count integrity safeguards.
ALTER TABLE inventory_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_counts FORCE ROW LEVEL SECURITY;
CREATE POLICY inventory_counts_organization ON inventory_counts
USING (business_id = NULLIF(current_setting('app.business_id',true),'')::uuid)
WITH CHECK (business_id = NULLIF(current_setting('app.business_id',true),'')::uuid);

ALTER TABLE inventory_counts ADD CONSTRAINT inventory_counts_shape CHECK ((
  data->>'status' IN ('draft','completed')
  AND jsonb_typeof(data->'lines') = 'array'
  AND jsonb_typeof(data->'revision') = 'number'
) IS TRUE);
CREATE FUNCTION validate_inventory_count() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.data->>'status' = 'completed' AND NEW.data IS DISTINCT FROM OLD.data THEN
    RAISE EXCEPTION 'Completed inventory counts are immutable';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(NEW.data->'lines') line
    WHERE NOT EXISTS (SELECT 1 FROM ingredients i WHERE i.business_id = NEW.business_id AND i.id = line->>'ingredientId')
  ) THEN
    RAISE EXCEPTION 'Count items must belong to the authorized workspace';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER inventory_counts_validate BEFORE INSERT OR UPDATE ON inventory_counts
FOR EACH ROW EXECUTE FUNCTION validate_inventory_count();
