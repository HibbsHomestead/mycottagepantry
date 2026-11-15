CREATE TABLE "stripe_subscription_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"business_id" uuid NOT NULL,
	"identity_id" text NOT NULL,
	"environment" text NOT NULL,
	"subscription_id" text NOT NULL,
	"from_plan" text NOT NULL,
	"to_plan" text NOT NULL,
	"from_price" text NOT NULL,
	"to_price" text,
	"kind" text NOT NULL,
	"status" text DEFAULT 'previewed' NOT NULL,
	"preview" jsonb NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"confirmed_at" timestamp with time zone,
	"provider_schedule_id" text,
	"provider_invoice_id" text,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stripe_change_environment" CHECK ("environment" IN ('test','live')),
	CONSTRAINT "stripe_change_kind" CHECK ("kind" IN ('upgrade','downgrade','cancel','resume')),
	CONSTRAINT "stripe_change_status" CHECK ("status" IN ('previewed','applying','pending','scheduled','releasing','applied','cancelled','expired','failed'))
);
--> statement-breakpoint
ALTER TABLE "stripe_subscription_changes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "stripe_changes_subscription" ON "stripe_subscription_changes" ("business_id","subscription_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stripe_one_pending_change" ON "stripe_subscription_changes" ("business_id") WHERE "status" IN ('applying','pending','scheduled','releasing');--> statement-breakpoint
ALTER TABLE "stripe_subscription_changes" ADD CONSTRAINT "stripe_subscription_changes_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id");
--> statement-breakpoint
ALTER TABLE stripe_subscription_changes FORCE ROW LEVEL SECURITY;
CREATE POLICY stripe_changes_worker ON stripe_subscription_changes
  USING (current_setting('app.billing_worker',true)='true' OR current_setting('app.platform_gateway',true)='true')
  WITH CHECK (current_setting('app.billing_worker',true)='true' OR current_setting('app.platform_gateway',true)='true');

-- A scheduled lower allowance also caps new memberships. Existing members and data
-- are never removed. Serialize additions with owner changes to close the renewal race.
CREATE FUNCTION enforce_pending_subscription_seats() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE allowance integer; member_count integer; previous_worker text;
BEGIN
  IF NOT NEW.active THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' THEN
    IF OLD.active AND OLD.business_id=NEW.business_id THEN RETURN NEW; END IF;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.business_id::text,717));
  previous_worker := current_setting('app.billing_worker',true);
  PERFORM set_config('app.billing_worker','true',true);
  SELECT (preview->>'toUsers')::integer INTO allowance
    FROM stripe_subscription_changes
    WHERE business_id=NEW.business_id AND kind IN ('downgrade','cancel')
      AND status IN ('applying','pending','scheduled','releasing')
    ORDER BY created_at DESC LIMIT 1;
  PERFORM set_config('app.billing_worker',COALESCE(previous_worker,''),true);
  IF allowance IS NOT NULL THEN
    SELECT count(*) INTO member_count FROM users WHERE business_id=NEW.business_id AND active=true;
    IF member_count >= allowance THEN
      RAISE EXCEPTION 'The scheduled plan allows % total users including the owner. Cancel the pending change before adding more members. Existing members were not changed.',allowance;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER a_pending_subscription_seats BEFORE INSERT OR UPDATE OF active,business_id ON users
  FOR EACH ROW EXECUTE FUNCTION enforce_pending_subscription_seats();
