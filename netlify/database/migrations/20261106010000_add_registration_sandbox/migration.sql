CREATE TABLE "billing_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"business_id" uuid NOT NULL,
	"identity_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"status" text DEFAULT 'checkout_pending' NOT NULL,
	"idempotency_key" uuid NOT NULL UNIQUE,
	"provider_order_id" text UNIQUE,
	"provider_link_id" text UNIQUE,
	"subscription_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_events" (
	"id" text PRIMARY KEY,
	"merchant_id" text NOT NULL,
	"kind" text NOT NULL,
	"object_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "complimentary_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"business_id" uuid NOT NULL,
	"owner_identity" text NOT NULL,
	"actor_identity" text NOT NULL,
	"reason" text NOT NULL,
	"plan_id" text DEFAULT 'cottage-kitchen' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "registration_acceptances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"identity_id" text NOT NULL,
	"policy_version" text NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"test_only" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "registration_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"actor_identity" text NOT NULL,
	"business_id" uuid,
	"action" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "registration_drafts" (
	"identity_id" text PRIMARY KEY,
	"workspace_id" uuid,
	"plan_id" text DEFAULT 'free' NOT NULL,
	"stage" text DEFAULT 'setup_incomplete' NOT NULL,
	"profile" jsonb DEFAULT '{}' NOT NULL,
	"checklist" jsonb DEFAULT '[]' NOT NULL,
	"marketing_consent" boolean DEFAULT false NOT NULL,
	"test_only" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "registration_limits" (
	"key" text PRIMARY KEY,
	"count" integer DEFAULT 1 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_billing" (
	"business_id" uuid PRIMARY KEY,
	"plan_id" text,
	"source" text DEFAULT 'unassigned' NOT NULL,
	"status" text DEFAULT 'setup_incomplete' NOT NULL,
	"subscription_id" text UNIQUE,
	"paid_from" timestamp with time zone,
	"paid_through" timestamp with time zone,
	"snapshot" jsonb DEFAULT '{}' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "billing_attempts" ADD CONSTRAINT "billing_attempts_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id");--> statement-breakpoint
ALTER TABLE "complimentary_grants" ADD CONSTRAINT "complimentary_grants_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id");--> statement-breakpoint
ALTER TABLE "registration_acceptances" ADD CONSTRAINT "registration_acceptances_EZ5KxMu8rTpX_fkey" FOREIGN KEY ("identity_id") REFERENCES "registration_drafts"("identity_id");--> statement-breakpoint
ALTER TABLE "registration_audit" ADD CONSTRAINT "registration_audit_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id");--> statement-breakpoint
ALTER TABLE "registration_drafts" ADD CONSTRAINT "registration_drafts_workspace_id_businesses_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "businesses"("id");--> statement-breakpoint
ALTER TABLE "workspace_billing" ADD CONSTRAINT "workspace_billing_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id");
-- Registration is development-only until reviewed policies/admission are ready.
ALTER TABLE registration_drafts ADD CONSTRAINT registration_drafts_plan CHECK (plan_id IN ('free','mixing-bowl','bakers-bench','cottage-kitchen'));
ALTER TABLE registration_drafts ADD CONSTRAINT registration_drafts_test_only CHECK (test_only = true);
ALTER TABLE registration_acceptances ADD CONSTRAINT registration_acceptances_fixture CHECK (test_only = true AND policy_version LIKE 'fixture:%');
ALTER TABLE workspace_billing ADD CONSTRAINT workspace_billing_plan CHECK (plan_id IS NULL OR plan_id IN ('free','mixing-bowl','bakers-bench','cottage-kitchen'));
ALTER TABLE workspace_billing ADD CONSTRAINT workspace_billing_source CHECK (source IN ('unassigned','free_sandbox','square_sandbox','complimentary'));
ALTER TABLE workspace_billing ADD CONSTRAINT workspace_billing_period CHECK (paid_from IS NULL OR (paid_through IS NOT NULL AND paid_from < paid_through));
ALTER TABLE billing_attempts ADD CONSTRAINT billing_attempts_plan CHECK (plan_id IN ('mixing-bowl','bakers-bench','cottage-kitchen'));
CREATE UNIQUE INDEX billing_attempts_unresolved ON billing_attempts(business_id) WHERE status IN ('checkout_pending','payment_processing','unknown');
ALTER TABLE complimentary_grants ADD CONSTRAINT complimentary_grants_plan CHECK (plan_id = 'cottage-kitchen');

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['registration_drafts','registration_acceptances'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY %I ON %I USING (identity_id = NULLIF(current_setting(''app.identity_id'',true),'''')) WITH CHECK (identity_id = NULLIF(current_setting(''app.identity_id'',true),''''))',t || '_identity', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['workspace_billing','billing_attempts'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY %I ON %I USING ((business_id = NULLIF(current_setting(''app.business_id'',true),'''')::uuid AND EXISTS (SELECT 1 FROM users u WHERE u.business_id = %I.business_id AND u.identity_id = NULLIF(current_setting(''app.identity_id'',true),'''') AND u.active = true AND u.role = ''Owner'')) OR current_setting(''app.billing_worker'',true) = ''true'') WITH CHECK ((business_id = NULLIF(current_setting(''app.business_id'',true),'''')::uuid AND EXISTS (SELECT 1 FROM users u WHERE u.business_id = %I.business_id AND u.identity_id = NULLIF(current_setting(''app.identity_id'',true),'''') AND u.active = true AND u.role = ''Owner'')) OR current_setting(''app.billing_worker'',true) = ''true'')',t || '_owner',t,t,t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['billing_events','complimentary_grants','registration_audit','registration_limits'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY %I ON %I USING (current_setting(''app.registration_admin'',true) = ''true'' OR current_setting(''app.billing_worker'',true) = ''true'') WITH CHECK (current_setting(''app.registration_admin'',true) = ''true'' OR current_setting(''app.billing_worker'',true) = ''true'')',t || '_internal',t);
  END LOOP;
END $$;
CREATE FUNCTION protect_registration_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Registration consent and administrative history are immutable'; END $$;
CREATE TRIGGER registration_acceptances_immutable BEFORE UPDATE OR DELETE ON registration_acceptances FOR EACH ROW EXECUTE FUNCTION protect_registration_audit();
CREATE TRIGGER complimentary_grants_immutable BEFORE UPDATE OR DELETE ON complimentary_grants FOR EACH ROW EXECUTE FUNCTION protect_registration_audit();
CREATE TRIGGER registration_audit_immutable BEFORE UPDATE OR DELETE ON registration_audit FOR EACH ROW EXECUTE FUNCTION protect_registration_audit();
