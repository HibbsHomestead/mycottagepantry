# Production planned-cost review

The planner previously accepted only `item.cost` and, for finished products, required `stockCostKnown === true`. All Products instead resolved current recipe/BOM or resale purchase estimates. Therefore a valid displayed product cost could disappear from kit planning when finished-stock valuation was absent. This mismatch was reproduced with isolated fixtures; it does not establish the cause of every warning in the unavailable real-run screenshot.

Blank actual labor (`''`) also overrode configured kit assembly labor as zero. Planning now treats blank as unentered and preserves explicit zero overrides.

Planned requirements use recorded inventory valuation first, otherwise the existing All Products `cardCost` resolver for the exact component ID. Material planning respects `currentCost` where configured. Every cost shows its matching unit and basis. Product estimates are whole sellable-package costs: kit quantities do not multiply package contents again. Kit requirements contain finished products plus kit packaging; component ingredients are not separately consumed or added. Existing assembly labor/overhead rules run once.

Unknown component costs remain unavailable in the UI. Known amounts, including applicable kit labor and packaging, remain in an explicitly incomplete known subtotal. Invalid saved definitions retain their specific line error without hiding other lines. Missing referenced records and conversion errors have separate diagnostics. Cost-source disclosures include exact component and recipe/design IDs where available. No name-based lookup or relinking was introduced.

Finalization still uses the strict inventory-only calculation, requires available stock, and executes the unchanged server stock/ledger transaction. The review button also requires recorded inventory valuation. Current estimates are never posted as actual valuation. Finalized runs continue to render their locked snapshots without recalculating them.

## Evidence limits

The affected real run ID, line IDs, product/component IDs, business scope, recipe/design links, quantities, and source costs were not supplied in this workspace. They remain unverified. No authoritative per-warning real-record diagnosis or claim that the inputs are genuinely absent is possible from names alone. No live customer records were queried or modified. The earlier $0.03 real-product investigation likewise remains unverified. No schema or migration changes were required.

## Verification

Production unit/component and isolated PGlite database suites passed (32 distinct tests). Coverage includes current estimates with zero stock, inventory priority with/without stock, truly missing purchase costs, exact-ID missing references, repeated components, multi-item package costs, intact resale multipacks, kit packaging and assembly labor, blank versus explicit zero labor, saved draft purity, revisions, tenant boundaries, transactional rollback, and immutable finalized history.

Chromium fixtures intercept all workspace requests with isolated records and assert no write requests. Screenshots show complete and incomplete estimates with stock shortages at 1440 and 820 CSS pixels, 100% zoom. They are local renders, not deployed verification:

- [Desktop complete](planned-kit-1440-complete.png)
- [Desktop incomplete](planned-kit-1440-incomplete.png)
- [Tablet complete](planned-kit-820-complete.png)
- [Tablet incomplete](planned-kit-820-incomplete.png)

No deployment was attempted, no remote database capacity was verified or released, and no deployed revision was verified. The existing database capacity blocker remains unresolved. The saved capacity audit was left untouched; no branches or resources were created or deleted.
