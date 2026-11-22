# Square sales CSV imports

Sales → Sales → Import sales accepts customer-owned Square CSV exports. This is separate from Cottage Pantry subscription billing. Imports are reporting only: they never change ingredients, packaging, finished goods, product prices, recipe costs, purchases or accounting journals.

## Supported reports

- Item-detail CSV: individual sold items, quantities and net sales, ideally with transaction/order/payment and stable line-item IDs. A Square Item Sales summary is not item detail.
- Transaction CSV: sale-level net sales and available tax, tips, service charges and processing fees. Payment totals are never substituted for net sales.
- Summary CSV: explicitly identified aggregate reporting, retained in import history and excluded from the sales ledger so overlapping detail cannot double count it.

The wizard inspects headers and samples and allows column corrections. Date and net-sales columns are required. Money supports decimal-point currencies with at most two decimal places, currency symbols, grouping commas, negatives and parentheses. Blank amounts remain unknown. Available subtotals are not evidence that absent amounts were zero. Dates support four-digit MDY, DMY and ISO forms; choose the reporting timezone. Offset timestamps are converted to that timezone, while wall-clock source values remain preserved. Files are limited to 2 MB and 2,000 rows.

Export guidance was checked on 22 November 2026 against [Square's report export instructions](https://squareup.com/help/us/en/article/8362-print-export-or-email-your-reports): in Square Dashboard, open Reports, choose the report and date/location filters, select the export icon, use the gear to include available columns, and start the export. Square's transaction-status pages cannot export. Availability and columns vary by account and report; use an actual transaction or item-detail CSV rather than assuming an aggregate has sale identifiers.

## Review and product matching

Upload and stage do not post sales. Review report type, dates, locations, currency, row exclusions, mappings, reconciliation differences and before/after ledger impact before confirming. Select whether tax/tips/fees/service charges in an item report repeat at transaction grain or belong to each item. Choose the source processing-fee sign convention explicitly. Source cells remain preserved.

Saved mappings take priority, then an exact unique SKU. Suggested names require selection. All product workflows are available, unmatched sales remain included in financial totals, and unmatched items have a separate view. One Square quantity normally means one sellable package. A different conversion requires an explicit multiplier; names such as “3-pack” never cause automatic multiplication.

Only the bakery's reporting currency can enter its shared sales ledger; no currency conversion occurs. Aggregate summaries retain currency-labelled totals separately. Net sales are preserved as exported: discounts and refunds are not subtracted a second time. Tax, tips, fees and service charges remain separate. Bank payouts are not imported as sales. Current product costs are not substituted for unavailable historical costs; imported-cost profitability remains incomplete.

## Duplicate handling and audit

A stable seller account reference namespaces identifiers and mappings. Reuse it consistently. File fingerprints prevent repeated committed files, and date overlaps require review. Order, transaction and payment identifiers link complementary exports; line identifiers preserve multiple items in one transaction. Identical legitimate sales with distinct IDs remain distinct. Transaction-level extras are counted once. Differences between transaction and item net sales remain explicit unallocated amounts.

Overlapping item reports without stable line IDs are blocked rather than guessed. Reports without sale IDs require explicit review and cannot guarantee overlap prevention. Split-payment orders, conflicting corrections and unsupported number formats are rejected with explanations. Manual-sales overlaps are flagged, never automatically merged. Do not import the same seller under different reference names.

Commits and reversals run inside the bakery-authorized database transaction and existing workspace lock. The immutable shared sales ledger receives signed adjustments; previous sales are never edited or deleted. Undo reverses only the selected import's contribution while keeping manual sales and complementary imports. File names, original cells, normalized rows, importing user, choices, warnings, statuses and audit history remain available. Saved mappings remain after undo.

## Direct Square connection

Square OAuth and syncing are not implemented. A future adapter must resolve the same seller and source identifiers into this reconciliation model. It still needs per-bakery OAuth with minimum read permissions, secure server-side token storage and refresh/revocation, merchant identity reconciliation, location and initial-date selection, pagination, retry and incremental-sync handling, updated order/refund reconciliation, and signature verification if webhooks are introduced. Customers must never paste private access tokens into the browser.

## Simulated data and validation

The isolated demo offers fictional Square-style item, transaction, overlap and summary fixtures under `/demo/`. They include multiple locations and items, a partial refund, discounts, tips, fees, an unmatched item and distinct legitimate identical sales. The base detail and transaction files each describe net sales of USD 34.00, tax 2.04, tips 2.00 and fees 1.58; importing both retains those totals. The overlap adds USD 6.00 rather than recounting its repeated rows.

Automated tests exercise parsing and reconciliation, the actual workspace handler with migrated PostgreSQL-compatible tenant policies, transactional retries, product ownership, roles, mappings, reversal, and unchanged inventory and product data. Browser tests cover the staged wizard and product controls at desktop and mobile widths.
