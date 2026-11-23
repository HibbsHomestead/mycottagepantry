# Square seller connection readiness

This setup belongs to the Cottage Pantry operator. Customers authorize their own seller account through Square; they never supply application credentials. Seller sales authorization is separate from the retired Square platform subscription billing integration.

## Configuration audit — 2026-11-23 UTC

The initial presence-only audit found these required names missing:

- `SQUARE_PRODUCTION_APPLICATION_ID`
- `SQUARE_PRODUCTION_APPLICATION_SECRET`

The operator subsequently supplied both through secure project setup for Production and Deploy Preview. No missing names remain reported by that setup notification. Their values were not read back, printed, copied into files or changed by this audit. This establishes project configuration, not availability inside the still-published older function or a verified seller connection.

The required scope is **Functions**, with **Production** deploy context for real seller authorization. The runtime rejects production seller authorization from non-production deployments even though project setup also configured these names for Deploy Preview. Sandbox testing continues to use its separate Sandbox names. The optional production API-version override is not required because the server has a default. No customer credential form was added.

The implementation generates this exact callback on the primary production domain:

`https://mycottagepantry.com/api/square-sales?callback=1&environment=production`

The operator explicitly confirmed this exact URL is registered in the Production Square application. Registration is operator-confirmed; seller authorization has not been performed. Initiate connection from the primary domain; aliases generate different origins.

A new deployment is required for these source changes and to activate changed Functions environment configuration. The current Functions handler reads server-side runtime configuration; changing local variables does not update a published function. Use the normal managed deployment approval workflow. The operator approved the proposed migration only after successful production preflight. The final preflight at 2026-11-23 01:59:27 UTC still returned HTTP 401 Access Denied, so the approval condition remains unmet.

## Management request evidence

`GET https://mycottagepantry.com/api/square-sales`, without a user session, returned HTTP **401** and the old generic management/sign-in message. This proved the endpoint was reachable, not that the authenticated screenshot failed authentication. The supplied access trace was found in production `account-access` logs. On published deployment `6b038fbfbc14ac6564d3d522`, it recorded `backend_identity: authenticated`, `membership_lookup: found`, `workspace_resolution: authorized`, and `workspace:ACTIVE_MEMBERSHIP`. Thus the session reached the account verification server and an active membership was verified. Those events do not expose the role and are not a trace of the separate Square request: server-side Owner permission and session verification on that exact Square request remain unverified. Historical Square function logs contained timing entries but no structured error, HTTP response status or exception identifying the cause. The older handler swallowed that exception. The visible sign-in message therefore does not establish authentication failure. Do not request cookies, tokens, or an unredacted HAR to investigate it.

The existing handler verified Identity, opened a database transaction, checked membership, then queried `square_seller_connections` before reporting missing platform configuration. It mapped unrecognized errors to HTTP 400 and a misleading sign-in message. That is a verified error-reporting defect, not proof of the specific underlying production exception.

The source schema and all existing migrations lacked `square_seller_connections`, although the handler and import completion code referenced it. The similarly named `20261120010000_add_square_merchant_oauth` migration creates platform billing tables, not seller connection storage. The staged additive migration proposal is `docs/proposals/square-seller-connection/20261222010000_add_square_seller_connections/migration.sql`. It creates a business/environment primary key, a business foreign key, JSON connection data containing encrypted seller credentials, an environment constraint, and forced tenant row-level security. It neither rewrites financial/import history nor moves stock. A business deletion cascades only its connection row through the new foreign key.

A read-only production metadata inspection (`netlify db status --branch production --json`) returned **401 Access Denied**. Therefore production table presence and applied migration state remain **unconfirmed**. Do not interpret this platform API authorization failure as the customer's Identity failure. No database was provisioned, branched, reset, migrated, or cleaned up. Before activating the migration, obtain metadata-only access and check the table, constraints, policies and migration history. If a seller table already exists outside recorded migrations, stop for reconciliation; do not overwrite it or modify an applied migration. The proposal is locally prepared and unapplied. Its SQL and snapshot are staged outside the automatic migration directory, with the schema fragment also held outside `db/schema.ts`, so managed validation cannot apply this unapproved-for-execution schema change. See the proposal README for activation after successful preflight.

## Prepared behavior

Owner permission is enforced before management actions. Missing platform configuration gets the customer-safe support message before querying seller storage. Session expiry, Owner permission, missing schema, and temporary service errors have distinct sanitized responses. Failures log only a generated support reference, fixed stage/category, session/Owner verification booleans, validated account trace reference and HTTP status, never the request URL, exception, identity, business data or credentials.

The ordinary customer panel has no environment switcher or duplicate management button. Locations follow authorization; sales preview is shown after a connection and saved locations. Date/time controls explicitly use UTC; the server validates calendar dates and converts them to UTC timestamps. Limits appear in expandable help at the preview step. Import review retains explicit approval and duplicate warnings.

## Managed deployment blocker

The subsequent managed Deploy Preview attempt, deployment `6b039ea012c331a81c71056f`, failed during Netlify Database setup. `createSiteDatabaseBranch` returned HTTP **403 Forbidden** with the explicit reason that the project had reached its maximum number of active database branches. The managed workflow requested preview branch `agent-6b03969b0661c01254ea02c0`; creation was denied. This is a verified platform capacity failure before application compilation, not evidence of a TypeScript error or the cause of the customer's earlier Square management failure.

The log loaded the existing migration list through `20261221010000_add_square_sales_imports`. The held seller migration proposal was not in that list. Holding it correctly prevented its automatic application, but could not remove the existing application's requirement for an isolated preview database. No successful seller migration application or new hosted revision was established.

No application-source fix addresses a platform branch-capacity rejection. Disabling Database, sharing Production with the preview, removing existing migrations or creating another database would undermine this application's persistence and isolation requirements. Platform branch capacity must be resolved through the operator's authorized account/support process before a normal managed retry. No branch deletion, reset, provisioning workaround, credential replacement or deploy retry was performed in response to this failure. Production metadata access remains a separate preflight gate for the conditionally approved seller migration.

## Release and Owner verification gates

The live site metadata identified published deployment `6b038fbfbc14ac6564d3d522`, commit `ceb7a7772722e50b211b7106f6356c3bafa49352`, published 2026-11-23 00:59:52 UTC. The live public app-version marker was `c9643c4b90ec53177c8027963b63e152b1bf1b5582a57bb5b186e2d9483e8d4b`; it is an opaque marker, not a commit. These identify the existing deployment only. This change has not been deployed or verified on a hosted revision.

After configuration, approved schema readiness and approved deployment, have the business Owner initiate Connect Square in Settings → Integrations → Square. The Owner signs in and approves on Square's site. Verify the returned merchant and authorized locations, then explicitly save the intended locations for the existing bounded read check (merchant/locations and at most one payment per selected location). Do not retrieve a sales sample, import, backfill, enable recurring sync or change stock as part of authorization verification. No real seller OAuth or production read was performed in this audit.
