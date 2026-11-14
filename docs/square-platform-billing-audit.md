# Square platform billing: audit and proposed implementation

> Historical implementation record. Square integration and its setup requirements were retired; see [the retirement record](./square-subscription-billing.md). For current connection evidence, see [Stripe status](./reviews/stripe-connection-status.md).

> Historical audit of the initial Sandbox implementation. Connection, Production synchronization and setup details below were superseded by [the current OAuth/setup guide](./square-oauth-setup.md) and [stage checkpoints](./signup-billing-stages.md). Production checkout remains disabled.

## Audit outcome

This is the requested audit/proposal stage. No checkout, plans, subscriptions, grants, payments, database migrations, DNS changes, or public activation were performed. Square is the intended provider; live charging remains separately gated.

Source inspection found draft commercial definitions in `src/lib/launch-plans.ts` and an unused server policy in `netlify/lib/entitlements.ts`. The evaluator accepts an internal active status but has no verified payment evidence; it must not become a payment authorization mechanism as-is. No billing tables, provider adapter, recurring scheduler, webhook handler, billing UI, or billing jobs were found. Existing prices match the approved numbers: Free 0, Mixing Bowl 10, Baker’s Bench 25, Cottage Kitchen 40 per workspace per month. The existing USD field is a draft assumption, not owner confirmation. No currency or catalog configuration should proceed until confirmed.

Square merchant sales import remains explicitly unavailable in the workspace UI. Platform billing needs a separate Square developer application, secret namespace, API endpoints, tables, webhook keys and permissions from any future customer merchant authorization/import. Subscription revenue must never enter customer sales, expenses, stock, or bakery journal tables.

## Existing workspace resolution

The owner subsequently stated that an account has not yet been created and that the intended account email is `contact@hibbshomestead.com`. This is an intended future login, not a verified Identity ID, authenticated platform-administrator role, or proof of workspace ownership. No account was created, invitation sent, workspace claimed, or grant applied on the strength of this address. Square account authorization also remains unverified; this statement does not establish a connected seller account. The previous currency, workspace and policy questions were left unanswered and are not being repeated. Currency, seller country and the proposed grace/change policies remain pending, not implicitly approved.

After the account exists and its email is verified, resolve its immutable Identity ID and independently verify ownership of the existing workspace. If an existing private demo workspace needs to be linked, use a reviewed authenticated claim process that proves control of that workspace; do not create another workspace or attach one by business-name/email matching. The complimentary grant then requires an authorized platform administrator and an audit record tied to that exact workspace ID and Owner Identity ID. Public signup and checkout remain gated; no account creation or activation is implied by this proposal.

A read-only query against the database available to this run returned these exact-name candidates:

| Workspace ID | Stored Identity Owner | Joined Owner membership |
| --- | --- | --- |
| 8060cf2a-dc7b-4095-956f-5fd3d0af1d7f | absent | absent |
| b3714823-4fc7-4405-80a0-4d6bfe3000da | absent | absent |
| 2b9b19ad-feb1-4237-9b04-d349a35b36af | absent | absent |
| ad2d3463-3374-4d66-b1d4-0e49d294687d | absent | absent |
| abd3cd45-6c3a-4095-946a-78a995d6802f | absent | absent |
| 33948670-1f45-4ae4-883f-ce79f537b0ad | absent | absent |

The application seeds the same business name for private demo workspaces. Name equality is therefore particularly unsafe. Row-level policies can restrict visibility; this is not a complete production inventory or proof that the intended workspace is absent. The exact intended workspace and verified Owner remain unresolved. No duplicate was created and no grant was applied. Obtain the intended workspace ID and verified Identity account, then independently verify active Owner membership and ownership in the correct database environment. Do not use an email address alone as authorization or create a replacement workspace.

Existing Square subscriptions could not be inspected. Absence of local billing code is not proof of no subscription in Square. Before granting complimentary access, inspect the authorized seller account for any subscription linked to the verified workspace; report any existing live subscription and obtain separate approval before changing it.

## Verified Square capabilities and recommendation

