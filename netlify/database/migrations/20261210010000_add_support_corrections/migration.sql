CREATE TABLE "support_corrections" (
	"id" uuid PRIMARY KEY,
	"conversation_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"business_id" uuid NOT NULL,
	"target_id" text NOT NULL,
	"before" jsonb NOT NULL,
	"after" jsonb NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "support_corrections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "support_corrections" ADD CONSTRAINT "support_corrections_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id");--> statement-breakpoint
ALTER TABLE support_corrections FORCE ROW LEVEL SECURITY;
CREATE POLICY support_correction_scope ON support_corrections FOR ALL
USING (actor_id=current_setting('app.identity_id',true) AND EXISTS(SELECT 1 FROM users u WHERE u.identity_id=current_setting('app.identity_id',true) AND u.business_id=support_corrections.business_id AND u.active=true AND u.role='Owner'))
WITH CHECK (actor_id=current_setting('app.identity_id',true) AND EXISTS(SELECT 1 FROM users u WHERE u.identity_id=current_setting('app.identity_id',true) AND u.business_id=support_corrections.business_id AND u.active=true AND u.role='Owner'));
ALTER TABLE support_corrections ADD CONSTRAINT support_correction_status CHECK(status IN ('proposed','verified','stale','expired'));
