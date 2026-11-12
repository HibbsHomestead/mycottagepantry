# Inventory view cleanup

The main Inventory page already provided photo cards and a table, using one filtered/sorted record list and the same item actions. Its existing authenticated per-user view preference was stored through the workspace API in Netlify Database. The separate photo-inventory popup was a design prototype with independent browsing state, rather than a photo-scanning inventory workflow.

Removed the preview button, popup, state, and unused preview styles. Barcode lookup and the Add Item existing-record action now open the established ingredient or product detail screen. Retained the barcode-review styles in a dedicated stylesheet because those styles are still used by existing entry workflows. Shared photo rendering, item records, categories, search, filters, permissions, receiving, labels, counts, and count sessions were preserved. No backend, migration, quantity, cost, photo, or history changes were needed. Switching views only saves the existing view preference; it does not post stock movements.

Verification passed for 12 focused component/helper tests, the existing server-side per-user Cards/Table preference test, and TypeScript. The updated browser checks passed in Chromium at 390, 820, and 1440 pixels, using disposable intercepted workspace records against local Netlify emulation. They checked shared search/low-stock filtering, view persistence across refresh, item actions, barcode-to-item details, loaded photos, single-column phone cards, absence of page overflow, and unchanged inventory/ledger records. These were emulated viewport checks, not real-device camera tests.

Targeted lint passed for the barcode-review component and browser test. A wider lint check encountered existing errors in the large workspace shell and inventory-tools component; those unrelated rules were not refactored in this cleanup. The retained barcode decoder/denied-camera fallback browser test timed out in local emulation, so that separate workflow was not claimed verified. No build ran because managed Netlify validation handles builds.

Screenshots:

- [Phone cards](../previews/inventory-main-cards-390.png)
- [Phone table](../previews/inventory-main-table-390.png)
- [Tablet cards](../previews/inventory-main-cards-820.png)
- [Desktop cards](../previews/inventory-main-cards-1440.png)
- [Desktop table](../previews/inventory-main-table-1440.png)
