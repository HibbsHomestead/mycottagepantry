# Handmade goods for Cottage Kitchen — design proposal

Status: **proposed, not implemented or advertised as available**. Cottage Kitchen remains **$40/month per business workspace, up to five total users including Owner**. This document does not change the central plan configuration, active subscriptions, existing food data or public website claims. Only the separate Pantry navigation change is implemented in this revision.

## Current implementation and gaps

| Area | Exists now | Required new work |
| --- | --- | --- |
| Products | Shared workspace products with optional normalized `recipe_id`, packaging links and extensible JSON; existing unlinked products are permitted | Explicit food/handmade type, manual cost basis, variants and optional craft-pattern relationship |
| Ingredients / stock | `ingredients` has normalized quantity/cost; ingredient conversions, ledger, lots and vendor records; receiving/adjustment safeguards | Separate non-food materials/tools, length/area units, material-specific package and lot contents, private photos and typed material movements |
| Specifications | Recipes and normalized `recipe_lines` reference ingredients; imports preserve food Method/source | Separate project patterns, revisions, material and packaging lines; no recipe renaming or shared food ingredient list |
| Production | Batches require `recipe_id`; completion uses actual inputs/output, locked costs, ledger and journal entries | Separate craft runs, actual material use/returns/waste, variant output and finished-item inventory |
| Costing | `domain.ts` validates numeric values, explicit conversions, packaging, labor, overhead/waste and pricing calculations | Extract neutral pure cost components; keep existing food adapters unchanged. Current units cover mass/volume/count, not length/area; custom unit definitions currently support count only |
| Sales / finance | Manual entries, tax and cost snapshots, balanced journals and exports | Existing `recordSale` still expects recipe costing (or a completed recipe run); an unlinked handmade product cannot be assumed to complete the sale path. Add an explicit manual/unknown cost source, craft stock allocation and food/handmade report dimensions |
| Access / plans | Membership/role enforcement, workspace ownership, forced RLS and composite tenant keys; proposed entitlements exist but are not wired to active subscriptions | Future server-authorized handmade-workflow capability for Cottage Kitchen, separate from product type, membership role and billing state |

Existing `batch_plans`, `batch_plan_lines`, `batch_usage` and `lots` are foundational entities, not proof of advanced project planning or complete lot allocation. Product variants and dedicated craft materials/patterns/runs do not exist. No claim of finished-goods stock management for crafts is made today.

## Proposed schema

Use Netlify Database for all structured records; private Netlify Blobs for validated photos. Every table includes `business_id`, opaque ID, creation/update actor and timestamps, composite `(business_id, id)` uniqueness, forced RLS and workspace-scoped foreign keys. Client-provided IDs never prove access. Monetary calculations need explicit currency, decimal precision and rounding policy; quantities use decimal numeric fields, never floating-point ledger balances.

