-- Continue the explicitly approved one-time recovery without changing the
-- historical migration or its immutable audit decision. Use the SAME request
-- marker: a prior successful recovery or not-required decision is a no-op.
--
-- The historical migration contains COMMIT and may leave the runner idle before
-- its bookkeeping completes. BEGIN keeps an existing transaction intact or
-- starts one after that historical COMMIT. Only the runner commits this
-- continuation. Never add a COMMIT here or extend a prior recovery decision.
BEGIN;
DO $$
DECLARE
  target_id constant text := 'd62a6cbd-124a-4766-9e82-22cb062ea09a';
  operator_id constant text := '6adffa3c415f25bd3c09076f';
  recovery_id constant uuid := 'e421f553-907a-40a8-b9a0-9019346149da';
  previous_grant platform_admins%ROWTYPE;
  new_deadline timestamptz;
  invalidated_sessions integer;
BEGIN
  PERFORM set_config('app.platform_gateway', 'true', true);
  PERFORM pg_advisory_xact_lock(719113852);
  SELECT * INTO previous_grant FROM platform_admins
    WHERE identity_id = target_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Enrollment recovery refused: expected administrator grant is missing';
  END IF;

  -- The immutable audit marker makes the deployment decision one-time, including
  -- a no-recovery decision for an open original window. Never reopen on replay.
  IF EXISTS (SELECT 1 FROM platform_audit
    WHERE request_id = recovery_id AND action = 'mfa_enrollment_recovery'
      AND target = target_id AND outcome IN ('success','not_required')) THEN
    RETURN;
  END IF;

  -- Fail closed on any unverified or changed grant/enrollment state. Recheck
  -- these conditions in the production transaction; never infer them from preview.
  IF NOT previous_grant.enabled OR previous_grant.role <> 'admin'
    OR previous_grant.granted_by <> operator_id THEN
    RAISE EXCEPTION 'Enrollment recovery refused: administrator grant changed or was revoked';
  END IF;
  IF previous_grant.enrollment_until IS NULL
    OR previous_grant.enrollment_until <> previous_grant.created_at + INTERVAL '24 hours' THEN
    RAISE EXCEPTION 'Enrollment recovery refused: expected original window is absent';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM platform_audit
    WHERE action = 'admin_granted' AND target = target_id
      AND actor_id = operator_id AND outcome = 'success') THEN
    RAISE EXCEPTION 'Enrollment recovery refused: original grant audit is missing';
  END IF;
  IF EXISTS (SELECT 1 FROM platform_credentials WHERE identity_id = target_id)
    OR EXISTS (SELECT 1 FROM platform_audit
      WHERE action = 'mfa_enrolled' AND outcome = 'success'
        AND (target = target_id OR actor_id = target_id))
    OR EXISTS (SELECT 1 FROM platform_sessions
      WHERE identity_id = target_id AND mfa_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Enrollment recovery refused: existing or prior MFA access requires separate recovery';
  END IF;

  -- Fresh preview branches can retain an unexpired original grant. Refuse to
  -- extend it, but let deployment proceed after every other safety check above.
  -- A changed/null window, revoked grant, credential or prior MFA still fails.
  IF previous_grant.enrollment_until > NOW() THEN
    INSERT INTO platform_audit
      (actor_id,action,target,outcome,reason,before,after,request_id)
    VALUES
      (operator_id,'mfa_enrollment_recovery',target_id,'not_required',
       'Original first-passkey enrollment window remains open; no recovery, deadline extension, credential replacement or access change was performed.',
       jsonb_build_object('role',previous_grant.role,'enabled',previous_grant.enabled,
         'epoch',previous_grant.epoch,'enrollmentUntil',previous_grant.enrollment_until,
         'credentialCount',0),
       jsonb_build_object('role',previous_grant.role,'enabled',previous_grant.enabled,
         'epoch',previous_grant.epoch,'enrollmentUntil',previous_grant.enrollment_until,
         'credentialCount',0,'mfaRequired',true,'recoveryApplied',false,
         'invalidatedPendingSessions',0),
       recovery_id);
    RETURN;
  END IF;

  -- Role, enabled state, credential records and every other account are preserved.
  -- Epoch rotation invalidates old sessions, including any concurrent pending
  -- ceremony. Registration and login use the same locked administrator row.
  new_deadline := NOW() + INTERVAL '24 hours';
  UPDATE platform_admins SET enrollment_until = new_deadline,
    epoch = previous_grant.epoch + 1 WHERE identity_id = target_id;
  DELETE FROM platform_sessions WHERE identity_id = target_id AND mfa_at IS NULL;
  GET DIAGNOSTICS invalidated_sessions = ROW_COUNT;

  -- Approval is recorded in the recovery reason and fixed request marker.
  -- Failure to append the audit rolls back the entire transaction.
  INSERT INTO platform_audit
    (actor_id,action,target,outcome,reason,before,after,request_id)
  VALUES
    (operator_id,'mfa_enrollment_recovery',target_id,'success',
     'Project-owner-approved one-time first-passkey recovery for the confirmed account after the original enrollment window closed; no credential replacement or permission change.',
     jsonb_build_object('role',previous_grant.role,'enabled',previous_grant.enabled,
       'epoch',previous_grant.epoch,'enrollmentUntil',previous_grant.enrollment_until,
       'credentialCount',0),
     jsonb_build_object('role',previous_grant.role,'enabled',previous_grant.enabled,
       'epoch',previous_grant.epoch+1,'enrollmentUntil',new_deadline,
       'credentialCount',0,'enrollmentHours',24,'mfaRequired',true,
       'invalidatedPendingSessions',invalidated_sessions),
     recovery_id);
END $$;
