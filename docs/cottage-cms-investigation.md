# Cottage CMS integration investigation

Research reviewed 31 October 2026. This investigation concerns **Cottage CMS at cottagecms.com only**. Craft CMS and Craft Commerce are excluded. No connector, private-endpoint client, credentials, provider account, paid request or sync was created.

## Evidence and limits

The official [short product index](https://cottagecms.com/llms.txt) and [full product description](https://cottagecms.com/llms-full.txt) were accessible. The home, features, pricing and contact HTML requests returned HTTP 403 during research. Public descriptions establish advertised platform capabilities, not a tested merchant integration or the owner's enabled account features.

| Topic | Verified from official public material | Still requires Cottage CMS confirmation |
| --- | --- | --- |
| Public merchant API / partner integration | No merchant API specification or partner connector contract was found in the inspected official product documentation | Whether a supported API/partner program exists; approval, documentation, sandbox and support terms |
| Authorization | No supported merchant authorization flow verified | OAuth vs scoped tokens, read-only scopes, shop identity, revocation/expiry and multi-shop separation; do not collect account passwords |
| Webhooks | No documented merchant webhook contract verified | Events, signing/authentication, replay protection, retries, ordering, event IDs, retention and versioning |
| Products / variants | Products, sizes, choices, extras, choice groups and inventory pools are described as storefront features | Export/API schemas, stable product/variant/choice IDs, SKUs, units, archive state, modifiers/bundles and update timestamps |
| Orders / sales | Online ordering, market checkout, quick sales, fulfillment and payment connections are described | Supported read/export access to order lines, payment status, fulfillment dates, currency, discounts, taxes, tips, fees and processor identifiers |
| Refunds | Refund/store-credit features are described | Refund-line linkage, partial refunds, fees, cancellations, returns vs refunds, gift cards/store credit and supported data access |
| Inventory | Product/size/choice stock, shared drop pools and timed checkout holds are described | Whether stock and holds are readable, their units, timestamps and semantics; these are storefront availability, not Pantry raw-material stock |
| CSV / structured exports | “Customer & Product Exports” is described as Free, with structured exports; product export file/schema not obtained | Obtain a sanitized product sample, actual format, IDs, variants/options coverage, encoding and limits; order/sales/refund/inventory exports remain unverified |
| Imports into Cottage CMS | Customer CSV Import is described as Pro | This does not establish product, order or inventory CSV import support, and customer import is outside the proposed Pantry scope |
| Pricing / restrictions | Official material labels some features Free and others Pro | Merchant API pricing, API plans/approval, rate/page limits, historical retention, usage charges, data handling terms and export restrictions are unknown; no API budget assumed |

The public `/api/transparency` and `transparency.csv` links describe aggregate, privacy-thresholded platform statistics. They are **not merchant-record APIs** and do not justify assuming access to private storefront records. No undocumented merchant endpoints were probed.

## Proposed staged relationship

Cottage CMS remains responsible for the storefront, customers, checkout and ordering. Cottage Pantry remains responsible for costing, materials, inventory and production. Initial integration should be **read-only retrieval → product matching → review → explicit approval**, starting with the documented product-export capability after inspecting a real sanitized sample. Do not start with a live sales/accounting sync.

1. Owner uploads an official export, or authorizes documented read-only API scopes if Cottage CMS supplies them. Store original file privately in Netlify Blobs and its workspace-owned draft/parse results in Netlify Database. Retain source timestamps, file digest and parser version. Enforce size/row limits; reject executable content and neutralize spreadsheet formula cells in later exports.
2. Parse into staging records without changing any product, price, stock, production or finance record. Unknown fields remain reviewable. Separate product identity, variant/options, sellable quantity/unit, currency and historical transaction values. Import only supported record types; do not synthesize missing refunds, inventory or fees.
3. Match using `(provider account, external product ID, external variant ID)` first. SKU/name suggestions require review; ambiguous names, bundles and choices must not auto-match. Verify both ends belong to the authorized Pantry workspace. Map quantities explicitly: one Cottage CMS box may correspond to several Pantry selling units. Keep external price as reference metadata only.
4. Display proposed associations and exclusions, source provenance, missing data and duplicate warnings. Owner/Manager approves a **mapping/reference import**, with a stable operation key, file/row digest and audited import result. Re-uploading a file must not duplicate mappings. Basic reference import must not silently create sales journals or change selling prices.
5. Later supported orders/refunds may be staged for a separate reviewed scope: immutable source IDs/revisions, separate order/payment/fulfillment status, explicit discount allocation, taxes excluded from revenue, fees/tips/store credit handled separately, and refund-to-original linkage. Historical date range, timezone, overlaps, corrections and duplicate semantics need agreement first. No automatic financial posting or stock deductions are authorized here.

Imported orders may become planning suggestions only after product and unit mappings are approved. Planning never consumes raw stock. Cottage CMS stock/checkout holds must not be treated as Pantry production usage; designate inventory authority before any future write integration. No outbound writes, automatic price updates, background polling or webhook subscriptions are enabled.

## Questions for Cottage CMS

Request an official integration contact/documentation, permitted read-only partner access and costs; supported auth/scopes and revocation; product/variant and transaction export samples; stable identifiers and timestamps; orders/refunds/tax/fee schemas; inventory/hold semantics; sandbox and rate limits; webhook authentication and event guarantees; retention, commercial approval and data-use restrictions. Do not supply an owner password or ask for undocumented dashboard endpoints.

## Future acceptance tests

Use isolated sanitized fixtures: duplicate upload, updated export, same name/different variant, missing SKU, bundle quantities, partial refunds and repeated events, tax-inclusive/exclusive totals, multiple currencies, dates/timezones, invalid/non-JSON provider responses, expired authorization and cross-workspace ID manipulation. Prove retrieval, draft save, matching and approval make **zero price, stock or financial writes**. Release availability only after provider documentation and deployed behavior are verified.
