CREATE TABLE "photo_extraction_attempts" (
	"id" text NOT NULL,
	"business_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'owner' NOT NULL,
	"updated_by" text DEFAULT 'owner' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "photo_extraction_attempts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "photo_pilot_grants" (
	"id" text NOT NULL,
	"business_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'owner' NOT NULL,
	"updated_by" text DEFAULT 'owner' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "photo_pilot_grants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "photo_extraction_attempts_org_id" ON "photo_extraction_attempts" ("business_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "photo_pilot_grants_org_id" ON "photo_pilot_grants" ("business_id","id");--> statement-breakpoint
ALTER TABLE "photo_extraction_attempts" ADD CONSTRAINT "photo_extraction_attempts_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "photo_pilot_grants" ADD CONSTRAINT "photo_pilot_grants_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE;
--> statement-breakpoint
-- Preserve forced tenant policies and the previously approved account grant.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['photo_pilot_grants','photo_extraction_attempts'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY photo_tenant ON %I USING (business_id::text=current_setting(''app.business_id'',true)) WITH CHECK (business_id::text=current_setting(''app.business_id'',true))',t);
  END LOOP;
END $$;
SELECT set_config('app.business_id','8081ae5d-576f-4bf6-8dd4-a69b39a47bf1',true);
INSERT INTO photo_pilot_grants(id,business_id,data)
SELECT '8a87b82e-1393-4c4d-9885-62f946204b6e', '8081ae5d-576f-4bf6-8dd4-a69b39a47bf1',
  '{"enabled":true,"processingEnabled":true,"boundsVerified":true,"dailyLimit":20,"monthlyLimit":100,"spendLimitMicros":2000000,"reservationMicros":50000}'::jsonb
WHERE EXISTS (SELECT 1 FROM users WHERE business_id='8081ae5d-576f-4bf6-8dd4-a69b39a47bf1' AND identity_id='8a87b82e-1393-4c4d-9885-62f946204b6e' AND role='Owner' AND active=true);
