The Stripe inspection found subscription-billing code already implemented, but no verified Stripe connection. No billing configuration, customer records, subscriptions, paid-access rules, Square settings, website images, or application features were changed. This inspection followed the request's final Stripe-only scope.

Evidence was collected on November 14, 2026, from the current source, resolved Netlify configuration, read-only preview-database queries, public production GET requests, and focused local tests. Production subscriber records and the Stripe dashboard were not accessible through this inspection; preview results did not establish their contents.

| Status | Finding |
| --- | --- |
| Implemented and verified locally | 86 tests across eight files passed for credential encryption, mode checks, webhook signatures, payment reconciliation, authorization, member limits, access precedence, recovery, and Square billing compatibility. Tests used mocks or disposable local databases, not Stripe transactions. |
| Verified on production | `GET /api/stripe/billing?view=availability` returned HTTP 200 with no available plans. GET requests to both webhook paths returned HTTP 405, consistent with their POST-only handlers; this did not verify signed delivery. |
| Implemented but unverified with Stripe | Hosted Checkout, payment-method/invoice portal, signed webhook processing, paid-invoice access, replay/recovery, renewal and failed-payment behavior. |
| Missing or blocked | The required encryption variable was absent in all inspected contexts. The accessible preview database contained no Stripe provider settings, checkouts, or events, so it had no saved credentials, validated Price mappings, portal policy, signed-delivery evidence, or checkout/access/portal test evidence. Production database mappings and Stripe-side resources remained unverified. |

Stripe served **Cottage Pantry's own monthly software subscriptions**. No Stripe Connect seller onboarding, connected seller accounts, marketplace payouts, or bakery payment collection was implemented. Business integration records or labels were not evidence of a Stripe connection. Square sales import remained a separate planned provider contract.

