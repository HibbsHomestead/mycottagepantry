# Five-tier draft — Cottage Mercantile

Status: **unpublished draft**. No live Square plans, checkout links, charges, annual prices, subscription moves, access restrictions or migrations were created. Existing customer access is unchanged because global commercial restrictions remain disabled. The central configuration is `src/lib/launch-plans.ts`; the admin portal's Plans & Access section shows the same cards and matrix.

## Five-tier comparison (proposed monthly USD per business oven)

| Plan               | Monthly | Users                | Scope                                                                                                               | Publication                     |
| ------------------ | ------: | -------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Free               |      $0 | 1                    | Small active catalog, complete costing, tracked-stock batches, standard labels, export                              | Draft                           |
| Mixing Bowl        |     $10 | 1                    | Complete solo bakery toolkit, plus basic handmade/resale product records, simple stock adjustments and manual sales | Draft                           |
| Baker’s Bench      |     $20 | 1                    | Mixing Bowl + advanced planning and reporting (needs refinement / not implemented)                                  | Draft                           |
| Cottage Kitchen    |     $30 | 5 total, incl. Owner | Baker’s Bench + invitations and shared access (not implemented / needs refinement)                                  | Draft                           |
| Cottage Mercantile |     $40 | 5 total, incl. Owner | Cottage Kitchen + complete resale, handmade production and advanced craft-material workflows                        | **Unpublished, not assignable** |

These prices supersede the earlier $25/$40 Baker’s Bench/Cottage Kitchen proposal and the $50 Cottage Mercantile proposal. No annual price is set. Each paid tier inherits every lower-tier capability (verified by an automated test). The name “Cottage Mercantile” is a working name and is edited in one place.

## Fifth-tier feature matrix

Status key: Implemented / Partial (needs refinement) / Not implemented. "Tested" refers to automated tests in this repository, not to a deployed end-to-end verification.

| Key                        | Capability                                                              | Tier(s)            | Usage limit                                  | Status          | Tests         | Dependencies / ongoing cost                           | Gap                                                              |
| -------------------------- | ----------------------------------------------------------------------- | ------------------ | -------------------------------------------- | --------------- | ------------- | ----------------------------------------------------- | ---------------------------------------------------------------- |
| `basicProductWorkflows`    | Handmade/resale product records, simple stock adjustments, manual sales | Mixing Bowl and up | None proposed                                | Implemented     | Tested        | Database                                              | Proposed lower-tier scope (see below)                            |
| `resaleMerchandise`        | Purchased merchandise & variants                                        | Mercantile         | None proposed                                | Partial         | Tested        | Database                                              | Variants are text fields; no parent/child model                  |
| `resalePackReceiving`      | Pack/case → sellable unit receiving                                     | Mercantile         | None proposed                                | Implemented     | Tested        | Database                                              | —                                                                |
| `resaleOpeningStock`       | Starting inventory with quantity/cost basis                             | Mercantile         | None proposed                                | Implemented     | Tested        | Database                                              | —                                                                |
| `resaleCostAndPrice`       | Purchase cost separate from selling price                               | Mercantile         | None proposed                                | Implemented     | Tested        | Database                                              | —                                                                |
| `resaleMovements`          | Movements, returns, adjustments                                         | Mercantile         | None proposed                                | Partial         | Tested        | Database                                              | Full refunds only; no partial refund or return-to-vendor         |
| `resalePurchasing`         | Receipt-line matching & purchasing links                                | Mercantile         | None proposed                                | Partial         | Tested        | Database                                              | Purchase orders are a placeholder tab                            |
| `fabricInventory`          | Fabric yardage, fractions, separate width                               | Mercantile         | None proposed                                | Implemented     | Tested        | Database                                              | —                                                                |
| `craftUnits`               | Compatible length/weight/count units                                    | Mercantile         | None proposed                                | Implemented     | Tested        | Database                                              | Fabric is length-only; others use verified conversions           |
| `yarnMeasurements`         | Yarn length and weight as separate measurements                         | Mercantile         | None proposed                                | Partial         | Partly tested | Database                                              | Import details only; no yarn stock logic                         |
| `materialLots`             | Color/pattern, lot/variant tracking                                     | Mercantile         | None proposed                                | Partial         | Partly tested | Database                                              | No dye lots for materials; lots never consumed                   |
| `storageLocations`         | Storage locations                                                       | Mercantile         | None proposed                                | Partial         | Partly tested | Database                                              | Free-text field; no per-location quantities                      |
| `materialRemnants`         | Pieces/remnants without double counting                                 | Mercantile         | None proposed                                | Implemented     | Tested        | Database                                              | —                                                                |
| `materialUsageHistory`     | Reorder & material-usage history                                        | Mercantile         | None proposed                                | Partial         | Not tested    | Database                                              | No material reorder workflow or usage-by-design report           |
| `handmadeDesigns`          | Designs / bills of materials                                            | Mercantile         | 100 lines per design (existing validation)   | Implemented     | Tested        | Database                                              | —                                                                |
| `handmadeCosting`          | Material, labor, packaging costing                                      | Mercantile         | None proposed                                | Implemented     | Tested        | Database                                              | —                                                                |
| `handmadeProduction`       | Production usage and waste                                              | Mercantile         | None proposed                                | Implemented     | Tested        | Database                                              | —                                                                |
| `finishedGoodsAdditions`   | Finished-goods additions                                                | Mercantile         | None proposed                                | Implemented     | Tested        | Database                                              | —                                                                |
| `handmadeProfitability`    | Pricing & profitability views                                           | Mercantile         | None proposed                                | Partial         | Partly tested | Database                                              | Reports don't separate workflows; variance uses food recipe cost |
| `craftResaleEntryAssist`   | Shared barcode & URL-assisted entry                                     | Mercantile         | Proposed per-oven import rate limit          | Implemented     | Tested        | In-browser scanning; server page fetching (compute)   | Barcode matches existing records only; no lookup database        |
| `crossTypeReceiptMatching` | Receipt matching across inventory types                                 | Mercantile         | Proposed monthly automatic-reading allowance | Implemented     | Tested        | Private Blobs storage; AI receipt reading per receipt | Reading is environment-gated                                     |
| `salesIntegration`         | Square sales integration                                                | Mercantile         | —                                            | Not implemented | Not tested    | Square OAuth/app review, webhooks                     | Placeholder only; Square sandbox is used for billing tests       |
| `activityReports`          | Bakery / handmade / resale activity reports                             | Mercantile         | —                                            | Not implemented | Not tested    | Database                                              | Reports never filter by workflow; valuation is ingredients only  |

