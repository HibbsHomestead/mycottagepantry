Inventory unit conversion investigation — issue remains open

The user reported that Overview and Ingredients failed while the other Inventory tabs worked, with Craft Materials explicitly confirmed loading. The supplied real exception, captured at 2026-11-13T04:31:22.849Z, was `A verified unit conversion from can to each is required.` Its report did not identify which of the two tabs was open; the diagnostic intentionally omits the hash. The actual second-tab exception still requires confirmation.

Production diagnostic publication was independently verified through the live Netlify API and public production assets. The published commit was `307de2238591e2e54f2d88cfbeb287bb54dcad95`, deployment `6af6923a047978609b3a071e`, published at 2026-11-13T04:30:51.349Z. `/app-version.json` returned `51503a42469f7eb2d90d7716295a6bf43a5bbfbf15f95fa7fc59b958ec7a50f8`, exactly matching the user's report. The production `/assets/index-CyEHjLok.js` contained both “Inventory error details” and “Copy error details”.

The public `/assets/oven-pS0egnGJ.js` at line 22, column 47813 mapped the reported error to the card renderer in `PantryInventory`: `convert(1, item.storageUnit || item.unit, item.unit, item.conversions) * (item.currentCost ?? item.cost)`. This was a client rendering failure when converting current unit cost for display. No failing API status was present in the supplied report; no authentication or API failure was established by that report.

The renderer assumed that every preferred shelf unit could convert to the saved inventory unit. `can` is a contextual package unit and deliberately has no universal `each` factor. A missing verified relationship correctly causes `convert` to throw. The rendering assumption, rather than the requirement for verified conversions, was corrected. No evidence established how the affected preference or missing relationship was originally saved, or whether a specific earlier change introduced it.

The source and deployed bundle confirmed these shared paths:

| Inventory tab | Data reaching the renderer | Relevant calculation |
| --- | --- | --- |
| Overview | All ingredient-table records, including ingredients, materials, packaging and supplies | The same `PantryInventory` cards/table quantity, reorder and unit-cost conversions |
| Ingredients | Ingredient-table records excluding material, packaging and supply roles, followed by the ingredient filter | The same `PantryInventory` cards/table conversions |
| Craft Materials | Records marked material | The same renderer, excluding ingredient records |
| Packaging / Supplies | Their respective record subsets | The same renderer, excluding ingredient records |
| Finished Goods / Movements / Counts | Separate view components | Do not enter this item-card conversion path |

Overview therefore includes the same ingredient rendering/calculation path as Ingredients. The summary value itself uses saved quantity multiplied by saved inventory cost; it does not require a shelf-unit conversion. Sorting normalizes compatible quantities separately and already handles unavailable comparison measures. Shared photo and later fabric changes were absent at the original failure time, as established in the earlier investigation; they were neither blamed nor reverted.

The correction selected saved inventory units for an item only when its preferred shelf relationship was missing. Cards and tables then displayed saved quantities, current unit costs and reorder thresholds in those units, alongside the explicit missing-conversion warning. For example, a synthetic saved balance of 7 each at a historical cost of $1.25 and current reference cost of $1.50 displayed 7 each, $1.50 per each and $8.75 inventory value; it did not claim 7 cans. Verified package relationships continued to display converted shelf measures. Invalid units, malformed conversions, conflicting measurements and unrelated errors continued to propagate. Neither failed totals nor unknown quantities were replaced with zero.

Diagnostics remained collapsed, Inventory-only, ephemeral and copied only by user action. No diagnostic production behavior, redaction rule or request-body handling was changed. Explicit regression tests covered the catch boundary on both Overview and Ingredients. Reports continued to omit query/hash values, private item details, credentials, cookies and arbitrary error text. No telemetry upload was introduced.

Four browser checks against the published diagnostic revision, at 390px and 1440px on both affected tabs, reproduced the exact `can` → `each` exception and the same bundle offset using synthetic HTTP responses. They verified that Craft Materials loaded first, both canonical tab hrefs were present, direct reloads reached the fallback, diagnostics started collapsed, and copying returned the expected app version and redacted report without the private-item sentinel. No workspace writes were attempted. The temporary test was removed after verification because it intentionally asserted the old production failure and pinned that revision.

Thirty-three targeted unit/component tests passed, covering nonzero saved quantities and valuation in both cards and tables, verified and unverified package relationships, propagation of other conversion errors, and diagnostic privacy/retry behavior on both affected tabs. TypeScript passed. Changed test files passed lint. The two changed application files retained exactly their existing baseline of 13 lint errors and one warning; comparison against unchanged HEAD found no new diagnostics.

Four local browser regression cases passed at 390px and 1440px with saved cards and table views. Each navigated from Dashboard to Inventory, reloaded it, opened all eight Inventory tabs, directly reloaded both Overview and Ingredients, checked the missing-conversion item's nonzero quantities/costs/value/reorder threshold and each tab's calculated total, opened that existing item's detail dialog, and opened Add Item. The intercepted workspace stayed byte-for-byte unchanged and no writes were attempted. Local development returned the already-known `/app-version.json` 404, without interrupting the tested workflow. No build command was run.

The correction was prepared for the authorized managed deployment workflow. Its publication had not been observed during this run, so the diagnostic deployment above must not be described as containing the correction. No commits or direct production deployment were created by the agent. No database schema, migrations, inventory records, photos, quantities, costs, lots, receipts, count sessions, history, permissions or browser storage were changed.

The canonical production links were verified in the deployed navigation and by direct reload with synthetic responses:

- Overview: https://mycottagepantry.com/oven#Inventory/Overview
- Ingredients: https://mycottagepantry.com/oven#Inventory/Ingredients

The requested reproduction instructions were to reload the app, open Overview and copy its report if it failed, then open Ingredients and copy its report if it also failed. Each report needed its tab label because the privacy-preserving report omitted hashes. The continuation response supplied the same timestamp, version and exception without a tab label or a separate second-tab report; it added no evidence that either affected tab had recovered. Production was rechecked and still served the diagnostic revision above. After managed publication of the correction, both tabs still require signed-in verification with the affected records. Synthetic tests establish only the exercised cases. The issue remains open.
