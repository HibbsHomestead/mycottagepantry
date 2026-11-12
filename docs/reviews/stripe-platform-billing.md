# Stripe subscription implementation and operating review

## Delivery status

The changes were implemented in the workspace for Netlify’s managed repository workflow. This runner does not create commits or pull requests directly; the platform records the changes and runs its build validation after completion. No new commit, pull request, deployment revision, or published URL was available during this run. The inspected production deployment remained `6af5e4c1358680cba891385c`, commit `8c18292b1a5466c3484bfe533f6d6c4386ae2adb` on main. Local implementation and browser emulation are not deployed or provider-verified billing.

## Implemented behavior

Platform Admin → Billing → Provider settings → Stripe received separate test/live configuration, masked credential metadata, explicit save/rotate/test/disconnect controls, existing MFA step-up, tier/Price mapping, supported policy approval, setup evidence, event search, and safe failed-event reconciliation. Saving credentials and testing the API do not create Stripe resources or claim webhook verification. Webhook setup is manual: the screen provides endpoint URLs and event subscriptions; administrators create the endpoint in Stripe and save its signing secret. Hosted Checkout does not require a publishable key or Stripe Connect.

Credentials were encrypted using AES-256-GCM with environment-bound authenticated data and a hosting-managed root. Read endpoints return masked metadata only. Connection requests use a fixed Stripe API origin, rate controls, timeouts, and sanitized errors. Credential actions require platform authorization and existing recent MFA. Save/rotate clears secret inputs. API validation and signed webhook-delivery evidence remain separate.

Owner checkout uses the existing verified Identity membership and business relationship. Durable checkout reservations, Stripe idempotency, provider/account/mode checks, existing Square subscription checks, and cross-provider database guards prevent accidental duplicate paid enrollment. Reconciliation verifies saved checkout/customer/subscription relationships and authoritative paid invoice coverage before granting access. Browser redirects alone do not activate a business. Live provider operations are blocked on preview database copies. Test checkout requires an isolated preview or an explicitly designated Test-access business.

The owner billing panel shows effective access, provider/status, verified coverage, pending checkout recovery, and server-authorized hosted portal launch. The portal uses a reviewed configuration and allowlisted return origin. The existing shared access resolver continues to enforce suspension and valid explicit manual overrides before billing-derived access. Square Sandbox grace was preserved. Billing events do not replace manual grants.

The operational directory received business/owner/tier/provider/status search, explicit Unassigned labels, focused details, safe reconciliation, verified member identity/membership lookup, and confirmed changes to existing membership roles/status. Existing manual grant controls and audit history were reused. Member updates enforce limits and protect primary/last owners. Secure new invitation delivery/resend/acceptance was not implemented: no existing secure delivery mechanism was available, and the interface identifies this limitation. The user directory retains existing stable-ID search and per-member verified identity lookup; it is not a new globally synchronized Identity email directory.

Existing Square business/POS connections, app subscription webhooks, historical billing, support, finance, inventory, product/recipe/label workflows, and account systems were retained. No customers were charged, migrated, cancelled, auto-enrolled, granted a new tier, or assigned permanent free access during implementation.

## Subscriber and blank-tier findings

Authorized read-only queries reached the accessible preview database branch. Eight businesses were visible: seven Hibbs-named businesses, including six anonymous demos, one owned Hibbs workspace, and one other owned/test candidate. Each owned candidate had one active member, no billing row, and no historical/manual grant record. Their missing tier display reflected absent persisted assignments on this branch. The display now says Unassigned; no assignments were fabricated and existing legacy access was preserved.

The accessible subscription/checkout records contained no rows. Authorized Square Sandbox subscription search succeeded with zero subscriptions and no continuation cursor. Production Square credentials were not available through the authorized readable configuration, so production provider state could not be established. This is not evidence that live Square subscribers do not exist.

Before live Stripe activation, an administrator must inspect authoritative production Square subscription/checkout records and Square live provider state, distinguish internal/test/pending/cancelled/live-paid records, and record the cutover decision. If live Square subscribers exist, keep their current subscription, access, reconciliation, and webhook paths; enable Stripe only for eligible new checkout. Any migration of existing customers needs a separate customer/payment-authorization decision. Existing subscribers must not be recreated or charged automatically.

## Hosting and Stripe setup

Protected encryption-root persistence could not be independently confirmed after the CLI setup attempt. Credential saving therefore remains blocked until runtime reports encryption storage ready. The required function-only protected secret is `STRIPE_BILLING_ENCRYPTION_KEY`, containing 32 cryptographically random bytes encoded as 64 hexadecimal characters, in production and deploy-preview. It must be generated and stored through protected hosting configuration without putting the value in source, ordinary logs, or this report. Keep the root backed up in an approved secret manager; changing it without re-encrypting saved credentials makes existing ciphertext unreadable. This is separate from the admin Rotate action for Stripe credentials.

