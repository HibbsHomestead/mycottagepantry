CREATE TABLE "event_finance_expense_links" (
	"id" text NOT NULL,
	"business_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'owner' NOT NULL,
	"updated_by" text DEFAULT 'owner' NOT NULL,
	"event_id" text NOT NULL,
	"expense_id" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "event_finance_expense_links_org_id" ON "event_finance_expense_links" ("business_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_finance_expense_links_pair" ON "event_finance_expense_links" ("business_id","event_id","expense_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_finance_expense_links_exclusive" ON "event_finance_expense_links" ("business_id","expense_id");--> statement-breakpoint
ALTER TABLE "event_finance_expense_links" ADD CONSTRAINT "event_finance_expense_links_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "event_finance_expense_links" ADD CONSTRAINT "event_finance_expense_links_e9MHUpDi3QaV_fkey" FOREIGN KEY ("business_id","event_id") REFERENCES "events"("business_id","id");--> statement-breakpoint
ALTER TABLE "event_finance_expense_links" ADD CONSTRAINT "event_finance_expense_links_dYCm2FqzzrHg_fkey" FOREIGN KEY ("business_id","expense_id") REFERENCES "finance_transactions"("business_id","id");ALTER TABLE event_finance_expense_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_finance_expense_links FORCE ROW LEVEL SECURITY;
CREATE POLICY event_finance_expense_links_tenant ON event_finance_expense_links
USING (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid)
WITH CHECK (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid);
