Inventory retained its purple styling, typography, cards, images, main application sidebar, and existing workflows. Summary cards moved above the internal navigation and span the Inventory content container. Category filtering and its compact actions menu moved beside sorting. Add item and manual Receive stock moved into the utility toolbar; barcode receiving remains a separate existing action. Mobile retains collapsible section navigation and compact utility icons with accessible names and focus/hover tooltips.

Rendered screenshots:

- [Desktop cards](inventory-1440.png)
- [Mobile cards](inventory-390.png)
- [Desktop table](table-1440.png)
- [Mobile table](table-390.png)

Two Playwright checks exercised desktop (1440px) and mobile (390px): summary/container geometry, navigation below the summary, all eight destinations and active states, category selection, sort choice and direction, status filters, search, category menu options, relocated action dialogs and keyboard-focus tooltips, Cards/Table views, and document overflow. Desktop category/sort alignment was measured. Eleven existing component tests passed. TypeScript checking and whitespace checks passed. Focused lint retained existing findings; no backend, migration, authentication, billing, Stripe, or stock mutation code changed.

Screenshots and interactions used intercepted workspace responses with synthetic records. Live receiving, checkout, and category writes were not exercised.
