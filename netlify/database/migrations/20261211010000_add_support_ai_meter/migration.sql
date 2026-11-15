CREATE TABLE "support_ai_meter" (
	"id" uuid PRIMARY KEY,
	"request_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"business_id" uuid,
	"model" text NOT NULL,
	"returned_model" text,
	"status" text DEFAULT 'reserved' NOT NULL,
	"reserved_nano_usd" bigint NOT NULL,
	"cost_nano_usd" bigint,
	"input_tokens" integer,
	"cached_tokens" integer,
	"output_tokens" integer,
	"provider_cost_usd" numeric,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "support_ai_meter" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "support_ai_meter_request" ON "support_ai_meter" ("request_id");--> statement-breakpoint
CREATE INDEX "support_ai_meter_date" ON "support_ai_meter" ("created_at");--> statement-breakpoint
ALTER TABLE support_ai_meter FORCE ROW LEVEL SECURITY;
CREATE POLICY support_ai_meter_read ON support_ai_meter FOR SELECT USING(actor_id=current_setting('app.identity_id',true) OR current_setting('app.support_admin',true)='true' OR current_setting('app.support_ai_counter',true)='true');
CREATE POLICY support_ai_meter_insert ON support_ai_meter FOR INSERT WITH CHECK(actor_id=current_setting('app.identity_id',true));
CREATE POLICY support_ai_meter_update ON support_ai_meter FOR UPDATE USING(actor_id=current_setting('app.identity_id',true)) WITH CHECK(actor_id=current_setting('app.identity_id',true));
-- Existing customers remain on ordinary human support until explicitly included in a private evaluation.
UPDATE support_ai_policy SET data=data || '{"model":"gpt-5.4-mini","evaluationBusinessIds":[],"maxToolCalls":6,"maxProviderCalls":4,"businessDailyUsd":1,"globalDailyUsd":10,"lifetimeUsd":25}'::jsonb WHERE id='platform';
