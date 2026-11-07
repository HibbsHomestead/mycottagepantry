The ingredient example separated package cost from the count of stock already owned. It used a bag containing 2 lb at $3.00 per bag, with a calculated cost of $1.50 per lb. The count-unit selector affected only the opening count.

| Example                             | Opening count | Stock added | Suggested opening value | Desktop                                         | Mobile                                         |
| ----------------------------------- | ------------- | ----------- | ----------------------- | ----------------------------------------------- | ---------------------------------------------- |
| One unopened bag                    | 1 bag         | 2 lb        | $3.00                   | [Preview](ingredient-unopened-bag-1440.png)     | [Preview](ingredient-unopened-bag-390.png)     |
| Remaining contents of an opened bag | 1 lb          | 1 lb        | $1.50                   | [Preview](ingredient-opened-bag-1440.png)       | [Preview](ingredient-opened-bag-390.png)       |
| Save without adding opening stock   | Disabled      | None        | No posting              | [Preview](ingredient-no-opening-stock-1440.png) | [Preview](ingredient-no-opening-stock-390.png) |

All screenshots used synthetic demonstration records. Each example was saved through the real creation handler in browser tests; disposable database tests checked the resulting stock and accounting entries. Opening stock continued to credit owner equity. No-opening-stock saves created no stock ledger or journal entries.

Decimal counts were supported: 0.5 bag added 1 lb. Unknown cost remained distinct from an explicit zero, and an optional valuation override affected the opening balance without changing the package cost. Identical save retries created no duplicate entries; altered retries were rejected. Switching tabs retained entered values.

The ingredient example received approval for rollout. The same pattern was then applied to the other inventory types in [the rollout review](inventory-opening-count-review.md). Existing records, historical quantities, recipe links, and purchase receiving retained their existing behavior.
