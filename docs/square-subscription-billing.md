# Cottage Pantry subscription billing with Square

> Historical audit of the initial Sandbox implementation. Connection, Production synchronization and setup details below were superseded by [the current OAuth/setup guide](./square-oauth-setup.md) and [stage checkpoints](./signup-billing-stages.md). Production checkout remains disabled.

Status: built and mock-tested for Square **Sandbox**. Production checkout stays switched off in code. No Square plans, customers, subscriptions or charges were created, and no live Sandbox request has been run, because this project has no Square credentials yet.

Platform billing is separate from any customer's Square sales-sync connection. It writes nothing to bakery ledgers, sales, stock or merchandise tax settings.

## 1. Audit: what already existed and what is new

| Area | Before this work | Now |
| --- | --- | --- |
| Square application | None recorded. The repo and hosting settings contain no Square application name or ID, and no credentials. | Unchanged. The owner must create or identify the app (see §2). |
| Sandbox adapter | Read-only lookups, Sandbox-only flag, signature verifier | Kept. New `netlify/lib/square-billing.ts` adds a per-environment client. Production can only make read-only seller/location checks until the release flag is approved. |
| Plan mappings | Prices in `launch-plans.ts` only | `billing_plan_mappings` table plus a Sandbox "create or reuse plans" action. It searches the catalog first and uses fixed idempotency keys. Amount, USD and MONTHLY are verified for every plan. |
| Checkout | None (`checkoutEnabled: false`) | Square-hosted subscription checkout, created on the server for the Oven's billing owner. Price and plan come only from server config. Recurring-charge consent is versioned and hashed, and the database blocks later edits to it. |
| Billing owner | None | `workspace_billing.billing_owner_identity`. The first Owner who subscribes becomes it; other team members see who manages billing and cannot start a second subscription. |
| Webhooks | Signed inbox only (references, no payload) | Same inbox, now tagged by environment. Processing rebuilds state from fresh Square reads, never from event order. |
| Reconciliation | Hourly job that only marked events "needs review" | The same hourly job now processes the inbox, sweeps open checkouts and live subscriptions for missed events, marks expired checkouts abandoned and disables their links. |
| Correlation | Not implemented | Checkout order → completed payment → exactly one Square customer → exactly one unclaimed subscription with the same plan variation and location. Any ambiguity goes to review. Email is never used. |
| Paid access | Unused evaluator | A month counts as paid only when a PAID, USD, fully settled, undisputed invoice for that subscription is at or above the plan price. ACTIVE alone grants nothing. Invoices are stored in `billing_invoices`. |
| Entitlements | Classifier prepared, not enforced | Enforced on the server, inside the workspace API, for Ovens billed through Square. Classification uses the stored record, so a forged request body can't bypass it. Reads, exports, refunds, returns and reversals are always allowed. |
| Duplicate protection | Unique index on open checkouts | Kept, plus a per-Oven advisory lock, reuse of the open link, refusal when a subscription already exists, and a unique index allowing one live subscription per Oven. |
| Customer UI | Read-only status page | Settings → Subscription & Billing: current plan, access, price, cadence, confirmed paid-through, renewal, pending state, billing owner, consent, checkout, and cancel at period end. Also a five-tier comparison on /pricing and a plan choice in signup. |
| Admin UI | Billing records list | Adds a connection panel per environment: Not verified / Verified / Verification failed, seller, location, currency, country, last check, missing setting *names*, errors. Also plan mappings, and audited "Verify connection" and "Create or reuse Sandbox plans" buttons. |
| Complimentary access | Ovens with no billing record were unrestricted | Unchanged. The Hibbs Homestead Market Oven has no billing record and keeps full access, with no subscription or charge. This is separate from platform-admin permissions. Checkout is refused for complimentary Ovens. |

Migration `20261117010000_add_square_subscription_billing` only adds things and widens existing limits: new tables, columns and check constraints, allowing `cottage-mercantile`, forced row-level security, and a trigger that makes consent permanent. No existing data changes.

## 2. Owner setup actions (do not paste secrets into chat or app forms)

1. **Square Developer app.** At developer.squareup.com, signed in as Hibbs Homestead Market, create one app (suggested name: *Cottage Pantry Platform Billing*) or choose an existing one used for nothing else. Do not reuse an app you plan to use for customer sales sync. Record the app name and ID in your own notes; the app never needs them.
2. **Sandbox seller and location.** In the app's Sandbox test account, note the location ID and confirm it is a US location using USD.
3. **Netlify environment variables.** Set these as secret, Functions-scoped values, in the **Deploy Preview** context only (Sandbox runs only in private test deployments):
   - `REGISTRATION_PRIVATE_TESTS_ENABLED=true`
   - `SQUARE_SANDBOX_ENABLED=true`
   - `SQUARE_SANDBOX_ACCESS_TOKEN` (Sandbox access token)
   - `SQUARE_SANDBOX_API_VERSION` (the Square API version shown in the app, e.g. `2026-01-22`)
   - `SQUARE_SANDBOX_LOCATION_ID`
   - `SQUARE_SANDBOX_MERCHANT_ID`
   - `SQUARE_SANDBOX_WEBHOOK_SIGNATURE_KEY`
   - `SQUARE_SANDBOX_WEBHOOK_URL`: the exact URL from step 4
