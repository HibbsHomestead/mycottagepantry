# Public website and subscription preview

## Preview

Public routes are `/`, `/features`, `/pricing`, `/help`, `/login`, `/signup`, `/privacy` and `/terms`. `/workspace` checks the existing Identity session. Marketing pages do not fetch business records; existing signed-in users get an Open workspace action. The warm neutral/logo-purple design uses real, clearly labeled demonstration screenshots.

`/pricing` previews proposed Free ($0) and approved paid names/prices: Mixing Bowl ($10), Baker’s Bench ($25), Cottage Kitchen ($40), monthly USD per business workspace. Free/Mixing Bowl/Baker’s Bench include one user; Cottage Kitchen proposes up to five total including Owner. No annual price, extra-seat fee, perpetual-free promise, unlimited claim or launch trial is presented. Free proposes no credit card. Beta collection, public signup and payments remain closed. Legal pages require reviewed content and a verified support address is still needed. `mycottagepantry.com` is the intended domain, not a verified DNS/TLS/email claim.

The prior comparison is withdrawn. Mixing Bowl contains the entire core solo-business workflow: costing, reviewed recipe import, products, inventory, individual production, full labels, sales/expenses and implemented reports/exports. No small paid recipe/product/inventory limits are proposed. Data export, essential account mail, warnings, privacy and security belong on every plan. AI and shopping remain independently deferred; neither appears as a paid entitlement.

## Product tour and four-card pricing update

See [the product-tour availability audit](product-tour-audit.md) for the six real demonstration screens, central plan availability, responsive checks and claims withheld. Pricing now uses four equal desktop cards, two on tablets and one on phones; detailed readiness caveats live in a shared notice and FAQ. The former five-column table was removed without changing plan decisions. See [the business help-desk proposal](business-help-desk-proposal.md) for the revised support architecture; no email service or DNS cutover is active.

## Feature availability and commercial design

See the [complete revised proposal](subscription-proposal.md) for the exact Free matrix, evidence, limits/concurrency design, active/archive semantics, safe stock coverage, downgrade/retention rules and operating-cost scenarios.

| Area                                   | Implemented                                                                                | Missing/refinement                                                                       | Proposal                                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Costing, recipes, product links/import | Deterministic reviewed import, canonical Method, full cost inputs and verified conversions | Public-account launch controls                                                           | Complete paid core; manual costing/linking also proposed for Free                  |
| Inventory/reorder                      | Receiving, adjustments, balances, stock ledger/history, low-stock information              | Free tracking counts and full batch coverage                                             | Included in Mixing Bowl; 10 tracked-item Free proposal, cost-only records excluded |
| Individual production                  | Scheduled/completed runs, transactional actual stock/cost snapshots                        | Ingredient/packaging tracking treatment inconsistent; no explicit partial-coverage guard | Paid core; refine coverage before limited Free launch                              |
| Labels                                 | Editor, logos, fonts, saved designs, print/PDF                                             | Free standard-layout subset requires review                                              | Full tool in Mixing Bowl; standard customization in Free proposal                  |
| Sales/expenses/reports                 | Records, basic profitability and existing business/tax CSV reports                         | No tax filing or live Square synchronization                                             | Paid core; historical read/export preserved on proposed downgrades                 |
| Advanced planning                      | Existing independent run list and rudimentary pending ingredient overview                  | No coherent saved plan; overview omits packaging and drops conversion errors             | Existing tools stay core; Baker’s Bench additions need refinement                  |
| Period comparisons/reminders           | No coherent comparison workflow or application mail scheduler                              | Design, implementation and testing                                                       | Not launch-ready; no reminder availability advertised                              |
| Collaboration                          | Existing role foundations only                                                             | Invitations/member admin, scoped permissions, multi-membership and revocation proof      | Cottage Kitchen not ready for purchase                                             |
| Free limits/archives                   | No enforcement/archive lifecycle                                                           | Transactional count safety, historical references, correction at cap, stock coverage     | Proposal only; no existing access changes                                          |
| Essential mail/export/security         | Provider mechanisms, CSV/JSON, tenant controls                                             | Delivered-mail and real two-tenant proof, complete backup/restore                        | All plans, launch review required                                                  |

Baker’s Bench currently lacks enough verified incremental value for launch. Preserve its price as a proposal, rather than removing core functionality from Mixing Bowl. Do not offer Cottage Kitchen until collaboration actually works.

## Central configuration and release safety

`src/lib/launch-plans.ts` centralizes names/prices/seats, proposed record limits, feature scope and readiness. `null` paid counts mean no small commercial cap proposed, not infinite resources. The server-only evaluator in `netlify/lib/entitlements.ts` remains **unwired** to the workspace API. No subscription records, trusted assignments, provider webhooks, active count limits or billing exist. Its historical-read/export rules require independent membership/role checks; a plan label is never authorization. Legacy trial validation in this unused evaluator is not a launch trial offer.

No billing products, checkout, subscriptions, data writes, restrictions, archival actions, inventory/accounting changes or migrations were enabled. All existing workspace data/access stayed intact. Deferred AI/shopping adapters and independent server guards stayed in place.

## Account setup and code work

**Owner/account side:** review Free scope, downgrade and retention; verify actual platform/auth/mail costs; provide reviewed legal content and support address; verify domain/TLS, Identity verification/recovery URLs and sender. Approve real delivery tests or any later paid service separately. Hiding shopping does not cancel any external subscription.

**Code after review:** resolve authentication/onboarding, tenant isolation, recovery/abuse controls, scoped permissions, Free active/archive/count/coverage rules, complete export/restore and lifecycle controls. Refine advanced planning/reporting before selling it; implement invitations later. See [account phases](accounts-and-launch-audit.md), [email audit](email-scope.md), and [integration audit](integrations-audit.md).

The normal Netlify pipeline validates/deploys source. A build is not proof of provider connectivity, billing, email delivery, safe Free inventory coverage or public-signup readiness.
