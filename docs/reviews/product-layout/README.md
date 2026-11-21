# Product layouts and resale purchase costs

Product tables now use deliberate columns: a 64px photo column, a flexible name column with at least 280px at the table's minimum size, compact type/category/currency columns, a 146px profit column, and a fixed 256px action column. Coarse-pointer layouts reserve 44px buttons and slightly more table width. Names wrap without truncation or a smaller font. The table scrolls inside its container when there is insufficient width.

View, Edit, Copy, and Delete occupy stable slots, with noninteractive space retained when a control is unavailable. A fifth slot preserves the existing unique Preview Label and Print Label menu; it is empty for kits. The former gap came from conflicting legacy table widths and right-aligned variable-width action groups, including automatic margins—not padding alone.

Product Details groups the primary photo and existing mockup controls at the right. Summary and cost calculation content starts at the top left. Margin and labels follow below in two columns, stacking on small screens. Label editing/creation opens a child dialog and leaves Product Details mounted; unsaved-label confirmation still applies. The mockup editor and saved-mockup actions retain their existing behavior. Footer controls retain their labels.

Handmade and Resale share tinted lavender navigation styles, muted borders, purple text/icons, stronger hover colors, a solid brand-purple active state with white text/icons, and a separate focus outline. Existing route logic and aria-current decide selection. Border width is offset by reduced padding to keep geometry unchanged.

Changed components included `ProductCards`, `ItemRecordActions`, `ItemDetailLayout`, `ProductCostCards` / `ProductMarginCard`, `ProductEditor`, `ProductWorkflowDialog`, and `WorkspaceApp`, with shared product-table, cost-panel, and navigation CSS. New `ResalePurchaseSetup` / `ResaleCostBreakdown`, `ProductLabelFlow`, and shared resale-cost helpers kept the new presentation and estimate policy reusable. Server validation was added to the existing product-workflow handler.

## Resale cost sources and policy

Existing actual-purchase fields were reused: `purchaseQuantity`, `purchaseUnit`, `itemsPerUnit`, `purchaseCost`, `lastReceivedUnitCost`, supplier references, `stockEntry`, and product-linked `purchase_receipt` ledger entries. The receipt conversion is purchase quantity × items per purchase unit = sellable items; total acquisition cost ÷ sellable items gives the receipt unit cost. `finishedMovement` retains the weighted-average inventory calculation. Product updates retain server-protected quantity, cost, and receipt-history fields.

Imported reference prices and inventory package prices were not treated as confirmed resale receipt costs. There was no persistent expected-purchase configuration for this editor, so one canonical `purchaseDefaults` object was added to the existing product JSON data, with pack price, explicit sellable count, and the supported purchase-unit choice. No relational schema change or migration was needed or applied. The server validates these defaults independently. They supply clearly labeled display estimates and default receiving unit/count choices. Receiving still requires an actual acquisition total; saving an editor does not receive stock or rewrite history.

Shared costing accepts an explicit display-only estimate option. Cards, tables, Product Details, and the editor opt in; operational/server calls retain the original requirement for a recorded stock basis. Recorded average inventory cost takes priority over the configured estimate. Last purchase cost and estimate are shown separately. Existing historical accounting, sales tax, fees, inventory valuation, and margin formulas remain unchanged.

The current receipt model stores one combined acquisition amount, not separate merchandise/freight/purchase-tax allocations. The breakdown identifies these components as not separately recorded rather than asserting zero, inventing a rule, or adding them again. Resale selling packaging/preparation is not configured in the existing costing model. Purchase-side acquisition costs stay separate from collected sales tax and selling fees.

## The reported $0.03

The previous editor printed `productCosting(...).perPackage` as “Average received cost.” For resale, that value came from the product's saved `cost` when `stockCostKnown` was true. Actual receipts could establish/update it through explicit pack conversion and weighted averaging; starting-stock records could also establish it, including an owner-entered estimate. This label alone did not prove an actual receipt existed.

The referenced annotated image and an identifiable authenticated real-product record/receipt export were not available. The exact origin of the reported $0.03 therefore remains unverified: no claim was made that it was an erroneous conversion, real receipt, default, or legacy value. No real product or historical receipt was inspected through a tenant-bypassing database query, changed, or silently corrected. The new breakdown surfaces available provenance and marks missing provenance explicitly.

## Rendered evidence

All images use isolated synthetic workspace data and intercepted API responses. They are local browser renders, not deployed screenshots. Before captures used temporary copies of the original components from source base `18f5e97787907bcccd6ad8b8b14a13f750d255a8`; those copies were removed after capture. No implementation was reverted to obtain them. Before and after use the same fixture and physical output size. The 60% comparison emulates browser zoom using a proportionally expanded CSS viewport and device scale; native browser zoom was not exercised.

| View | Before | After |
| --- | --- | --- |
| Table, 1600×1000, 100% | [Before](before-table-1600-100.png) | [After](after-table-1600-100.png) |
| Details, 1600×1000, 100% | [Before](before-details-1600-100.png) | [After](after-details-1600-100.png) |
| Table, 1600×1000 output, 60% equivalent | [Before](before-table-1600-60.png) | [After](after-table-1600-60.png) |
| Details, 1600×1000 output, 60% equivalent | [Before](before-details-1600-60.png) | [After](after-details-1600-60.png) |

Additional renders include the [wide table](after-table-1920-100.png), [resale details](after-resale-details-1920-100.png), [resale editor](after-resale-editor.png), and narrow/short details at 1280×800, 1024×768, 768×700, 390×600, and 1024×480. At widths where the table exceeds its container, some columns require horizontal scrolling inside the table; the page itself does not overflow.

Navigation captures cover neither selected, Handmade selected, and Resale selected in both the Products submenu and primary sidebar at 1600px and 390px, plus hover and focus images: `nav-submenu-*`, `nav-sidebar-*`, `nav-hover-*`, and `nav-focus-*`. Hover/focus checks verified stable item geometry and route-dependent selection. Active primary items were checked for white text; unselected emphasis did not set aria-current.

## Validation and deployment

TypeScript passed. Six focused suites passed 45 tests covering cost conversion, missing/zero costs, saved editor values, product edit protection, and pricing displays. The focused local database run passed both the new defaults/tenant/history test and the existing weighted-receipt test. These used an isolated PGlite fixture, not a new Netlify database or remote branch. A separate missing-provenance component regression test passed. Twelve layout Playwright checks and the existing shared-copy scenario at 1440px passed across product types, photos/placeholders, saved/absent mockups and labels, different permissions, action alignment, narrow/short layouts, nested flow return, purchase-cost display consistency, and cancellation.

A broader database-suite run had one failure in the unrelated manual membership-tier limit assertion (`product-workflow-database.test.ts`, expected “manual tier allows 2” rejection). That assertion and its migrations were not changed; the focused receipt/default tests passed.

No build or deployment was initiated. No deployed revision or live rendered UI was verified. Earlier deployment attempts in the conversation reported remote database-branch capacity rejection; current remote capacity was not retested. No branch was created, reset, cleaned up, or reprovisioned, no permissions changed, and the saved blocked database-capacity audit was left untouched.
