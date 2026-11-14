# Square billing retirement

Square platform billing was retired from the application after the owner confirmed that the live merchant account had no subscriptions or unfinished checkouts. The sandbox audit also returned zero subscriptions. The production database audit was unavailable, so the owner confirmation supplied the live pre-removal evidence.

Square connection screens, OAuth and checkout routes, API clients, webhook handlers, scheduled/background synchronization, and configuration requirements were removed. Stripe connection and checkout readiness do not require any Square setup. No Square account connection is currently available.

Historical invoices, subscription/checkout references, encrypted connection records, verified paid-through access, schema and applied migrations were retained. Stripe still checks unresolved historical subscriptions and checkouts before starting a new subscription. No external subscription was cancelled, account authorization revoked, or financial record deleted. Existing external settings and resources were left untouched.

For current Stripe and administrator verification status, see [the connection investigation](./reviews/stripe-connection-status.md).
