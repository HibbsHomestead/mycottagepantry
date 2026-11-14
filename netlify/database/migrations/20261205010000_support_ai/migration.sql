CREATE TABLE "support_ai_conversations" (
	"id" uuid PRIMARY KEY,
	"requester_id" text NOT NULL,
	"business_id" uuid,
	"messages" jsonb DEFAULT '[]' NOT NULL,
	"diagnostics" jsonb,
	"ticket_id" uuid,
	"pending_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "support_ai_conversations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "support_ai_policy" (
	"id" text PRIMARY KEY DEFAULT 'platform',
	"data" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "support_ai_policy" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "support_ai_usage" (
	"id" uuid PRIMARY KEY,
	"requester_id" text NOT NULL,
	"business_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "support_ai_usage_status_check" CHECK ("status" IN ('pending','success','failed')),
	CONSTRAINT "support_ai_usage_input_tokens_check" CHECK ("input_tokens">=0),
	CONSTRAINT "support_ai_usage_output_tokens_check" CHECK ("output_tokens">=0)
);
--> statement-breakpoint
ALTER TABLE "support_ai_usage" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "support_ai_owner" ON "support_ai_conversations" ("requester_id","business_id","updated_at");--> statement-breakpoint
CREATE INDEX "support_ai_expiry" ON "support_ai_conversations" ("expires_at");--> statement-breakpoint
CREATE INDEX "support_ai_usage_day" ON "support_ai_usage" ("created_at","requester_id","business_id");--> statement-breakpoint
ALTER TABLE "support_ai_conversations" ADD CONSTRAINT "support_ai_conversations_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "support_ai_conversations" ADD CONSTRAINT "support_ai_conversations_ticket_id_support_tickets_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "support_ai_usage" ADD CONSTRAINT "support_ai_usage_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE SET NULL;
--> statement-breakpoint
-- Default usage policy and server-authoritative support isolation.
INSERT INTO support_ai_policy VALUES('platform','{"enabled":true,"userDaily":20,"businessDaily":60,"globalDaily":400,"cooldownSeconds":10,"retentionDays":30}');
--> statement-breakpoint
ALTER TABLE support_ai_policy FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY support_ai_policy_read ON support_ai_policy FOR SELECT USING (current_setting('app.identity_id',true)<>'' OR current_setting('app.support_worker',true)='true');
--> statement-breakpoint
CREATE POLICY support_ai_policy_update ON support_ai_policy FOR UPDATE USING (current_setting('app.support_admin',true)='true') WITH CHECK (current_setting('app.support_admin',true)='true');
--> statement-breakpoint
ALTER TABLE support_ai_conversations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY support_ai_read ON support_ai_conversations FOR SELECT USING (requester_id=current_setting('app.identity_id',true) OR (ticket_id IS NOT NULL AND current_setting('app.support_staff',true)='true') OR current_setting('app.support_worker',true)='true');
--> statement-breakpoint
CREATE POLICY support_ai_insert ON support_ai_conversations FOR INSERT WITH CHECK (requester_id=current_setting('app.identity_id',true) AND (business_id IS NULL OR EXISTS(SELECT 1 FROM users u WHERE u.business_id=support_ai_conversations.business_id AND u.identity_id=current_setting('app.identity_id',true) AND u.active=true)));
--> statement-breakpoint
CREATE POLICY support_ai_update ON support_ai_conversations FOR UPDATE USING (requester_id=current_setting('app.identity_id',true)) WITH CHECK (requester_id=current_setting('app.identity_id',true));
--> statement-breakpoint
CREATE POLICY support_ai_delete ON support_ai_conversations FOR DELETE USING (requester_id=current_setting('app.identity_id',true) OR current_setting('app.support_worker',true)='true');
--> statement-breakpoint
ALTER TABLE support_ai_usage FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY support_ai_usage_read ON support_ai_usage FOR SELECT USING (requester_id=current_setting('app.identity_id',true) OR current_setting('app.support_staff',true)='true' OR current_setting('app.support_ai_counter',true)='true' OR current_setting('app.support_worker',true)='true');
--> statement-breakpoint
CREATE POLICY support_ai_usage_insert ON support_ai_usage FOR INSERT WITH CHECK (requester_id=current_setting('app.identity_id',true));
--> statement-breakpoint
CREATE POLICY support_ai_usage_update ON support_ai_usage FOR UPDATE USING (requester_id=current_setting('app.identity_id',true)) WITH CHECK (requester_id=current_setting('app.identity_id',true));
--> statement-breakpoint
CREATE POLICY support_ai_usage_delete ON support_ai_usage FOR DELETE USING (current_setting('app.support_worker',true)='true');
