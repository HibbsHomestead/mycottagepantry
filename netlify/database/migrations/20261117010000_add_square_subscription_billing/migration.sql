CREATE TABLE "billing_connection_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"environment" text NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ok" boolean NOT NULL,
	"merchant_id" text,
	"location_id" text,
	"location_name" text,
	"currency" text,
	"country" text,
	"missing" jsonb DEFAULT '[]' NOT NULL,
	"error_code" text
);
--> statement-breakpoint
CREATE TABLE "billing_invoices" (
	"id" text PRIMARY KEY,
	"environment" text NOT NULL,
	"business_id" uuid NOT NULL,
	"subscription_id" text NOT NULL,
	"status" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"paid_cents" integer DEFAULT 0 NOT NULL,
	"refunded_cents" integer DEFAULT 0 NOT NULL,
	"currency" text NOT NULL,
	"service_from" text,
	"service_through" text,
	"version" integer DEFAULT 0 NOT NULL,
	"retrieved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_plan_mappings" (
	"environment" text,
	"plan_id" text,
	"catalog_plan_id" text NOT NULL,
	"variation_id" text NOT NULL UNIQUE,
	"amount_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"cadence" text NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_plan_mappings_pkey" PRIMARY KEY("environment","plan_id")
);
--> statement-breakpoint
CREATE TABLE "billing_subscriptions" (
	"subscription_id" text PRIMARY KEY,
	"environment" text NOT NULL,
	"business_id" uuid NOT NULL,
	"attempt_id" uuid,
	"customer_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"plan_variation_id" text NOT NULL,
	"status" text NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "billing_attempts" ADD COLUMN "environment" text DEFAULT 'sandbox' NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_attempts" ADD COLUMN "amount_cents" integer;--> statement-breakpoint
ALTER TABLE "billing_attempts" ADD COLUMN "plan_variation_id" text;--> statement-breakpoint
ALTER TABLE "billing_attempts" ADD COLUMN "checkout_url" text;--> statement-breakpoint
ALTER TABLE "billing_attempts" ADD COLUMN "consent_version" text;--> statement-breakpoint
ALTER TABLE "billing_attempts" ADD COLUMN "consent_hash" text;--> statement-breakpoint
ALTER TABLE "billing_attempts" ADD COLUMN "consented_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "billing_attempts" ADD COLUMN "customer_id" text;--> statement-breakpoint
ALTER TABLE "billing_attempts" ADD COLUMN "error_code" text;--> statement-breakpoint
ALTER TABLE "billing_attempts" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "billing_events" ADD COLUMN "environment" text DEFAULT 'sandbox' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_billing" ADD COLUMN "environment" text;--> statement-breakpoint
ALTER TABLE "workspace_billing" ADD COLUMN "billing_owner_identity" text;--> statement-breakpoint
ALTER TABLE "workspace_billing" ADD COLUMN "customer_id" text;--> statement-breakpoint
ALTER TABLE "workspace_billing" ADD COLUMN "plan_variation_id" text;--> statement-breakpoint
ALTER TABLE "workspace_billing" ADD COLUMN "provider_status" text;--> statement-breakpoint
ALTER TABLE "workspace_billing" ADD COLUMN "provider_version" integer;--> statement-breakpoint
ALTER TABLE "workspace_billing" ADD COLUMN "next_billing_date" text;--> statement-breakpoint
ALTER TABLE "workspace_billing" ADD COLUMN "canceled_date" text;--> statement-breakpoint
ALTER TABLE "workspace_billing" ADD COLUMN "last_reconciled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "billing_invoices" ADD CONSTRAINT "billing_invoices_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id");--> statement-breakpoint
ALTER TABLE "billing_invoices" ADD CONSTRAINT "billing_invoices_pH3DRgz9TpWx_fkey" FOREIGN KEY ("subscription_id") REFERENCES "billing_subscriptions"("subscription_id");--> statement-breakpoint
ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id");--> statement-breakpoint
ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_attempt_id_billing_attempts_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "billing_attempts"("id");
-- Platform subscription billing only. Customer Square sales sync, bakery
-- ledgers and merchandise tax settings are never written by these tables.
-- Cottage Mercantile becomes storable at its approved $40 monthly price.
ALTER TABLE workspace_billing DROP CONSTRAINT workspace_billing_plan;
ALTER TABLE workspace_billing ADD CONSTRAINT workspace_billing_plan CHECK (plan_id IS NULL OR plan_id IN ('free','mixing-bowl','bakers-bench','cottage-kitchen','cottage-mercantile'));
ALTER TABLE workspace_billing DROP CONSTRAINT workspace_billing_source;
ALTER TABLE workspace_billing ADD CONSTRAINT workspace_billing_source CHECK (source IN ('unassigned','free_sandbox','free_app','square_sandbox','square_production','complimentary'));
ALTER TABLE workspace_billing ADD CONSTRAINT workspace_billing_environment CHECK (environment IS NULL OR environment IN ('sandbox','production'));
ALTER TABLE billing_attempts DROP CONSTRAINT billing_attempts_plan;
ALTER TABLE billing_attempts ADD CONSTRAINT billing_attempts_plan CHECK (plan_id IN ('mixing-bowl','bakers-bench','cottage-kitchen','cottage-mercantile'));
ALTER TABLE billing_attempts ADD CONSTRAINT billing_attempts_environment CHECK (environment IN ('sandbox','production'));
ALTER TABLE billing_attempts ADD CONSTRAINT billing_attempts_status CHECK (status IN ('checkout_pending','payment_processing','unknown','completed','abandoned','failed','needs_review'));
ALTER TABLE billing_attempts ADD CONSTRAINT billing_attempts_amount CHECK (amount_cents IS NULL OR amount_cents >= 100);
ALTER TABLE billing_events ADD CONSTRAINT billing_events_environment CHECK (environment IN ('sandbox','production'));
ALTER TABLE billing_subscriptions ADD CONSTRAINT billing_subscriptions_plan CHECK (plan_id IN ('mixing-bowl','bakers-bench','cottage-kitchen','cottage-mercantile'));
ALTER TABLE billing_subscriptions ADD CONSTRAINT billing_subscriptions_environment CHECK (environment IN ('sandbox','production'));
ALTER TABLE billing_invoices ADD CONSTRAINT billing_invoices_environment CHECK (environment IN ('sandbox','production'));
ALTER TABLE billing_invoices ADD CONSTRAINT billing_invoices_amounts CHECK (amount_cents >= 0 AND paid_cents >= 0 AND refunded_cents >= 0);
ALTER TABLE billing_plan_mappings ADD CONSTRAINT billing_plan_mappings_plan CHECK (plan_id IN ('mixing-bowl','bakers-bench','cottage-kitchen','cottage-mercantile'));
ALTER TABLE billing_plan_mappings ADD CONSTRAINT billing_plan_mappings_environment CHECK (environment IN ('sandbox','production'));
ALTER TABLE billing_plan_mappings ADD CONSTRAINT billing_plan_mappings_monthly CHECK (cadence = 'MONTHLY' AND currency = 'USD' AND amount_cents >= 100);
ALTER TABLE billing_connection_checks ADD CONSTRAINT billing_connection_checks_environment CHECK (environment IN ('sandbox','production'));
-- At most one live provider subscription per oven; a second is held for review.
CREATE UNIQUE INDEX billing_subscriptions_one_live ON billing_subscriptions(business_id) WHERE status IN ('PENDING','ACTIVE','PAUSED');
CREATE INDEX billing_invoices_subscription ON billing_invoices(subscription_id);
CREATE INDEX billing_connection_checks_recent ON billing_connection_checks(environment, checked_at DESC);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['billing_subscriptions','billing_invoices'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    -- Owners may read their own oven; only the billing worker writes provider state.
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (business_id = NULLIF(current_setting(''app.business_id'',true),'''')::uuid AND EXISTS (SELECT 1 FROM users u WHERE u.business_id = %I.business_id AND u.identity_id = NULLIF(current_setting(''app.identity_id'',true),'''') AND u.active = true AND u.role = ''Owner''))',t || '_owner_read',t,t);
    EXECUTE format('CREATE POLICY %I ON %I USING (current_setting(''app.billing_worker'',true) = ''true'') WITH CHECK (current_setting(''app.billing_worker'',true) = ''true'')',t || '_worker',t);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (current_setting(''app.platform_read'',true) = ''true'')',t || '_platform_metadata',t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['billing_plan_mappings','billing_connection_checks'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY %I ON %I USING (current_setting(''app.registration_admin'',true) = ''true'' OR current_setting(''app.billing_worker'',true) = ''true'') WITH CHECK (current_setting(''app.registration_admin'',true) = ''true'' OR current_setting(''app.billing_worker'',true) = ''true'')',t || '_internal',t);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (current_setting(''app.platform_read'',true) = ''true'')',t || '_platform_metadata',t);
  END LOOP;
END $$;
-- Consent evidence on a checkout attempt cannot be rewritten after creation.
CREATE FUNCTION protect_billing_consent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.consent_hash IS NOT NULL AND (NEW.consent_hash IS DISTINCT FROM OLD.consent_hash OR NEW.consent_version IS DISTINCT FROM OLD.consent_version OR NEW.consented_at IS DISTINCT FROM OLD.consented_at OR NEW.amount_cents IS DISTINCT FROM OLD.amount_cents OR NEW.plan_id IS DISTINCT FROM OLD.plan_id OR NEW.business_id IS DISTINCT FROM OLD.business_id) THEN
    RAISE EXCEPTION 'Checkout consent, price and oven are immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER billing_attempts_consent_immutable BEFORE UPDATE ON billing_attempts FOR EACH ROW EXECUTE FUNCTION protect_billing_consent();
