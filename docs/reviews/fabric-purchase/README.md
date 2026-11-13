# Fabric purchase and expiry verification

These images show the rendered application using synthetic workspace records. No customer stock or prices were changed.

| View | Evidence |
| --- | --- |
| Original purchase form | [Desktop before](before-1440.png) |
| Fixed one-yard purchase basis and cost label | [Phone](after-390.png), [tablet](after-768.png), [desktop](after-1440.png) |
| Opening count, $11.96 suggested value, Inventory as of, and optional lot without expiry | [Phone](opening-stock-390.png), [tablet](opening-stock-768.png), [desktop](opening-stock-1440.png) |
| Saved record reopened in Edit Material | [Phone](reopened-390.png), [tablet](reopened-768.png), [desktop](reopened-1440.png) |
| Conflicting historical reference requiring review | [Review notice](legacy-review.png) |
| Fractional fabric receipt and separate cost per yard | [Receive fabric](receive-fabric.png) |

The $2.99 example saved a purchase unit and stock unit of yd, a purchase basis of 1 yd, and an opening count of 4 yd valued at $11.96. Reloading and reopening retained the purchase basis and price; stock and the opening ledger retained the four-yard count. Fractional counts retained full calculation precision while displayed currency followed existing rounding.

Coverage included Add Item and its Purchase & Stock tab, Edit Material, Receive fabric, receipt inventory matching, inventory expiry filters, and stock status. Package-to-yard and yard-to-bolt/roll switches cleared the draft price and required review, while rolls and bolts kept editable multi-yard contents. Canceling a legacy reference review preserved the saved record. Reviewing and saving a reference retained the previous reference in history without changing inventory valuation or stock movements.

Fabric was excluded from expiry controls, expired/expiring status, counts, and notifications. Inventory dates and optional lots remained available. Ingredient expiry controls and receipt dates remained supported. Existing historical dates stayed stored; no schema migration or historical stock rewrite was performed. Existing precut and other material package rules remained in place.

Validation passed 153 focused unit, handler, and database tests, plus eight browser checks. Browser checks covered 390, 768, and 1440 pixel viewports, keyboard focus and tab order, draft tab retention, save/reload/reopen, fractional yards, package switches, legacy review and cancel, receiving, and receipt matching. TypeScript checking passed. Focused lint passed for the fabric/shared purchase implementation and new tests. The broader touched legacy files retained their pre-existing 110 lint errors and four warnings; comparison with unchanged source found no increase. Builds were left to the platform validation.
