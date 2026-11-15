# Shared application layout and readable typography

Authenticated workspace pages use a compact heading, any existing full-width overview, then the existing left section menu beside page actions, filters and content. Finance and Purchasing now use the shared section grid. Shared overview and action slots allow nested workflows to keep their existing state and handlers. Inventory retains its summary-first structure, category filter beside sorting, and accessible icon toolbar. Product creation and export actions were consolidated above search. Finance retains its five supported toolbar actions. Handmade and advanced financial summaries use the full-width overview slot.

Typography uses scoped rem tokens: body, table data, controls and navigation are 1rem; secondary text is at least .875rem; card titles are 1.125rem; section titles are 1.3125rem; page headings are 1.75rem; summary values are 1.625rem. Mobile does not lower these sizes. Public page typography and label artwork sizing were preserved.

## Rendered screenshots

The screenshots use real React components with deterministic synthetic workspace responses. No live business records or checkout were used.

| Page | Desktop, 1440px | Mobile, 390px | 200% equivalent reflow |
| --- | --- | --- | --- |
| Inventory | [Desktop](inventory-1440.png) | [Mobile](inventory-390.png) | [Reflow](inventory-200-reflow.png) |
| Purchasing | [Desktop](purchasing-1440.png) | [Mobile](purchasing-390.png) | [Reflow](purchasing-200-reflow.png) |
| Finance | [Desktop](finance-1440.png) | [Mobile](finance-390.png) | [Reflow](finance-200-reflow.png) |
| Products | [Desktop](products-1440.png) | [Mobile](products-390.png) | [Reflow](products-200-reflow.png) |
| Recipes | [Desktop](recipes-1440.png) | [Mobile](recipes-390.png) | [Reflow](recipes-200-reflow.png) |
| Settings | [Desktop](settings-1440.png) | [Mobile](settings-390.png) | [Reflow](settings-200-reflow.png) |

Additional desktop/mobile captures cover [Dashboard](dashboard-1440.png), [Handmade](handmade-1440.png), [Sales](sales-1440.png), and [Labels](labels-1440.png). Recipes remains the existing Recipes & Designs destination within Production.

## Verification

Five browser tests passed across the new shared-layout suite and existing Inventory layout suite. Checks covered ten destinations on desktop/mobile, summary position and width, actual visible input/select/table/navigation font sizes, and document overflow. Inventory checks exercised all eight destinations, status filters, category selection, sorting/direction, search, category actions, Cards/Table, Add item/Receive stock dialogs and keyboard-focus tooltips. Six required pages also passed button-clipping and document-overflow checks at a 720×500 CSS viewport, equivalent to the layout viewport of a 1440×1000 display at 200% zoom. All five Finance toolbar actions opened their existing dialogs at that viewport.

The reflow captures test equivalent CSS viewport dimensions; native browser zoom controls were not exercised. Full-page screenshots can show fixed mobile navigation across the capture; that navigation stays fixed to the visible viewport during use. TypeScript, focused ESLint and whitespace checks passed. No build command was run.

## Appropriate exceptions

No summary was invented for Purchasing's receipt inbox, Products, Recipes or Settings. Their existing filters and data begin beneath actions and navigation. Dashboard has no internal section menu. Settings keeps section-specific Save/Cancel controls within their forms. Labels keeps its canvas/editor and print controls with the content they operate on. Dialogs remain centered and retain their specialized layouts. Single-purpose account access, workspace selection and billing/checkout-return screens were left in their existing flows rather than given artificial section menus. Public marketing, pricing and authentication pages were unchanged.

Only presentation files and browser-review assets changed. Database migrations, API handlers, business calculations, stock operations, permissions, authentication and billing integrations were not modified.
