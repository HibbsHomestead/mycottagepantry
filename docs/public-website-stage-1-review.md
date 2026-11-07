# Public website Stage 1 review

Stage 1 corrected subscription and registration messaging while preserving the existing brand, pages and billing implementation. Stage 2 implementation has not started. The existing features tour received CTA wording corrections only.

## Verified pricing and readiness

The approved prices came from `src/lib/launch-plans.ts`, also used to calculate server checkout amounts. They are USD per business oven, monthly only.

| Tier | Approved monthly price | Current publication and availability |
| --- | --- | --- |
| Free | $0 | Account creation has a separate Free setup path. The proposed Free subscription scope is still a draft. |
| Mixing Bowl | $10 | Draft scope; paid purchase is unavailable. |
| Baker’s Bench | $20 | Draft scope; advanced planning and reporting additions are not launch-ready. |
| Cottage Kitchen | $30 | Draft scope; invitations and membership administration are not implemented. |
| Cottage Mercantile | $40 | Explicitly unpublished; omitted from public plan cards and signup choices. Its approved price is testable in Sandbox only. |

No annual prices, annual billing totals, trial, discount, cancellation promise or guarantee were added. The configuration defines no annual offering or implemented trial.

The Free proposal lists 5 active recipes, 5 active products, 10 active stock-tracked items and one user. Cost-only records are outside that stock-tracked count. Mixing Bowl and Baker’s Bench propose one user; Cottage Kitchen proposes five total users including the Owner. Paid proposals have no small recipe/product/inventory count limits. These counts and the displayed feature lists were identified as proposed scope rather than enforced public subscription entitlements. The code-level production Square release gate remains disabled. Existing ordinary ovens retain their access, while separate server checks continue to govern Square-billed test subscriptions.

## Discrepancies addressed and remaining release limits

The previous public site described registration as requiring no plan selection while signup displayed a paid-plan selector whose choice was never sent to signup or persisted. It also described Free limits as available and displayed an explicitly unpublished tier. The updated site uses View Plans for plan comparison and Get Started for account registration, identifies proposed limits, excludes the unpublished tier, and disables unavailable paid choices. It does not imply that a selection activates a subscription.

Account creation and business oven creation remain distinct. Identity signup is available, but the approved Terms and Privacy content and policy revision are empty. The existing server therefore blocks business oven creation. The homepage, pricing, signup, verification, setup, FAQ and footer copy disclose the applicable readiness limits. No policy, registration, billing, entitlement or database behavior was changed.

The source configuration still describes Free as a proposed plan while the separate registration implementation provides a Free setup path. Public messaging now explains this distinction; deciding the final subscription scope remains release work. Production checkout remains unavailable, and pricing pages offer comparison rather than purchase.

## Stage 2 capture list — pending approval

Capture the current approved application with deterministic sample records, after verifying each workflow. Review every capture for private information, account identifiers, credentials and tokens before publication. Use readable desktop screenshots, selected mobile views, descriptive alternative text, and an expandable viewer. Optimize approved assets and lazy-load media below the fold.

| Product-tour section | Required screenshot and useful close-up | Availability review |
| --- | --- | --- |
| Business overview | Approved dashboard with sample costs and activity; close-up of a useful business summary | Describe only the currently working overview. |
| Inventory | Ingredients, packaging, craft materials and supplies; close-up of purchasing units, receiving and stock history | Clearly distinguish available workflows from proposed tier scope. |
| Products and pricing | Approved product cards and detail view with the photo on the right; close-up of the approved editor’s costing summary | Retain existing calculations and tab layouts in the capture. |
| Recipes and production | Recipe breakdown, an individual planned batch, and reviewed completion | Do not claim advanced multi-batch planning or unverified mixed-stock coverage. |
| Handmade and resale | Approved handmade/resale product views, material costing, and received resale stock | Exclude unfinished variants, returns, purchasing, lots and reporting claims. Do not advertise the unpublished tier. |
| Label design | Current saved design with real sample fields and images in the approved Label Studio | Show actual saved typography, positions and rotations. |
| Label preview and printing | Read-only modal and its print settings; close-up of populated fields, physical dimensions and multi-label placement | Show the real same-tab workflow. Do not imply a confirmed physical print from dialog closure. |
| Purchasing and sales | Current receiving and recorded sale screens with sample records | Exclude unfinished purchase-order receiving and unavailable sales integrations. |
| Plan availability | Current pricing comparison and readiness explanation | Recheck source prices, scope and checkout release gates before capturing. |

## Optional walkthrough — unpublished shot list

No approved walkthrough recording was identified or published. A real 60–90 second recording is needed before adding the optional video section:

1. Show a sample material or ingredient and its recorded purchase units and cost (0–15 seconds).
2. Open a product and review its actual costing summary (15–30 seconds).
3. Show the matching approved production workflow with reviewed usage and output; record only a workflow confirmed to work with that sample product (30–50 seconds).
4. Open the assigned label preview, inspect populated fields and physical dimensions, and choose quantity/sheet settings (50–70 seconds).
5. Open and cancel the native print dialog, demonstrating that the same preview remains available (70–85 seconds).

Supply an approved recording, a representative poster image and synchronized captions. The eventual player must provide playback controls and must not autoplay with sound. If the complete materials-to-production workflow cannot be verified, keep this section unpublished and revise the shot list.
