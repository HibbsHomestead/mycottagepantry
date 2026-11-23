# Held seller schema proposal

Migration `20261222010000_add_square_seller_connections` has operator approval **only after successful production preflight**. The final metadata check at 2026-11-23 01:59:27 UTC returned HTTP 401 Access Denied. Its condition has not been met.

The proposed SQL and generated snapshot are deliberately outside `netlify/database/migrations/`. The matching schema fragment is staged here rather than in `db/schema.ts`. This prevents automatic deployment or schema generation from applying an unverified change. No previously applied migration was changed. The Square handler's seller table queries already existed before this proposal; the prepared diagnostic code reports unavailable schema safely.

The proposed migration creates `square_seller_connections` with a business/environment primary key, business foreign key, environment constraint, JSON connection data and forced tenant row-level security. It does not update existing sales, imported records, costs, stock or journal entries. Deleting a business cascades to its new connection row.

Activation requires metadata-only inspection of the intended production database: confirm table/column/constraint/policy state and migration history, and establish whether this migration is needed. If the table exists outside recorded migrations, reconcile first; do not overwrite it or modify an applied migration. Once preflight succeeds, the existing conditional approval permits staging this exact named proposal for the normal deployment workflow. Append the schema fragment to `db/schema.ts`, move the named directory to `netlify/database/migrations/`, and update the isolated fixture to use the ordinary migration chain again. Recheck ordering against actual applied migrations before activating it.

Only the Netlify deployment lifecycle may apply migrations. Do not run the proposed SQL against production directly, create another database/branch, reset a database or bypass preflight. The database fixture test applies this proposed SQL only to its disposable test database; that is not production schema evidence.
