# Stripe test-mode setup

The approved test scope includes all four paid tiers. No trial, additional failed-payment grace, plan switching, proration, or self-service cancellation is enabled. The customer portal supports payment methods and invoice history. Live checkout is a separate later activation.

## 1. Open the correct test environment

In Stripe, select the account that sells Cottage Pantry subscriptions and switch to its test environment. Keep all Products, Prices, API credentials, webhook destinations, and portal configuration in that same account and test environment. Hosted Checkout does not need Stripe Connect or a publishable key.

Hosting credentials are imported into encrypted TEST/LIVE settings when no saved connection exists. On the trusted deployed site, initial import also provisions prices, portal and webhook automatically under the same database lock. Existing saved connections and explicit disconnections are preserved. A legacy Stripe credential in the encryption setting is recovered using a domain-separated encryption derivation; preserve that setting because changing it would invalidate stored ciphertext.

In Platform Admin → Billing → Provider settings → Stripe, select the environment and use **Set up TEST billing** or **Set up LIVE billing** after administrator authentication. Setup creates or reuses the approved monthly prices and billing portal, saves the webhook secret encrypted, and requests a real signed delivery. LIVE setup requires the production deployment. Setup does not enable checkout: the existing signed webhook, test checkout/access/portal evidence and live subscriber review checks still apply. The manual procedure below remains available.
Use the stable preview webhook URL displayed by the admin screen. Do not substitute a local URL, an arbitrary deploy URL, or the live endpoint. Keep preview webhooks and credentials associated with that preview's database. Automatic schedules run only on published deployments; previews use webhooks and owner/admin refresh for reconciliation.

## 2. Create four Products and Prices

In Stripe's Product catalog, create one Product per row. Add the exact Product metadata key `cottage_pantry_tier` with the value below. Add one active recurring **monthly USD flat-rate Price**, billed once per business, with quantity one. Do not use usage-based billing, annual prices, introductory prices, trials, coupons, or tiered/quantity-transformed pricing.

| Product | Product metadata value | Monthly Price | Total active users, including owner |
| --- | --- | ---: | ---: |
| Mixing Bowl | `mixing-bowl` | $10 USD | 1 |
| Baker’s Bench | `bakers-bench` | $20 USD | 1 |
| Cottage Kitchen | `cottage-kitchen` | $30 USD | 2 |
| Cottage Mercantile | `cottage-mercantile` | $40 USD | 6 |

Free requires no Stripe Product, Price, card, or Checkout. User allowances are app access rules, not Stripe purchase quantities. Cottage Kitchen continues to exclude resale and consignment. Features described as planned remain unavailable; purchase does not implement them. New invitations/member administration are outside this work.

Keep each Price ID (`price_…`) for mapping below. These IDs are not secrets.

## 3. Configure the customer portal

In Stripe's customer portal settings for the same test environment, enable payment-method updates and invoice history. Disable subscription updates/plan switching and subscription cancellation. Save an active configuration and obtain its `bpc_…` ID. If the dashboard does not display the ID, Stripe Workbench's authenticated API explorer can list `GET /v1/billing_portal/configurations`; choose the configuration just reviewed. The app validates its active status, test environment, and disabled subscription actions before use.

## 4. Configure the webhook and protected credentials

In Stripe Workbench → Webhooks, add a destination using the **exact TEST endpoint shown in Cottage Pantry admin**. Subscribe to:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `checkout.session.expired`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`

Use API version **2025-04-30.basil**, matching the server integration, where Stripe offers endpoint version selection.

Enter the test secret API key and this destination's signing secret directly in Cottage Pantry's protected Stripe settings. Never send them in chat, commit them, or put them in screenshots. Use the existing **Save credentials** control and its displayed TEST confirmation. Then **Test connection** and confirm the correct account. A restricted key must permit the account/catalog reads and the customer, subscription, invoice, Checkout, portal, and event operations used by the integration; a successful read test alone does not establish write permissions.

Send a signed test event from Stripe and inspect the admin webhook evidence. Stripe-generated sample events have no trusted Cottage Pantry checkout relationship, so a sample may show a processing failure even after signed delivery is verified. That verifies transport only; a real app-created test checkout must later reconcile successfully. Do not fabricate a successful payment or manually grant paid billing status to bypass this check.

## 5. Map Prices and activate TEST checkout

Under Tier and recurring Price mappings, select each paid tier, enter its matching test `price_…` ID, select purchase availability, and validate/save. Map all four rows. The server verifies currency, exact amount, billing interval, product metadata, and environment. Mapping changes disable new checkout until activation is reviewed again.

Enter the reviewed `bpc_…` ID under Required policies and activation review. Use the displayed **APPROVE POLICIES** confirmation and save the approved policy. Then use **ENABLE TEST CHECKOUT** to activate only test checkout. These controls record setup evidence; the billing policy has already been approved for this work.

Use a disposable verified test owner/business in the private registration test environment. If that private environment is unavailable, use the existing admin Test access grant for a disposable business, not a real customer. A manual grant takes precedence over billed access: revoke the disposable test grant after linking test billing when verifying that paid invoice coverage actually controls access. Do not revoke real customer grants. No real business needs to be enrolled or charged for these checks.

## 6. Verify the hosted flow

From the disposable owner's billing page, select a mapped tier and continue to hosted Stripe Checkout. In test mode, use Stripe's documented successful test card (`4242 4242 4242 4242`, a future expiry, and test CVC), never a real card. Confirm all of the following:

1. Canceling the browser checkout grants no access. Resuming it does not create a second subscription.
2. Successful Checkout shows payment verification until authoritative Stripe invoice evidence is reconciled. The correct business receives the selected tier and verified paid-through date.
3. Stripe webhook deliveries process successfully. Replaying a delivery creates no duplicate subscription or access period.
4. Manage billing opens Stripe's portal for that business. Payment methods and invoices are available; plan switching/cancellation are absent. Returning refreshes verified billing.
5. Provider-driven renewal, payment failure, and coverage expiry preserve only already-paid access, then fall back to existing Free-scope access. Records, history, exports, manual overrides, and security suspensions remain intact. Use disposable subscription fixtures and Stripe's documented test tooling; do not edit real records to simulate billing.
6. Mercantile allows six total active members and rejects a seventh; Kitchen keeps its two-user allowance. Existing memberships survive a lapse while further activations obey the effective lower tier. Secure invitations remain unimplemented; database tests cover activation limits without inventing an invitation flow.

The production schedule, when deployed there with protected test configuration, retries failed test events every ten minutes and checks stale test subscription links, in small batches. It never enables checkout or touches live Stripe subscriptions. Previews do not run automatic schedules.

## Remaining account setup and live rollout

Automatic setup supplies Price mappings, portal configuration and a protected webhook secret using the configured Stripe credential. Real test checkout, access and portal evidence still require verification in the deployed application.

Do not enable LIVE checkout during this test phase. A later rollout must separately verify live account settings and tax/customer-facing terms, review existing production Square subscribers, preserve their subscriptions and reconciliation, and approve live activation after test evidence. Never recreate existing subscribers automatically. Disabling new checkout is the rollback; keep credential encryption, webhooks, subscription history, and reconciliation available for already-linked customers.
