# Purchasing visual standard review

The current Purchasing page supplied the existing purple theme, system typography, neutral surfaces, panel radius, buttons and navigation states. Purchasing was excluded from the new shared spacing rules. Its before/after pixels were identical at all four sizes.

These are actual browser renders of the authenticated React workspace with deterministic demo fixtures and intercepted API requests, not live customer records. Each pair uses the same viewport and data. Screenshots show the viewport, not a scaled full-page image.

## Before and after

Each cell links to the original PNG pair. Purchasing is the unchanged reference.

| Page | Laptop 1366×768 | Desktop 1440×1000 | Ultrawide 2560×1000 | Mobile 390×844 |
|---|---|---|---|---|
| Inventory | [Before](before/inventory-1366.png) · [After](after/inventory-1366.png) | [Before](before/inventory-1440.png) · [After](after/inventory-1440.png) | [Before](before/inventory-2560.png) · [After](after/inventory-2560.png) | [Before](before/inventory-390.png) · [After](after/inventory-390.png) |
| Recipes | [Before](before/recipes-1366.png) · [After](after/recipes-1366.png) | [Before](before/recipes-1440.png) · [After](after/recipes-1440.png) | [Before](before/recipes-2560.png) · [After](after/recipes-2560.png) | [Before](before/recipes-390.png) · [After](after/recipes-390.png) |
| Production | [Before](before/production-1366.png) · [After](after/production-1366.png) | [Before](before/production-1440.png) · [After](after/production-1440.png) | [Before](before/production-2560.png) · [After](after/production-2560.png) | [Before](before/production-390.png) · [After](after/production-390.png) |
| Finance | [Before](before/finance-1366.png) · [After](after/finance-1366.png) | [Before](before/finance-1440.png) · [After](after/finance-1440.png) | [Before](before/finance-2560.png) · [After](after/finance-2560.png) | [Before](before/finance-390.png) · [After](after/finance-390.png) |
| Dashboard | [Before](before/dashboard-1366.png) · [After](after/dashboard-1366.png) | [Before](before/dashboard-1440.png) · [After](after/dashboard-1440.png) | [Before](before/dashboard-2560.png) · [After](after/dashboard-2560.png) | [Before](before/dashboard-390.png) · [After](after/dashboard-390.png) |
| Settings | [Before](before/settings-1366.png) · [After](after/settings-1366.png) | [Before](before/settings-1440.png) · [After](after/settings-1440.png) | [Before](before/settings-2560.png) · [After](after/settings-2560.png) | [Before](before/settings-390.png) · [After](after/settings-390.png) |
| Purchasing | [Before](before/purchasing-1366.png) · [After](after/purchasing-1366.png) | [Before](before/purchasing-1440.png) · [After](after/purchasing-1440.png) | [Before](before/purchasing-2560.png) · [After](after/purchasing-2560.png) | [Before](before/purchasing-390.png) · [After](after/purchasing-390.png) |
| Products | [Before](before/products-1366.png) · [After](after/products-1366.png) | [Before](before/products-1440.png) · [After](after/products-1440.png) | [Before](before/products-2560.png) · [After](after/products-2560.png) | [Before](before/products-390.png) · [After](after/products-390.png) |
| Handmade | [Before](before/handmade-1366.png) · [After](after/handmade-1366.png) | [Before](before/handmade-1440.png) · [After](after/handmade-1440.png) | [Before](before/handmade-2560.png) · [After](after/handmade-2560.png) | [Before](before/handmade-390.png) · [After](after/handmade-390.png) |
| Sales | [Before](before/sales-1366.png) · [After](after/sales-1366.png) | [Before](before/sales-1440.png) · [After](after/sales-1440.png) | [Before](before/sales-2560.png) · [After](after/sales-2560.png) | [Before](before/sales-390.png) · [After](after/sales-390.png) |
| Labels | [Before](before/labels-1366.png) · [After](after/labels-1366.png) | [Before](before/labels-1440.png) · [After](after/labels-1440.png) | [Before](before/labels-2560.png) · [After](after/labels-2560.png) | [Before](before/labels-390.png) · [After](after/labels-390.png) |

