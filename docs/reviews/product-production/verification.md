# Product production and kit assembly

The approved implementation uses whole selling packages as output, verified mapping to the linked recipe yield, and an explicit compound-prep path. It introduces no reservation, in-progress, completed-run reversal/disassembly, kit sales, or zero-output total-loss workflow.

## Posting and history

Drafts, scheduling, and cancellation of uncompleted runs create no stock movements or journals. Scheduling pins the selected product, package/output mapping, recipe/base graph or kit components, ingredient metadata, and reviewed requirements. A later completion uses that definition and current stock valuation. Inputs are aggregated before actual-use overrides. Finished component stock is consumed by assembly; component recipes and their raw ingredients are never posted again.

Completion runs inside the existing serialized workspace transaction. Stable IDs and payload hashes make matching retries return the prior result; changed actuals after completion are rejected. Deterministic ledger/usage/journal IDs and immutable usage records provide additional protection. Food and kit stock now use the existing deferred ledger/balance guard. Shortages and failures roll back all intermediate writes. No negative-stock policy was relaxed.

New food production receives ledger-backed finished packages and capitalizes consumed stock plus configured allocations. Subsequent food sales consume those packages at their weighted-average stock cost. This is prospective only. Existing completed production and sales are never recalculated or reposted; no opening stock is inferred. Nonzero pre-existing food balances require review before enabling the bridge. Stock with a different package basis cannot be silently mixed.

Legacy recipe-based runs retain their original references. Existing scheduled plans may continue the old policy until their product has switched to finished stock; after that they require explicit review into a product run. Saving a replacement draft leaves the original scheduled plan untouched. Confirming the replacement cancels the original without moving stock and records the replacement link. Shared-recipe relationships are not guessed. Completed legacy rows remain untouched.

Receipt lot/expiry metadata and ingredient/allergen source definitions are retained in snapshots. There is still no lot-selection/expiry-allocation production chain; this change does not claim lot-level traceability.

## Verification

The six targeted Vitest suites passed 52 tests: production requirements, production database/API behavior, existing finished-product workflows, kit costing, kit details, and kit cost cards. Database/API tests applied the migration chain to isolated PGlite fixtures and used the real workspace handler with forced tenant policies. No customer records were used.

Coverage included fractional recipe scaling; explicit product selection for shared recipes; verified physical and named-yield mappings; missing recipe/yield/conversion; repeated ingredient aggregation; prepared stock instead of its raw inputs; packaging and labor; draft save/cancel without movements; output/waste and actual input recording; pinned definitions after edits; finished food receipt and sale COGS; kit stock consumption and carrying costs; shortages including rollback after an earlier input movement; matching/conflicting completion retries; explicit legacy-plan replacement; tenant isolation; immutable usage; and database food/kit balance enforcement. Three selling packages cost $6.60 in the fixture; assembling one kit from two of those packages, outer packaging, and assembly labor cost $6.40 without re-consuming flour or component bags.

Nine Chromium browser cases passed across the production-specific and shared-popup suites. Product and kit review, shortages, repeated opening, actual dialog/control bounds, scrolling, and phone (390px), tablet (820px), and desktop (1440px) were checked. Dashboard, Quick Add, Production, Product Details, and Kit Details reached the same product-based workflow. Confirming a new plan kept the dialog open for actual-output review and final production confirmation. Broader shared-popup cases retained the existing position/scroll/focus regression coverage. All workspace writes in those browser tests were intercepted; database posting behavior was verified separately.

TypeScript and targeted ESLint passed. The three large legacy modules retained their baseline lint rule totals (89 existing errors and two warnings); no new findings were introduced in that comparison. No build command or production deployment was run. Physical iPhone/Safari, native keyboard, pinch zoom, and Home Screen behavior were not reverified in this run. The previously confirmed shared popup positioning source was not changed.

## Migrations

Only new forward migrations were added, after the existing applied chain: product-targeted runs with nullable recipe references and tenant-scoped product foreign keys; normalized usage references; immutable usage; preservation of the existing usage index; and prospective food/kit ledger guard coverage. Drizzle schema and generated snapshots were synchronized. No applied migration was edited, renamed, or deleted. Managed deployment applies these migrations; local database tests do not establish a production migration or deployment.
