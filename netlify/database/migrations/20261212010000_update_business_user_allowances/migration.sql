-- Forward-only update: no subscriber, billing identity or member rows change.
-- Mirrors launchPricing.plans[].users; regression tests assert every tier.
CREATE OR REPLACE FUNCTION business_plan_user_limit(plan text) RETURNS integer
LANGUAGE sql IMMUTABLE AS $$ SELECT CASE WHEN plan='cottage-mercantile' THEN 6 ELSE 5 END $$;

CREATE OR REPLACE FUNCTION enforce_business_user_limit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE billing workspace_billing%ROWTYPE; grant_row complimentary_grants%ROWTYPE;
  owner_id text; effective_plan text := 'free'; user_limit integer; member_count integer; previous_worker text;
BEGIN
  IF NOT NEW.active THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' THEN
    IF OLD.active AND OLD.business_id=NEW.business_id AND OLD.identity_id=NEW.identity_id THEN RETURN NEW; END IF;
  END IF;
  -- Every writer locks the business row, including businesses with no billing row.
  -- A later invitation workflow must reserve pending seats under this same lock;
  -- invitation creation and acceptance are currently unavailable.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.business_id::text,717));
  PERFORM 1 FROM businesses WHERE id=NEW.business_id FOR UPDATE;
  previous_worker := current_setting('app.billing_worker',true);
  PERFORM set_config('app.billing_worker','true',true);
  SELECT * INTO billing FROM workspace_billing WHERE business_id=NEW.business_id FOR UPDATE;
  SELECT * INTO grant_row FROM complimentary_grants WHERE business_id=NEW.business_id AND grant_source IS NOT NULL ORDER BY created_at DESC,id DESC LIMIT 1;
  SELECT identity_owner INTO owner_id FROM businesses WHERE id=NEW.business_id;
  IF grant_row.operation='grant' AND grant_row.owner_identity=owner_id AND (grant_row.expires_at IS NULL OR grant_row.expires_at>now()) THEN
    effective_plan:=grant_row.plan_id;
  ELSIF billing.source IN ('stripe_test','stripe_live','square_sandbox','square_production') THEN
    IF billing.paid_through>now() AND billing.status IN ('paid_active','cancelled','past_due') THEN effective_plan:=billing.plan_id;
    ELSIF billing.source='square_sandbox' AND billing.status='past_due' AND billing.paid_through + interval '7 days'>now() THEN effective_plan:=billing.plan_id;
    END IF;
  ELSIF billing.status IN ('free_active','complimentary','paid_active') THEN
    effective_plan:=billing.plan_id;
  END IF;
  PERFORM set_config('app.billing_worker',COALESCE(previous_worker,''),true);
  -- The owner already occupies the reserved owner seat, even on an over-limit team.
  IF NEW.identity_id=owner_id THEN RETURN NEW; END IF;
  user_limit:=business_plan_user_limit(effective_plan);
  -- Count distinct logins, including the owner exactly once even if their row
  -- has not yet been provisioned. Exclude this row on identity replacement.
  SELECT count(*) INTO member_count FROM (
    SELECT identity_id FROM users WHERE business_id=NEW.business_id AND active AND (TG_OP='INSERT' OR id<>NEW.id)
    UNION SELECT owner_id WHERE owner_id IS NOT NULL
    UNION SELECT NEW.identity_id
  ) members;
  IF member_count>user_limit THEN
    RAISE EXCEPTION 'This business has reached its allowance of % total users, including the owner. Contact support to review existing memberships. No members were removed.',user_limit;
  END IF;
  RETURN NEW;
END $$;
-- A single guard now resolves both manual overrides and provider billing.
DROP TRIGGER IF EXISTS manual_business_user_limit ON users;
DROP TRIGGER IF EXISTS business_user_limit ON users;
CREATE TRIGGER business_user_limit BEFORE INSERT OR UPDATE OF active,business_id,identity_id ON users
FOR EACH ROW EXECUTE FUNCTION enforce_business_user_limit();
DROP FUNCTION IF EXISTS enforce_manual_business_user_limit();

-- Read today's shared allowance for the scheduled target tier, rather than a
-- historical review snapshot. Previously approved provider schedules stay intact.
CREATE OR REPLACE FUNCTION enforce_pending_subscription_seats() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE allowance integer; member_count integer; previous_worker text; owner_id text;
BEGIN
  IF NOT NEW.active THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' THEN
    IF OLD.active AND OLD.business_id=NEW.business_id AND OLD.identity_id=NEW.identity_id THEN RETURN NEW; END IF;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.business_id::text,717));
  SELECT identity_owner INTO owner_id FROM businesses WHERE id=NEW.business_id FOR UPDATE;
  previous_worker := current_setting('app.billing_worker',true);
  PERFORM set_config('app.billing_worker','true',true);
  SELECT business_plan_user_limit(to_plan) INTO allowance FROM stripe_subscription_changes
    WHERE business_id=NEW.business_id AND kind IN ('downgrade','cancel')
      AND status IN ('applying','pending','scheduled','releasing')
    ORDER BY created_at DESC LIMIT 1;
  PERFORM set_config('app.billing_worker',COALESCE(previous_worker,''),true);
  IF NEW.identity_id=owner_id THEN RETURN NEW; END IF;
  IF allowance IS NOT NULL THEN
    SELECT count(*) INTO member_count FROM (
      SELECT identity_id FROM users WHERE business_id=NEW.business_id AND active AND (TG_OP='INSERT' OR id<>NEW.id)
      UNION SELECT owner_id WHERE owner_id IS NOT NULL
      UNION SELECT NEW.identity_id
    ) members;
    IF member_count>allowance THEN
      RAISE EXCEPTION 'The scheduled plan allows % total users including the owner. Cancel the pending change before adding more members. Existing members were not changed.',allowance;
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS a_pending_subscription_seats ON users;
CREATE TRIGGER a_pending_subscription_seats BEFORE INSERT OR UPDATE OF active,business_id,identity_id ON users
FOR EACH ROW EXECUTE FUNCTION enforce_pending_subscription_seats();
