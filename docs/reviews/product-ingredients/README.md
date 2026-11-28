# Product ingredients and allergens verification

Product details previously rendered product cost, stock, packaging, and label actions but did not resolve or show ingredient declarations. The new full-width section and editor tab reuse Label Studio’s `resolveLabelData` for current statements and allergen information. Internal recipe quantities are separate from generated wording and from approved or printed snapshots.

## Rendered fixture evidence

- [Desktop product details](product-ingredients-1440.png)
- [Phone product details, blueberry expanded](product-ingredients-390.png)
- [Phone product details, cranberry expanded](product-ingredients-390-cranberry.png)
- [Label Studio preview of the same six-pack](label-studio-ingredients.png)

Chromium compared both product detail declarations and allergens with the actual-size assortment preview. The fixture also exercised copying the exact statement, checking internal compound-prep quantities, missing recipe and subingredients, editing a manufacturer source, collapsed review summaries, and nested, food-only, and mixed food/non-food baskets. Automated checks covered circular relationships, review invalidation when recipe or manufacturer sources changed, and preservation of prior snapshots.

All records were synthetic. Nested saved relationships were expanded in details; existing production and nested outer-label restrictions were not changed. A manufacturer declaration recorded only on a historical label job was not promoted to the current product source. Physical printing and deployed behavior were not verified for this change.
