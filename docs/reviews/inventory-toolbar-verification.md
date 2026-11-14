# Inventory toolbar and label selection

The scanning/counting/label actions moved below the summary cards, beside the lower All items / Low stock / Expiring soon filters. The filters stayed left-aligned and the action group stayed right-aligned. Desktop/tablet controls reused the mobile icons with compact purple buttons, accessible full names and hover/focus tooltips. A divider separated actions from filters. The group wrapped below the filters when enlarged text left insufficient space, and phones retained the existing three-column icon grid.

The standalone action row and shelf-label disclosure/duplicate item list were removed. The enabled zero-count print icon opened selection mode in the existing Cards/Table results. Select all filtered items used exactly the current result rows; Clear selection cleared the shared selection, and Done hid the checkboxes and selection controls while keeping the selected count. Printing required at least one item. Returning from the print dialog made selection available for further changes. The existing shelf-label dialog, copy quantity, media profiles and print/export options were reused. Scanner/count handlers and business mutations remained unchanged.

The Cards empty state spanned every grid column. Cards and Table centered the existing heading, supporting text and Add Item action within the results area, excluding the sidebar, with compact spacing and no viewport-height card.

## Verification

- 22 focused tests passed across the inventory toolbar, pantry rendering/sorting, inventory browsing, count controls and barcode rules. New component coverage exercised selection in both views, filtered bulk selection, zero-selection printing, clearing, Done/re-entry, retained print options, read-only action permissions and no stock writes.
- Eight Chromium browser cases passed at 320, 390, 430, 820 and 1440 pixels. They checked placement beneath the summary, desktop alignment, phone grids, enlarged text, wrapped tablet actions, keyboard tooltips, the existing scanner/count/location dialogs and the rapid-count link. The phone scan-to-receive case denied the camera, entered a barcode manually, required package confirmation and opened the receiving draft without a stock write.
- Empty-state geometry was checked in both Cards and Table across Overview, Ingredients, Craft Materials, Packaging and Supplies at phone/tablet/desktop widths. Heading, text and button shared the results area's horizontal center; no document overflow or tall empty card was introduced. Actual desktop, tablet and phone screenshots were inspected.
- TypeScript, lint for the new/updated toolbar tests, and whitespace checks passed. Existing lint findings in the three modified application modules matched the original source: no new findings were introduced. No backend/schema/migration changes or build commands were required.

An additional older Add Item scanner test timed out on its obsolete Barcode entry-method selector. Checking the current inline ingredient entry also exposed its missing catalog-response fixture. Those unrelated product-entry implementation files and the older test remained unchanged; the toolbar camera-denied/manual-receiving flow was verified directly in the updated toolbar suite.

Browser tests used deterministic workspace/authentication responses and did not change production data. They did not verify physical cameras, printers or stock posting. Managed publication and authenticated verification of the resulting deployed toolbar remained pending after this editing run.