| Entity | Proposed fields and invariants |
| --- | --- |
| `products` extension | Nullable, checked `product_type` (`food` / `handmade`), optional `craft_pattern_id`, explicit manual cost source/status. Keep `recipe_id` and existing food semantics. New typed food products may use a recipe; new handmade products cannot reference a food recipe. Basic handmade records may exist without any pattern. Never force food ingredient/allergen/expiry fields for handmade products |
| `craft_materials` | Name, category, vendor reference, SKU/barcode, private photo asset reference, `kind=consumable/tool`, stock/use unit, reorder threshold, optional location, active/archive state, attributes (color, fiber/fabric, dimensions). Only consumables can appear on consumption lines. Tools have reusable quantities/availability, not per-project consumption |
| `craft_material_packages` | Material, supplier/package SKU, purchase quantity/unit, **explicit contents quantity/unit**, quoted price/currency, evidence/source, verification actor/time and effective date. A skein/roll/bundle has no universal conversion factor. Changes create versions; completed receipts/runs reference the version used |
| `craft_material_conversions` | Material-specific from/to units and quantities, category, verified flag/actor/date and evidence. Cross-category weight/length needs explicit material-specific evidence; missing conversions block dependent costs/completion. Lot-specific contents override general package assumptions |
| `craft_material_receipts/lots` | Material, supplier/reference, purchase quantity/unit, measured contents, color/dye lot, actual amount/currency, explicit owner-reviewed FX basis if needed, book-currency unit cost, received date. No automatic FX provider. Missing price/conversion remains unknown rather than zero |
| `craft_material_movements` | Material/optional lot, signed quantity, use unit, book-value amount/unit-cost snapshot, reason, source operation/run and actor. Types: receipt, adjustment, issue, return, waste, reversal. Unique operation/line IDs prevent duplicates. Balance is supported by immutable movements and a transactionally maintained balance |
| `craft_tools` or tool-specific details | Reusable tool/equipment identity, quantity, photo, reference purchase cost and optional availability. A pattern references required tools separately. No per-run deduction or automatic depreciation. Equipment accounting/depreciation is a separately reviewed scope |
| `craft_patterns` + immutable revisions | Name, instructions/ordered groups, expected output quantity/unit, active labor minutes/rate, overhead method/value, optional waste method/allowance, source URL/reference notes and original reference when supplied. Published revisions retain material lines and costing inputs for reproducibility |
| `craft_pattern_material_lines` | Pattern revision, **craft material** FK, required quantity/unit, optional variant-specific override and optionality. Reusable tools prohibited. Explicitly separate required versus optional additions |
| `craft_pattern_packaging_lines` | Pattern revision and approved workspace packaging reference, quantity/unit. Existing food packaging records may be linked through the existing packaging service after `usedAs=packaging` validation; craft materials cannot masquerade as food ingredients |
| `product_variants` | Product, size/color/attributes, unique workspace SKU where supplied, active/archive state, output unit, pattern revision and explicit material/packaging overrides. A default variant can represent an unvaried item. No automatic Cartesian variant generation or assumption of identical inputs |
| `craft_runs` + usage/output lines | Planned/running/completed/cancelled status, product/variant, pattern revision, planned count/output, planned date, actual labor, material issue/return/waste, actual finished/rejected output, actor and immutable cost snapshot. Planning alone has no movements or financial posting |
| `finished_item_movements/balances` | Product **variant**, source completed run, quantity, valuation snapshot, movement type and source sale/refund/reversal. Trace units sold to available run output; prevent overselling and cross-workspace links |
| `craft_operations` | Unique `(business_id, operation_id)` and request digest, action/result references for durable idempotency. Same key/body returns original result; changed body with same key is rejected |

For existing unlinked products, type must be reviewed rather than guessed from a name. A future additive nullable column can preserve old records untouched; a legacy food read adapter preserves the current behavior while an owner-reviewed classification/backfill is prepared. Do not bulk classify existing records in this task. New typed products choose food or handmade explicitly; unresolved legacy records remain readable/exportable and must be classified deliberately before a specialized craft operation.

Photos need membership-authorized upload/download, byte/type validation, size limits, private keys and no public owner-data URLs. Archives retain referenced revisions, variants and movements. Historical batches, sales, costing and links must not break when a material/pattern/product is archived.

## Material units and variants

Extend a **craft-scoped** registry with length (m/cm/yd/in) and, if approved, area (m²/cm²/yd²) while leaving the existing food unit registry and tests unchanged. Reuse the verified-conversion algorithm through typed adapters; do not simply add “skein = each” globally. A supplier's 100 g skein with 200 m contents and another 100 g skein with 150 m contents are distinct package/lot definitions. A kilogram does not imply a length. Rolls require usable length/width as relevant, not assumed fabric area. Verify what is actually measured, including partial packages and remnant quantities.

Example: a small blue crochet item consumes 160 m of one yarn/dye lot; a larger size consumes 240 m, and a different yarn/color may change both length and price. Each variant has its own resolved specification, cost scenario, SKU and finished stock. A color change does not silently reuse another material's conversion. A pattern edit does not rewrite a completed run's revision, actual usage or cost snapshot.

## Costing and maker-facing workflow

Use maker terms: **Materials → Project patterns → Products & variants → Project runs → Finished stock → Sales**. Keep food Recipes and its ingredients/labels intact.

Show a breakdown of material cost, packaging, planned active labor, overhead and optional waste allowance, then total estimated production cost and cost per expected finished item. A zero-rate input is a deliberate valid value; unknown quantities/rates/currencies remain visibly unknown and cannot produce a falsely complete total. Actual project costing replaces planned quantities with reviewed actuals without rewriting earlier runs.

- Material cost = sum of verified use quantity × current/receipt unit cost; account for returns and waste once.
- Packaging is counted once using its recorded quantity and verified units; do not charge the same wrapping both on a pattern and again on the product.
- Labor = active minutes / 60 × rate. Waiting/drying time is not silently active labor.
- Overhead method is explicit: per run, per finished item or a reviewed percentage basis. Display its basis.
- Waste allowance is a pricing estimate; it is not automatically added to physical usage and then charged again at completion. When actual usage already includes scrap, do not add the same scrap twice.
- `markup = (selling revenue − estimated cost) / estimated cost`; `margin = (selling revenue − estimated cost) / selling revenue`. Handle zero denominators honestly. Tax collected stays separate from revenue. These are estimated contribution/pricing measures, not guaranteed net business profit.

