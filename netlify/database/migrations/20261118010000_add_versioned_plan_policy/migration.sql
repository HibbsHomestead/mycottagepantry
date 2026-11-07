-- Keep every existing account on its recorded access policy. Only new billing
-- records receive the clarified policy; no subscription or member is migrated.
ALTER TABLE "workspace_billing" ADD COLUMN "entitlement_policy" text DEFAULT 'legacy' NOT NULL;
ALTER TABLE "workspace_billing" ALTER COLUMN "entitlement_policy" SET DEFAULT 'kitchen-two-v1';
ALTER TABLE "workspace_billing" ADD CONSTRAINT workspace_billing_entitlement_policy
  CHECK (entitlement_policy IN ('legacy','kitchen-two-v1'));

-- All membership writers, including future invitation acceptance/reactivation,
-- share a database lock. Owners count toward the total. Existing memberships
-- remain usable after a lapse or downgrade; only additions/reactivations check it.
CREATE FUNCTION enforce_business_user_limit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
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
CREATE TRIGGER business_user_limit BEFORE INSERT OR UPDATE OF active,business_id ON users
FOR EACH ROW EXECUTE FUNCTION enforce_business_user_limit();
