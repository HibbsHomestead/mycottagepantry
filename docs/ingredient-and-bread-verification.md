# Ingredient lookup, opening stock, and shared bread bases

Rendered verification used the existing application components in Chromium at **1440 × 1000** and **390 × 1000**, with synthetic records and intercepted API responses. Database checks used the actual workspace handler against disposable PostgreSQL-compatible fixtures. These are local rendered results, not screenshots of changed customer records or evidence of a production deployment.

**Compact lookup panel**

Verified path: **Inventory → Ingredients → View details → Edit Ingredient → Details & Costing**. The existing popup header, tabs, manual fields, and Save/Cancel workflow stayed in place. The normal desktop panel decreased from approximately **504 px to 213 px (58% shorter)**. Identification now starts roughly 291 px higher. On mobile, the Name, Brand, and Category fields are visible below the panel in the same viewport; before, the panel occupied the remaining viewport.

| State | Desktop before | Desktop after | Mobile before | Mobile after |
| --- | --- | --- | --- | --- |
| Normal | [Before](previews/lookup-before-normal-1440.png) | [After](previews/lookup-after-normal-1440.png) | [Before](previews/lookup-before-normal-390.png) | [After](previews/lookup-after-normal-390.png) |
| Failed import, details collapsed | [Before](previews/lookup-before-error-collapsed-1440.png) | [After](previews/lookup-after-error-collapsed-1440.png) | [Before](previews/lookup-before-error-collapsed-390.png) | [After](previews/lookup-after-error-collapsed-390.png) |
| Error details expanded | [Before](previews/lookup-before-error-expanded-1440.png) | [After](previews/lookup-after-error-expanded-1440.png) | [Before](previews/lookup-before-error-expanded-390.png) | [After](previews/lookup-after-error-expanded-390.png) |

The URL/import pair shares one row. Barcode and catalog groups share the next desktop row and stack on mobile. The three secondary disclosures sit tightly underneath. Lookup inputs and buttons measure 36 px high. The panel has no internal scrolling region or fixed empty space; the existing dialog provides scrolling.

A failed action shows one red X, a concise message, and one initially collapsed Error details disclosure. Details display the response's error code, HTTP status and safe references; URL query values are redacted, and raw server messages, headers and traces are excluded. Missing error codes are identified as missing. The unconditional Walmart warning was removed; retailer-specific wording appears only for a returned verification error.

Browser checks preserved the edited ingredient name, URL, barcode, catalog query and pasted notes. They exercised four consecutive failures through the original Import details button, cleared an obsolete validation error on URL edit, cleared an error after success, and switched between barcode/catalog failures without duplicate banners. None of those interactions saved an ingredient or posted stock. Existing extraction, field mapping, photo/catalog alternatives and checkbox review tests passed.

**Opening stock: finding and verified navigation**

Add Ingredient already contained an opening count in **Add Item → Item Type: Ingredient → Purchase & Stock**, conditional on **Add what I already have on hand**. The section was labeled “Opening Count.” Edit Ingredient's **Stock & Other Details** tab previously contained inventory settings but no opening-stock controls. It was absent from that editor, rather than simply hidden in that tab.

The Add section is now labeled **Opening stock**. For existing ingredients, the verified path is **Inventory → Ingredients → View details → Edit Ingredient → Stock & Other Details → Opening stock**. A zero-balance ingredient without history offers **Enter opening stock already owned**. Ingredients with history show their status and **Stock count / adjustment** instead of another opening entry. Dirty ingredient drafts must be saved or canceled before switching to an adjustment.

| Rendered state | Desktop | Mobile |
| --- | --- | --- |
| New ingredient, opening stock enabled | [View](previews/opening-stock-new-1440.png) | [View](previews/opening-stock-new-390.png) |
| Existing ingredient without opening stock | [View](previews/opening-stock-existing-none-1440.png) | [View](previews/opening-stock-existing-none-390.png) |
| Ingredient with recorded opening stock | [View](previews/opening-stock-history-1440.png) | [View](previews/opening-stock-history-390.png) |
| Count/adjustment action opened, set-total selected | [View](previews/opening-stock-adjustment-1440.png) | [View](previews/opening-stock-adjustment-390.png) |

