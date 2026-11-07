# Shopping price comparison — Deferred (internal)

Shopping comparison is excluded from the public release. The SerpApi adapter and tests are retained for possible later use; no alternative provider was added. No provider purchase, upgrade, activation, paid lookup or retry was performed. If a SerpApi subscription already exists, the owner must cancel it separately in that account. Hiding the app feature does not cancel external billing; active subscription status was not verified.

## Release protection

`netlify/lib/feature-flags.ts` reads **`SHOPPING_SEARCH_ENABLED`** from the server runtime. Only the exact string `true` enables it. Missing, empty and unrecognized values default OFF. Credentials alone never enable the feature.

When OFF, `workspace.mts` rejects any request carrying `priceSearch` or `priceSearchStatus` with 404 `FEATURE_UNAVAILABLE`, before database connection, membership/provisioning, cache, quota or provider work. This applies to GET/POST through `/api/workspace` and the default function invocation. The adapter checks again at `findPrices` and immediately before each provider request/enrichment. Unrelated workspace operations remain available.

No comparison card, compare button, provider setup warning, onboarding prompt, search empty state, test or assistant alternative is mounted. Inactive `store-price-search.tsx` and `price-search-setup.tsx` are retained internally. The manual Vendor quotes section, approved quotes/provenance, preferred vendor, package price, source links, purchase/cost history and verified conversions remain. No historical data is deleted or rewritten.

Product-link import fetches the merchant page directly using the SSRF-protected HTTPS importer and Product/Offer JSON-LD. It uses neither SerpApi nor AI. Recipe text/URL import is likewise independent. No background or render-triggered shopping path remains mounted.

## Preserved implementation and settings

- Provider dependency: **SerpApi Google Shopping**, optionally up to two Google immersive-product lookups for direct merchant links. One explicit future lookup may consume up to **three provider requests**. Direct merchant links and duplicate product tokens skip unnecessary enrichment; first enrichment failure stops further enrichment and there are no retries.
- Server credential name for both status and search: **`SERPAPI_API_KEY`**, read through `Netlify.env.get` in `netlify/lib/price-search.ts`. Never expose its value or create a public-prefixed copy.
- Status route: `GET /api/workspace?priceSearchStatus=1`; explicit test is POST to the same route with an owned ingredient and `confirmAllowance: true`.
- Search/cache: `GET /api/workspace?priceSearch=<ingredient-id>` and POST with `operation: "search"`; saving a reviewed offer is a separate operation.
- All routes live inside the **workspace** Function, not separate deployed functions. Existing approved quote management uses unrelated `ingredientOffer` operations and remains usable.
- Preserved quota: ten workspace searches/hour, fifteen-second gap, failed attempts counted. One-hour workspace cache, forty recent ingredient searches; no keystroke searches.
- Configuration presence is **Configured, not tested**, distinct from **Connection successful** after an explicit successful current-deployment request. Test metadata is deployment-bound. Removing configuration suppresses old test details.
- Preserved outcomes: Missing configuration; Authentication failed; Allowance exhausted; Provider unavailable; No matching products; Search successful. Unexpected HTML, non-JSON, malformed or invalid response shapes produce safe messages.

The earlier published deployment metadata listed the workspace Function, but live GET probes were intercepted by site protection (401 HTML). No current application-level provider status or connectivity was established. This branch's protection requires the normal deployment process; a build alone cannot establish it.

## Future re-enable procedure — requires deliberate release review

1. Approve the feature and provider budget/terms; verify plan accounting and coverage without purchasing in this task.
2. Review the retained adapter, quota/cache isolation, private provenance and offer-review flow. Restore frontend mounts deliberately; setting the backend flag alone does **not** restore customer UI.
3. Configure the server credential in intended contexts, then set `SHOPPING_SEARCH_ENABLED=true` and redeploy only after authorization. Previews should remain OFF unless explicitly approved.
4. Confirm free status shows **Configured, not tested** for the current deployment. A signed-in Owner must explicitly acknowledge allowance use and run one test; never auto-test on deploy, page load or key detection. Avoid repeated requests/retries.
5. Test real auth/quota/provider outage/non-JSON/no-match outcomes, package evidence, retailer URLs, conditional prices, currencies/ZIP coverage, exact barcode evidence, duplicate enrichment tokens and graceful partial enrichment.
6. Test two-tenant cache/results/quote access, stale-result review, rate/concurrency controls and no hidden network calls. Assert searches/tests never change prices, stock or financial records; only separately reviewed quote/reference operations may change the intended fields.
