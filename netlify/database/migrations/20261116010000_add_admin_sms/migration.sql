CREATE TABLE "platform_sms" (
	"identity_id" text PRIMARY KEY,
	"phone_ciphertext" text,
	"phone_masked" text,
	"verified_at" timestamp with time zone,
	"authorized_session" text,
	"authorized_until" timestamp with time zone,
	"pending_ciphertext" text,
	"pending_masked" text,
	"pending_sid" text,
	"pending_sent_at" timestamp with time zone,
	"pending_sends" integer DEFAULT 0 NOT NULL,
	"pending_attempts" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_sessions" ADD COLUMN "mfa_method" text;--> statement-breakpoint
ALTER TABLE "platform_sessions" ADD COLUMN "sms_verification_sid" text;--> statement-breakpoint
ALTER TABLE "platform_sessions" ADD COLUMN "sms_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "platform_sessions" ADD COLUMN "sms_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "platform_sessions" ADD COLUMN "sms_sends" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_sessions" ADD COLUMN "sms_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_sms" ADD CONSTRAINT "platform_sms_identity_id_platform_admins_identity_id_fkey" FOREIGN KEY ("identity_id") REFERENCES "platform_admins"("identity_id");--> statement-breakpoint
ALTER TABLE "platform_sms" ADD CONSTRAINT "platform_sms_neTE7pgCqkld_fkey" FOREIGN KEY ("authorized_session") REFERENCES "platform_sessions"("token_hash") ON DELETE SET NULL;
-- Preserve platform-only access and SMS activation invariants alongside generated schema.
ALTER TABLE platform_sessions DROP CONSTRAINT platform_challenge_purpose;
ALTER TABLE platform_sessions ADD CONSTRAINT platform_challenge_purpose CHECK(challenge_purpose IS NULL OR challenge_purpose IN ('totp-enroll','totp-remove','totp-recovery','sms-enroll','sms-remove'));
ALTER TABLE platform_sessions ADD CONSTRAINT platform_mfa_method CHECK(mfa_method IS NULL OR mfa_method IN ('passkey','totp','recovery','sms'));
ALTER TABLE platform_sessions ADD CONSTRAINT platform_sms_counters CHECK(sms_sends >= 0 AND sms_attempts >= 0);
ALTER TABLE platform_sms ADD CONSTRAINT platform_sms_activation CHECK ((phone_ciphertext IS NULL) = (verified_at IS NULL) AND (phone_ciphertext IS NULL) = (phone_masked IS NULL));
ALTER TABLE platform_sms ADD CONSTRAINT platform_sms_counters CHECK(pending_sends >= 0 AND pending_attempts >= 0);
ALTER TABLE platform_sms ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_sms FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_sms_gateway ON platform_sms USING (current_setting('app.platform_gateway',true)='true') WITH CHECK (current_setting('app.platform_gateway',true)='true');