4. **Sandbox webhook.** In the app's Webhooks → Sandbox, add `https://<your-deploy-preview-host>/api/square/sandbox/webhook`. Subscribe to `subscription.created`, `subscription.updated`, `invoice.payment_made`, `invoice.scheduled_charge_failed`, `invoice.updated`, `payment.updated`, `refund.updated`, `dispute.created`. Copy its signature key into step 3.
5. **Verify.** In the admin portal → Billing, choose **Verify connection** (Sandbox), then **Create or reuse Sandbox plans**. The panel must show *Verified* plus your seller and location, and four mappings at $10/$20/$30/$40 MONTHLY.
6. **Production (later, only after approval §6).** Use the `SQUARE_PRODUCTION_*` names, plus `SQUARE_PRODUCTION_BILLING_ENABLED`, in the **Production** context. A production webhook endpoint still has to be built, and the code-level release flag must be approved. Settings alone never turn production on.

Account items to confirm: an active US location; card processing enabled; Subscriptions available to the account; seller currency USD.

## 3. Test results

Run in this environment (mock only, no live Square calls):

- `src/lib/square-billing.test.ts`, 23 passed. Covers: approved amounts (1000/2000/3000/4000 cents); partial settings never enable checkout; production stays off with every setting present; signature checks (exact URL and raw body, wrong key/URL/body rejected); plan creation with fixed keys and reuse with zero writes; hosted checkout price, variation, location and one idempotency key per attempt; abandoned and unpaid checkouts stay pending; failed first payment; single-match linking; ambiguous or claimed matches go to review; ACTIVE but unpaid gives no access; paid month and renewal advancing the period; failed renewal → grace → Free scope; underpaid, refunded and disputed cases; cancellation paid through period end; same result regardless of invoice order; direct-API plan denial; stored-record classification with Oven-scoped lookup; refunds allowed after a lapse; pending checkout gives no paid access.
- Full suite: 1,038 passed, 1 failed, 15 skipped. The one failure is an older recovery-page wording test that also failed before this work.

**Not run:** every live Sandbox scenario (free signup through hosted checkout, test-card success and decline, real renewal, live webhook delivery, missed-event recovery against Square, and cancellation). These need the credentials from §2. After setup, run them in a Deploy Preview using Square's Sandbox test cards.

## 4. Proposed billing policies (pending owner approval)

| Policy | Proposal |
| --- | --- |
| Failed payment | A previously paid Oven keeps its plan for 7 days after the paid-through date while Square retries. After that, Free limits apply and nothing is deleted. A failed first payment never grants paid access. |
| Cancellation | Takes effect at the end of the current paid month, with no partial refund. Implemented in Sandbox through Square's cancel. |
| Upgrade | Next renewal at the new price, with no proration. Not implemented. |
| Downgrade | Next renewal. Not implemented. |
| Refunds | No automatic refunds. A manual refund in Square stops that month counting as paid and flags it for review. |
| Over limits after downgrade | All records, history and exports stay available and existing records stay editable. Only new records beyond the lower plan, or for workflows outside it, are blocked. |
| Subscription sales tax | Not collected. Software taxability varies by state; confirm with a tax advisor. Bakery merchandise tax settings are never used. |

Sandbox uses the 7-day grace and end-of-period cancellation only as labeled test settings.

## 5. Remaining production blockers

- Square app, Production seller and location not yet created or verified.
- No production webhook endpoint yet (only the Sandbox endpoint exists).
- Policies above and the feature matrix need approval. Cottage Mercantile is unpublished because some of its features are unfinished.
- Plan changes, a card-update page and subscription tax are not implemented.
- Seller-timezone handling of Square's date-only invoice fields still needs confirming; dates are currently read as UTC.
- No live Sandbox acceptance run yet.

## 6. Ready for owner approval — production checklist

Approve each item explicitly. Nothing below happens without your written go-ahead.

- [ ] The production Square app and seller account are Hibbs Homestead Market's, with location ID ______ (US, USD, card processing on).
- [ ] Policies in §4 approved as written, or amended.
- [ ] Feature matrix and published tiers approved (Cottage Mercantile stays unpublished until its features are finished).
- [ ] Sandbox acceptance tests from §3 passed in a Deploy Preview, with results recorded.
- [ ] Production webhook endpoint built, signature verified, and events confirmed received.
- [ ] Exact production plans approved: Mixing Bowl $10, Baker's Bench $20, Cottage Kitchen $30 (and Cottage Mercantile $40 only when published), USD, monthly, no trial, annual price, setup fee or discount. Approval is also needed to **create** them in production.
- [ ] Production settings entered in Netlify (Production context only) and the admin panel shows *Verified*.
- [ ] Approval to change the code-level production release flag.
- [ ] Approval for one controlled live charge (for example a staff-owned test Oven on Mixing Bowl, then refunded), and of who performs it.
- [ ] Confirmation that the Hibbs Homestead Market Oven stays complimentary, and that no existing subscription is changed.
