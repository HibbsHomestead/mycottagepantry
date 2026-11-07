# Proposed reusable recipes, linked bases, and product kits

This is a proposal for review, not an implemented feature. Ingredient URL import takes priority. No recipe, production, inventory, label, Square, or billing behavior was changed for this proposal.

## Existing behavior inspected

Recipes currently contain ingredient lines. A compound prep already links a recipe to a pantry ingredient through `compoundRecipeId`: saving the recipe creates a zero-stock prep reference, `rollup` traverses its dependencies and estimates cost per yield unit, and completing a prep batch consumes raw ingredients and receives the actual finished prep. The parent consumes that prep stock. Compound yields require normalized pantry units; recursion detects cycles. This provides a foundation for stocked sub-recipes, rather than a reason to build a competing inventory system.

`costBreakdown` includes ingredients, labor, recipe packaging, overhead, waste, and optional product packaging. `products.recipeId` is the canonical recipe connection, and `unitsPerPackage` maps recipe output to a sellable package. Recipe Details already supports reviewed product links. Completed batches retain actual usage and cost snapshots. Sales retain historical COGS and tax snapshots. Finished-stock workflows exist for handmade and resale items, but the legacy food-batch completion path does not itself receive finished food product stock. Kits therefore need an explicit food finished-stock bridge before they can safely consume those products.

Label resolution currently traverses compound ingredient recipes, carries subingredients and known allergens, and warns about missing review or weight conversions. It does not provide the full versioned source tree, Contains/advisory provenance, and historical label content required here. Ordinary recipe lines have tenant-scoped ingredient foreign keys; several foundational entities still use JSON data. Business ownership, forced row policies, stock-ledger records, and posted journal immutability must remain enforced.

## Proposed relationships

| Relationship                                                         | Proposed role                                                                                                                                                                                  |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recipe → immutable recipe versions                                   | Save a new version for changed yield, ingredients, method, labor, overhead, or declarations. Keep the stable recipe ID for discovery.                                                          |
| Recipe version → ordered component lines                             | Each line refers to exactly one ingredient or recipe version, with positive quantity, unit, component role, and fulfillment mode. Ingredient lines retain their existing identity and meaning. |
| Parent recipe component → source recipe version                      | A reusable sub-recipe or linked base stays linked and expandable. One optional base line has an explicit scale; additional components stay independent.                                        |
| Stocked sub-recipe → existing prep ingredient                        | One inventory identity per prep, using the existing compound relationship. Lots/runs link actual yield and cost to the producing version.                                                      |
| Product → recipe/output mapping                                      | Retain the existing recipe relationship and package-output mapping. Add version review metadata without inventing a second canonical product link.                                             |
| Kit product → immutable kit version → product component lines        | Each component refers to an existing product and a positive number of sellable packages. Store kit packaging and assembly labor separately. Initially exclude nested kits.                     |
| Reservation → component stock identity and operation                 | Track allocation without changing physical on-hand stock. Link assembly/fulfillment, release, cancellation and expiry to stable operation IDs.                                                 |
| Production/assembly/sale → immutable usage and declaration snapshots | Record exact source versions, quantities, conversions, actual cost, packaging, stock movements and source text. Preserve historical records after source edits.                                |

Use composite business/record keys and foreign keys throughout. Version keys must include the source recipe/product identity so a version cannot be attached to another record. Referenced records are archived rather than deleted. No persistent browser drafts or local-file business storage is proposed; committed data and optional durable drafts belong in Netlify Database.

## Yield, scaling and costing

A source must have a positive finished yield in an explicit unit. For a 1,000 g frosting yield costing $8, a parent using 250 g receives $2 of source cost. Its scale is `amount used in source yield units / source finished yield`. A parent multiplier applies to all direct additions and source usage. A linked base may be entered as a batch factor (0.5×, 1×, 2×) with its corresponding finished output shown. Parent finished yield is entered explicitly; adding cheese does not imply a guessed baked yield.

