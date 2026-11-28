# Ingredient modes and allergen review

Label Studio previously kept supplier subingredients as an unweighted text field and used recorded ingredient allergen tags directly for recipe-backed products. The shared label resolver now keeps the original declaration, produces a weighted statement only from complete verified inputs, and separates allergen suggestions from explicit product confirmations. Product details, the product editor, recipe details, and Label Studio reuse these results.

## Rendered fixture evidence

- [Desktop ingredient modes](ingredient-modes-1440.png)
- [Phone ingredient modes](ingredient-modes-390.png)
- [Desktop allergen evidence](allergen-evidence-1440.png)
- [Phone allergen evidence](allergen-evidence-390.png)
- [Actual-size six-pack label preview](mixed-pack-label-review.png)

The browser fixtures exercised selecting and saving merged mode, reviewing suggested allergen evidence and recording a dismissal reason on desktop and phone, and checking that the six-pack matched product details and kept each flavor’s separately resolved statement and confirmed allergens. Browser mutation responses were fixture-backed, not live database writes. Automated resolver tests also exercised missing percentages, nested components, circular recipes, duplicate flour, the strict 2% threshold, print validation, and a stale review after a source change without altering the earlier snapshot.

Merged weights use the saved formulation and documented composition, not a lab analysis of the finished food. Supplier wording that cannot be safely split, missing weights, and incomplete source data remain visible for review. Nothing in this workflow certifies label compliance. No production deployment, live database mutation, or physical printing was performed.