After deployment and encryption readiness:

1. Open the platform-admin Stripe settings with an existing enrolled MFA method. Save test API credentials, test the connection, and verify the displayed Stripe account. A restricted key must support the necessary account/catalog/customer/subscription/invoice/Checkout/portal operations; successful reads alone do not prove all writes work.
2. Create recurring monthly USD prices manually for approved purchasable tiers. Mark the intended Stripe product with `cottage_pantry_tier` equal to the existing tier ID. Map and validate prices in the matching environment. The approved $30 tier retains two users and excludes resale/consignment. The $40 tier remains unpublished/unpurchasable; its unspecified multiple-user limit is not guessed.
3. Configure the displayed test webhook endpoint in Stripe. On production this is `https://mycottagepantry.com/api/stripe/test/webhook`; previews display their stable deploy-preview alias. Subscribe to checkout.session.completed, checkout.session.async_payment_succeeded, checkout.session.async_payment_failed, checkout.session.expired, customer.subscription.created, customer.subscription.updated, customer.subscription.deleted, invoice.paid, and invoice.payment_failed. Save the signing secret and send an actual signed test event. Inspect delivery and processing results separately.
4. Review the supported policies explicitly: no trial, access only through verified paid coverage with no additional failed-payment grace, no automated plan changes/downgrades/proration, and cancellation requiring separate review. A Stripe portal configuration with subscription changes and cancellation disabled is required. Payment methods and invoices can be managed there. These policies are proposals until approved in admin; alternatives need further implementation rather than implicit defaults.
5. Enable test checkout, use disposable verified accounts/businesses, and verify a real test payment, business access, webhook retries, failure/renewal coverage, and portal return/reconciliation. Do not designate real customers as test fixtures.
6. Save and validate live credentials, mappings, and the stable live endpoint `https://mycottagepantry.com/api/stripe/live/webhook`. Obtain actual signed live-delivery evidence without creating a live charge. Complete the production subscriber review and policy approval. Review the activation screen and explicitly confirm enabling LIVE checkout only after test checkout/access/portal evidence exists.

The API supports enabling approved existing tiers only. The unpublished $40 program needs separate approval and confirmed member policy before public purchase. There are no invented annual prices, trials, promotions, or automated refunds. Provider/account changes, cancellations, and migration remain separate reviewed operations.

Rollback means disabling new Stripe checkouts in admin. Preserve encrypted credentials, webhook delivery, existing subscriptions, billing history, and reconciliation so existing access continues. Disconnect does not cancel external subscriptions and is guarded when active subscription/pending checkout links exist. Never remove encryption infrastructure as a checkout rollback.

## Schema and verification

The additive migration `20261128010000_add_stripe_platform_billing` added provider settings, durable checkout links, and event processing records, with forced row-level policies, mode/provider constraints, an open-checkout uniqueness guard, symmetric cross-provider protection, and Stripe member-limit enforcement. All already-applied migrations were preserved. Database status showed the new migration pending in the correct order; deployment has not yet applied it.

Targeted unit/security/database coverage passed: 180 tests across 15 files, plus 23 registration-database regression tests. Tests cover cryptography/masking, authorization/mode validation, raw signed webhook checks, reconciliation/idempotency, cross-provider guards, RLS, member limits/owner protection, manual-access precedence, signup, existing Square billing, and MFA. The final TypeScript check and targeted ESLint check passed; git diff whitespace checks passed. Build execution was prohibited in this run and is delegated to Netlify’s managed validation.

Eight rendered browser workflows passed across phone/tablet/desktop layouts: provider settings and clearing secrets at 390/820/1440 pixels, owner portal launch, paid-preference onboarding, confirmed existing-member updates, and the existing operational admin at 390/1440 pixels. These ran Chromium against Netlify local emulation with disposable intercepted API fixtures. Stripe destinations were mocked. They do not establish real Stripe account permissions, payment processing, webhook delivery, renewal/failure behavior, portal configuration, live subscriber safety, or real-device behavior. Those provider-dependent acceptance tests remain unverified until credentials and hosted deployment are available.

Screenshots contain synthetic data and blank secret fields:

- [Desktop billing settings](../previews/stripe-billing-settings-1440.png)
- [Tablet billing settings](../previews/stripe-billing-settings-820.png)
- [Phone billing settings](../previews/stripe-billing-settings-390.png)
- [Owner billing](../previews/stripe-owner-billing.png)
- [Phone onboarding](../previews/stripe-onboarding-390.png)
- [Member controls](../previews/stripe-admin-members.png)
