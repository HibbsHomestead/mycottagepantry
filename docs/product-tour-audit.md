# Product tour and pricing verification

## Preview

Open `/features` for the complete tour and `/pricing` for the four-card preview. Desktop presents Free, Mixing Bowl, Baker’s Bench and Cottage Kitchen in one row; tablets present two columns and phones one. Prices remain **$0 / $10 / $25 / $40 per month, USD per business workspace**, with one user in the first three and up to five total including Owner in Cottage Kitchen. There is no fifth tier or comparison-table layout. Mixing Bowl has a subtle purple treatment. Card headings, price/user rows, features and beta actions align across each desktop row.

The shared beta notice and FAQ preserve the unfinished Free scope, advanced upgrades, membership, stock-coverage and account-email limitations. Enrollment and payments remain closed. Pricing/entitlements are still a design proposal; no server entitlement gate was connected or existing workspace access restricted. The central source remains `src/lib/launch-plans.ts`, including the existing proposed Free 5/5/10 scope. No new counts, prices, billing products, subscriptions or migrations were introduced.

The tour follows six anchored sections with alternating real screens, specific benefits, three or four capabilities, a practical example and plan availability derived from the central feature configuration. Non-implemented central features resolve to “not yet available,” rather than a plan inclusion claim. The tour ends with one white-bread workflow example, the central four-plan summary, practical FAQs and beta/pricing actions. Screenshot dialogs have accessible titles/descriptions, Escape close, focus return and keyboard-scrollable full-resolution views.

## Feature availability audit

“Implemented” below means code and covered application behavior exist; it does not certify live account setup, every deployment or all source formats. Public-account isolation, signup, recovery and launch work remain in the existing account audit.

| Tour area | Verified implementation | Boundary / withheld claim | Evidence |
| --- | --- | --- | --- |
| Costing & pricing | Package prices, compatible units and explicit verified cross-category conversions; ingredient, packaging, labor, overhead and waste inputs; batch/per-yield costs and product pricing scenarios | No guessed density, automatic weight-volume equivalence or guaranteed profit | `domain.ts`, `costing.test.ts`, recipe/product forms and calculation tests; actual bread cost-detail screenshot |
| Pantry & inventory | Ingredients/packaging, manual vendor/source fields, receiving/adjustments, balances, ledger history, locations, thresholds and low-stock status | Editing a cost does not receive stock. Receipt ledger can retain lot/expiry metadata, but automatic lot selection/expiration allocation is unavailable. Free tracking limits and mixed-coverage controls are unfinished | `pantry-inventory.tsx`, workspace receiving/adjustment handler and `pantry-inventory.test.tsx`; actual Pantry screenshot |
| Recipes & products | Quantities, yield, canonical `instructions` Method; deterministic text/link extraction and editable import review; original source, optional additions, Pantry matching/conversion warnings; link existing or new products and explicit selling/output units | Review required, not every site/format supported; automatic PDF/image reading remains unavailable with AI deferred | `recipe-import.ts`, `recipe-source.ts`, `netlify/lib/recipe-import.ts`, review UI and product-link helpers/tests; actual recipe list and cost-detail Method |
| Import separation | The actual Best Crumble fixture retains six required ingredients, optional combined additions and five ordered Method steps. Tests cover nonstandard headings, wrapping, quantity-bearing prose, preparation words, ranges/unknowns and no supplied Method | No claim of perfect extraction or automatic repair of an owner's saved/approved recipe | Parser/extraction/review tests plus workspace draft save/reopen → approve → edit → refresh persistence regression |
| Individual production | Plans store recipe/date/count/output; completion scales inputs, reviews actual usage/output, records ledger movements and locks historical costs | Planning does not move stock. Current pending overview omits packaging and suppresses conversion failures; do not market a comprehensive stock-sufficiency promise. Ingredient completion and packaging treat `trackInventory=false` differently; safe mixed coverage remains a blocker. No coherent saved multi-batch plan | `workspace-app.tsx` planner/completion UI; transactional workspace `complete` branch; actual individual batch screenshot |
| Labels | Preset/custom layouts, bundled/uploaded fonts, logos/graphics, saved designs, supplier subingredients, declared allergens/review warnings, browser print and PDF export | User reviews finished-product order/allergens/local requirements; no legal compliance/certification claim. Free standard-layout subset remains under review | `label-studio.ts[x]`, font/export helpers and label tests; actual bread label editor screenshot |
| Finances & reports | Manual sales/expenses, recorded costs and estimated summaries; Tax Center preset/custom period filters, existing business reports and CSV exports | Not every generic report has date filtering; no prior-period comparison workflow, bank sync, live Square sync, tax filing or full accounting-suite claim. Totals depend on entered records/calculation basis | `finance.ts`, finance workspace, Tax Center/report components/tests; actual Tax Center screenshot |
| Export & plans | Existing CSV exports; export is proposed on every plan. Core solo-business workflow stays in Mixing Bowl | No enforced paid/free rollout; not enough verified advanced value yet for Baker’s Bench. Invitations/member administration unavailable | Central launch plan/feature configuration and tests; pricing FAQ |

