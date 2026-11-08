# Retailer restock and shopping handoff: feasibility and phased design

This is a plan only. Product links and manual checkout are feasible for Phase 1. Direct cart access requires separate retailer approval and evidence that the supported cart can hand off to retailer checkout. No retailer connection, cart write, purchase, paid service, or inventory workflow change was implemented.

## Phase 1: reviewed shopping lists

Reuse each inventory item's saved exact product URL (`productSourceUrl`), supplier/vendor reference, variant/SKU metadata, low-stock threshold, stock unit, and explicit purchase-package conversions. Add a preferred retailer and target stock where missing. Store thresholds and targets in the item's stock unit and require target ≥ threshold.

Calculate retail-package suggestions only from verified saved conversions:

```text
packages = ceil(max(0, target stock − on hand − confirmed outstanding order stock)
                / stock quantity per retail package)
```

Only confirmed, uncancelled, unreceived order quantities reduce the need. Draft lists and opened links do not. Show rounding and expected excess: a 6 kg target, 1 kg on hand, and 2 kg bags suggests 3 bags. Missing or conflicting conversions block the suggestion; never infer density, case sizes, or package contents from a product title, URL, price, or barcode. Reuse the existing unit/package conversion helpers, including the relevant fabric or resale conversions.

Provide a compact list in Purchasing grouped by retailer: item, exact variant/pack, suggested and reviewed package quantity, conversion warning, product link, and progress. Users can edit, copy/export, open individual saved product links, and manually confirm ordered status. Login, cart changes, and checkout occur on the retailer's site. Opening a product does not mark it ordered. This phase does not activate a shopping-comparison service or scrape retailers.

Persist tenant-owned list headers, lines, revisions, order references, and receiving links in Netlify Database using server-derived business ownership, permission checks, composite tenant references, and row-level security. Future implementation requires new forward migrations. Snapshot approved package conversions and require another review when stock or package definitions change. Prevent accidentally ordering duplicate active suggestions.

Keep **requested**, **ordered**, and **received** quantities separate, including package quantities and converted stock quantities. Manual Ordered means user confirmation, not retailer acknowledgement. Track partial orders, cancellations, substitutions, and partial receipts explicitly. An arrival can be marked awaiting receipt posting; received totals that affect stock must link to the existing posted receipt/receiving transaction.

Cart activity, order status, checkout returns, and receipt uploads never add stock. Reuse existing reviewed receipt/Receive stock posting, ledger, and weighted-average costing. Use tenant-scoped idempotency keys, row locks, and receipt/receiving links so importing a receipt and manually receiving the same purchase cannot post it twice. Handle corrections through the existing correction/reversal path. The current purchase-order UI is header-level; line-level receiving is future work, not an existing capability.

Phase 1 adds normal platform storage/compute usage, with no retailer API fee inherent to this design. Retail purchases, shipping, and membership are separate. No cost or resource has been approved or enabled by this plan.

## Phase 2: investigate each official integration separately

The following findings were checked against official sources on 2026-11-07. Unknown terms remain implementation blockers.

| Retailer | Verified feasibility and limitations | Approval, regions, and cost gates |
| --- | --- | --- |
| Amazon | An **Amazon Business Cart API** exists. Its default cart is documented as independent of the Amazon Business website cart. Its documented order flow uses the Ordering API, which does not establish the requested website checkout handoff. Consumer Amazon carts are not covered by this evidence. | Developer questionnaire review, app registration, customer authorization, and Amazon-assigned **Amazon Business Order Placement** and **Business Product Catalog** roles are required. The Cart API region enum lists DE, FR, UK, IT, ES, IN, US, CA, MX, JP, and AU; actual account/offer availability needs confirmation. Product Search must supply ASIN and offer ID; Hosted Catalog is unsupported. The documented listCarts default limit is 2 requests/sec with burst 2. Confirm an approved website handoff/Punch-in/PunchOut path, sandbox, applicable API/catalog/support fees, and account-plan costs before coding. No applicable public fee schedule was confirmed. Do not use Ordering API to purchase. |
| Walmart | The official developer portal documents seller/solution-provider, supplier, advertising, and logistics programs. Those do not establish authorization to modify a shopper's cart. A supported buyer-cart or checkout-handoff contract was not verified. | Confirm consumer versus Business procurement eligibility, official cart-link/API or PunchOut support, partner approval, sandbox, regions, store/fulfillment limits, membership requirements, fees, and quotas. Marketplace credentials or Walmart+ membership do not prove cart access. |
| Sam's Club | A supported public member-cart contract was not verified. Official help content was inaccessible during inspection; this is not proof that partner options do not exist. | Confirm membership/account eligibility, partner approval, supported regions/clubs, fulfillment restrictions, sandbox, fees, quotas, and written integration terms. Walmart affiliation does not establish API compatibility. Use ordinary product links unless official support is established. |

Before selecting a provider, record its documented authorization/scopes, production and test eligibility, approval process, supported markets, full costs, rate limits, allowed data use/retention, cart behavior, revocation, and checkout handoff. No retailer or partner was contacted.

## Security and release requirements

Use only documented provider authorization. Store future tokens server-side, encrypted and tenant-scoped, with least privilege, revocation/rotation, retention limits, and redacted logs. Never collect retailer passwords, reuse browser cookies, automate authenticated browser sessions, or depend on private shopping APIs. Validate saved HTTPS links; any later server fetch must use existing SSRF defenses.

Require explicit review before every external cart change, including any link that adds items: exact account/cart, seller, variant, package quantities, price information, and change summary. Preserve unrelated cart contents. Reconcile partial failures and uncertain responses before retrying; require provider idempotency or safe read/reconciliation. No automatic checkout, order placement, or purchase. Cart actions have no inventory effect.

Acceptance checks cover missing conversions, stale stock/package revisions, pending and partial orders, cancellations, duplicate suggestions, tenant separation, wrong variants/markets, expired/revoked authorization, quotas, rejected items, timeout reconciliation, forged callbacks, and exactly-once receipt/manual receiving reconciliation.

## Official references

- Amazon Business: [Cart API overview](https://docs.business.amazon.com/docs/cart-api-overview), [Cart API reference](https://docs.business.amazon.com/docs/cart-api-v1-reference), [onboarding](https://docs.business.amazon.com/docs/onboarding-overview), [authorization](https://docs.business.amazon.com/docs/authorization-workflow), [FAQs](https://docs.business.amazon.com/page/faqs), and [integration security policy](https://docs.business.amazon.com/page/amazon-business-data-protection-and-security-policy-for-integrations).
- Walmart: [developer portal](https://developer.walmart.com/) and [Walmart Business](https://business.walmart.com/). No applicable buyer-cart contract was established.
- Sam's Club: [official help](https://help.samsclub.com/). Access restrictions prevented verification of partner-cart terms.
