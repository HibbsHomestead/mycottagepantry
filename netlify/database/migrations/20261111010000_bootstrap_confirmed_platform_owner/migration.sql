-- The authenticated project owner explicitly confirmed this immutable, verified
-- Identity account. This is a one-time deployment grant, never a signup rule or
-- email allowlist. It creates no customer, billing, or subscription records.
DO $$
BEGIN
  PERFORM set_config('app.platform_gateway', 'true', true);
  PERFORM pg_advisory_xact_lock(719113852);

  -- Preserve all existing administration decisions, including disabled grants.
  -- Replaying this migration cannot reopen enrollment or restore revoked access.
  IF EXISTS (SELECT 1 FROM platform_admins) THEN
    RETURN;
  END IF;

  INSERT INTO platform_admins
    (identity_id, role, enrollment_until, granted_by, reason)
  VALUES
    ('8a87b82e-1393-4c4d-9885-62f946204b6e', 'owner',
     NOW() + INTERVAL '24 hours', '6adffa3c415f25bd3c09076f',
     'Initial owner bootstrap: authenticated project owner explicitly confirmed this provider-verified immutable Identity account.');

  INSERT INTO platform_audit
    (actor_id, action, target, outcome, reason, before, after, request_id)
  VALUES
    ('6adffa3c415f25bd3c09076f', 'owner_bootstrap',
     '8a87b82e-1393-4c4d-9885-62f946204b6e', 'success',
     'Controlled deployment bootstrap following explicit project-owner confirmation',
     '{"platformAccess":false}'::jsonb,
     '{"role":"owner","enrollmentHours":24,"mfaRequired":true}'::jsonb,
     gen_random_uuid());
END $$;