## Screens and demonstration data

The six WebP files in `public/screenshots` were captured from the actual React workspace using `tests/workspace-fixture.ts` and deterministic `demoData()` records. The screenshot payload replaces the seed's business name, owner, address and email with explicit demonstration values; it does not request owner records. The bread label is a synthetic saved-design fixture opened in the real editor, avoiding auto-save writes. The cost view opens the real bread detail and cost breakdown; Finance opens the real Tax Center. Each image is labeled as demonstration data on the public page.

The connected example uses Homestyle White Bread throughout: flour purchase information → recorded four-loaf recipe → reviewed cost → existing single-loaf product relationship → explicit individual batch completion → separately recorded sales/expenses. These are supported transitions, not an assertion that linking/planning automatically posts a sale.

Capture reproduction: run Netlify dev on port 8889, then the screenshot-capture scenario in `tests/public-release.spec.ts`. Its workspace transport allows only mocked GETs with synthetic records. Convert the six `/tmp/cottage-{name}.png` files with Sharp to WebP. Never capture authenticated owner records or expose a production screenshot bypass.

## Checks performed for this revision

- TypeScript typecheck.
- Nine focused Vitest files covering public pages/central pricing, import classification/extraction/review, product links, labels, finance and inventory. The actual crumble persistence regression was also run through the actual workspace handler with mocked database operations. This checks the save/reopen/edit mapping, not deployed persistence or database policies.
- Playwright capture scenario against the real app and synthetic GET-only workspace responses; no record-changing request is allowed.
- Playwright public-route checks at **1440, 820 and 390 pixels** across home, Features, Pricing, help, signup, privacy, terms and the signed-out workspace entry. Verified all six screenshot assets load, no horizontal document overflow, no workspace data request, no deferred controls/old prices or checkout links, six section links, accessible screenshot open/Escape/focus return, exact four/two/one pricing columns and aligned desktop CTAs.
- Visually inspected desktop pricing, desktop/mobile tour and actual label/cost/finance screens. Browser captures are previews, not evidence of live auth, provider delivery or business mutation correctness.

Final exact counts and any remaining checks are recorded in `.netlify/results.md`. No build command was run; the platform performs its own build validation. No live emails, AI, shopping/provider searches, stock/finance changes, payments or DNS changes were performed.

## Claims withheld

AI; shopping comparison; live Square; tax filing; bank synchronization; automatic density conversions; certified/compliant labels; reliable imports from every website/cookbook; automatic image/PDF reading; comprehensive mixed-stock coverage; expiration/lot allocation; advanced saved multi-batch planning; period comparisons; email reminders; invitations/member administration or launch-ready shared accounts; unlimited resources, “Free forever,” testimonials, savings/profit guarantees and customer counts.

For the full business help-desk comparison, actual email limitations, owner setup and phased tests, see [Business help-desk proposal](business-help-desk-proposal.md). A connected inbound/outbound help desk is not advertised as existing.
