-- Only the bounded expiry routine may remove immutable SANDBOX history.
-- Production history triggers retain their original functions and conditions.
CREATE FUNCTION preview_demo_cleanup_active(org uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(current_setting('app.demo_cleanup_business',true),'') = org::text
    AND pg_trigger_depth() > 0
$$;
--> statement-breakpoint
DO $$
DECLARE t record; definition text;
BEGIN
  FOR t IN
    SELECT tr.oid, tr.tgname, c.relname
    FROM pg_trigger tr JOIN pg_class c ON c.oid=tr.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND NOT tr.tgisinternal AND (tr.tgtype & 8) = 8
      AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='business_id')
  LOOP
    definition := pg_get_triggerdef(t.oid);
    IF definition LIKE '% WHEN (%' THEN
      RAISE EXCEPTION 'Review existing trigger condition before adding sandbox cleanup: %',t.tgname;
    END IF;
    EXECUTE format('DROP TRIGGER %I ON %I',t.tgname,t.relname);
    definition := replace(definition,' EXECUTE FUNCTION ',
      ' WHEN (NOT public.preview_demo_cleanup_active(old.business_id)) EXECUTE FUNCTION ');
    EXECUTE definition;
  END LOOP;
END $$;
--> statement-breakpoint
CREATE FUNCTION purge_expired_preview_demos() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE b record; removed integer := 0;
BEGIN
  -- Immutable history is bypassed only during FK cascades from a business that
  -- was locked and verified anonymous, sample-only, and expired for 24 hours.
  FOR b IN SELECT id FROM businesses
    WHERE identity_owner IS NULL AND session_hash ~ '^[a-f0-9]{64}$'
      AND business_name='Cottage Pantry Demo Bakery'
      AND expires_at < NOW()-INTERVAL '1 day'
    ORDER BY expires_at LIMIT 20 FOR UPDATE SKIP LOCKED
  LOOP
    PERFORM set_config('app.business_id',b.id::text,true);
    PERFORM set_config('app.demo_cleanup_business',b.id::text,true);
    DELETE FROM businesses WHERE id=b.id;
    removed := removed+1;
    PERFORM set_config('app.demo_cleanup_business','',true);
  END LOOP;
  RETURN removed;
END $$;
