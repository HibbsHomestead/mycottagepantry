DROP INDEX "users_identity";--> statement-breakpoint
CREATE UNIQUE INDEX "users_identity" ON "users" ("identity_id","business_id");