CREATE TABLE "billing_sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"environment" text NOT NULL,
	"checked" integer NOT NULL,
	"swept" integer NOT NULL,
	"failures" integer NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "square_billing_connections" (
	"environment" text PRIMARY KEY,
	"merchant_id" text NOT NULL,
	"merchant_name" text NOT NULL,
	"token_ciphertext" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"scopes" jsonb NOT NULL,
	"locations" jsonb NOT NULL,
	"location_id" text,
	"status" text DEFAULT 'connected' NOT NULL,
	"connected_by" text NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "square_billing_oauth_states" (
	"state_hash" text PRIMARY KEY,
	"session_hash" text NOT NULL,
	"identity_id" text NOT NULL,
	"environment" text NOT NULL,
	"origin" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"callback_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"code_ciphertext" text,
	"candidate_ciphertext" text
);
--> statement-breakpoint
ALTER TABLE "square_billing_oauth_states" ADD CONSTRAINT "square_billing_oauth_states_PsyfUGe8a1N7_fkey" FOREIGN KEY ("session_hash") REFERENCES "platform_sessions"("token_hash") ON DELETE CASCADE;
-- Credential rows are never exposed through platform metadata SELECT policies.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['square_billing_connections','square_billing_oauth_states','billing_sync_runs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY %I ON %I USING (current_setting(''app.platform_gateway'',true) = ''true'') WITH CHECK (current_setting(''app.platform_gateway'',true) = ''true'')',t || '_gateway',t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['square_billing_connections','billing_sync_runs'] LOOP
    EXECUTE format('CREATE POLICY %I ON %I USING (current_setting(''app.billing_worker'',true) = ''true'') WITH CHECK (current_setting(''app.billing_worker'',true) = ''true'')',t || '_worker',t);
  END LOOP;
END $$;
ALTER TABLE square_billing_connections ADD CONSTRAINT square_connection_environment CHECK(environment IN ('sandbox','production'));
ALTER TABLE square_billing_connections ADD CONSTRAINT square_connection_status CHECK(status IN ('connected','reconnect_required'));
ALTER TABLE square_billing_oauth_states ADD CONSTRAINT square_oauth_environment CHECK(environment IN ('sandbox','production'));
ALTER TABLE billing_sync_runs ADD CONSTRAINT billing_sync_environment CHECK(environment IN ('sandbox','production'));
CREATE INDEX square_oauth_expiry ON square_billing_oauth_states(expires_at);
