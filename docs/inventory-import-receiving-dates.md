# Inventory importing, receipt receiving, and calendar dates

The shared product-link importer was extended across purchasable inventory, and receipt matching and posting were extended to craft materials and resale merchandise. Receiving dates were separated from purchase dates and system creation timestamps. Historical date changes were left for explicit owner approval.

## Supported forms

| Inventory type | Create / new-item receiving | Edit existing details | Receive existing stock |
| --- | --- | --- | --- |
| Ingredients | Shared URL import and manual entry | Individual imported-field review | Saved supplier URL; confirmed receiving only |
| Craft materials, including yarn | Shared URL import and manual entry | Shared inventory detail editor | Saved supplier URL; compatible inventory units |
| Fabric | Shared URL import with separate width and length | Fabric editor; stock configuration stays protected | Fabric receiving with explicit length or supported piece configuration |
| Packaging | Shared URL import; packaging-specific sections retained | Shared inventory detail editor | Saved supplier URL; confirmed receiving only |
| Supplies | Shared URL import and manual entry | Shared inventory detail editor | Saved supplier URL; confirmed receiving only |
| Purchased finished goods / resale variants | Shared URL import; zero-stock creation | Product editor; retail price stays separate | Stable product/variant ID; confirmed pack contents and acquisition cost |
| Handmade finished goods | Reference URL and selected product details | Product editor | Purchased stock receiving stays unavailable; production remains a separate workflow |

Receipt lines also supported creating and matching an empty item of any of the five purchasable types. Creating an item preserved the receipt draft and its other line matches; receiving happened only when the receipt was confirmed.

## Shared import behavior

All applicable forms reused `ProductLinkImport`, the existing product extraction endpoint, and the protected shared page downloader. URL validation, bounded downloads, timeouts, redirect checks, retailer access restrictions, and the earlier page-size limit fix were retained. Amazon's helper read: “Use Share → Copy link on the Amazon product page.”

Review offered editable, individually selected values and identified conflicting current entries. Name, photo, brand, supplier, source URL, explicitly provided identifiers and barcode, package information, listed price/currency, description, and supported specifications were retained when available and accepted. Manufacturer part/model numbers and retailer identifiers remained distinct from the owner's internal SKU and barcode. Supplier IDs were checked against the current Oven.

Fabric width was stored separately from package length. Yarn length and yarn weight remained separate specifications. Material composition, color/pattern, selected variant, explicit items per package, and dimensions were supported where exposed as labelled product facts. Ingredient statements and allergen wording remained food-specific, with missing wording left unknown and imported statements requiring review. Packaging retained its existing hidden-section behavior.

Listed online prices were saved as references. They did not supply the actual amount paid, change the retail selling price, or rewrite historical costs. Imported package contents did not establish packages purchased. New-item receiving required the owner to enter packages actually received separately; existing-item receiving used its explicit quantity/unit and actual total cost.

Importing alone did not create stock movements, purchasing entries, or production runs. Applying selected details changed the current form, and an edit save changed metadata only. Loading, partial results, unreadable-page errors, and photo-copy failures had separate feedback; manual entries remained available and were retained after failures.

The “Paste product text instead” fallback kept pasted text as notes for manual field entry. It did not run an additional text extraction service. Retailer restrictions, missing or incomplete structured data, and unsupported specifications could still require manual entry. No standard bolt, roll, skein, bundle, density, pack contents, or missing allergen information was inferred. Real retailer availability was not guaranteed.

## Receipt matching and posting

The original receipt selector and posting path were limited to ingredient-table records. The selector was replaced with searchable groups for Ingredients, Craft Materials, Packaging, Supplies, and Resale Merchandise. Options included item name, selected variant, internal SKU where available, and inventory type. Product/variant matches carried a stable table-and-item identity through draft saving, posting, and reopening.

Resale receipts used confirmed purchase quantities, purchase units, and items per package. For example, two packs with six explicitly confirmed items produced twelve sellable units. Weighted-average inventory costs used actual line costs and existing tax/charge allocation. Retail selling prices stayed unchanged. Craft receiving used compatible conversions and the existing fabric length/piece safeguards; width never became received length.

One receipt could contain all five types, plus non-inventory expenses and personal/excluded inventory lines. Posting linked the receipt, transaction, ledger movements, and inventory items. Database transactions, closed-receipt checks, and stable creation/operation IDs prevented duplicate item creation or inventory/expense posting on retries. Existing permissions, tenant ownership, row-level security, photo ownership checks, and stock constraints remained in force. Handmade products were rejected by purchased resale receiving.

## Date investigation

The available database branch was inspected read-only for the owner's Oven. Its timezone setting was absent; the database session timezone was GMT. The owner described Central time, so the effective legacy default became the daylight-saving-aware `America/Chicago` timezone, visible and editable in Oven settings. Explicitly configured Oven timezones took precedence.

