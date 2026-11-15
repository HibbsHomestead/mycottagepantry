ALTER TABLE "support_tickets" ADD COLUMN "priority" text DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "assignee" text;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "reads" jsonb DEFAULT '{}' NOT NULL;
--> statement-breakpoint
ALTER TABLE support_tickets DROP CONSTRAINT support_ticket_status;
ALTER TABLE support_tickets ADD CONSTRAINT support_ticket_status CHECK (status IN ('new','in_progress','waiting_on_customer','resolved','archived'));
ALTER TABLE support_tickets ADD CONSTRAINT support_ticket_priority CHECK (priority IN ('low','normal','high','urgent'));
CREATE INDEX support_ticket_assignment ON support_tickets(assignee,status,updated_at);
