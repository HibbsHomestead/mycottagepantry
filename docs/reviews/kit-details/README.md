# Kit Details and Kits tab verification

Kit cards now open read-only Details. The view uses the existing Product Details dialog, header, two-column layout, photo component, calculation-card primitives and action styles. Kit-specific figures come from the existing `productCosting`, `calculateTax`, `applicableTaxes` and `profitability` functions. Component production labor, overhead and packaging remain inside the component package cost; only kit packaging and assembly are added. The existing calculation has no additional kit overhead charge.

The compact included-product list sits directly below the unchanged photo. Quantities explicitly identify whole selling packages and show saved selling-unit and contents information when available. Product links open regular Product Details; Back and Close return to the kit. Lists grow in the outer dialog without an internal scrolling area. Edit kit opens the existing three-tab editor; saving returns to Details using the confirmed workspace response and refreshes the cards. Cancel returns to the saved kit.

Products includes Kits alongside All Products, Food, Handmade, Resale and Categories. Kits filters only kit records, retains search and the hash route, and offers Create kit. Existing product tabs exclude kits and All Products includes them.

Missing category validation remains visible in Details and the editor. The message names the kit and points to Category in Contents & details. Inactive categories, missing classification and missing tax mappings receive the appropriate category or tax-settings action. Available costs and saved prices remain visible; dependent tax, revenue, profit, margin and suggested price remain unavailable until their requirements are satisfied. Missing component cost prevents displaying a zero total while independent revenue/tax results remain available.

## Rendered evidence and access limitation

These are screenshots of the actual application rendered locally in Chromium. The API boundary used deterministic presentation fixtures named **Holiday Dressin’ Rolls – 9ct.** and **Gather 'Round**, with a synthetic image and demo cost sources. This run did not have an authenticated session for the private customer records or their actual photographs. The screenshots establish shared component geometry and behavior; they do not establish the actual saved contents, amounts or photographs of those two private records. No customer records were queried or modified. Verification against those exact private records remains outstanding.

The regular reference and kit were rendered at identical viewport sizes. Dialog dimensions, grid columns, photo dimensions and horizontal position, title font, calculation-card styles, and action styles matched. Title wrapping on phone screens naturally changed following vertical positions. Both photos retained `object-fit: contain`.

| Viewport | Dialog, regular and kit | Columns | Photo, regular and kit | Horizontal overflow |
| --- | --- | --- | --- | --- |
| 1440 × 950 | 1000 × 810 | 564.92 / 353.08 | 353.08 × 353.08 | 0 px |
| 768 × 950 | 768 × 810 | 422.14 / 263.86 | 263.86 × 263.86 | 0 px |
| 390 × 950 | 370 × 810 | 324, stacked | 324 × 280 | 0 px |

| Evidence | Desktop | Tablet | Phone |
| --- | --- | --- | --- |
| Regular Product Details | [Reference](regular-product-1440.png) | [Reference](regular-product-768.png) | [Reference](regular-product-390.png) |
| Kit Details | [Kit](kit-details-1440.png) | [Kit](kit-details-768.png) | [Kit](kit-details-390.png) |
| Kits tab | [Products](kits-tab-1440.png) | [Products](kits-tab-768.png) | [Products](kits-tab-390.png) |
| Missing category | [Warning](kit-incomplete-1440.png) | — | [Warning](kit-incomplete-390.png) |
| Raw measurements | [JSON](geometry-1440.json) | [JSON](geometry-768.json) | [JSON](geometry-390.json) |

[Phone calculation cards after scrolling](kit-costs-390-scrolled.png).

## Actual test results

The final kit browser run passed **12/12** checks in 46.2 seconds: `tests/kit-details.spec.ts` plus the two kit-definition cases in `tests/kits-admin.browser.spec.ts`. It covered details-first opening, shared rendered geometry/styles, package quantities and contents, component links and return using Back or Close, calculation expansion, all editor tabs, saved price/assembly refresh without reload, cancel preserving saved data, card refresh, Kits/search/Create kit/type filters/hash refresh, missing-category behavior and edit action, and 18-product lists with accessible outer scrolling. Viewing and canceling sent no workspace writes. Saves sent only `save/products` with the kit definition. Ingredient data, product stock quantities, ledger, batches and sales remained unchanged in the fixtures.

The existing regular-details browser regressions passed **11/11**: nine `tests/product-detail-media.spec.ts` cases across 1762, 1440, 1280, 1024, 768, 390 and 320 px, including long label lists, and two `tests/detail-cost-cards.spec.ts` comparisons. Regular labels, actions, photo size, linked recipe navigation and existing editors remained functional. Generated historical preview screenshots were restored after these tests.

The broader `tests/product-cards.spec.ts` run failed **5/5** at its existing assertion that all card photos are exactly 128 px high. The unchanged current stylesheet uses responsive 4:3 photos with a 200 px minimum height. All five failures were reproduced using a temporary copy of the unchanged application from HEAD. Those unrelated card layouts and test expectations were left unchanged; temporary baseline files were removed.

The targeted unit/component run passed **69/69** tests in nine files: kit details, authoritative kit costing, shared cost cards, product cards, workspace navigation, costing, product editing, categories and the existing product editor. It included inclusive/exclusive tax, missing/inactive/unclassified categories, missing tax mappings, missing component cost, missing/invalid selling prices, invalid target margin, archived/missing components and unsupported quantity bases.

`npx tsc --noEmit` and `git diff --check` passed. ESLint passed for the added modules and changed kit editor, cards, navigation and tests. The existing workspace file retained the same 49 errors and one warning as the unchanged baseline, with identical rule counts; no new lint diagnostics were introduced. No build command or deployment was run. Database schema, migrations and stock workflows were unchanged.
