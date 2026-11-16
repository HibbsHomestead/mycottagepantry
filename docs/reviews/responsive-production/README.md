# Responsive lists and multi-product production verification

All screenshots used the real React application with synthetic browser API fixtures. Database acceptance tests exercised the workspace handler, tenant policies, migrations, stock ledger and transactions in local PGlite. Browser fixture saves were intercepted; they did not exercise live persistence or move live stock.

## Available-width grids

The outer workspace cap and fixed card-column overrides were removed. Inventory, Products, Recipes, Handmade and supplier cards use a shared automatic grid with a 320px starting minimum and a 416px card maximum. Empty grid tracks keep sparse results on the left. Forms, tables, dashboard-specific grids and dialogs retain their own layouts. Loaded-image proportions/loading logic remain intact; missing-image placeholders remain distinct.

Default browser scale was 100%. With both desktop navigation columns present:

| Viewport | Inventory grid width | Inventory | Products | Recipes | Handmade |
| --- | --- | --- | --- | --- | --- |
| 1366px | 796px | 2 | 2 | 2 | 2 |
| 1440px | 870px | 2 | 2 | 2 | 2 |
| 1920px | 1350px | 3 | 3 | 3 | 3 |
| 2560px | 1990px | 5 | 5 | 5 | 5 |
| 390px | 358px | 1 | 1 | 1 | 1 |

Every measured page stayed within the viewport. Long names and large numeric values remained accessible through wrapping; typography was not reduced. Inventory resizing retained its search and matching item count and made no additional workspace requests. One- and two-item ultrawide screenshots verified sparse cards stayed at normal widths and aligned left. Card/Table controls, filtering, sorting and pagination implementations were retained.

There is no desktop sidebar-collapse toggle in the existing application. The following tests simulated narrower main navigation and an absent internal menu by changing those container widths in the browser, without changing application data or adding a new navigation control:

| Viewport | Main sidebar collapsed | Internal menu absent | Both |
| --- | --- | --- | --- |
| 1366px | 2 | 2 | 3 |
| 1440px | 3 | 3 | 3 |
| 1920px | 4 | 4 | 5 |
| 2560px | 6 | 6 | 6 |

200% equivalent reflow was tested at CSS widths 683, 720, 960 and 1280px (half the requested desktop viewport widths), plus mobile at 390px. Inventory rendered 1, 1, 2 and 2 columns at those effective widths. Products, Recipes and Handmade also passed the same reflow widths. Native browser zoom controls were not exercised, so these are reflow checks rather than a claim of native 200% zoom testing. Mobile production controls were scrolled into view and checked for horizontal clipping; dialogs kept one vertical scrolling surface.

[1366px Inventory](inventory-1366.png) · [1440px](inventory-1440.png) · [1920px](inventory-1920.png) · [2560px](inventory-2560.png) · [390px](inventory-390.png)

[One item](one-item-2560.png) · [Two items](two-items-2560.png) · [Products desktop](products-1440.png) / [mobile](products-390.png) · [Recipes desktop](recipes-1440.png) / [mobile](recipes-390.png) · [Handmade desktop](handmade-1440.png) / [mobile](handmade-390.png)

Raw measurements: [Inventory and navigation cases](grid-measurements.json), [other lists and reflow](other-list-measurements.json).

## Production behavior and evidence

A run has one header and independently identified product lines. Draft and In progress runs retain editable plans, actual output, rejected output, material usage, labor minutes and notes. Save draft, Save changes and Start run do not move stock. Owners and Managers manage run structure; Production Staff can record supported actuals and finalize without gaining permission to alter products, quantities or header information. Actuals survive saving, closing and reopening. Changing a product or removing a line with actuals asks before discarding those entries.

Finalization reviews every output and the aggregate materials, shortages and costs. The existing workspace transaction and business lock enclose every line's established posting engine and the header transition. Movement/usage records identify both run and product line. Revision checks reject stale edits; finalization retries use the saved revision and return the existing result. Finalization records the operator, time, locked per-line costs and audit events. A new database trigger also prevents edits/deletion of finalized or cancelled multi-product headers.

Material, packaging, labor and overhead use the existing scaled recipe/BOM costing policies once per product line. There are no added run-level labor/overhead charges. When labor is shared, users enter each product's allocated portion of actual minutes; the full run time must not be repeated on every line. Estimates remain distinct from locked actual costs. Product histories and cost-variance reports account for the lines belonging to each product instead of assuming a single product.

[Multi-product draft](multi-product-draft.png) · [Combined materials](combined-materials.png) · [Finalization review](finalization-review.png) · [Finalized read-only run](finalized-run.png) · [Mobile draft](draft-mobile.png)

Verified cases included single-product food production, multiple products, food/BOM combinations, shared stock and aggregate shortages, kg-to-g conversion, recipe package mapping, configured allocations, saving and reopening, adding/removing lines, stale revisions, staff restrictions, cancellation, duplicate finalization, a late line failure with complete rollback followed by safe retry, finalized locking, cross-business references and handmade-only whole-run reversal/retry. Browser tests covered Dashboard, quick-add, Production, Product details and kit assembly entry points. A component regression check verified changing an already-saved line clears its old definition and actuals after confirmation.

## Existing records and limits

Existing product-based single-product records are adapted to one stable line on read. Their original IDs, snapshots, dates, status and inventory references are not rewritten; saving an unfinished record upgrades its representation. Finalized legacy runs keep their original read-only view and supported reversal. Duplicating a finalized run creates a fresh draft with planned lines and no actuals or movements. Recipe-only legacy batches without a product stay in their original workflow and require explicit product mapping when replaced; no product is guessed. Tests verified repeatable adaptation and unchanged historical records. No live record audit was performed, so no claim is made about the number of businesses requiring that mapping.

The existing production workflow has no reservations or in-progress stock postings. This change preserves that behavior. Kits consume already-existing finished stock; output from another line is not implicitly allocated as a same-run kit component. Existing prepared-component/base-recipe rules remain in use. No new lot/expiry allocation, assigned-user workflow or run-level cost pool was introduced. Zero-good-output finalization retains the existing minimum-one-good-unit restriction. Handmade-only runs reuse the existing guarded reversal; food and mixed runs have no automatic reversal or new correction wizard and remain locked.

Plan definitions and subscriptions were unchanged. Every referenced line is checked against current business ownership and applicable production entitlements. No new paid tier, billing change, authentication change or checkout change was introduced. Live Identity, live migration application, live persistence, true simultaneous network requests, native browser zoom and LIVE checkout were not exercised. Builds and migration application were left to the platform.

## Validation results

The final focused suite passed 81 unit/component/database checks across 11 files. Eight browser checks passed across the responsive-layout and updated production-entry suites. TypeScript, focused ESLint and whitespace checks passed.

The broader workspace suite had four failures: three label-save/print/PDF expectations returned 400, and a receipt journal expectation asserted Owner draws while the handler returned Inventory asset. The identical four failures reproduced using the unchanged baseline workspace and production handlers (77 passed / 4 failed). Those unrelated workflows were not changed to accommodate stale expectations. Temporary baseline verification files were removed.
