CREATE TABLE font_assets (
  id text NOT NULL,
  business_id uuid NOT NULL CONSTRAINT font_assets_business_id_businesses_id_fkey REFERENCES businesses(id) ON DELETE CASCADE,
  data jsonb NOT NULL,
  created_at timestamp DEFAULT now() NOT NULL,
  updated_at timestamp DEFAULT now() NOT NULL,
  created_by text DEFAULT 'owner' NOT NULL,
  updated_by text DEFAULT 'owner' NOT NULL
);
CREATE UNIQUE INDEX font_assets_org_id ON font_assets(business_id,id);
ALTER TABLE font_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE font_assets FORCE ROW LEVEL SECURITY;
CREATE POLICY font_assets_organization ON font_assets
USING (business_id = NULLIF(current_setting('app.business_id',true),'')::uuid)
WITH CHECK (business_id = NULLIF(current_setting('app.business_id',true),'')::uuid);