| Surface | Existing implementation |
| --- | --- |
| Administrator settings | [Platform Admin](https://admin.mycottagepantry.com/admin) → Billing → Provider settings · Stripe; separate TEST/LIVE credentials, connection test, tier/Price validation, portal-policy review, explicit activation, and failed-event retry. Platform authorization and MFA protected configuration actions. |
| Owner actions | [My Oven billing](https://mycottagepantry.com/oven/billing), also reached from Settings → Subscription & Billing; status, tier choice, recurring consent, continue/resume Checkout, refresh, and Manage billing. Owner membership was enforced server-side. |
| API | `GET /api/admin?action=stripe` and POST to the same administrator endpoint; `GET /api/stripe/billing` for owner status; POST actions `checkout`, `refresh`, and `portal`; public GET with `view=availability`. |
| Records | `stripe_provider_settings` held environment-bound encrypted credentials, configuration, and verification evidence. `stripe_checkouts` linked business/owner, tier/Price, Checkout Session, Customer, and Subscription. `stripe_events` tracked delivery and processing. Shared `workspace_billing` held provider, billing owner, customer/subscription mappings, and verified coverage. |
| Recovery | Webhooks plus owner/admin refresh and failed-event retry were implemented. Automatic reconciliation ran every ten minutes on published production deployments for **test-mode records only**; previews had no automatic schedule. Live periodic reconciliation was not implemented. |

The relevant source was in `src/components/admin-stripe-settings.tsx`, `src/components/stripe-owner-billing.tsx`, `netlify/functions/stripe-billing.mts`, `netlify/functions/stripe-webhook.mts`, `netlify/lib/stripe-provider.ts`, `netlify/lib/stripe-subscriptions.ts`, `netlify/lib/stripe-reconciliation.ts`, and `db/schema.ts`.

Configuration checks reported names and presence only:

| Configuration | Production | Deploy Preview | Branch Deploy | Dev |
| --- | --- | --- | --- | --- |
| `STRIPE_BILLING_ENCRYPTION_KEY` | Not configured | Not configured | Not configured | Not configured |

No Stripe-named environment variables were returned in any scope, including Functions. The implementation required this one hosting secret: a protected, Functions-scoped encryption root. Stripe API credentials and webhook signing secrets belonged in the application's encrypted TEST/LIVE settings, not additional environment variables. Hosted Checkout required no publishable key. Deployment metadata `CONTEXT` and `DEPLOY_PRIME_URL` controlled mode/origin handling; Netlify supplied these on deployments. No stable preview origin was verified in this inspection.

The exact implemented production-host webhook URLs were:

- TEST: `https://mycottagepantry.com/api/stripe/test/webhook`
- LIVE: `https://mycottagepantry.com/api/stripe/live/webhook`

For Deploy Preview test billing, the implementation used that preview's validated stable alias plus `/api/stripe/test/webhook`; the administrator screen supplied its exact URL. Test/live credentials, Price mappings, signing secrets, provider objects, and event modes were checked separately. Live Checkout, portal use, and reconciliation were blocked outside production. Browser redirects alone granted no paid access.

Square subscription billing remained alongside Stripe, with its production release gate still closed in source. Square Sandbox configuration was present; its configured status was not proof of a working connection. No Square production credential variables were returned in the checked Production or Deploy Preview Functions configuration. This did not establish whether production Square subscriptions existed. The preview's `workspace_billing`, Square `billing_subscriptions`, and `billing_attempts` queries returned no rows under transaction-local billing read scope. No customer names, provider identifiers, or payment details were extracted.

Before any live activation, preserve and review authoritative production `workspace_billing` mappings, Square `billing_subscriptions`/`billing_attempts`/`billing_invoices`, encrypted Square connection records, Stripe checkout/customer/subscription links, manual grants, and billing history. Existing code used durable Checkout reservations, provider idempotency, shared locks, and database guards against overlapping Square/Stripe enrollment. Stripe reconciliation preserved suspension and manual-access precedence. Existing customers must not be recreated or migrated as part of connection setup.

The proposed setup sequence required these account-owner dashboard decisions and inputs; none was applied:

1. Select the Stripe account selling Cottage Pantry subscriptions and its test environment. In Netlify's project environment settings, arrange protected Functions encryption storage for the chosen test deployment. Generate the root securely during an authorized setup; do not send it in chat. Preserve any existing encryption root if authoritative records depend on it. Leave production activation for separate approval.
2. In Stripe's Product catalog, create or reuse active monthly USD flat-rate Prices: Mixing Bowl $10 (`mixing-bowl`), Baker's Bench $20 (`bakers-bench`), Cottage Kitchen $30 (`cottage-kitchen`), and Cottage Mercantile $40 (`cottage-mercantile`). Put the exact tier ID in Product metadata `cottage_pantry_tier`. All four were test-eligible; Mercantile remained live-ineligible. No Free Price, trial, annual billing, or per-seat purchase was implemented.
3. In Stripe's customer portal settings, enable payment-method updates and invoice history; disable subscription changes and cancellation. Retain the reviewed configuration ID for the app. Alternative cancellation, trial, grace, or plan-change policies required separate review.
4. In Stripe Workbench → Webhooks, create a destination using the exact TEST URL displayed by the chosen deployed administrator screen. Use API version `2025-04-30.basil` where selectable. Subscribe to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, and `invoice.payment_failed`.
5. In Cottage Pantry's protected TEST settings, enter the test API credential and destination signing secret, save, and test the connection. Validate each Price mapping and the portal policy. A signed sample event established transport only; an unlinked sample could fail processing. Restricted-key write permissions required real test Checkout/portal verification. Explicit TEST activation belonged after setup review; LIVE activation remained unapproved.

The proposed sandbox verification used a disposable verified owner/business, never customer records: cancel and resume Checkout; complete a Stripe test payment; confirm the exact tier and paid-through date from invoice evidence; replay webhooks and repeated clicks without duplicates; check portal payment methods/invoices and return reconciliation; exercise decline, renewal, failed renewal, and coverage expiry; verify non-owner/cross-business denial, manual-grant/suspension precedence, and Square overlap rejection. Missed-event recovery needed testing separately on previews and the production-only test scheduler. Test tooling simulations were to be distinguished from actual Stripe-generated renewals. No live charges, subscription migration, or production activation was performed or approved by this inspection.
