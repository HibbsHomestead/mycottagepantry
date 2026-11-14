# Typography readability verification

Interface text was enlarged selectively across the workspace, Billing, Support inbox, ingredient/product popups, and Label Studio controls. Existing grouping and compact spacing were retained. Controls could grow or wrap; small screens kept readable type and horizontal table scrolling.

[Open the before/after comparison viewer](comparison.html).

| Screen | Before | After | Matching viewport |
| --- | --- | --- | --- |
| Inventory | [Before](inventory-1657-before.png) | [After](inventory-1657-after.png) | 1657 × 1262 |
| Inventory table, full crop | [Before](inventory-table-1657-before.png) | [After](inventory-table-1657-after.png) | Same desktop viewport; full table crop |
| Ingredient popup | [Before](ingredient-popup-1657-before.png) | [After](ingredient-popup-1657-after.png) | 1657 × 1262 |
| Ingredient editor | [Before](ingredient-editor-1657-before.png) | [After](ingredient-editor-1657-after.png) | 1657 × 1262 |
| Admin Billing | [Before](admin-billing-1440-before.png) | [After](admin-billing-1440-after.png) | 1440 × 900 |
| Billing controls | [Before](admin-billing-controls-1440-before.png) | [After](admin-billing-controls-1440-after.png) | 1440 × 900 |
| Support conversation | [Before](support-inbox-1440-before.png) | [After](support-inbox-1440-after.png) | 1440 × 900 |
| Product popup | [Before](product-popup-1440-before.png) | [After](product-popup-1440-after.png) | 1440 × 900 |
| Label Studio controls | [Before](label-studio-1440-before.png) | [After](label-studio-1440-after.png) | 1440 × 900 |
| Phone Inventory | [Before](inventory-390-before.png) | [After](inventory-390-after.png) | 390 × 900 |
| Phone ingredient popup | [Before](ingredient-popup-390-before.png) | [After](ingredient-popup-390-after.png) | 390 × 900 |
| Phone Billing | [Before](admin-billing-390-before.png) | [After](admin-billing-390-after.png) | 390 × 900 |

All pairs used Chromium at 100% browser zoom, device pixel ratio 1, and visual viewport scale 1. Inventory used the supplied image's content width and height after excluding browser chrome. Tablet captures at 820 × 900 and additional phone captures were also retained alongside the screenshots above. Each capture's adjacent JSON file recorded actual computed sizes, colors, ancestor zoom/transforms, overflow, and clipping checks.

The [supplied Inventory table reference](inventory-reference.png) informed the isolated API fixture. Both Inventory captures rendered the actual current Inventory component with the same 12 visible item names, categories, quantities, current unit costs, units, reorder points, vendors, and sort order transcribed from the reference. This was not an authenticated capture of the entire 74-item production workspace: photos, complete totals, historical valuation, and remaining records were not copied. Ingredient and product popup captures used isolated records as well; admin captures used synthetic billing state and support tickets. No live customer records were accessed or modified to prepare the screenshots.

## Computed sizes

| Text | Before | After |
| --- | --- | --- |
| Desktop / phone body | 15px / 14px | 16px |
| Inventory item names | 14px | 15px |
| Inventory quantities, costs, categories, vendors | 10px | 15px |
| Inventory unit suffixes | 13px | 15px |
| Inventory column headings | 11px | 14px |
| Inventory status badges | 12px | 14px |
| Ingredient calculation labels / help | 11px | 14px |
| Admin base text | 14px | 16px |
| Admin secondary paragraphs | 12px | 14px |
| Support conversation body | 13px | 16px |
| Support timestamps | 11px | 14px |
| Label Studio compact number inputs | 12px | 16px |
| Editable inputs and dropdown values | 12–14px in affected controls | 16px |

The Inventory ancestor chain had no inherited scaling: every ancestor had zoom 1 and transform none. The small cells came from explicit font declarations, including a 10px table-cell rule. The page itself did not need scaling. Existing smaller breakpoint overrides received the same minimum sizes.

Inventory retained 8px cell padding and compact 14px status badges. Names and numeric values shared 15px type. All original decimal formatting and calculation precision were retained; no domain, cost, stock, recipe, product, or persistence code changed. Main and section headings stayed larger than body text.

Admin secondary text changed from #72798a to #606879, improving contrast against white from 4.36:1 to 5.59:1. Faint admin table headings and identifiers were darkened as well.

## Validation

- 65 focused unit/component tests passed for shared controls and overlays, Inventory, administration, support, label documents/browser printing, and costing.
- 11 readability browser checks passed across desktop, 820px tablet, 390px phone, and 320px phone. They checked all visible interface text for a 14px minimum, editable values for 16px, button clipping, and page overflow.
- Eight existing Inventory toolbar/selection/empty-state browser cases passed, covering 320, 390, 430, 820, and 1440px layouts, tooltips, and existing actions.
- A separate 200% text-enlargement check passed: Inventory values grew to 30px, buttons remained unclipped, and table overflow stayed within its scrolling container. [Capture](inventory-text-200-percent.png). This supplemented responsive checks; it was not represented as an actual browser-zoom test.
- TypeScript, targeted ESLint, and whitespace checks passed. No build command was run.
- Forty original stylesheets were compared structurally: existing changes only added screen font floors; every original print rule and original label-artwork style was retained.
- The actual label SVG was captured separately from page overlays at a fixed integer position. Before/after label pixels matched exactly at both desktop and phone widths. SVG viewBox, text font attributes, transforms, and shape geometry also matched after normalizing generated document identifiers. [Desktop before](label-artwork-1440-before.png) / [after](label-artwork-1440-after.png); [phone before](label-artwork-390-before.png) / [after](label-artwork-390-after.png).

Two older Label Studio layout cases still looked for a removed “Templates” navigation button and timed out before reaching their layout checks. The same missing-button failure was reproduced on the original source. They were excluded from the passing counts; the new browser checks exercised the current editor and selected-text controls directly.

Label content, dimensions, canvas geometry, saved font sizes, print/export code, and stored business data were unchanged. Authenticated production verification and publication remained with the managed deployment workflow.
