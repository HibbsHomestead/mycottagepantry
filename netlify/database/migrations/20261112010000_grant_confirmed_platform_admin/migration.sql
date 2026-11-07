-- The project owner requested administrator access for an existing account.
-- Netlify Identity lookup verified the exact email and confirmed immutable ID.
-- This is a one-time grant, not an email allowlist or signup rule.
DO $$
BEGIN
  PERFORM set_config('app.platform_gateway', 'true', true);
  PERFORM pg_advisory_xact_lock(719113852);

  -- Preserve existing grants, revocations, credentials, and enrollment deadlines.
  -- Replaying this migration cannot restore access or reopen MFA enrollment.
  IF EXISTS (
    SELECT 1 FROM platform_admins
    WHERE identity_id = 'd62a6cbd-124a-4766-9e82-22cb062ea09a'
  ) THEN
    RETURN;
  END IF;

  INSERT INTO platform_admins
    (identity_id, role, enrollment_until, granted_by, reason)
  VALUES
    ('d62a6cbd-124a-4766-9e82-22cb062ea09a', 'admin',
     NOW() + INTERVAL '24 hours', '6adffa3c415f25bd3c09076f',
     'Project owner requested administrator access for this provider-confirmed Identity account.');

  INSERT INTO platform_audit
    (actor_id, action, target, outcome, reason, before, after, request_id)
  VALUES
    ('6adffa3c415f25bd3c09076f', 'admin_granted',
     'd62a6cbd-124a-4766-9e82-22cb062ea09a', 'success',
     'Explicit project-owner request; exact account verified with Netlify Identity',
     '{"platformAccess":false}'::jsonb,
     '{"role":"admin","enabled":true,"enrollmentHours":24,"mfaRequired":true}'::jsonb,
     gen_random_uuid());
END $$;