The two latest initial packaging purchases were the likely reported entries:

| Item | Movement ID | Original creation instant | America/Chicago creation time | Stored calendar date | Proposed received date |
| --- | --- | --- | --- | --- | --- |
| 50oz Aluminum Foil Pans with Lids, 8.7 × 6 in | `a2f4334e-3a2f-4589-8c66-e8c6e95172c2` | `2026-11-04T02:55:37.351Z` | November 3, 2026, 8:55:37 PM CST | 2026-11-04 | 2026-11-03 |
| Mini Loaf Baking Pans with Lids, Black Gold Square 20oz | `a5b263cc-507c-4298-b9fa-2e16450dd318` | `2026-11-04T02:57:26.004Z` | November 3, 2026, 8:57:26 PM CST | 2026-11-04 | 2026-11-03 |

Those creation times differed from the owner's approximate 9:18 PM report. Both records were initial purchases without receipt-upload/extraction links. Neither had a separately entered purchase date or received date, and the associated item forms supplied no calendar date. These were therefore likely matches requiring owner confirmation, rather than positively identified circled entries.

The original server initial-receiving path generated its calendar date with `new Date().toISOString().slice(0, 10)`. The purchase-history table directly rendered that ledger date. This was a persisted calendar-date error, rather than a date-only parsing shift in the table. The system creation timestamps were valid instants. Associated posted journals also carried November 4; their original values were retained.

Seven additional legacy movements had the same UTC-date/local-date mismatch pattern. Their proposed change was November 2 → November 1, 2026:

| Item | Movement ID | Local creation time on November 1 |
| --- | --- | --- |
| Aluminum Loaf Pans 13 × 9.84 × 2.36, Black Gold | `38ab544f-400c-4b45-a826-0642a3b27035` | 9:50:51 PM |
| Sourdough Bread Bags | `dd931039-e469-48e2-9a9f-c369aad6d42c` | 9:48:32 PM |
| Small Cookie Bags | `a692a9d3-2a06-4c00-90ba-eb2193179157` | 9:46:34 PM |
| Bread Bags Large | `8bc399a9-3f29-495f-88fe-7df48dd1978c` | 8:03:47 PM |
| Black Gold 20.9oz pans, initial receipt | `767ee3c2-b1c3-415e-99f0-a91178c5a74e` | 7:42:46 PM |
| Iodized Salt | `bfea9177-65ce-4522-9d11-934623284f0d` | 7:18:56 PM |
| Sugar Granulated | `75ce8413-658e-4d21-ada4-18abd7b24576` | 6:57:27 PM |

These nine records were correction candidates. Creation time alone could not establish their physical receiving date or purchase date. No historical corrections were applied during this work.

## Date behavior and approval

New receiving defaults used the Oven's current local calendar date, independent of browser or server timezone. Historical received dates remained editable. Purchase dates stayed separate and were never replaced with an upload date. An inspected older receipt had a July 30 purchase date despite its November upload, and that date was preserved.

Calendar dates remained date-only strings. Added/uploaded timestamps remained actual instants and were displayed in the Oven timezone. Purchase history used the explicit heading “Received date”, displayed purchase date separately, and exposed “Added at” in record details. Receipt review also exposed its upload timestamp. Resale receiving reset its date defaults for each new receipt rather than reusing dates saved on the product.

Owners and Managers could review a proposed date, edit it, enter a reason, and explicitly approve it. The server checked ownership, role, expected prior value, and stable correction ID. Corrections appended an audit annotation containing original/previous/new dates, actor, reason, and timestamp. They did not mutate immutable ledger rows or posted journals, recreate receipts, or change quantity or cost.

Approved annotations affected purchase-history sorting and ledger-based purchase reports/CSV. Accounting reports continued to use original posted journal dates. Changing an existing journal's accounting period remained a separate accounting correction, requiring appropriate reversal/correction rather than silently changing history. New receiving entries used an entered purchase date for accounting and the received date for stock movement history.

## Verification and deployment

Automated checks covered ingredient imports, craft/fabric/yarn specifications, packaging multipacks, supplies, resale variants, the Amazon Share-link path through the shared downloader, partial/unreadable results, selected-field review, preservation of manual entries, zero-stock edits/creation, mixed receipts, stable links, weighted costs, and retry safety. Database integration checks exercised real schema constraints and cross-Oven rejection. Date checks covered the reported November 3 evening, local midnight, both daylight-saving changes, differing server timezones, older purchase dates, approval/audit behavior, and unchanged movement/journal counts during corrections.

The focused run passed 70 tests with one skipped test. The final complete suite passed 861 tests, with 15 skipped, across 100 passing test files and seven skipped files. `npm run typecheck` and `git diff --check` also passed. Live authenticated browser acceptance and live retailer retrieval were not performed. Builds and manual deployment were not run; automatic Netlify validation and publication remained pending.