"None proposed" means no small commercial count. It is **not** a promise of unlimited processing, storage or inventory; fair-use and resource safeguards require an approved operating-cost policy before publication. Eight of the 22 Mercantile capabilities are partial and two are not implemented, so the tier cannot be advertised as ready.

## Lower-tier proposal (approval needed — nothing removed)

- **Free:** keep handmade/resale product identity (name, SKU, price, photo). No sales, as in the existing Free scope.
- **Mixing Bowl and up:** keep basic handmade/resale products, simple finished-stock receive/adjust and manual sales so Mixing Bowl stays genuinely useful for mixed bakeries.
- **Cottage Mercantile:** the specialized workflows in the matrix (fabric/remnants, designs/BOM production, pack/case receiving, cross-type receipt matching, activity reports).

Today, every existing oven can use the craft, handmade and resale workflows. Free test ovens can as well, because the Free allowlist treats fabric actions as generic actions. This draft does not remove or reclassify any of that.

## Entitlement design (prepared, not enforced)

`netlify/lib/plan-feature-gates.ts` maps workspace API requests to stable feature keys, and `enforcePlanFeatures` is a no-op while restrictions are disabled. It covers:

- Add Item and `save` (materials, resale and handmade by stored record, so a forged body cannot hide a stored resale product).
- Bulk `import` per row.
- Receipt actions and uploads.
- `ingredientBarcode` and product-URL import.
- Fabric and remnant actions, `receive`/`adjust` and handmade `complete`.
- Sales and consignment actions, finance actions and label/PDF paths.

Refunds, returns, cancellations, reversals, reads and data export are always allowed, so history and legitimate corrections survive a plan change. Admin permissions are not consulted, which keeps them separate from subscription access. The unpublished plan is rejected by signup selection, billing evidence and entitlement checks.

Before enforcement:

1. Wire the gate into the workspace function, after membership and role checks. Load the stored row for `id`-based actions under tenant RLS.
2. Add an end-to-end test for each bypass path.
3. Replace the generic `inventory` gate for receipts and barcodes with per-line classification.

### Proposed downgrade behavior

When an oven leaves Mercantile:

- Keep every material, design, run, finished/resale item, remnant and ledger entry. Nothing is deleted or reclassified.
- Keep reading and export available.
- Allow completing or cancelling runs that have already started.
- Allow selling, refunding, counting and adjusting existing finished/resale stock down. Allow posting receipts that were already drafted.
- Block only new specialized records: new materials, designs, remnant splits and pack/case receipts.

## Billing and owner access

- No Square catalog plan, checkout link or charge exists for any tier.
- The fifth tier cannot be stored in billing, signup-draft or grant records. The existing database constraints allow only the four original IDs.
- The owner's complimentary grant is constrained to `cottage-kitchen` and remains unchanged.

**Approval requested:**

1. A new additive migration that adds `cottage-mercantile` to the allowed plan IDs for `workspace_billing`, `billing_attempts` and `complimentary_grants`. `registration_drafts` stays excluded while the tier is unpublished.
2. A new complimentary grant record moving the owner's oven to Cottage Mercantile. The existing Cottage Kitchen record is kept as history.

Neither change has been made.

## Cost considerations for the $40 price

- **Payment processing:** an earlier illustrative card + subscription-billing example (2.9% + $0.30 + 0.7%) gives about $0.66 / $1.02 / $1.38 / $1.74 per $10 / $20 / $30 / $40 charge. Square's actual subscription rates for this account have **not** been verified.
- **Mercantile-specific variable costs:**
  - AI receipt reading per receipt.
  - Private receipt and photo storage and egress, which accumulate even when an oven is inactive.
  - Server-side URL fetches.
  - Larger ledgers from remnants, variants and production runs.
  - Up to 5 identities.
  - More support for mixed inventory types.
- **Future cost and pricing risks:** Square sales integration would add webhook and compute costs and an app-review cost. At $40, Mercantile is only $10 above Cottage Kitchen while adding the most storage- and processing-heavy workflows. Measure per-oven receipt, photo and import volume in beta before confirming the price.
- **Safeguards to define before publication:**
  - A monthly automatic-receipt-reading allowance.
  - Photo and upload size and retention limits.
  - Import rate limits.
- For shared platform cost reserves, see the operating-cost model in [subscription-proposal.md](subscription-proposal.md).

## Publication checklist

The tier remains unpublished until all of the following are met:

- Every advertised capability is implemented and verified on a deployed preview.
- Partial items are completed or removed from the advertised list.
- The gates are wired and tested end to end.
- The migration and grant above are approved.
- Square billing is verified in sandbox.
- The operating-cost policy is approved.