For synthetic applesauce saved in **each**, both Add and Edit saved quantity **3 each**, not 3 grams. The actual API test verified the ingredient balance, canonical unit, matching opening ledger quantity/unit, $6 inventory value and $2 unit cost. A verified kg-to-g conversion was tested separately; no unit conversion was guessed.

Opening stock records an initial balance of stock already owned, once. Its value posts to owner equity. **Set total balance** replaces the current balance with the counted total; **Add / remove** changes the current balance by the entered amount. The rendered adjustment explains this distinction. Cancel, opening the popup, importing product details and unrelated ingredient saves create no inventory transaction. A stable operation ID and transactional checks make identical retries a no-op and reject a second opening, changed retry values, unit mismatches or existing history. The UI blocks repeated submission while saving. Existing balances/history are retained.

**Shared bread base and inclusions**

Inspection found prepared-subrecipe usage, which requires a positive yield in a supported pantry unit. That workflow remains separate. The implementation plan presented before changes added an explicit base-recipe batch link, expanded its saved ingredient quantities for current calculations/production, kept inclusions and the variation's yield separate, and introduced an additive tenant-scoped migration with no recipe backfill. The pending migration creates recipe-base links with tenant foreign keys, positive multiplier constraints and forced row-level policies. Applied migrations were left unchanged. The platform applies the pending migration during deployment.

Verified path: **Recipes → Spinach Parmesan → Edit Recipe → Base recipe: Homestyle White Bread → Base quantity (batches)**. The linked name/multiplier and **Open base recipe** action are visible. Existing lines become labeled **Inclusions**. No baked-bread ingredient or stock movement is created by linking/saving. Source and variation yields remain their saved values; the fixture's source uses “loaves,” without any loaf-to-weight conversion.

| Rendered bread editor | Desktop | Mobile |
| --- | --- | --- |
| Linked base, multiplier and expanded source quantities | [View](previews/bread-base-link-1440.png) | [View](previews/bread-base-link-390.png) |
| Separate spinach/Parmesan inclusions | [View](previews/bread-base-inclusions-1440.png) | [View](previews/bread-base-inclusions-390.png) |

The synthetic source contains flour 1000 g, water 600 mL, yeast 10 g and salt 20 g. Spinach Parmesan contains spinach 80 g and Parmesan 50 g; its own finished yield stays 3 loaves. Costs below include the source's labor/overhead once and the variation's own charges, excluding the source's sellable packaging.

| Base batches | Flour | Spinach inclusion | Parmesan inclusion | Combined ingredients | Total variation batch |
| --- | --- | --- | --- | --- | --- |
| 0.5 | 500 g | 80 g | 50 g | $2.47 | $7.97 |
| 1 | 1000 g | 80 g | 50 g | $3.54 | $12.54 |
| 2 | 2000 g | 80 g | 50 g | $5.68 | $21.68 |

Scaling the whole 1-base-batch variation by 2 produces flour 2000 g, spinach 160 g and Parmesan 100 g, at $25.08 total. Ingredient statements retain flour and Parmesan subingredients, Wheat/Milk allergens and source recipe provenance. Source edits update current calculations without modifying completed production snapshots. Circular base/prepared references are rejected. Shared raw inputs are aggregated once for actual-use overrides and deduction; prepared-stock components retain their established measured-yield requirements.

The actual API production test linked 0.5 base batches, recorded two variation batches with a 1050 g flour actual-use override, and consumed exactly six raw inputs, including spinach 160 g and Parmesan 100 g. It created no prepared bread consumption. The $16.04 completed cost and usage snapshots remained unchanged after editing the source. A second completion was rejected.

No customer bread recipes were automatically linked, merged, deduplicated or assigned fixture quantities. When an inclusion also exists in the base, the editor shows the overlap and requires explicit approval to retain both quantities; it removes nothing.

**Validation results**

All 12 desktop/mobile workflow checks passed. TypeScript passed. The focused regression run finished with **302 passed, 3 skipped and 3 failed** across 23 files. The three failures concern legacy label save/print/PDF fixtures and reproduce unchanged against the original source. The new ingredient/base database suite passed all three actual-handler integration cases; its companion calculation/opening-stock suites passed all 11 cases. ESLint remains non-clean: strict-any and JSX-in-try rules flag existing patterns and flexible types in touched files. No build command or platform migration application was run in this session.