Use exact supported same-category conversions and explicit, verified, source-specific mappings. Grams and kilograms convert directly. Cups and grams require a measured conversion for that ingredient/prep. A loaf-to-gram mapping must be measured; free-text “loaves” is not interchangeable with `each`. Missing conversions and incomplete costs remain visible and block completion/fully costed claims. Do not change historical unit meanings.

For made-to-order components, expand the selected source version into raw requirements and source labor/overhead once. A base's ingredient cost already includes its nested sources; do not add its flattened ingredients again. Base labor is included once; only additional parent labor is added. Source sellable packaging is excluded from reusable recipe output unless it is explicitly a consumed input; parent/product packaging is charged at its own level. Show ingredient, component, labor, packaging, overhead, total and per-yield cards using the approved calculation-card components, with expansion for details.

For stocked preps, estimates may show the latest reviewed source cost, while actual production consumes the prep's existing stock valuation. It does not consume the prep's raw ingredients or add its production labor again. Source recipe saves change future estimates, never the cost of previously prepared stock.

## User workflows

In the existing recipe popup, “Add component” offers an ingredient or a reusable recipe. Selecting a recipe shows its linked name, version, finished yield, amount used, fulfillment mode and proportional cost. Expansion shows the source ingredients/method without creating another editor. The existing popup owns one draft across sections.

“Use linked base” creates a draft with an explicit base link and scale, plus editable additions. “Duplicate as independent recipe” copies the recipe structure into a new identity without a base dependency. The duplicate review must also state whether existing nested reusable components remain linked; detaching the base alone does not silently detach or flatten every child.

Recommended base-change policy: pin links to a reviewed version. New source versions show “Update available” with cost, yield, method and allergen differences. The user accepts the update in the child recipe. New drafts use the current reviewed version; planned runs remain pinned until explicitly replanned. Completed production, sales and printed-label snapshots remain unchanged. Reverse dependency lookup identifies all affected recipes, products, kits and label reviews.

In the existing product popup, “Kit / box” selects existing products and sellable-package quantities, kit-only packaging, assembly minutes/rate and one kit selling price. Reuse the approved cost cards. Show each component's included packaging separately from outer-box packaging. A product's selling price is never its component cost. Taxes remain a separate configured calculation; mixed-tax kits need an approved policy before release.

## Inventory and accounting behavior

Saving a recipe, base, kit, or draft plan creates no stock, reservation, purchase, or journal. A stocked prep reference can exist at quantity zero as it does now. Users choose an explicit fulfillment mode per recipe component:

- **Make for this run:** expand raw requirements. Complete the raw consumption and its allocation to parent output atomically. Do not also deduct a stocked prep. If a separate prep run produces excess, explicitly receive and value the excess once.
- **Use prepared stock:** reserve/deduct the existing prep stock once, at actual stock cost, with a ledger entry. Shortage blocks completion; making more requires an explicit linked prep run. Do not silently switch modes.

Recommended kit modes are assemble to stock and assemble for order. Confirming an order/assembly plan reserves available component products and outer packaging in one transaction. Draft quotes reserve nothing. Availability is on-hand minus active reservations, including existing sales/consignment allocations. Order revisions release/replace reservations atomically. Unavailable components block confirmation or require an explicit unreserved/backorder status with a visible production requirement; never substitute products or allow negative stock.

Assembly consumes component finished goods and kit-only packaging once and capitalizes their actual costs plus assembly labor/approved overhead into kit stock (or an immediately allocated order output). This is an inventory transfer, not another expense for ingredients already used to make the products. Food components first need a reviewed ledger-backed finished-goods receipt from their production runs; a recipe definition cannot stand in for product stock.

Selling an assembled kit deducts kit stock and recognizes its actual COGS once. It does not deduct component products or packaging again. Cancellation before assembly releases reservations only. Cancellation after assembly releases the order allocation and leaves the assembled kit available. Explicit disassembly reverses a recorded assembly's recoverable component quantities/costs into stock; used packaging, nonrecoverable labor and spoiled items are separately recorded as waste. Original movements and journals remain immutable; a reversal has a new ID referencing the original operation. Refunds restore kit stock only for an explicitly accepted return and never fabricate recoverable components.

