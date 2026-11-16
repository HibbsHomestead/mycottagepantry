CREATE TABLE "event_batch_links" (
	"id" text NOT NULL,
	"business_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'owner' NOT NULL,
	"updated_by" text DEFAULT 'owner' NOT NULL,
	"event_id" text NOT NULL,
	"batch_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_expense_links" (
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
CREATE TABLE "event_pickups" (
	"id" text NOT NULL,
	"business_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'owner' NOT NULL,
	"updated_by" text DEFAULT 'owner' NOT NULL,
	"event_id" text NOT NULL,
	"invoice_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_sale_links" (
	"id" text NOT NULL,
	"business_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'owner' NOT NULL,
	"updated_by" text DEFAULT 'owner' NOT NULL,
	"event_id" text NOT NULL,
	"sale_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" text NOT NULL,
	"business_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'owner' NOT NULL,
	"updated_by" text DEFAULT 'owner' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "event_batch_links_org_id" ON "event_batch_links" ("business_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_batch_links_pair" ON "event_batch_links" ("business_id","event_id","batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_expense_links_org_id" ON "event_expense_links" ("business_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_expense_links_pair" ON "event_expense_links" ("business_id","event_id","expense_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_expense_links_exclusive" ON "event_expense_links" ("business_id","expense_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_pickups_org_id" ON "event_pickups" ("business_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_pickups_pair" ON "event_pickups" ("business_id","event_id","invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_pickups_exclusive" ON "event_pickups" ("business_id","invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_sale_links_org_id" ON "event_sale_links" ("business_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_sale_links_pair" ON "event_sale_links" ("business_id","event_id","sale_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_sale_links_exclusive" ON "event_sale_links" ("business_id","sale_id");--> statement-breakpoint
CREATE UNIQUE INDEX "events_org_id" ON "events" ("business_id","id");--> statement-breakpoint
ALTER TABLE "event_batch_links" ADD CONSTRAINT "event_batch_links_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "event_batch_links" ADD CONSTRAINT "event_batch_links_dhYIYyBL8BQo_fkey" FOREIGN KEY ("business_id","event_id") REFERENCES "events"("business_id","id");--> statement-breakpoint
ALTER TABLE "event_batch_links" ADD CONSTRAINT "event_batch_links_S7nNlmbqUtap_fkey" FOREIGN KEY ("business_id","batch_id") REFERENCES "batches"("business_id","id");--> statement-breakpoint
ALTER TABLE "event_expense_links" ADD CONSTRAINT "event_expense_links_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "event_expense_links" ADD CONSTRAINT "event_expense_links_I5L7SFNKwdHI_fkey" FOREIGN KEY ("business_id","event_id") REFERENCES "events"("business_id","id");--> statement-breakpoint
ALTER TABLE "event_expense_links" ADD CONSTRAINT "event_expense_links_agG5gkKn5VcO_fkey" FOREIGN KEY ("business_id","expense_id") REFERENCES "expenses"("business_id","id");--> statement-breakpoint
ALTER TABLE "event_pickups" ADD CONSTRAINT "event_pickups_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "event_pickups" ADD CONSTRAINT "event_pickups_business_id_event_id_events_business_id_id_fkey" FOREIGN KEY ("business_id","event_id") REFERENCES "events"("business_id","id");--> statement-breakpoint
ALTER TABLE "event_pickups" ADD CONSTRAINT "event_pickups_MVgFPE7L1HZp_fkey" FOREIGN KEY ("business_id","invoice_id") REFERENCES "finance_transactions"("business_id","id");--> statement-breakpoint
ALTER TABLE "event_sale_links" ADD CONSTRAINT "event_sale_links_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "event_sale_links" ADD CONSTRAINT "event_sale_links_66aYUZ2LI4On_fkey" FOREIGN KEY ("business_id","event_id") REFERENCES "events"("business_id","id");--> statement-breakpoint
ALTER TABLE "event_sale_links" ADD CONSTRAINT "event_sale_links_business_id_sale_id_sales_business_id_id_fkey" FOREIGN KEY ("business_id","sale_id") REFERENCES "sales"("business_id","id");--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE events FORCE ROW LEVEL SECURITY;
CREATE POLICY events_tenant ON events
USING (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid)
WITH CHECK (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid);

ALTER TABLE event_batch_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_batch_links FORCE ROW LEVEL SECURITY;
CREATE POLICY event_batch_links_tenant ON event_batch_links
USING (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid)
WITH CHECK (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid);

ALTER TABLE event_sale_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_sale_links FORCE ROW LEVEL SECURITY;
CREATE POLICY event_sale_links_tenant ON event_sale_links
USING (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid)
WITH CHECK (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid);

ALTER TABLE event_expense_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_expense_links FORCE ROW LEVEL SECURITY;
CREATE POLICY event_expense_links_tenant ON event_expense_links
USING (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid)
WITH CHECK (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid);

ALTER TABLE event_pickups ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_pickups FORCE ROW LEVEL SECURITY;
CREATE POLICY event_pickups_tenant ON event_pickups
USING (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid)
WITH CHECK (business_id = NULLIF(current_setting('app.business_id', true),'')::uuid);