Official documentation fetched successfully during this audit supports `CreatePaymentLink` with a subscription plan variation. Use a Square-hosted checkout for one indefinite monthly paid phase, with no trial and no fixed shared billing anchor that could cause closely spaced full-price invoices. Free requires no Square object or payment method. Square schedules recurring billing; do not build a monthly card-charging scheduler.

Hosted checkout is recommended initially because Square collects payment details and recurring consent. Checkout supports one paid phase, optionally preceded by one free phase, and does not support application fees, Cash App Pay or Afterpay for subscription payments. The checkout initial amount can override the variation price if mismatched: both must be read from trusted server configuration and match exactly. Square documents a minimum subscription amount of $1 or local equivalent; complimentary access must not use a zero-priced subscription.

Hosted checkout can find/create a Square customer using buyer-provided phone information. Do not assume a browser redirect or prefilled contact establishes a workspace-to-subscription association. Sandbox must prove authoritative correlation from a unique checkout/order to the resulting payment/customer/subscription before paid access is granted. Never correlate solely by email, phone, or customer ID, since an Owner can have multiple workspaces. If hosted checkout cannot satisfy reliable correlation and single-subscription protection, use Square Web Payments SDK tokenization plus Cards and Subscriptions APIs in an integrated flow instead. That adds payment UX, consent and security obligations and needs separate implementation review.

The seller account's country, active location, currency, card-processing capability, eligibility for this business and account-specific rates remain unverified. No Square variables were available in this process, and no authorized Square account connector was available. Securely provision server configuration before authenticated read-only merchant/location checks; do not paste credentials into chat or app forms.

## Account-side setup checklist

1. Confirm settlement and billing currency and seller country. Verify an active location and `CREDIT_CARD_PROCESSING` capability using authorized account reads; verify subscription availability and relevant restrictions for that account and region.
2. Create a dedicated Cottage Pantry platform-billing developer application under the business's Square account. Do not reuse future merchant-import credentials.
3. For this single owned seller account, Square documents a server-held personal access token as supported for production custom integrations. It is broad access and must be protected. A scoped seller OAuth authorization is preferable where practical; implement state verification, server-only code exchange, encrypted token storage, refresh and revocation handling. This authorizes the platform seller, never each subscribing workspace's Square account.
4. Configure separate Sandbox and Production server secrets in Netlify's protected environment configuration. Scope to server/functions, isolate deploy contexts and redact logs. Keep tokens, OAuth secrets and webhook signature keys out of source, browser bundles, chat and frontend forms. No secret values were recorded in this audit.
5. Create and select a Sandbox test seller/location; verify its currency. Pin a reviewed Square API version. Configure an HTTPS Sandbox webhook URL and its own signature key.
6. After currency approval, configure server-owned monthly catalog plan variations for the approved prices, with environment-specific Square IDs mapped to stable internal plan IDs. Verify the catalog amounts, currency, cadence and location before checkout.
7. Verify Square's actual payment-method management experience and buyer communication in Sandbox. Do not advertise a hosted billing portal without evidence it exists for this integration.

## Costs and limitations

The current public US fee page showed online payments at 3.3% + 30¢ on Square Free and 2.9% + 30¢ on Plus/Premium; Online API payments at 2.9% + 30¢; manual entry/card on file at 3.5% + 15¢. These are published categories, not a verified subscription rate for this seller. Initial hosted and subsequent stored-card charges may fall into different categories; obtain confirmation before budgeting or activation. At those three rate examples, processing a 10/25/40 charge costs approximately 0.63/1.13/1.62, 0.59/1.03/1.46, or 0.50/1.03/1.55 respectively, with processor rounding. These figures are US illustrations, not a currency decision or quote. Confirm taxes, cross-border charges, refund fee treatment, disputes, any Square plan costs, and Netlify database/function costs separately.

Square continues invoicing ACTIVE subscriptions even when earlier invoices are unpaid. ACTIVE is not proof of payment. Failed saved-card payments can result in an emailed invoice payment link. ACH cannot be stored and charged later through Subscriptions API. Default billing is not prorated; changing billing anchors can produce close full-price charges. Avoid anchor changes and surprise charges.

