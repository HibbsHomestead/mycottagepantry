# Inventory preview and barcode acceptance

## Review before wider rollout

The existing web app now offers **My Oven → Inventory → Preview photo inventory**. This is an opt-in preview; the existing inventory layout remains available. No sample records were seeded and browsing does not change stock, costs or history. The preview uses the same server-backed Oven records on every device.

| Width | Grid | Item details |
| --- | --- | --- |
| Phone, 390 px | [Grid](previews/inventory-grid-390.webp) | [Details](previews/inventory-detail-390.webp) |
| Tablet, 820 px | [Grid](previews/inventory-grid-820.webp) | [Details](previews/inventory-detail-820.webp) |
| Desktop, 1440 px | [Grid](previews/inventory-grid-1440.webp) | [Details](previews/inventory-detail-1440.webp) |

These screenshots use existing deterministic demo flour, eggs, butter, sugar and bags, plus explicitly synthetic fabric/resale fixtures and a licensed sample egg photograph. They are not photographs or inventory exported from a customer account. The photo fixture's license is retained with the fixture. KitchenPal screenshot attachments were not available in this checkout; the written requirements guided the preview without copying its branding.

Cards emphasize saved photos with a consistent fallback, readable names and labeled stock units. Package references are separate from remaining stock; no full-package count is inferred from partially consumed quantities. Fabric shows yardage and recorded width. Display precision is limited without changing stored precision; small positive residuals remain visible. Missing stock is labeled as unrecorded. White cards, cool-gray surfaces and purple accents are scoped to the preview.

Search, sort, inventory type, category, storage location and supported low-stock/expiry filters remain distinct. A table option is available. Phone details fill the screen; wider screens use a dialog. Details expose the existing Edit, Receive and Adjust flows and expandable purchasing, storage, history, supplier and type-specific information. Receiving previews the resulting quantity through existing conversion rules. There is no direct plus/minus counter or new stock calculation/persistence path. Existing URL import, receipt review and simplified navigation remain available.

## Barcode workflow

The existing unified Add Item retains Item Type first and all five types: ingredients, packaging, craft materials, supplies and resale. Scan Barcode, Enter Barcode Manually, Import from URL and Enter Details Manually reuse that form. Barcode values remain text, including leading zeros.

Scanning first searches only the current Oven's loaded inventory and resale records, including saved purchase offers. Matches show photo, variant, package reference and stock. Multiple matches require selection. Receiving requires package/variant confirmation and actual quantity and cost; these fields start blank. View Item opens details. Receipt matching selects an existing item without posting stock. The save guard checks existing matches again instead of silently creating a duplicate.

A separate Scan to receive shortcut reuses existing receiving services and operation IDs. Camera frames are accepted once until an intentional restart. A failed receipt retains its draft and operation ID for retry. No inventory is posted merely because a camera detects a code. **A multi-item pending scan queue and batch review/post workflow are not implemented.**

No product-data provider is configured. An unknown barcode displays **Product lookup unavailable**, preserves the barcode and permits manual entry or existing URL import. A successful decode is not a successful product lookup. Ingredient and allergen information still requires review; catalog prices never establish actual cost paid.

## Provider options requiring a separate decision

| Provider | Coverage and cost | Licensing and handling review |
| --- | --- | --- |
| Open Food Facts | Public packaged-food database/API; free public access subject to rate limits. Incomplete variants/packages; not a general fabric or supplies catalog. | Identifying User-Agent; ODbL database attribution/share-alike and CC BY-SA image requirements need review before reuse. Missing fields stay blank. |
| UPCitemdb | Broader retail coverage. Documented free tier has 100 combined requests/day and a six-request/minute limit. Current paid pricing is not verified; obtain a quote before purchase. | Confirm commercial use, caching, redistribution, image rights and retention terms before integration. |

References: [Open Food Facts API](https://openfoodfacts.github.io/openfoodfacts-server/api/), [terms](https://world.openfoodfacts.org/terms-of-use), [UPCitemdb API](https://www.upcitemdb.com/wp/docs/main/development/api/). No paid dependency was added. A future server adapter should send only the barcode, never account identity, Oven records, quantities, costs or receipts, and retain source attribution for review.

## Verification and limits

The complete automated suite passed **892 tests**, with **15 skipped** (104 files passed, seven skipped). After the final leading-zero assertions, the focused entry/review suite passed **21 tests**. These runs overlap and are not additive. TypeScript, focused new-file lint and whitespace validation passed.

The final **13 Playwright checks passed** in actual Linux Chromium 156.0.8078.4 and Firefox 157.0 engines. They covered photo grid/detail and Edit entry at 390/820/1440 pixels; responsive navigation and shelf-label preview at 390/412/820/1440; actual generated Code128 decoding; simulated camera denial with manual fallback; ambiguous package selection; blank actual receiving quantity/cost; and retry operation-ID retention. Browser API responses were fixtures, with no production business writes.

| Acceptance area | Evidence/status |
| --- | --- |
| Photos, fallbacks, labeled quantities, filters, modal/mobile navigation, edit entry | PASS in fixture browser checks; screenshots linked above. |
| All five item types and leading-zero barcode preservation | PASS automated form fixtures. |
| Existing item → scan → receive and failed-save retry | PASS fixture checks; production stock posting deliberately not performed. |
| New code → manual/URL fallback | PASS automated fixtures; real provider lookup is unavailable. |
| Product lookup → review → save | NOT VERIFIED; no configured provider or real product result. |
| Repeated frame protection | PASS automated guard coverage; physical camera behavior pending. |
| Tenant isolation | Existing server ownership boundary retained; automated coverage is separate from live multi-account acceptance. No other Oven is queried by the client matcher. |
| Batch receiving review queue | NOT IMPLEMENTED. |
| Keyboard/manual text entry | PASS browser fixtures; physical USB/Bluetooth scanners NOT VERIFIED. |
| iPhone/iPad Safari, Android phone/tablet Chrome, Windows/Mac browsers | NOT VERIFIED on those devices/operating systems. Resized Linux browser tests do not certify them. |

Actual camera permission flows, camera focus/lighting, physical scanners, production editing/stock acceptance, image availability on customer records and device accessibility remain release gates. Manual entry remains available when camera access is unavailable or denied. Wider inventory rollout awaits owner review of the preview; live provider lookup and batch receiving remain separate unfinished work.
