The application’s internal navigation was standardized around Finance’s left menu, while retaining Purchasing’s existing purple theme, typography, neutral surfaces, borders and controls. The main application sidebar and canonical hash destinations were preserved. Internal menus used a consistent 180px desktop column and a 20px content gap. On narrow screens, each menu became one labelled disclosure with the same destinations, expanded state, keyboard focus and current-page indication.

| Section | Inspection and result |
| --- | --- |
| Inventory | Converted all eight existing destinations: Overview, Ingredients, Craft Materials, Packaging, Supplies, Finished Goods, Movements and Counts. |
| Products | Converted All Products, Food, Handmade, Resale, Kits and Categories. |
| Handmade | Converted its five workspace destinations. |
| Production / Recipes | Converted Overview, Recipes & Designs, Production Runs and Waste & Adjustments. The main Recipes shortcut still opened Recipes & Designs. |
| Sales | Converted Sales and Consignment. |
| Labels | Converted its existing Studio section navigation, preserving its contextual Editor destination. Editor controls were retained. |
| Finance | Already matched: retained its single menu, conditional Bills/Invoices destinations, Receipt inbox link, mobile disclosure and content toolbar actions. Matched the shared compact width and spacing. |
| Purchasing | Already matched: retained its single menu and disclosure, destinations, receipt workflow and existing page styling. Matched the shared compact width and spacing. |
| Settings | Already used a desktop left menu. Standardized its width and selected styling; replaced the mobile horizontal rail with a disclosure. Existing owner billing link and all settings destinations remained. |
| Dashboard | Single view; no internal menu was added. |
| Standalone billing, help and support | No workspace section menu was added. Existing dedicated flows remained. |

Inventory’s All items / Low stock / Needs review / Expiring soon filters, Cards/Table toggle, categories, search, sorting and stock utilities stayed in the content area. Mobile summary and utility spacing was tightened. Record-detail view panels and form-editor tabs were retained as their specialized controls.

Loaded inventory images used transparent wrappers, contained proportions and natural-size limits. Missing images retained their icon placeholders, and loading images had a separate busy state. Original files and backgrounds inside files were preserved. The loaded-image screenshots used a small synthetic flour illustration to make wrapper letterboxing and proportions visible; they were browser renders of the actual component, not screenshots supplied by the user.

The product popup adopted the supplied reference’s price/cost/profit hierarchy, stacked cost breakdown, margin panel beside the photo, expandable detailed calculations and bottom actions. The existing recipe, production, editing and label actions remained available. Values came from the unchanged existing costing, profitability and tax functions. Demo products without saved photos still displayed the existing missing-photo state; no replacement product photograph was fabricated.

| Rendered view | Desktop (1440 × 1000) | Mobile (390 × 1000) |
| --- | --- | --- |
| Products | [Desktop](products-1440.png) | [Mobile](products-390.png) |
| Inventory Overview | [Desktop](inventory-1440.png) | [Mobile](inventory-390.png) |
| Ingredients selected | [Desktop](ingredients-1440.png) | [Mobile](ingredients-390.png) |
| Inventory Table | [Desktop](inventory-table-1440.png) | [Mobile](inventory-table-390.png) |
| Loaded inventory image | [Desktop](inventory-loaded-image-1440.png) | [Mobile](inventory-loaded-image-390.png) |
| Purchasing | [Desktop](purchasing-1440.png) | [Mobile](purchasing-390.png) |
| Finance | [Desktop](finance-1440.png) | [Mobile](finance-390.png) |
| Settings | [Desktop](settings-1440.png) | [Mobile](settings-390.png) |
| Product details | [Desktop](product-detail-1440.png) | [Mobile](product-detail-390.png) |
| Handmade | [Desktop](handmade-1440.png) | [Mobile](handmade-390.png) |
| Production | [Desktop](production-1440.png) | [Mobile](production-390.png) |
| Sales | [Desktop](sales-1440.png) | [Mobile](sales-390.png) |
| Labels | [Desktop](labels-1440.png) | [Mobile](labels-390.png) |

[Expanded mobile Inventory menu](inventory-mobile-expanded.png) showed the collapsible destination list.

Validation passed 11 browser tests: two section-navigation/rendered-review tests, four Finance layout/navigation/action tests (1280, 1440, 2560 and 390px), and five Purchasing/shared-receipt/linked-record tests. Every Inventory destination was clicked at desktop and mobile widths; canonical hash routes and active states were checked. Table view and the product popup were opened. All nine multi-view workspace sections were rendered at desktop and mobile widths without document overflow. The loaded image wrapper’s computed background was verified transparent. Navigation made no business mutation requests; the existing Table preference used its existing pantryView action, which was fulfilled by the test fixture.

Seventeen focused unit tests passed for navigation compatibility, inventory browsing, photo fallback behavior and cost cards, including inclusive/exclusive tax values and unchanged input records. TypeScript checking, focused lint and whitespace checking passed. Browser tests used intercepted synthetic workspaces and receipt responses. No live receiving, customer data edits, live checkout, payment, authentication change or database migration was performed. Backend business rules, stock balances, permissions, Stripe configuration and billing code were unchanged. No build command was run.