## Proposed storage and security

Use new Netlify Database tables with synchronized forward-only migrations, tenant foreign keys and forced row-level policies. Preserve all already-applied migrations. Keep platform billing separate from bakery accounting.

Store billing accounts keyed by verified workspace ID and billing Owner Identity ID; environment-qualified merchant/location/customer IDs; stable plan IDs; catalog plan/variation mappings; subscriptions and provider versions; checkout attempts with idempotency keys and order IDs; invoices/payments/refunds/disputes with provider IDs and currency; verified paid service-period start/end; webhook inbox; reconciliation attempts; and append-only administrative audit records. Require unique environment/provider IDs and one unresolved checkout or current subscription per workspace/environment. Customer IDs alone are not unique workspace identifiers.

Only a verified active workspace Owner can read sensitive billing history or request checkout, card update, cancellation or plan changes. Resolve membership server-side; never accept workspace ownership or role from the client. Protect mutations against CSRF and replay and enforce plan/currency/price server-side. Bind a checkout attempt to the verified actor, workspace, environment, plan, catalog version and explicit consent text/version/time. Never store card numbers or security codes. Serialize checkout creation by workspace, reuse pending attempts and persist provider idempotency keys. Reconcile ambiguous timeouts before creating another subscription; invalidate prior links where supported and detect any provider duplicates before treating a replacement as safe.

## Entitlement state proposal

| State | Evidence and behavior |
| --- | --- |
| Free | No card or provider subscription required; approved Free scope only once implemented. |
| Pending | Checkout or subscription exists without verified settled payment; no new paid access. |
| Paid/current | Server-retrieved subscription/invoice/payment match workspace, plan, amount, currency and paid service period; payment is completed and net coverage remains valid. |
| Payment failed/past due | Renewal has not established the next paid period. Preserve records and existing paid period. Proposed seven-calendar-day grace for a previously paid workspace requires owner approval. |
| Cancelled with remaining paid access | Provider confirms cancellation; access remains until the verified paid-through end, shown explicitly. |
| Expired | Paid coverage and any approved grace ended; retain data and historical read/export. Scope of future writes requires approved downgrade policy. |
| Complimentary/platform owner | Independently verified non-expiring administrative grant, no payment method, trial, subscription or invoice; immune to payment/trial jobs. |

A redirect, frontend success or ACTIVE provider status never extends access. Reconciliation considers fully paid invoices and completed payments, partial payments, refunds and disputes against the associated service period; do not extend paid coverage from an invoice creation or status label. Refund/dispute events trigger reconciliation and platform review; no unapproved automated revocation or data deletion. Store timestamps with the seller timezone interpretation explicitly resolved for date-only Square fields.

Recommend both upgrades and downgrades at the next paid-period boundary, with no immediate charges, proration or automatic refunds. Show effective date and new recurring amount before consent. Verify Square plan-swap constraints and schedule behavior in Sandbox; where incompatible, design a reviewed replacement flow that cannot overlap charges. Do not implement changes until timing, retention and grace policies are approved. Preserve data, require review where seat usage exceeds the target plan, and never remove memberships automatically.

## Webhooks and reconciliation

Use independent environment endpoints. Verify the Square HMAC-SHA256 signature over the exact configured notification URL plus unmodified raw request body with the environment's signature key and constant-time comparison. Reject invalid signatures before storing or acting. Validate merchant/environment and event structure. Deduplicate by environment and event ID in a durable inbox before acknowledgement. Retry durable processing; retrieve canonical provider subscription, invoices, payments, refunds and disputes rather than applying events in arrival order. Use provider versions and transactional locking to prevent stale state overwrites. Persist outbound idempotency keys where APIs support them; for other updates use version checks and read-before-retry.

Subscribe to relevant subscription, invoice/payment failure/payment made, payment, refund and dispute events. Maintain retry/dead-letter visibility. Reconcile periodically and after ambiguous mutations or missing events; this is state synchronization, not a card-charge scheduler. Reconciliation must be idempotent and must never override an active complimentary grant or post revenue to a bakery ledger.