Reuse validated pure cost/conversion/numeric/rounding services, with food-specific labels and recipe traversal isolated in the existing adapters. Do not pass non-food material IDs through `recipe_lines` or use `resolveLabelData` to generate food declarations for a handmade product. Craft hangtags could reuse generic layout/print primitives later, with all food bindings disabled and their own reviewed scope; no new safety, certification or legal claims.

## Production and inventory safeguards

1. **Plan:** choose product variant, pattern revision, planned count/output and optional date. Resolve material/packaging quantities and estimate cost. Show required tools separately. No stock deduction, journal or finished-stock addition occurs.
2. **Review actuals:** enter actual material usage, selected dye lots, usable returns/remnants, unrecoverable scrap/waste, actual labor and accepted/rejected output. Use a net-consumption flow initially: no earlier automatic issue deduction. Track gross use, returned amount and scrap in separate fields with an explicit interpretation, rejecting contradictory totals. An eventual issue/return flow must be a separate state model so the same material is not deducted at issue and completion.
3. **Validate:** current membership + role + server-owned handmade entitlement; all linked records in the same business; pattern/material kind; verified units; nonnegative finite values; output relationship; package/lot availability. Never silently substitute another color, dye lot, material or partial stock coverage. Insufficient stock blocks the whole transaction; an adjustment/receipt is a separate explained action.
4. **Complete atomically:** lock operation, run, material/packaging lots/balances and output variants in a consistent order. Check idempotency and non-completed status. Record material/packaging movements, explicit scrap/returns, finished output, valuation, immutable actual cost snapshot and audit entries in one transaction. A retry returns the original outcome. Any failure rolls back all effects.
5. **Sell:** allocate only finished variant stock with its locked cost. Selling the item **does not consume yarn/fabric/packaging again**. Basic manual sales without stock tracking remain possible, with clearly distinguished manual/unknown cost basis and no invented stock movement. Inventory-tracked sales require sufficient actual output; no silent negative balance.
6. **Correct:** completed runs/movements stay immutable. Use linked, reasoned reversal/correction operations with their own idempotency keys; prevent reversing output already sold without a reviewed return/reconciliation process. A refund does not automatically return stock: explicit inspected saleable return versus damaged item is required. Cancellation of a mere plan has no inventory effect.

## Finance and reporting proposal

Use the same business workspace, tax configuration, sales/expense services and journal-balance safeguards. Add a product/business-line dimension (`food` / `handmade`, with legacy unclassified records visible) to sales, eligible material expenses and reports. Snapshot classification and variant/run cost on the transaction so later recategorization does not rewrite historical reports. General expenses need optional business-line allocation or a visible shared/unallocated category; no guessed split.

The existing food completion flow posts Ingredient/Packaging COGS and the sale uses cost snapshots in summaries. It does **not** provide craft finished-item asset transfers. Preserve that food behavior; do not reuse its posting branch unchanged for crafts.

Proposed craft inventory basis, for accounting review:

- Purchase materials: debit materials inventory, credit cash/payable once. A linked purchase expense/receipt must not post the same acquisition twice.
- Completion: move actual eligible material/packaging book value to finished-goods inventory. Explicit abnormal waste is expensed once under the approved policy, not both included in finished stock and expensed. Returned remnants retain source cost. Record estimated imputed labor/overhead separately for costing; never invent payroll/overhead journal expenses from pricing estimates. Capitalization of actual labor/overhead needs a separately reviewed accounting policy.
- Sale: debit COGS / credit finished-goods inventory for the allocated book value once, plus the usual sale/revenue/tax entries. No second raw-material deduction or consumption expense.
- Reports distinguish **estimated full production cost/profitability** from **posted book COGS/expenses**. Do not add snapshot COGS and the same posted COGS or inventory-purchase expense twice. Reconcile the material/finished ledgers to asset balances and cost allocation totals.

Manual sales for unlinked products need explicit known/manual/unknown cost handling before this is a complete workflow. Unknown cost must show incomplete profitability, never zero-cost profit. Tax categories for crafts must be explicitly configured/reviewed; never inherit a food exemption just because the workspace also sells food.

