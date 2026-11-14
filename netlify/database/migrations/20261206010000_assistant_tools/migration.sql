CREATE TABLE "support_ai_actions" (
	"id" uuid PRIMARY KEY,
	"conversation_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"tool" text NOT NULL,
	"business_id" uuid,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "support_ai_actions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "support_ai_conversations" ADD COLUMN "audience" text DEFAULT 'customer' NOT NULL;--> statement-breakpoint
ALTER TABLE "support_ai_conversations" ADD COLUMN "context_ticket_id" uuid;--> statement-breakpoint
ALTER TABLE "support_ai_actions" ADD CONSTRAINT "support_ai_actions_aAPq8W9Qg7zW_fkey" FOREIGN KEY ("conversation_id") REFERENCES "support_ai_conversations"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "support_ai_actions" ADD CONSTRAINT "support_ai_actions_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "support_ai_conversations" ADD CONSTRAINT "support_ai_conversations_CvnCIDWCBEb8_fkey" FOREIGN KEY ("context_ticket_id") REFERENCES "support_tickets"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE support_ai_conversations ADD CONSTRAINT support_ai_audience CHECK (audience IN ('customer','admin'));
--> statement-breakpoint
ALTER TABLE support_ai_conversations ADD CONSTRAINT support_ai_private_admin CHECK (audience='customer' OR (ticket_id IS NULL AND business_id IS NULL));
--> statement-breakpoint
DROP POLICY support_ai_read ON support_ai_conversations;
--> statement-breakpoint
CREATE POLICY support_ai_read ON support_ai_conversations FOR SELECT USING (
  (audience='customer' AND (requester_id=current_setting('app.identity_id',true) OR (ticket_id IS NOT NULL AND current_setting('app.support_staff',true)='true')))
  OR (audience='admin' AND requester_id=current_setting('app.identity_id',true) AND current_setting('app.support_admin',true)='true')
  OR current_setting('app.support_worker',true)='true');
--> statement-breakpoint
DROP POLICY support_ai_insert ON support_ai_conversations;
--> statement-breakpoint
CREATE POLICY support_ai_insert ON support_ai_conversations FOR INSERT WITH CHECK (
  requester_id=current_setting('app.identity_id',true) AND (
    (audience='customer' AND context_ticket_id IS NULL AND (business_id IS NULL OR EXISTS(SELECT 1 FROM users u WHERE u.business_id=support_ai_conversations.business_id AND u.identity_id=current_setting('app.identity_id',true) AND u.active=true)))
    OR (audience='admin' AND current_setting('app.support_admin',true)='true' AND ticket_id IS NULL AND business_id IS NULL)));
--> statement-breakpoint
DROP POLICY support_ai_update ON support_ai_conversations;
--> statement-breakpoint
CREATE POLICY support_ai_update ON support_ai_conversations FOR UPDATE USING (requester_id=current_setting('app.identity_id',true) AND (audience='customer' OR current_setting('app.support_admin',true)='true')) WITH CHECK (requester_id=current_setting('app.identity_id',true) AND (audience='customer' OR current_setting('app.support_admin',true)='true'));
--> statement-breakpoint
DROP POLICY support_ai_delete ON support_ai_conversations;
--> statement-breakpoint
CREATE POLICY support_ai_delete ON support_ai_conversations FOR DELETE USING ((requester_id=current_setting('app.identity_id',true) AND (audience='customer' OR current_setting('app.support_admin',true)='true')) OR current_setting('app.support_worker',true)='true');
--> statement-breakpoint
ALTER TABLE support_ai_actions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY support_ai_action_read ON support_ai_actions FOR SELECT USING (
  actor_id=current_setting('app.identity_id',true) AND EXISTS(SELECT 1 FROM support_ai_conversations c WHERE c.id=conversation_id AND c.requester_id=current_setting('app.identity_id',true)));
--> statement-breakpoint
CREATE POLICY support_ai_action_insert ON support_ai_actions FOR INSERT WITH CHECK (
  actor_id=current_setting('app.identity_id',true) AND EXISTS(SELECT 1 FROM support_ai_conversations c WHERE c.id=conversation_id AND c.requester_id=current_setting('app.identity_id',true)));
--> statement-breakpoint
CREATE POLICY support_ai_action_update ON support_ai_actions FOR UPDATE USING (
  actor_id=current_setting('app.identity_id',true) AND current_setting('app.support_admin',true)='true') WITH CHECK (actor_id=current_setting('app.identity_id',true) AND current_setting('app.support_admin',true)='true');
