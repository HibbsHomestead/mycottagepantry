CREATE TABLE "stripe_checkouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"business_id" uuid NOT NULL,
	"identity_id" text NOT NULL,
	"environment" text NOT NULL,
	"plan_id" text NOT NULL,
	"price_id" text NOT NULL,
	"session_id" text UNIQUE,
	"customer_id" text,
	"subscription_id" text UNIQUE,
	"status" text DEFAULT 'creating' NOT NULL,
	"checkout_url" text,
	"expires_at" timestamp with time zone,
	"reconciled_at" timestamp with time zone,
	"portal_launched_at" timestamp with time zone,
	"access_verified_at" timestamp with time zone,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stripe_events" (
	"id" text PRIMARY KEY,
	"environment" text NOT NULL,
	"kind" text NOT NULL,
	"object_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "stripe_provider_settings" (
	"environment" text PRIMARY KEY,
	"ciphertext" text,
	"fingerprint" text,
	"account_id" text,
	"account_name" text,
	"validated_at" timestamp with time zone,
	"webhook_verified_at" timestamp with time zone,
	"last_test_at" timestamp with time zone,
	"checkout_enabled" boolean DEFAULT false NOT NULL,
	"configuration" jsonb DEFAULT '{}' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stripe_checkouts" ADD CONSTRAINT "stripe_checkouts_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id");
ALTER TABLE stripe_provider_settings ADD CONSTRAINT stripe_environment CHECK(environment IN ('test','live'));
ALTER TABLE stripe_checkouts ADD CONSTRAINT stripe_checkout_environment CHECK(environment IN ('test','live'));
ALTER TABLE stripe_events ADD CONSTRAINT stripe_event_environment CHECK(environment IN ('test','live'));
CREATE UNIQUE INDEX stripe_one_open_checkout ON stripe_checkouts(business_id) WHERE status IN ('creating','open','complete');
ALTER TABLE workspace_billing DROP CONSTRAINT workspace_billing_source;
ALTER TABLE workspace_billing ADD CONSTRAINT workspace_billing_source CHECK(source IN ('unassigned','free_sandbox','free_app','square_sandbox','square_production','complimentary','stripe_test','stripe_live'));
ALTER TABLE workspace_billing DROP CONSTRAINT workspace_billing_environment;
ALTER TABLE workspace_billing ADD CONSTRAINT workspace_billing_environment CHECK(environment IS NULL OR environment IN ('sandbox','production','test','live'));
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['stripe_provider_settings','stripe_checkouts','stripe_events'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY %I ON %I USING (current_setting(''app.billing_worker'',true)=''true'' OR current_setting(''app.platform_gateway'',true)=''true'') WITH CHECK (current_setting(''app.billing_worker'',true)=''true'' OR current_setting(''app.platform_gateway'',true)=''true'')',t||'_worker',t);
 END LOOP;
END $$;
-- Lock the common business row for BOTH providers, including pending subscriptions.
CREATE FUNCTION prevent_cross_provider_subscription() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.business_id::text, 717));
 IF TG_TABLE_NAME='stripe_checkouts' AND NEW.status IN ('creating','open','complete') THEN
  IF EXISTS(SELECT 1 FROM billing_subscriptions WHERE business_id=NEW.business_id AND status IN ('PENDING','ACTIVE','PAUSED')) OR EXISTS(SELECT 1 FROM billing_attempts WHERE business_id=NEW.business_id AND status IN ('checkout_pending','payment_processing','unknown')) THEN
   RAISE EXCEPTION 'Existing Square billing requires reconciliation before Stripe checkout';
  END IF;
 ELSIF TG_TABLE_NAME='billing_attempts' AND NEW.status IN ('checkout_pending','payment_processing','unknown') THEN
  IF EXISTS(SELECT 1 FROM stripe_checkouts WHERE business_id=NEW.business_id AND status IN ('creating','open','complete')) THEN RAISE EXCEPTION 'Existing Stripe billing requires reconciliation'; END IF;
 ELSIF TG_TABLE_NAME='billing_subscriptions' AND NEW.status IN ('PENDING','ACTIVE','PAUSED') THEN
  IF EXISTS(SELECT 1 FROM stripe_checkouts WHERE business_id=NEW.business_id AND status IN ('creating','open','complete')) THEN RAISE EXCEPTION 'Cross-provider billing conflict requires review'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER stripe_provider_guard BEFORE INSERT OR UPDATE ON stripe_checkouts FOR EACH ROW EXECUTE FUNCTION prevent_cross_provider_subscription();
CREATE TRIGGER square_checkout_provider_guard BEFORE INSERT OR UPDATE ON billing_attempts FOR EACH ROW EXECUTE FUNCTION prevent_cross_provider_subscription();
CREATE TRIGGER square_subscription_provider_guard BEFORE INSERT OR UPDATE ON billing_subscriptions FOR EACH ROW EXECUTE FUNCTION prevent_cross_provider_subscription();

-- Extend the existing shared member-limit trigger without changing Square grace.
DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef('enforce_business_user_limit()'::regprocedure) INTO definition;
 definition := replace(definition, 'billing.source IN (''square_sandbox'',''square_production'')', 'billing.source IN (''square_sandbox'',''square_production'',''stripe_test'',''stripe_live'')');
 EXECUTE definition;
END $$;
