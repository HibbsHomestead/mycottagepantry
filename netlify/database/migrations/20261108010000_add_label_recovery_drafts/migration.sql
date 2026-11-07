CREATE TABLE "label_recovery_drafts" (
	"id" text NOT NULL,
	"business_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'owner' NOT NULL,
	"updated_by" text DEFAULT 'owner' NOT NULL,
	"identity_id" text NOT NULL,
	"label_id" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "label_recovery_drafts_org_id" ON "label_recovery_drafts" ("business_id","id");--> statement-breakpoint
ALTER TABLE "label_recovery_drafts" ADD CONSTRAINT "label_recovery_drafts_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE;
ALTER TABLE label_recovery_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE label_recovery_drafts FORCE ROW LEVEL SECURITY;
CREATE POLICY label_recovery_drafts_owner ON label_recovery_drafts
USING (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid AND identity_id = NULLIF(current_setting('app.identity_id', true),''))
WITH CHECK (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid AND identity_id = NULLIF(current_setting('app.identity_id', true),''));
