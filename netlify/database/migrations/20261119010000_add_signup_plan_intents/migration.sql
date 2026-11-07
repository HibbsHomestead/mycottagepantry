CREATE TABLE "signup_plan_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"plan_id" text NOT NULL,
	"identity_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "signup_plan_intents_identity_updated" ON "signup_plan_intents" ("identity_id","updated_at");
--> statement-breakpoint
ALTER TABLE signup_plan_intents ADD CONSTRAINT signup_plan_intents_plan
  CHECK (plan_id IN ('free','mixing-bowl','bakers-bench','cottage-kitchen','cottage-mercantile'));
ALTER TABLE signup_plan_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE signup_plan_intents FORCE ROW LEVEL SECURITY;
CREATE POLICY signup_plan_intents_access ON signup_plan_intents
  USING (identity_id = NULLIF(current_setting('app.identity_id',true),'') OR current_setting('app.signup_intent_worker',true) = 'true')
  WITH CHECK (identity_id = NULLIF(current_setting('app.identity_id',true),'') OR current_setting('app.signup_intent_worker',true) = 'true');

-- A saved test preference never assigns access; test activation still accepts Free only.
ALTER TABLE registration_drafts DROP CONSTRAINT registration_drafts_plan;
ALTER TABLE registration_drafts ADD CONSTRAINT registration_drafts_plan
  CHECK (plan_id IN ('free','mixing-bowl','bakers-bench','cottage-kitchen','cottage-mercantile'));
