# Mixed-pack editor and outer-label verification

## Reproduction and fix

In Products → Food, clicking **Create mixed pack** mounted the dedicated mixed-pack editor and, in the same render, the workspace’s generic Radix dialog. The generic dialog excluded `kit` but not `mixed-pack`. It had no title or body for `mixed-pack`, so it displayed the fallback “Oven” header and workspace description in a second portal. The extra dialog’s backdrop and focus scope, not a help event or a z-index rule, interrupted the editor. After the fix, the editor alone owns that modal state. Both explicit Help buttons still open Help, and Escape returns focus to the triggering button.

[Before: both dialogs open](oven-before.png) · [After: desktop contents](unobstructed-1440.png) · [After: 390 px phone viewport](unobstructed-390.png)

## Rendered label evidence

The isolated fixture created and reopened one pack with three blueberry muffins, three cranberry muffins, one six-count container, and a selling price. Only the product definition was written; ingredient balances, existing product balances, and the stock ledger were unchanged. Keyboard selection, tab switching, Escape, and an in-flight workspace refresh were exercised in the rendered browser.

Label Studio loaded the saved pack into one outer label. The 3 × 4-inch design was turned 90° on 4 × 3-inch media. Chromium generated 10 pages, each 288 × 216 points. Every page retained the two complete product-specific ingredient/subingredient and allergen sections, the configured 10 pt body text, and the business footer. A completed run with a different three-flavor mix loaded from the run, not the catalog. Missing review, a changed flavor, and undersized stock required a new review or prevented approval. The original printed snapshot remained unchanged.

[Label Studio preview](studio-rotated-preview.png) · [Rendered first PDF page](printed-label-page-1.png) · [Actual ten-page PDF](ten-outer-labels-4x3.pdf)

All screenshots and print pages used isolated synthetic records. The native print dialog, physical printer, driver settings, and a physical phone were not verified. The PDF is digital print output, not a regulatory or compliance check.
