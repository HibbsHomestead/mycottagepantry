CREATE TABLE "subscription_expense_payments" (
	"id" text NOT NULL,
	"business_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'owner' NOT NULL,
	"updated_by" text DEFAULT 'owner' NOT NULL,
	"environment" text NOT NULL,
	"provider_id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"attempt_id" uuid NOT NULL,
	"transaction_id" text,
	CONSTRAINT "subscription_expense_environment" CHECK ("environment" IN ('test','live'))
);
--> statement-breakpoint
CREATE TABLE "subscription_expense_preferences" (
	"business_id" uuid PRIMARY KEY,
	"enabled" boolean DEFAULT false NOT NULL,
	"category" text DEFAULT 'Software' NOT NULL,
	"account" text DEFAULT '' NOT NULL,
	"enabled_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_expense_org_id" ON "subscription_expense_payments" ("business_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_expense_provider" ON "subscription_expense_payments" ("environment","provider_id");--> statement-breakpoint
ALTER TABLE "subscription_expense_payments" ADD CONSTRAINT "subscription_expense_payments_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "subscription_expense_payments" ADD CONSTRAINT "subscription_expense_payments_dkrV7jqpWLcy_fkey" FOREIGN KEY ("attempt_id") REFERENCES "stripe_checkouts"("id");--> statement-breakpoint
ALTER TABLE "subscription_expense_payments" ADD CONSTRAINT "subscription_expense_payments_zY1xStDgmJUc_fkey" FOREIGN KEY ("business_id","transaction_id") REFERENCES "finance_transactions"("business_id","id");--> statement-breakpoint
ALTER TABLE "subscription_expense_preferences" ADD CONSTRAINT "subscription_expense_preferences_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id");
ALTER TABLE subscription_expense_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_expense_preferences FORCE ROW LEVEL SECURITY;
CREATE POLICY subscription_expense_preferences_tenant ON subscription_expense_preferences
USING (business_id::text=current_setting('app.business_id',true))
WITH CHECK (business_id::text=current_setting('app.business_id',true));
ALTER TABLE subscription_expense_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_expense_payments FORCE ROW LEVEL SECURITY;
CREATE POLICY subscription_expense_payments_tenant ON subscription_expense_payments
USING (business_id::text=current_setting('app.business_id',true))
WITH CHECK (business_id::text=current_setting('app.business_id',true));
-- Webhook workers resolve a trusted charge-to-checkout link before entering a
-- tenant context. Only reads get this worker policy; writes still require tenant RLS.
CREATE POLICY subscription_expense_payment_worker_lookup ON subscription_expense_payments FOR SELECT
USING (current_setting('app.billing_worker',true)='true');
CREATE POLICY subscription_expense_preferences_worker_lookup ON subscription_expense_preferences FOR SELECT
USING (current_setting('app.billing_worker',true)='true');
