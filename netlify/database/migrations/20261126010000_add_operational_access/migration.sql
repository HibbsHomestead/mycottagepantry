-- Extend the existing immutable grant ledger; billing remains independent.
ALTER TABLE complimentary_grants DROP CONSTRAINT complimentary_grants_plan;
ALTER TABLE complimentary_grants ADD CONSTRAINT complimentary_grants_plan CHECK (plan_id IN ('free','mixing-bowl','bakers-bench','cottage-kitchen','cottage-mercantile'));
ALTER TABLE complimentary_grants ADD COLUMN grant_source text;
ALTER TABLE complimentary_grants ADD COLUMN operation text NOT NULL DEFAULT 'grant';
ALTER TABLE complimentary_grants ADD COLUMN expires_at timestamptz;
ALTER TABLE complimentary_grants ADD CONSTRAINT manual_grant_source CHECK (grant_source IS NULL OR grant_source IN ('owner_internal','test','complimentary','support_override'));
ALTER TABLE complimentary_grants ADD CONSTRAINT manual_grant_operation CHECK (operation IN ('grant','revoke'));
ALTER TABLE complimentary_grants ADD CONSTRAINT manual_grant_expiry CHECK (expires_at IS NULL OR expires_at > created_at);
CREATE INDEX complimentary_grants_current ON complimentary_grants(business_id,created_at DESC,id DESC);
CREATE POLICY complimentary_grants_workspace_read ON complimentary_grants FOR SELECT USING (business_id=NULLIF(current_setting('app.business_id',true),'')::uuid);
CREATE POLICY complimentary_grants_platform_append ON complimentary_grants FOR INSERT WITH CHECK (current_setting('app.platform_gateway',true)='true');

-- Additions/reactivations share a tenant lock across billing and manual policy.
-- Existing active members survive downgrades; the original billing guard remains.
CREATE FUNCTION enforce_manual_business_user_limit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE grant_row complimentary_grants%ROWTYPE; owner_id text; member_count integer; user_limit integer; previous_worker text;
BEGIN
  IF NOT NEW.active THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' THEN
    IF OLD.active AND OLD.business_id=NEW.business_id AND OLD.identity_id=NEW.identity_id THEN RETURN NEW; END IF;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.business_id::text, 717));
  previous_worker := current_setting('app.billing_worker',true);
  PERFORM set_config('app.billing_worker','true',true);
  SELECT * INTO grant_row FROM complimentary_grants WHERE business_id=NEW.business_id AND grant_source IS NOT NULL ORDER BY created_at DESC,id DESC LIMIT 1;
  PERFORM set_config('app.billing_worker',COALESCE(previous_worker,''),true);
  SELECT identity_owner INTO owner_id FROM businesses WHERE id=NEW.business_id;
  IF grant_row.operation IS DISTINCT FROM 'grant' OR grant_row.owner_identity IS DISTINCT FROM owner_id OR (grant_row.expires_at IS NOT NULL AND grant_row.expires_at<=now()) THEN RETURN NEW; END IF;
  user_limit := CASE WHEN grant_row.plan_id='cottage-kitchen' THEN 2 WHEN grant_row.plan_id='cottage-mercantile' THEN NULL ELSE 1 END;
  IF user_limit IS NULL THEN RAISE EXCEPTION 'The team user limit awaits configuration.'; END IF;
  SELECT count(DISTINCT identity_id) INTO member_count FROM users WHERE business_id=NEW.business_id AND active=true AND (TG_OP='INSERT' OR id<>NEW.id);
  IF NOT EXISTS(SELECT 1 FROM users WHERE business_id=NEW.business_id AND active=true AND identity_id=owner_id) THEN member_count:=member_count+1; END IF;
  IF NEW.identity_id<>owner_id AND member_count>=user_limit THEN RAISE EXCEPTION 'This manual tier allows % total business users, including the owner. Existing members were not changed.',user_limit; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER manual_business_user_limit BEFORE INSERT OR UPDATE OF active,business_id,identity_id ON users FOR EACH ROW EXECUTE FUNCTION enforce_manual_business_user_limit();

CREATE OR REPLACE FUNCTION enforce_business_user_limit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE billing workspace_billing%ROWTYPE; effective_plan text; user_limit integer; member_count integer; previous_worker text;
BEGIN
  IF NOT NEW.active THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.active AND OLD.business_id = NEW.business_id THEN RETURN NEW; END IF;
  END IF;
  -- The billing row must be visible even when the caller is a non-owner member.
  -- Restore the worker setting before inspecting memberships or returning.
  previous_worker := current_setting('app.billing_worker',true);
  PERFORM set_config('app.billing_worker','true',true);
  SELECT * INTO billing FROM workspace_billing WHERE business_id=NEW.business_id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM complimentary_grants g WHERE g.id=(SELECT id FROM complimentary_grants WHERE business_id=NEW.business_id AND grant_source IS NOT NULL ORDER BY created_at DESC,id DESC LIMIT 1)
    AND g.operation='grant' AND g.owner_identity=(SELECT identity_owner FROM businesses WHERE id=NEW.business_id) AND (g.expires_at IS NULL OR g.expires_at>now()) AND g.plan_id<>'cottage-mercantile') THEN
    PERFORM set_config('app.billing_worker',COALESCE(previous_worker,''),true);
    RETURN NEW;
  END IF;
  PERFORM set_config('app.billing_worker',COALESCE(previous_worker,''),true);
  IF billing.business_id IS NULL OR billing.entitlement_policy='legacy' OR billing.source='complimentary' THEN RETURN NEW; END IF;
  effective_plan := 'free';
  IF billing.source IN ('square_sandbox','square_production') AND billing.paid_through IS NOT NULL AND (
    (billing.status IN ('paid_active','cancelled') AND billing.paid_through > now()) OR
    (billing.status='past_due' AND billing.environment='sandbox' AND billing.paid_through + interval '7 days' > now())
  ) THEN effective_plan := billing.plan_id; END IF;
  SELECT count(*) INTO member_count FROM users WHERE business_id=NEW.business_id AND active=true;
  user_limit := CASE WHEN effective_plan='cottage-kitchen' THEN 2 WHEN effective_plan='cottage-mercantile' THEN NULL ELSE 1 END;
  IF user_limit IS NULL AND member_count > 0 THEN
    RAISE EXCEPTION 'The Cottage Mercantile team user limit awaits confirmation. New members cannot be added yet.';
  END IF;
  IF user_limit IS NOT NULL AND member_count >= user_limit THEN
    RAISE EXCEPTION 'This plan allows % total business users, including the owner. Existing members were not changed.',user_limit;
  END IF;
  RETURN NEW;
END $$;