## Plan and permission proposal

Basic food/handmade product identity, SKU, price, photo and **manual sales** should remain flexible on every plan; choosing “handmade” must not itself require an upgrade. Specialized materials stock, craft-pattern costing, project runs and craft finished-stock workflows are proposed **Cottage Kitchen-only** capabilities. Require both authorized workspace role and server-owned entitlement for specialized mutations, APIs/imports/jobs/files. Never authorize from a frontend plan name or client product type. Essential warnings, security and export remain available on every plan.

The existing Free commercial proposal excluded sales/expense records and reports. This request changes the proposed direction for **basic manual sales**; that should be reviewed as a distinct capability rather than opening all financial reports or silently changing the current matrix. No configuration or restrictions were changed in this task. The prepared entitlement helper is not a live subscription system; subscription storage/activation remains separate approved work.

On a future downgrade, retain patterns/materials/runs, historical reading, corrections needed for data integrity and exports; do not delete or auto-archive data. Define how an already-started run is completed/cancelled, and how already-produced stock can be sold/reconciled, **before** enforcing new gates. Prefer permitting completion/reversal of existing committed work while blocking new specialized plans. This needs explicit owner review, not an automatic subscription migration.

## Implementation phases and migration steps — after approval

1. Review product typing of legacy unlinked records, manual sale cost handling, scope/roles/entitlements, craft unit definitions and the accounting/valuation/downgrade policies above. Keep the feature internal and off public marketing.
2. Add new Drizzle entities and a **new additive migration**, retaining every already-applied migration unchanged. Add nullable product references/type without automatic customer-data reclassification. Composite FKs, forced RLS, check constraints, balance/immutability triggers and operation uniqueness must accompany each table, not arrive in a later hardening phase. Use private Netlify Blobs for photos.
3. In isolated fixtures/preview only, add basic typed products/manual sales and pure craft costing adapters; regression-test food behavior unchanged. Add material receipt/conversion/movement services and then patterns/variants. Do not turn existing ingredients into craft materials.
4. Implement actual production, finished-stock allocation, reviewed journal mappings, financial dimensions and exports. Add reconciliation tools and immutable correction operations. Only migrate/backfill owner-selected legacy records using an idempotent dry-run proposal with counts, cross-links, backup/restore test and rollback/forward-correction plan. Do not rewrite existing cost snapshots, stock or posted entries.
5. Run isolation, concurrency, accounting and end-to-end tests; owner reviews an invite-only preview. Add a centrally defined planned capability and later activate it only after the server subscription policy is approved. Publish availability only after implementation and deployed verification. No price change or billing activation is required by this design.

No handmade migration was created or applied here, and no handmade runtime gate was enabled.

## Proposed tests

- Existing food purchase → recipe → batch → sale/refund and label ingredient/allergen rendering remain identical. Non-food material IDs are rejected in food recipes/declarations at both API and relational layers, including forged JSON links.
- Products/manual sales on all plans; unlinked known/unknown manual costs; correct incomplete-profit display; server denial of specialized operations for other plans and unauthorized roles; removed members/cross-business IDs/files denied; historical export preserved on downgrade.
- Different skein contents, partial rolls, verified mass-to-length basis, missing basis, lot override, currency/FX unknowns, precision, returns and variants with different materials/amounts. Tools never deducted. Missing data never turns into zero cost.
- Every costing component, markup versus margin, tax exclusion, zero denominators, scaling/output units, overhead basis and waste included exactly once. Food conversion results must not change when length/area support is added.
- Planning makes zero stock/journal changes. Completion requires full stock coverage; simultaneous runs cannot overspend one lot. Repeated/concurrent completion, timeout/retry and changed-body idempotency keys cannot duplicate stock, costs or journals. Failure halfway rolls back everything.
- Variant finished stock increases only at completion, decreases once on sale, and never re-consumes raw materials. Overselling, lot mismatches, inactive references and reversing sold output are handled explicitly. Refund/physical-return actions remain distinct.
- Material purchases, capitalization, waste, COGS and linked expense records reconcile without duplicate expenses. Estimated cost summaries and posted accounting bases stay clearly distinct. Food/handmade/shared report totals and exports reconcile to the full business total.
- Archived records preserve references/costing; revision edits cannot rewrite completed history; private photos resist unauthorized access, forged MIME/type and oversize uploads. Restore/reconcile an isolated migration fixture before any production rollout.

These are future acceptance tests, not claims of implemented handmade functionality.
