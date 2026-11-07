CREATE TABLE "support_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"message_id" uuid NOT NULL,
	"object_key" text NOT NULL,
	"byte_size" integer NOT NULL,
	"submission_key" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"actor_id" text NOT NULL,
	"ticket_id" uuid,
	"action" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_delivery_events" (
	"id" text PRIMARY KEY,
	"notification_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"ticket_id" uuid NOT NULL,
	"author_id" text NOT NULL,
	"kind" text NOT NULL,
	"body" text NOT NULL,
	"submission_key" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"ticket_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"target_identity" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"retry_at" timestamp with time zone DEFAULT now() NOT NULL,
	"provider_message_id" text,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_settings" (
	"id" text PRIMARY KEY,
	"recipient" text,
	"pending_recipient" text,
	"recipient_verified_at" timestamp with time zone,
	"from_address" text,
	"reply_to" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"number" serial UNIQUE,
	"requester_id" text NOT NULL,
	"requester_email" text NOT NULL,
	"workspace_id" uuid,
	"subject" text NOT NULL,
	"category" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"submission_key" uuid NOT NULL,
	"diagnostics" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "support_attachment_submission" ON "support_attachments" ("message_id","submission_key");--> statement-breakpoint
CREATE UNIQUE INDEX "support_message_submission" ON "support_messages" ("ticket_id","author_id","submission_key");--> statement-breakpoint
CREATE UNIQUE INDEX "support_outbox_event" ON "support_outbox" ("message_id","kind");--> statement-breakpoint
CREATE INDEX "support_outbox_ready" ON "support_outbox" ("status","retry_at");--> statement-breakpoint
CREATE UNIQUE INDEX "support_ticket_submission" ON "support_tickets" ("requester_id","submission_key");--> statement-breakpoint
CREATE INDEX "support_ticket_inbox" ON "support_tickets" ("updated_at");--> statement-breakpoint
CREATE INDEX "support_ticket_requester" ON "support_tickets" ("requester_id");--> statement-breakpoint
ALTER TABLE "support_attachments" ADD CONSTRAINT "support_attachments_message_id_support_messages_id_fkey" FOREIGN KEY ("message_id") REFERENCES "support_messages"("id");--> statement-breakpoint
ALTER TABLE "support_audit" ADD CONSTRAINT "support_audit_ticket_id_support_tickets_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("id");--> statement-breakpoint
ALTER TABLE "support_delivery_events" ADD CONSTRAINT "support_delivery_events_notification_id_support_outbox_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "support_outbox"("id");--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_ticket_id_support_tickets_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("id");--> statement-breakpoint
ALTER TABLE "support_outbox" ADD CONSTRAINT "support_outbox_ticket_id_support_tickets_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("id");--> statement-breakpoint
ALTER TABLE "support_outbox" ADD CONSTRAINT "support_outbox_message_id_support_messages_id_fkey" FOREIGN KEY ("message_id") REFERENCES "support_messages"("id");--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_workspace_id_businesses_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "businesses"("id") ON DELETE SET NULL;
-- Support records are separate from business ownership. Membership is not ticket access.
ALTER TABLE support_tickets ADD CONSTRAINT support_ticket_status CHECK (status IN ('new','in_progress','waiting_on_customer','resolved'));
ALTER TABLE support_tickets ADD CONSTRAINT support_ticket_category CHECK (category IN ('Question','Bug','Account & billing','Feature request'));
ALTER TABLE support_tickets ADD CONSTRAINT support_ticket_subject CHECK (length(subject) BETWEEN 1 AND 160);
ALTER TABLE support_messages ADD CONSTRAINT support_message_kind CHECK (kind IN ('customer','support','internal'));
ALTER TABLE support_messages ADD CONSTRAINT support_message_body CHECK (length(body) BETWEEN 1 AND 6000);
ALTER TABLE support_attachments ADD CONSTRAINT support_attachment_size CHECK (byte_size BETWEEN 1 AND 4194304);
ALTER TABLE support_outbox ADD CONSTRAINT support_outbox_attempts CHECK (attempts BETWEEN 0 AND 3);
ALTER TABLE support_outbox ADD CONSTRAINT support_outbox_kind CHECK (kind IN ('new_ticket','acknowledgment','reply','customer_reply'));
ALTER TABLE support_outbox ADD CONSTRAINT support_outbox_status CHECK (status IN ('pending','sending','blocked_setup','accepted','delivered','failed','unknown','bounced','suppressed','cancelled'));
INSERT INTO support_settings(id) VALUES('platform');

ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_tickets FORCE ROW LEVEL SECURITY;
CREATE POLICY support_ticket_read ON support_tickets FOR SELECT USING (
 requester_id = current_setting('app.identity_id',true) OR current_setting('app.support_staff',true) = 'true' OR current_setting('app.support_worker',true) = 'true');
