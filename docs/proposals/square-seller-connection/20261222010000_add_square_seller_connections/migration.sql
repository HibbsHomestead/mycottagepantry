CREATE TABLE "square_seller_connections" (
	"business_id" uuid,
	"environment" text,
	"data" jsonb NOT NULL,
	CONSTRAINT "square_seller_connections_pkey" PRIMARY KEY("business_id","environment"),
	CONSTRAINT "square_seller_environment" CHECK ("environment" IN ('sandbox', 'production'))
);
--> statement-breakpoint
ALTER TABLE "square_seller_connections" ADD CONSTRAINT "square_seller_connections_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE square_seller_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE square_seller_connections FORCE ROW LEVEL SECURITY;
CREATE POLICY square_seller_connections_organization ON square_seller_connections
USING (business_id = NULLIF(current_setting('app.business_id',true),'')::uuid)
WITH CHECK (business_id = NULLIF(current_setting('app.business_id',true),'')::uuid);
