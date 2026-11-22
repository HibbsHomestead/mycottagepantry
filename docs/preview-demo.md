# Preview demo workspace

The login screen and the signed-in-session error screen offer **Try demo** when the server enables the feature. The public username and password are both `demo`. This is a separate sandbox entry route; it does not create an Identity account or relax the Identity password policy.

## Deployment setup

`COTTAGE_DEMO_ENABLED` was configured for deploy-preview, branch-deploy, and dev during setup. It must be available to Functions in those contexts. Leave it unset in production. The server additionally checks Netlify's deployment context and refuses demo entry in production even when the flag is present. The preview needs its normal Netlify Database binding and the new cleanup migration. No additional credentials are required.

Continue editing the same working branch. Subsequent preview deployments update that branch's review environment; no extra development branches are needed. Backend changes require a preview deployment, but do not require publishing the production site. Review there, then publish through the existing production workflow when satisfied.

## Authentication diagnosis

The client could restore a cached Identity user while the server had no verifiable `nf_jwt` session. The login UI then hid the login form behind its session-verification error. The old workspace endpoint rejected unverified users, and no functional demo-entry route existed. This code path explains the dead end; the original failing browser request and provider logs were unavailable, so the precise reason its Identity cookie was missing or invalid was not established.

Demo entry bypasses that UI dead end without bypassing real-account verification. A cryptographically random, HttpOnly, host-only session cookie resolves only an anonymous server-owned sample tenant. A present but invalid or expired demo cookie cannot fall through to a real Identity account. Leaving demo clears only the demo cookie.

HTTPS demo cookies use Secure, SameSite=None and Partitioned for compatible embedded browsers. Cookies remain browser-session cookies; database access expires after seven days at most. Browser partitioning may give the embedded frame and a new tab separate demo sessions. If cookies are blocked, the UI offers **Open preview in new tab** rather than repeating login. The agent runtime tested here served the functions but lacked a database binding, so complete workflows there returned an explicit database-unavailable message. Use a database-enabled Netlify Deploy Preview for those workflows.

## Data and safety

Each independent browser session receives a separate Cottage Pantry Demo Bakery. All workspace operations use the normal server validation, tenant settings, row-level policies, and business logic. Data persists across navigation and refresh while that session remains valid. Browser storage does not hold business data.

The connected sample includes ingredients and packaging, purchase-unit conversions and minimums, low/zero stock, recipes and a batch variation, food/handmade/resale/kit products, categories, packaging assignments, editable front/back and preserved labels, purchase and sales history, scheduled production, expenses, and opening ledger balances. Costs use the existing calculation engine. Historical examples are not replayed into stock.

**Reset demo data** requires confirmation and replaces only the current resolved demo tenant. Its retired data becomes inaccessible immediately. Expired anonymous sample tenants are removed in bounded batches after a 24-hour grace period, during new demo provisioning and by a scheduled cleanup. Immutable production history remains protected. Preview schedules may not execute; provisioning also performs cleanup.

External imports, AI generation, barcode/catalog services, paid/private retrieval, receipt/photo processing, uploads, payment/billing, account connections, support submission, and integration configuration are blocked in demo. None are simulated. Manual entry, local costing, inventory, production, labels, printing, and baking conversions remain available. Existing real-account sessions and credentials are unchanged.

## Verification and limits

The targeted Vitest suites passed 54 tests using real API handlers and a disposable PostgreSQL-compatible database with all migrations. They covered stale Identity isolation, independent tenants, forced RLS with a non-superuser role, forged record IDs, persisted edits, actual batch completion, label geometry saving, private conversion factors, reset, expiry, immutable history, and blocked external services.

Three Playwright browser tests passed for the actual login/app components: public credential entry and reset, stale-session Try demo, and embedded-cookie failure with the new-tab fallback. These browser tests used controlled API responses and do not establish hosted integration success.

Local real-function checks returned enabled status and an inactive session successfully; demo provisioning returned 503 because the runtime lacked a database binding. Hosted top-level/embedded cookie behavior and end-to-end live database provisioning still need verification after preview configuration/deployment. Typechecking reported three existing `descriptionBusinessIds` type errors in the support administration component, unrelated to demo files. No build command was run.
