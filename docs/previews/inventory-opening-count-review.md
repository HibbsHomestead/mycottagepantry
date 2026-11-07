The approved Package & Cost and Opening Count pattern was applied to new ingredients, packaging, supplies, craft materials, and resale merchandise. Purchase and stock units remained independent of the opening count-unit selector. Suggested valuation used the entered package contents and cost; the optional override affected the opening balance only.

The [ingredient examples](ingredient-opening-count-review.md) demonstrated one unopened bag, one lb remaining from an opened bag, and saving without opening stock.

| Inventory example   | Package                        | Opening count | Stock added    | Opening value | Desktop                                     | Mobile                                     |
| ------------------- | ------------------------------ | ------------- | -------------- | ------------- | ------------------------------------------- | ------------------------------------------ |
| Packaging           | 24 each per pack, $9.60        | 0.5 pack      | 12 each        | $4.80         | [Preview](inventory-packaging-1440.png)     | [Preview](inventory-packaging-390.png)     |
| Supplies            | 2,000 ml per bottle, $12.00    | 500 ml        | 500 ml         | $3.00         | [Preview](inventory-supply-1440.png)        | [Preview](inventory-supply-390.png)        |
| Yarn                | 200 yd per pack, $8.00         | 50 yd         | 50 yd          | $2.00         | [Preview](inventory-yarn-1440.png)          | [Preview](inventory-yarn-390.png)          |
| Fabric length       | 10 yd per roll, $50.00         | 0.5 roll      | 5 yd           | $25.00        | [Preview](inventory-fabric-length-1440.png) | [Preview](inventory-fabric-length-390.png) |
| Fabric precuts      | 4 pieces per bundle, $12.00    | 1 each        | 1 piece        | $3.00         | [Preview](inventory-fabric-precut-1440.png) | [Preview](inventory-fabric-precut-390.png) |
| Resale sealed packs | 6 sealed packs per case, $9.00 | 0.5 case      | 3 sealed packs | $4.50         | [Preview](inventory-resale-1440.png)        | [Preview](inventory-resale-390.png)        |

Fabric retained its width and length/precut rules. Resale retained its sellable-unit definition and whole-item validation; the description of contents inside a sealed pack never multiplied its stock count. Fractional package counts were accepted when they resolved to a valid stock quantity.

All browser demonstrations used synthetic records and the real item-creation handler. Disposable database tests also checked each item type with and without opening stock, identical and altered retries, ledger entries, owner-equity postings, and preservation of existing records and recipe connections. Purchases remained in the existing Receive Stock workflow. Existing item editors, production calculations, and historical quantities were preserved.

TypeScript validation, 121 focused tests, and 18 desktop/mobile browser checks passed. Formatting and lint for new code passed; existing lint findings in older files were verified unchanged.
