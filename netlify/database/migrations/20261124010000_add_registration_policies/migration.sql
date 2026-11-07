CREATE TABLE "registration_policies" (
	"id" serial PRIMARY KEY,
	"revision" text NOT NULL UNIQUE,
	"terms" text NOT NULL,
	"privacy" text NOT NULL,
	"published_by" text NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "registration_policies" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE registration_policies FORCE ROW LEVEL SECURITY;
CREATE POLICY registration_policies_public ON registration_policies FOR SELECT USING (true);
CREATE POLICY registration_policies_publish ON registration_policies FOR INSERT
  WITH CHECK (current_setting('app.platform_gateway',true) = 'true');
ALTER TABLE registration_policies ADD CONSTRAINT registration_policies_content CHECK (
  length(btrim(revision)) BETWEEN 1 AND 100 AND
  length(btrim(terms)) BETWEEN 1 AND 100000 AND
  length(btrim(privacy)) BETWEEN 1 AND 100000
);
CREATE FUNCTION protect_registration_policies() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Published registration policies are immutable'; END; $$;
CREATE TRIGGER registration_policies_immutable BEFORE UPDATE OR DELETE ON registration_policies
  FOR EACH ROW EXECUTE FUNCTION protect_registration_policies();