## Proposed interfaces

The Owner-only Account Billing page should show current internal plan, monthly price and confirmed currency, state, paid-through period, next provider billing date when available, genuine invoice/payment history, scheduled changes and cancellation effective date. Clear recurring consent precedes checkout. Support card updates through a verified Square-hosted management path if available; otherwise use the Web Payments SDK for tokenization and server-side card/subscription updates. Do not expose generic card fields or claim that a new checkout updates an existing card.

Provide a separate platform administrator billing view guarded by verified platform role, independent of customer Owner roles. It should expose reconciliation failures, provider links, invoice/payment references and audited grants/revocations, with no raw payment data or fabricated history.

## Complimentary workspace implementation after identity resolution

Grant `cottage-kitchen`, billing source `complimentary/platform_owner`, charge 0, maximum five total users including Owner, no expiry and no payment method. Persist a grant bound to the verified workspace ID and current verified Owner Identity ID. Record authenticated platform administrator, reason and before/after state in an append-only audit. Resolve it server-side on every authenticated workspace load; customer plan mutations cannot alter it. Ownership transfer or deletion must enter explicit platform-owner review before proceeding; the benefit must not silently follow another Owner or workspace.

Display exactly “Cottage Kitchen · Complimentary”. Show no invoices or revenue unless genuine historical payments exist, clearly labeled. Do not create a Square customer/subscription/payment for the grant. Suppress reminders, failed-payment downgrade and trial expiry. Grant only implemented feature scope; collaboration administration, AI, shopping comparison and unfinished integrations remain deferred. Existing app access is not proof this grant exists: it remains unapplied until workspace/Owner verification succeeds.

## Test results and release gates

Existing local unit tests: `npm test -- src/lib/launch-plans.test.ts` passed, 1 file / 5 tests. These are policy/unit tests, not Square integration or Sandbox tests, and do not prove billing safety. No new provider mock tests were implemented in this audit. Sandbox tests: not run; account authorization and configuration are absent. No live tests or charges were performed. Builds were left to the platform.

Before release, add separately labeled mock tests for signature rejection, duplicates/out-of-order events, idempotency/timeouts, settlement-based coverage, cross-workspace denial, non-Owner denial, and platform-admin-only complimentary changes. Sandbox must verify initial enrollment, success and decline, repeated clicks and reused links, renewal events, cancellation, approved plan change, card update, webhook replay and workspace authorization. Document simulated renewal-event replay separately from an actual Square-generated recurring renewal; do not claim time travel or real renewal support without evidence. Verify refund/dispute reconciliation with supported Sandbox scenarios, labeling unsupported scenarios as mocks.

Complimentary acceptance checks must demonstrate unchanged business records, persistence across refresh/login, five-user accounting, downgrade/trial/reminder exclusion, no Square calls, rejection of self-grants, reviewed ownership transfer/deletion and continued deferred-feature guards. None are claimed passed before implementation.

Remaining production gates: identify and independently verify the intended workspace/Owner; confirm currency; securely authorize the seller and inspect locations and existing subscriptions; approve grace/change/retention policies; implement and pass mock and Sandbox suites; configure separate Production mappings/signatures and authorized admin roles; verify fees, consent and cancellation terms; obtain explicit approval for public checkout and any live charging. Production credentials alone must not enable checkout. No DNS change is needed or authorized by this proposal.

## Sources

Fetched successfully during this audit:

- https://developer.squareup.com/docs/checkout-api/subscription-plan-checkout
- https://developer.squareup.com/docs/subscriptions-api/overview
- https://developer.squareup.com/docs/subscriptions-api/subscription-billing
- https://developer.squareup.com/docs/subscriptions-api/manage-subscriptions
- https://developer.squareup.com/docs/subscriptions-api/swap-plan-variations
- https://developer.squareup.com/docs/build-basics/access-tokens
- https://developer.squareup.com/docs/webhooks/step3validate
- https://squareup.com/us/en/payments/our-fees

These document platform capabilities and published US fee categories. They do not verify this seller's account, contract, region or eligibility.
