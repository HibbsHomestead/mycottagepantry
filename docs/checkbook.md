# Checkbook bookkeeping

Finance now opens the register-oriented overview. The existing technical financial interface remains under Advanced. Old finance/report bookmarks map to the corresponding new section. Bills and invoices are optional controls inside the bookkeeping sidebar and are off by default.

## Sources and treatment

The implementation reuses `journals`, `finance_transactions`, `finance_reviews`, `accounts`, receipt allocations and sales cost snapshots. It does not synthesize a second purchase or sale from receipt headers, expense copies or product-sale group headers. Existing records without linked postings appear in the overview review list. No historical business records were migrated or rewritten.

Receipt review retains responsibility for business/personal allocations, tax allocation and stock additions. A photo entered through Money out is uploaded to the existing private receipt service and saved as a draft for review; it does not also post a manual expense. Purchases and product sales can select their business money account. Receipt corrections and product-sale refunds use that recorded account.

Register balances come from posted money-account movements. Transfers and owner funding/withdrawals do not enter profit. Cash-basis bills/invoices recognize their original category allocation on settlement, with deterministic cent apportionment for partial payments. Costs locked onto product sales are included once; older production-stage consumption is not counted again alongside those sold-product costs. Mileage estimates do not create spending entries. Sales tax is a liability, separate from sales income.

Business records use the existing Netlify Database transaction, ownership settings, forced row policies and tenant foreign keys. Owner and Manager can write; the accountant role can read. Production Staff receive no finance summary/financial-table payload or receipt-file access. Every mutation is audited by the existing activity mechanism, and immutable posted records are corrected with new opposite postings. Balanced statement periods reject new backdated money-account postings at the database level.

## Imports, reconciliation and reports

Statement CSV review accepts mapped ISO date, description and signed amount columns. File previews stay unposted until the user matches a source or confirms a new transaction. Known reviewed lines and possible matches are shown; request deduplication and reviewed-line keys protect retried submissions. An import is not a bank feed.

Reconciliation includes earlier balanced statement movements and selected transactions through the statement ending date. The server requires a zero difference before recording a statement. Transactions on a completed statement cannot be cleared/uncleared or voided through the new workflow. New later corrections preserve history.

Reports use server calculations for the requested dates. Unpaid obligations are presented separately from cash-basis profit. CSV amounts are exported as decimal currency values. Print / Save as PDF uses the browser print dialog, not a hosted PDF-generation service. Summaries are not tax filings and do not determine deductibility.

## Integration boundary

The inspected Stripe integration implements Cottage Pantry platform subscriptions, rather than a merchant order/sales feed. Automatic merchant Stripe sales/payout ingestion is unavailable. No changes were made to credentials, webhook handlers, subscription prices, subscriptions or checkout activation. Verified totals can be entered manually with separate processor fees and sales tax, followed by a processor-to-bank transfer; the same sale must not also be entered through product sales. Product quantities requiring stock consumption continue through the existing product-sale workflow.

## Validation

Disposable unit and database fixtures cover splits, neutral transfers and owner money, bank-account receipt allocations, partial bills/invoices, payment reversals, request retries, inventory costs, source review, mileage, CSV matching and statement locks. Workspace API fixtures verify write roles, idempotency and finance-response privacy. Browser fixtures exercise actual components at 1440px and 390px, including optional bill visibility. Screenshots are in `docs/reviews/checkbook/`.