All fulfillment operations lock affected rows in a stable order, recheck available stock, use unique operation keys, write stock and ledger/journals atomically, and return the same result on a retry. Prevent concurrent overselling and duplicate reservation/assembly/disassembly. Keep existing tax/revenue separation and require accounting review of the food-stock capitalization bridge before release.

## Declarations and dependency safeguards

Preserve an ordered tree of original ingredient text, nested subingredients, explicit Contains and separate May contain/shared-equipment/facility text, supplier/source identity, reviewed status and exact recipe version. Carry the source path through each nested recipe and kit component. Summaries may deduplicate allergen names for readability while retaining every contributing source. An advisory does not become a Contains declaration. Missing information never means allergen-free. Source updates invalidate relevant future label review, not prior snapshots.

Check direct and indirect cycles on every graph edit and version adoption, including ingredient → compound source recipe edges and linked base edges. Serialize graph edits per business (or lock the graph revision), so two concurrent saves cannot each pass validation and introduce a cycle together. Check version dependencies and stable recipe identities. Reject invalid/missing sources, nonpositive yields, unresolved units, and cross-business references. Limit nesting and graph size with a clear validation error, without silently truncating ingredients or declarations. Initial kit support excludes kit-in-kit references.

## Migration requirements

After design approval, add Drizzle definitions and NEW forward migrations for recipe/kit versions, component edges, source provenance snapshots, inventory reservations, assembly runs/usage, and their tenant-scoped foreign keys, indexes, unique operation keys, positive quantity checks and forced row policies. Add guarded immutability and stock-ledger rules for the new records. Preserve every applied migration exactly as it exists.

Backfill a version from each current recipe without altering its ID, yield or saved lines. Adapt existing `recipe_lines` and compound/prep links; do not create duplicate prep stock or replay historical receipts. Existing completed batches/sales keep their current snapshots and are explicitly marked legacy where source versions cannot be reconstructed. Audit existing dependency cycles, incomplete cost/unit mappings and food-stock posting behavior before enabling new completion paths. Roll out behind a capability flag with dual-read verification, then switch writes; disabling the flag must leave existing records readable. No migrations are needed for the import regression itself.

## Phases and approval checkpoints

1. Repair ingredient import and verify the exact baking-soda URL plus the separate flour URL, actual rendered fields, conflict preservation, sections, partial responses and failures. Retain popup/cost-card presentation.
2. Review this design and approve version updates, fulfillment modes, duplicate behavior, kit stock/reservation policy, and cost/accounting rules. No reusable-recipe/kit code precedes this review.
3. Add version/dependency storage and read-only audit/preview calculations. Prove business isolation, graph serialization, cycle checks, nested units/costs, and legacy-data preservation.
4. Extend existing stocked preps into the reusable-component selector, with linked expansion and full declaration provenance. Verify stock and historical cost invariants before made-to-order support.
5. Add linked bases and explicit version-update review, then made-to-order planning/completion with atomic raw allocation and excess handling. Verify shared sources, scaling and no double costs/deductions.
6. Add the food finished-stock bridge, then kit definition/cost preview. Confirm accounting and mixed-tax treatment before enabling assembly/sales.
7. Add reservations, assembly, cancellation, disassembly, returns and historical kit snapshots. Verify concurrency/retries, unavailable components, waste, expiry, costs and labels. Capture actual desktop/mobile popup results before release.

Decisions needing approval: pinned versus automatically updated base versions (pinned recommended); which fulfillment modes are exposed initially (stocked preps first recommended); whether independent duplication retains or detaches nested links; assemble-to-stock versus order assembly and the reservation trigger/expiry policy; recoverable disassembly rules and labor/overhead allocation; food inventory capitalization; and mixed-tax kit treatment. These are proposal decisions, not assumed approvals. Square and Production billing settings are outside every phase.
