CREATE TABLE "platform_recovery_codes" (
	"identity_id" text,
	"code_hash" text,
	"used_at" timestamp with time zone,
	CONSTRAINT "platform_recovery_codes_pkey" PRIMARY KEY("identity_id","code_hash")
);
--> statement-breakpoint
CREATE TABLE "platform_totp" (
	"identity_id" text PRIMARY KEY,
	"secret_ciphertext" text,
	"last_step" bigint DEFAULT -1 NOT NULL,
	"pending_ciphertext" text,
	"pending_session" text,
	"pending_until" timestamp with time zone,
	"enabled_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "platform_sessions" ADD COLUMN "challenge_purpose" text;--> statement-breakpoint
ALTER TABLE "platform_recovery_codes" ADD CONSTRAINT "platform_recovery_codes_ufv5MIN2LokG_fkey" FOREIGN KEY ("identity_id") REFERENCES "platform_totp"("identity_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "platform_totp" ADD CONSTRAINT "platform_totp_identity_id_platform_admins_identity_id_fkey" FOREIGN KEY ("identity_id") REFERENCES "platform_admins"("identity_id");--> statement-breakpoint
ALTER TABLE "platform_totp" ADD CONSTRAINT "platform_totp_pending_session_platform_sessions_token_hash_fkey" FOREIGN KEY ("pending_session") REFERENCES "platform_sessions"("token_hash") ON DELETE SET NULL;
-- Preserve platform-only access and activation invariants alongside generated schema.
ALTER TABLE platform_sessions ADD CONSTRAINT platform_challenge_purpose CHECK(challenge_purpose IS NULL OR challenge_purpose IN ('totp-enroll','totp-remove','totp-recovery'));
ALTER TABLE platform_totp ADD CONSTRAINT platform_totp_activation CHECK ((secret_ciphertext IS NULL) = (enabled_at IS NULL));
ALTER TABLE platform_totp ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_totp FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_totp_gateway ON platform_totp USING (current_setting('app.platform_gateway',true)='true') WITH CHECK (current_setting('app.platform_gateway',true)='true');
ALTER TABLE platform_recovery_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_recovery_codes FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_recovery_gateway ON platform_recovery_codes USING (current_setting('app.platform_gateway',true)='true') WITH CHECK (current_setting('app.platform_gateway',true)='true');
