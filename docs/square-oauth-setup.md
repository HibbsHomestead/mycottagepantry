# Platform subscription Square setup

This connection receives Cottage Pantry subscription revenue. It is independent of any customer business's Square sales integration. No Production Square resource was created or changed by this work.

## Deployed endpoints

The implemented Production OAuth callback is **https://admin.mycottagepantry.com/api/admin/square/callback**. The Production notification endpoint shown by that admin origin is **https://admin.mycottagepantry.com/api/square/production/webhook**. Register these only after the corresponding deployment exists. Production callbacks are accepted only on the deployed admin host.

Sandbox uses the actual trusted Deploy Preview origin followed by `/api/admin/square/callback` and `/api/square/sandbox/webhook`. Admin Billing displays both complete URLs from that deployed origin. Use those exact values; a local development address, a guessed preview hostname or a Production URL is not a substitute.

## Secure configuration

The Sandbox application ID, application secret and webhook signing key were supplied through secure project setup for Deploy Preview; their values were not read back. For other genuinely missing settings, use secure project setup or Netlify project configuration → Environment variables, Functions scope. Keep Sandbox values in Deploy Preview and Production values in Production. Never enter credentials in ordinary chat or browser storage.

| Configuration | Purpose |
| --- | --- |
| `SQUARE_BILLING_ENCRYPTION_KEY` | Generated 32-byte encryption key, stored as 64 hex characters; generated securely for Deploy Preview. Preserve it for existing encrypted records. Production requires its own generated secure value before connection. |
| `SQUARE_SANDBOX_APPLICATION_ID` / `SQUARE_PRODUCTION_APPLICATION_ID` | Correct environment's Square application ID. |
| `SQUARE_SANDBOX_APPLICATION_SECRET` / `SQUARE_PRODUCTION_APPLICATION_SECRET` | Corresponding application secret for server exchange and refresh. |
| `SQUARE_SANDBOX_API_VERSION` / `SQUARE_PRODUCTION_API_VERSION` | Square API version supported by that application. The existing Sandbox version passed real merchant/location reads. |
| `SQUARE_SANDBOX_WEBHOOK_SIGNATURE_KEY` / `SQUARE_PRODUCTION_WEBHOOK_SIGNATURE_KEY` | Signing key from that environment's registered webhook. |
| `SQUARE_SANDBOX_WEBHOOK_URL` / `SQUARE_PRODUCTION_WEBHOOK_URL` | Optional exact notification URL override; otherwise the trusted Deploy Preview origin (Sandbox) or implemented admin origin (Production) supplies the URL. Invalid overrides block checkout. It is part of signature verification. |
| `SQUARE_SANDBOX_ENABLED` / `SQUARE_PRODUCTION_BILLING_ENABLED` | Existing enable flags. Production's flag alone cannot enable checkout. |
| `REGISTRATION_PRIVATE_TESTS_ENABLED` | Existing private test gate; Sandbox requires a private test deployment. |

A confirmed OAuth connection supplies access token, merchant ID and selected location from encrypted database records. Existing `SQUARE_<ENV>_ACCESS_TOKEN`, `SQUARE_<ENV>_MERCHANT_ID` and `SQUARE_<ENV>_LOCATION_ID` remain a legacy server configuration only where no OAuth connection exists. A broken OAuth connection never falls back to another merchant's legacy token.

Requested permissions are MERCHANT_PROFILE_READ, ITEMS_READ, ITEMS_WRITE, ORDERS_READ, ORDERS_WRITE, PAYMENTS_READ, PAYMENTS_WRITE, SUBSCRIPTIONS_READ, SUBSCRIPTIONS_WRITE, INVOICES_READ and DISPUTES_READ. These correspond to merchant/location verification, catalog setup, hosted payment links, cancellation and canonical billing reads; customer sales synchronization permissions are not added.

Subscribe to these supported webhook events: `subscription.created`, `subscription.updated`, `invoice.payment_made`, `invoice.scheduled_charge_failed`, `invoice.updated`, `payment.updated`, `refund.updated`, `dispute.created`, `dispute.state.updated`.

## Ordered Sandbox checkpoint

1. After this preview is deployed, register its exact OAuth callback. The supplied Sandbox application credentials are already configured.
2. Register the exact preview notification URL and supported events. The supplied signing key is already configured. The server derives the URL automatically; any explicit override must match the registered URL exactly.
3. Sign in as platform owner. Choose Connect Square, authorize the revenue merchant, then Verify Square authorization. Confirm the displayed business and active USD billing location explicitly.
4. Verify billing configuration. Create or reuse Sandbox plans, then verify their mappings. The four monthly USD prices must be $10, $20, $30 and $40.
5. Run the seven live scenarios in the requested acceptance checklist. Use existing private test setup where permitted. Public business creation remains gated by final policies. Record actual Square webhook and synchronization evidence separately from mock results.
6. Confirm reconnection/refresh, retry without duplicate subscriptions, and support recovery without asking a customer to pay again.

OAuth states expire after ten minutes and are session-bound. If the session expires or rotates, restart authorization. The existing merchant remains in service until confirmation. Merchant/location replacement is refused while subscriptions or unresolved open checkouts could be affected; review impacted accounts before attempting migration.

## Production remains blocked

Before any live checkout: approve final Terms and a separate accurate Privacy Policy; approve failed-payment, cancellation/refund and tax policy; resolve Mercantile's user allowance and unfinished feature scope; confirm seller-timezone interpretation; finish live Sandbox acceptance; securely configure and authorize the Production app/merchant/location; explicitly approve the exact Production catalog resources before creating them; verify all four server-owned monthly USD mappings and real signed notification/sync evidence; explicitly approve the code release gate and controlled live acceptance. No button in this release creates Production plans or enables live checkout.

Read-only Production synchronization can collect canonical evidence before release. Policy-dependent paid-access updates remain gated. Subscription changes and card-update self-service remain unfinished and must not be advertised as ready.