CREATE POLICY support_ticket_create ON support_tickets FOR INSERT WITH CHECK (requester_id = current_setting('app.identity_id',true));
CREATE POLICY support_ticket_update ON support_tickets FOR UPDATE USING (requester_id = current_setting('app.identity_id',true) OR current_setting('app.support_staff',true) = 'true') WITH CHECK (requester_id = current_setting('app.identity_id',true) OR current_setting('app.support_staff',true) = 'true');

ALTER TABLE support_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_messages FORCE ROW LEVEL SECURITY;
CREATE POLICY support_message_read ON support_messages FOR SELECT USING (
 (kind <> 'internal' OR current_setting('app.support_staff',true) = 'true') AND EXISTS (SELECT 1 FROM support_tickets t WHERE t.id=ticket_id));
CREATE POLICY support_message_create ON support_messages FOR INSERT WITH CHECK (
 author_id=current_setting('app.identity_id',true) AND EXISTS (SELECT 1 FROM support_tickets t WHERE t.id=ticket_id)
 AND (current_setting('app.support_staff',true)='true' OR (kind='customer' AND EXISTS (SELECT 1 FROM support_tickets t WHERE t.id=ticket_id AND t.requester_id=current_setting('app.identity_id',true)))));

ALTER TABLE support_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_attachments FORCE ROW LEVEL SECURITY;
CREATE POLICY support_attachment_read ON support_attachments FOR SELECT USING (EXISTS (SELECT 1 FROM support_messages m WHERE m.id=message_id));
CREATE POLICY support_attachment_create ON support_attachments FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM support_messages m WHERE m.id=message_id AND m.author_id=current_setting('app.identity_id',true)));

ALTER TABLE support_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY support_settings_access ON support_settings USING (current_setting('app.support_admin',true)='true' OR current_setting('app.support_worker',true)='true') WITH CHECK (current_setting('app.support_admin',true)='true');
ALTER TABLE support_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_outbox FORCE ROW LEVEL SECURITY;
CREATE POLICY support_outbox_manage ON support_outbox USING (current_setting('app.support_staff',true)='true' OR current_setting('app.support_worker',true)='true') WITH CHECK (current_setting('app.support_staff',true)='true' OR current_setting('app.support_worker',true)='true');
CREATE POLICY support_outbox_enqueue ON support_outbox FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM support_messages m WHERE m.id=message_id AND m.ticket_id=support_outbox.ticket_id AND m.author_id=current_setting('app.identity_id',true) AND m.kind='customer'));
ALTER TABLE support_delivery_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_delivery_events FORCE ROW LEVEL SECURITY;
CREATE POLICY support_delivery_worker ON support_delivery_events USING (current_setting('app.support_worker',true)='true') WITH CHECK (current_setting('app.support_worker',true)='true');
ALTER TABLE support_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_audit FORCE ROW LEVEL SECURITY;
CREATE POLICY support_audit_read ON support_audit FOR SELECT USING (current_setting('app.support_staff',true)='true' OR current_setting('app.support_worker',true)='true');
CREATE POLICY support_audit_insert ON support_audit FOR INSERT WITH CHECK (actor_id=current_setting('app.identity_id',true) OR current_setting('app.support_worker',true)='true');

-- No private note can become an email event, even through an accidental future enqueue.
CREATE FUNCTION support_public_notification_only() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE message_kind text; requester text;
BEGIN
 SELECT m.kind,t.requester_id INTO message_kind,requester
 FROM support_messages m JOIN support_tickets t ON t.id=m.ticket_id
 WHERE m.id=NEW.message_id AND t.id=NEW.ticket_id;
 IF message_kind IS NULL OR message_kind='internal' THEN RAISE EXCEPTION 'Only public support messages can notify'; END IF;
 IF NEW.kind IN ('acknowledgment','reply') THEN
  IF NEW.target_identity IS DISTINCT FROM requester OR (NEW.kind='reply' AND message_kind<>'support') THEN RAISE EXCEPTION 'Invalid support notification recipient'; END IF;
 ELSE
  IF NEW.target_identity IS NOT NULL OR message_kind<>'customer' THEN RAISE EXCEPTION 'Invalid support notification audience'; END IF;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER support_notification_privacy BEFORE INSERT OR UPDATE OF message_id,ticket_id,kind,target_identity ON support_outbox FOR EACH ROW EXECUTE FUNCTION support_public_notification_only();
