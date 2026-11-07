CREATE TABLE "consignment_items" (
	"id" text NOT NULL,
	"business_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'owner' NOT NULL,
	"updated_by" text DEFAULT 'owner' NOT NULL,
	"consignor_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consignment_movements" (
	"id" text NOT NULL,
	"business_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'owner' NOT NULL,
	"updated_by" text DEFAULT 'owner' NOT NULL,
	"consignor_id" text NOT NULL,
	"item_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consignment_payouts" (
	"id" text NOT NULL,
	"business_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'owner' NOT NULL,
	"updated_by" text DEFAULT 'owner' NOT NULL,
	"consignor_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consignment_sales" (
	"id" text NOT NULL,
	"business_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'owner' NOT NULL,
	"updated_by" text DEFAULT 'owner' NOT NULL,
	"consignor_id" text NOT NULL,
	"item_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consignors" (
	"id" text NOT NULL,
	"business_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'owner' NOT NULL,
	"updated_by" text DEFAULT 'owner' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finance_reviews" (
	"id" text NOT NULL,
	"business_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'owner' NOT NULL,
	"updated_by" text DEFAULT 'owner' NOT NULL,
	"transaction_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finance_transactions" (
	"id" text NOT NULL,
	"business_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'owner' NOT NULL,
	"updated_by" text DEFAULT 'owner' NOT NULL,
	"receipt_id" text,
	"bill_id" text
);
--> statement-breakpoint
CREATE TABLE "receipt_extractions" (
	"id" text NOT NULL,
	"business_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'owner' NOT NULL,
	"updated_by" text DEFAULT 'owner' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendor_matches" (
	"id" text NOT NULL,
	"business_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'owner' NOT NULL,
	"updated_by" text DEFAULT 'owner' NOT NULL,
	"item_id" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "consignment_items_org_id" ON "consignment_items" ("business_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "consignment_items_owner" ON "consignment_items" ("business_id","id","consignor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "consignment_movements_org_id" ON "consignment_movements" ("business_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "consignment_payouts_org_id" ON "consignment_payouts" ("business_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "consignment_sales_org_id" ON "consignment_sales" ("business_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "consignors_org_id" ON "consignors" ("business_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_reviews_org_id" ON "finance_reviews" ("business_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_transactions_org_id" ON "finance_transactions" ("business_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "receipt_extractions_org_id" ON "receipt_extractions" ("business_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_matches_org_id" ON "vendor_matches" ("business_id","id");--> statement-breakpoint
ALTER TABLE "consignment_items" ADD CONSTRAINT "consignment_items_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "consignment_items" ADD CONSTRAINT "consignment_items_HWvn7hluSb1d_fkey" FOREIGN KEY ("business_id","consignor_id") REFERENCES "consignors"("business_id","id");--> statement-breakpoint
ALTER TABLE "consignment_movements" ADD CONSTRAINT "consignment_movements_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "consignment_movements" ADD CONSTRAINT "consignment_movements_0Z0OqLhie935_fkey" FOREIGN KEY ("business_id","item_id","consignor_id") REFERENCES "consignment_items"("business_id","id","consignor_id");--> statement-breakpoint
ALTER TABLE "consignment_payouts" ADD CONSTRAINT "consignment_payouts_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "consignment_payouts" ADD CONSTRAINT "consignment_payouts_2rHHG6qOC8m2_fkey" FOREIGN KEY ("business_id","consignor_id") REFERENCES "consignors"("business_id","id");--> statement-breakpoint
ALTER TABLE "consignment_sales" ADD CONSTRAINT "consignment_sales_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "consignment_sales" ADD CONSTRAINT "consignment_sales_wXZebYPTyktH_fkey" FOREIGN KEY ("business_id","item_id","consignor_id") REFERENCES "consignment_items"("business_id","id","consignor_id");--> statement-breakpoint
ALTER TABLE "consignors" ADD CONSTRAINT "consignors_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "finance_reviews" ADD CONSTRAINT "finance_reviews_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "finance_reviews" ADD CONSTRAINT "finance_reviews_WNLeCEeKqwhC_fkey" FOREIGN KEY ("business_id","transaction_id") REFERENCES "finance_transactions"("business_id","id");--> statement-breakpoint
ALTER TABLE "finance_transactions" ADD CONSTRAINT "finance_transactions_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "finance_transactions" ADD CONSTRAINT "finance_transactions_BKKkUZk2RpAV_fkey" FOREIGN KEY ("business_id","receipt_id") REFERENCES "receipt_extractions"("business_id","id");--> statement-breakpoint
ALTER TABLE "finance_transactions" ADD CONSTRAINT "finance_transactions_3N1LkzkIanqB_fkey" FOREIGN KEY ("business_id","bill_id") REFERENCES "finance_transactions"("business_id","id");--> statement-breakpoint
ALTER TABLE "receipt_extractions" ADD CONSTRAINT "receipt_extractions_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "vendor_matches" ADD CONSTRAINT "vendor_matches_business_id_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "vendor_matches" ADD CONSTRAINT "vendor_matches_3nGgTRWfjeWD_fkey" FOREIGN KEY ("business_id","item_id") REFERENCES "ingredients"("business_id","id");