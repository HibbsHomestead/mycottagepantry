ALTER TABLE "platform_sessions" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "platform_sessions" ADD COLUMN "verification_method" text;--> statement-breakpoint
ALTER TABLE "platform_sessions" ADD CONSTRAINT "platform_verification_method" CHECK ("verification_method" IS NULL OR "verification_method" IN ('password','totp','recovery','sms'));--> statement-breakpoint
-- Retire prior ceremonies and privileges. Accounts keep password access,
-- authenticator secrets, recovery codes, grants and immutable audit history.
-- Historical public-key records are inert and no longer read by the application.
-- Password reverification is distinct from MFA. No billing data is changed.
DO $$
DECLARE previous_gateway text := current_setting('app.platform_gateway', true);
BEGIN
  PERFORM set_config('app.platform_gateway', 'true', true);
  DELETE FROM platform_sessions WHERE mfa_method='passkey';
  UPDATE platform_sessions SET challenge=NULL,challenge_kind=NULL,challenge_purpose=NULL,challenge_until=NULL;
  PERFORM set_config('app.platform_gateway', COALESCE(previous_gateway, ''), true);
END $$;
