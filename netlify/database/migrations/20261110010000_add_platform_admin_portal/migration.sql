CREATE TABLE "platform_admins" (
	"identity_id" text PRIMARY KEY,
	"role" text DEFAULT 'admin' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"epoch" integer DEFAULT 1 NOT NULL,
	"enrollment_until" timestamp with time zone,
	"granted_by" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"actor_id" text,
	"action" text NOT NULL,
	"target" text,
	"outcome" text NOT NULL,
	"reason" text,
	"before" jsonb,
	"after" jsonb,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_credentials" (
	"id" text PRIMARY KEY,
	"identity_id" text NOT NULL,
	"public_key" text NOT NULL,
	"counter" integer DEFAULT 0 NOT NULL,
	"transports" jsonb DEFAULT '[]' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_limits" (
	"key" text PRIMARY KEY,
	"count" integer DEFAULT 1 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_sessions" (
	"token_hash" text PRIMARY KEY,
	"identity_id" text NOT NULL,
	"epoch" integer NOT NULL,
	"mfa_at" timestamp with time zone,
	"origin" text NOT NULL,
	"challenge" text,
	"challenge_kind" text,
	"challenge_until" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_credentials" ADD CONSTRAINT "platform_credentials_dLw4YKvtP2h3_fkey" FOREIGN KEY ("identity_id") REFERENCES "platform_admins"("identity_id");--> statement-breakpoint
ALTER TABLE "platform_sessions" ADD CONSTRAINT "platform_sessions_identity_id_platform_admins_identity_id_fkey" FOREIGN KEY ("identity_id") REFERENCES "platform_admins"("identity_id");

-- Platform metadata access is SELECT-only. No recipe, financial document, file,
-- label document, or stock-writing policy is granted to the administration API.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['users','workspace_billing','billing_events','complimentary_grants','registration_drafts','integrations','receipt_extractions','label_recovery_drafts','support_outbox','support_tickets'] LOOP
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (current_setting(''app.platform_read'',true) = ''true'')',t || '_platform_metadata',t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['platform_admins','platform_credentials','platform_sessions','platform_limits','platform_audit'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY %I ON %I USING (current_setting(''app.platform_gateway'',true) = ''true'') WITH CHECK (current_setting(''app.platform_gateway'',true) = ''true'')',t || '_gateway',t);
  END LOOP;
END $$;
ALTER TABLE platform_admins ADD CONSTRAINT platform_admin_role CHECK(role IN ('owner','admin'));
ALTER TABLE platform_admins ADD CONSTRAINT platform_admin_epoch CHECK(epoch > 0);
ALTER TABLE platform_credentials ADD CONSTRAINT platform_credential_counter CHECK(counter >= 0);
ALTER TABLE platform_sessions ADD CONSTRAINT platform_challenge_kind CHECK(challenge_kind IS NULL OR challenge_kind IN ('registration','authentication'));
CREATE INDEX platform_audit_recent ON platform_audit(created_at DESC,id);
CREATE INDEX platform_audit_target ON platform_audit(target,created_at DESC);
CREATE INDEX platform_sessions_expiry ON platform_sessions(expires_at);
CREATE FUNCTION protect_platform_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Platform audit history is immutable'; END $$;
CREATE TRIGGER platform_audit_immutable BEFORE UPDATE OR DELETE ON platform_audit FOR EACH ROW EXECUTE FUNCTION protect_platform_audit();
CREATE FUNCTION protect_last_platform_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(719113852);
  IF OLD.role='owner' AND OLD.enabled AND (TG_OP='DELETE' OR NOT NEW.enabled OR NEW.role<>'owner')
    AND NOT EXISTS(SELECT 1 FROM platform_admins WHERE identity_id<>OLD.identity_id AND role='owner' AND enabled=true)
  THEN RAISE EXCEPTION 'The last enabled platform owner cannot be removed'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF NEW.enabled IS DISTINCT FROM OLD.enabled OR NEW.role IS DISTINCT FROM OLD.role THEN
    NEW.epoch := OLD.epoch+1;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER platform_owner_safety BEFORE UPDATE OR DELETE ON platform_admins FOR EACH ROW EXECUTE FUNCTION protect_last_platform_owner();
