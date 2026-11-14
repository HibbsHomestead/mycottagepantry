-- Owner-approved five users plus the owner: six active business users total.
-- Forward-only function updates preserve existing triggers, RLS, grants and history.
DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef('enforce_business_user_limit()'::regprocedure) INTO definition;
 definition := replace(definition, 'WHEN effective_plan=''cottage-mercantile'' THEN NULL', 'WHEN effective_plan=''cottage-mercantile'' THEN 6');
 -- Match the app resolver: past-due Stripe keeps already-paid coverage only.
 -- Square Sandbox retains its existing seven-day grace branch.
 definition := replace(definition, 'billing.status IN (''paid_active'',''cancelled'')', 'billing.status IN (''paid_active'',''cancelled'',''past_due'')');
 EXECUTE definition;
 SELECT pg_get_functiondef('enforce_manual_business_user_limit()'::regprocedure) INTO definition;
 definition := replace(definition, 'WHEN grant_row.plan_id=''cottage-mercantile'' THEN NULL', 'WHEN grant_row.plan_id=''cottage-mercantile'' THEN 6');
 EXECUTE definition;
END $$;