## Measured list positions

Positions are CSS pixels from the viewport top at scroll zero. Counts include only complete data cards/rows within the viewport; mobile excludes the bottom 80px occupied by navigation. Partial cards are not counted. Cards can span multiple lines and are not equivalent to compact table rows. The stored measurement JSON files contain all sampled pages, header positions, left edges and overflow checks.

| Viewport | List | First item Y, before → after | Fully visible items, before → after |
|---|---|---|---|
| 1366px | Inventory | 776 → 647 | 0 → 0 |
| 1366px | Recipes | 465 → 404 | 0 → 0 |
| 1366px | Products | 652 → 587 | 0 → 0 |
| 1366px | Sales | 422 → 362 | 4 → 5 |
| 1440px | Inventory | 751 → 622 | 0 → 0 |
| 1440px | Recipes | 465 → 404 | 3 → 3 |
| 1440px | Products | 652 → 587 | 0 → 0 |
| 1440px | Sales | 422 → 362 | 5 → 5 |
| 2560px | Inventory | 695 → 622 | 0 → 0 |
| 2560px | Recipes | 465 → 404 | 3 → 3 |
| 2560px | Products | 652 → 587 | 0 → 0 |
| 2560px | Sales | 422 → 362 | 5 → 5 |
| 390px | Inventory | 1529 → 1319 | 0 → 0 |
| 390px | Recipes | 797 → 632 | 0 → 0 |
| 390px | Products | 1100 → 877 | 0 → 0 |
| 390px | Sales | 526 → 475 | 0 → 1 |

Production's laptop screenshots show its first batch row moving from approximately 409px to 334px, with two complete batch rows visible in both. This was checked from the rendered screenshots; the automated selector did not include `.batch-row`. Finance's fixture register was empty, Handmade had no products, and Labels had no saved labels, so these views do not demonstrate a populated-list row-count improvement. Dashboard and Settings are not list pages.

## Changes and checks

All 11 sampled destinations used shared compact page spacing and existing Purchasing tokens. Repeated application eyebrows were removed outside Purchasing, the Dashboard quick-action block was shortened, Finance's duplicated introduction was removed, and existing section navigation used Purchasing's purple selected treatment. Inventory retained its cards, summaries, filters, sort controls and explanatory note. Settings retained all destinations in a horizontally accessible mobile rail. Finance actions stayed inside its content area. Public pages, print geometry, business calculations and server operations were unchanged.

Rendered checks covered the 44 page/viewport combinations, with visible headings, zero document overflow, unchanged left-aligned outer containers, and GET-only workspace requests. Purchasing matched the baseline pixels at every size. Receipt/linked-record browser checks passed at desktop, ultrawide and mobile, including popup access, exact links outside the date period, multiple explicit links, missing links, reload, filters, keyboard focus and return scroll. The return-scroll assertion was changed to wait for asynchronous browser history restoration. Four Finance layout/interaction checks passed. Seven focused navigation, linked-record and Dashboard unit tests and TypeScript checking passed. Focused lint passed; the large pre-existing workspace file retained the same 49 errors and two warnings as its baseline.

## Limits and follow-up

Inventory, Recipes and Products still use tall cards: starting higher did not increase complete visible card counts at laptop size. Inventory and Products' first cards remain below the mobile fold because their useful filters and summaries are retained. No claim is made that every view now fits above the fold. The gallery covers one main destination per section, not every settings tab, label editor mode, empty/error/loading variant or authenticated dialog. Existing shared dialog styling was retained; no dialog redesign was performed. Populated Finance-register density and exhaustive keyboard/screen-reader review remain follow-up checks.

Receipt upload/review and record navigation were exercised with mocked endpoints. This run did not post live receipts, allocate live tax, receive inventory, test live cross-business credentials, or change payment relationship support. Existing relationship limitations remain: historical purchases without explicit stored links are not matched automatically, and no new payment-allocation or reconciliation workflow was introduced.
