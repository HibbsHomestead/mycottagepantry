# Events & Pickup Days verification

Open **My Oven → Events** (`/oven#Events/List`). List, Month, Week and Day use hash navigation; refresh preserves the selected view. Month and week become stacked agendas on narrow screens. Event details reuse the product detail header, wide Radix dialog and semantic theme tokens.

## Attribution and operational rules

A sale record represents one product line, potentially with several packages. Each entire sale record can belong to one event. Other product lines from a grouped transaction may be assigned separately; individual sale-record quantities cannot be split. Original sale links bring their refunds into the same report automatically. Payment journals and grouped transaction summaries are never added as additional revenue. Matching dates, batch links and pickup assignments never attribute a sale.

Existing `orders` and `order_lines` represent purchasing, not customer orders. Customer order counts and average order value are therefore unavailable. Invoice-backed pickup scheduling uses the existing customer invoices and their recorded paid balances. Invoice pickup is independent of merchandise sales attribution. Partial invoice payments/deposits reduce pickup outstanding balances; they are not counted as event sales or a second customer receipt. Invoice reversals remain visible for operational review.

Batch links are planning relationships. Optional per-product-line reservations are limited across all linked events to planned packages, or recorded good output after completion. The workspace transaction serializes these checks. A later production change that would invalidate reservations requires reducing reservations first. Linking, completion/cancellation of an event, and pickup status changes never post stock or money. Batch output reservations are not finished-stock reservations or automatic cost allocations. Reports take COGS only from attributed sales, never from the full linked batch. Unlinking a batch releases its event reservation; cancelled events retain their links until explicitly unlinked.

Existing legacy expenses and current Finance expenses can be linked. Mirrored expense/financial records are treated as one source. Whole expenses belong to one event; split expense allocation is unsupported. Recorded expense refunds reduce linked costs and reversals zero them in current reports. Inventory, COGS, waste and processing-fee expense categories are excluded from event-expense assignment to prevent common double counting. Processing fees already recorded on sales are counted once.

## Financial definitions and manual reconciliation

The representative fixture in `src/lib/events.test.ts` uses these synthetic source records, not live customer data:

| Source | Gross merchandise | Discount | Net merchandise | Tax | Customer cash posting | Saved COGS | Processing fees |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Bread sale `a`, 10 packages | 100.00 | 10.00 | 90.00 | 4.50 | 94.50 | 30.00 | 2.75 |
| Cookie sale `b`, 5 packages | 40.00 | 0.00 | 40.00 | 2.00 | 42.00 | 15.00 | 1.25 |
| Bread refund `r`, 2 returned packages | — | — | -18.00 | -0.90 | -18.90 | -6.00 | 0.00 |

The event has a separately recorded 20.00 vendor fee. An unrelated 500.00 sale on the same date is not linked. Refund rows may carry a copy of the original discount; that copy is not counted again. The fixture’s partial negative adjustment verifies the arithmetic; it does not add a partial-refund entry workflow. The existing sale refund action remains its full-refund workflow.

Manual arithmetic:

- Gross merchandise: 100 + 40 = **140.00**.
- Discounts: **10.00**; merchandise refunds: **18.00**.
- Net sales: 140 − 10 − 18 = **112.00**.
- Net tax liability: 4.50 + 2.00 − 0.90 = **5.60**, excluded from revenue.
- Customer receipts: 94.50 + 42.00 = **136.50**. Refund payment: **18.90**. Outstanding: 112 + 5.60 − 136.50 + 18.90 = **0.00**.
- Saved historical COGS: 30 + 15 − 6 = **39.00**. Gross profit: 112 − 39 = **73.00**.
- Processing fees: 2.75 + 1.25 = **4.00**. A separate fee journal sharing sale `a`'s source ID is excluded from customer receipts.
- Event contribution after recorded costs: 112 − 39 − 4 − 20 = **49.00**.
- Contribution margin: 49 ÷ 112 × 100 = **43.75%**.
- Bread product breakdown: net quantity 8; gross 100; discounts 10; refunds 18; net sales 72; cost 24.

The fixture’s separate pickup-day invoice is 80.00 with 30.00 paid: **50.00** remains due at pickup. That pickup day has **0.00** attributed merchandise sales. The API acceptance fixture separately persists a 100.00 invoice with 25.00 paid and records its pickup independently of a sale-attribution event.

Automated assertions reproduce the arithmetic above. This is a representative source-record reconciliation, not a reconciliation of the owner’s production business data.

## Accuracy limits

Sales `amount` is merchandise revenue after discounts and before tax; negative refund rows reduce merchandise and tax separately. Gross merchandise is reconstructed only when recorded discounts have a known pre-tax basis. Legacy missing discounts or positive tax-inclusive discounts without a pre-tax discount snapshot yield “Unavailable.” Product-sale delivery/service charges have no separate field and are unavailable.

Customer receipts use posted sale/refund journal lines to Cash or business asset accounts, requiring the sale-revenue posting. COGS and fee journals sharing the sale source are excluded. Records without matching cash evidence have unavailable receipts/outstanding balances. Refund payments are separate from original receipts. Payment-method breakdowns use the original recorded method, with an explicit Unrecorded bucket.

COGS uses `historicalCogs` only. Completed-batch and finished weighted-average sources are verified recorded historical valuations. Production valuations may contain configured labor, overhead, flat packaging and waste allocations. These are recorded allocation rules, not proof that every event cost was measured or paid. Contribution is labeled as using this recorded cost basis, with a completeness warning. `current_estimate` and unknown cost sources do not produce final gross profit or contribution. Missing saved COGS stays missing; today’s ingredient costs are never substituted. Margin is unavailable for zero/negative net sales. Event contribution excludes unrecorded overhead, labor and other costs and is never labeled net business profit.

Event-specific leftovers and event-specific waste are unavailable without explicit destination stock movements. Run waste, when present, is shown as run-level information and not charged again. Produced minus sold is never called waste. Planned revenue and event expense budgets are comparisons only. Currency is the current business currency; source records do not provide a full historical multicurrency ledger.

Reports read the current linked source records, including refunds/corrections after event completion. Reports do not freeze a completed event snapshot. Export/print report includes the full explicitly attributed event, regardless of calendar search/type/status display filters, along with date range, timezone, currency, generation time, attribution basis and completeness warnings.

## Schema and security

Two new forward migrations were added: `20261217010000_add_events_pickup_days` and `20261218010000_add_event_bookkeeping_expenses`. They add events and five relationship tables for batches, sales, legacy expenses, invoice pickups and current bookkeeping expenses. Applied migrations were preserved. New tables have forced tenant row policies and composite same-business foreign keys. Sales, expenses and invoice pickups have exclusive per-business record attribution. No financial foreign key cascades from event deletion; the UI provides cancellation rather than deletion. Owner/Manager can mutate; Accountant can inspect financials; Production Staff receive planning data with financial relationships and budgets removed by the API.

## Remaining work

A customer-order/order-item workflow, line-level invoice merchandise/cost attribution, separately tracked customer service/delivery charges, pre-tax discount snapshots for tax-inclusive discounts, historical costs for legacy sales, and explicit event destination stock movements are needed before every requested financial and pickup metric can be available. Production financial completeness is not claimed. Live checkout, customer payment collection, Identity, Stripe, subscriptions, Dropbox and S3 were not exercised or changed.

## Checks completed

64 targeted Vitest tests passed across event calculations/UI, workspace routing, the full workspace API with a local Postgres-compatible migration fixture, production, Finance and bookkeeping. Coverage included all event types, event editing and validation failures, search/type/status filters, date navigation and empty states, shared batch quantity limits including cancelled runs, duplicate attribution rejection, invoice partial balances and pickup status, discounts/refunds/tax reconciliation, zero sales, missing/estimated costs, expense refunds/reversals, tenant isolation and financial role enforcement. The API acceptance case compared ingredients, products, batches, sales, expenses, movements, journals, purchase orders and financial transactions before and after event linking/cancellation and found them unchanged.

Three Chromium browser scenarios passed. They exercised all eight themes in light and dark modes at 390px and 1440px (32 palette/mode/viewport combinations), checked page/dialog overflow and financial-label text size, opened event details from calendars, switched through List/Month/Week/Day, dismissed dialogs by keyboard, edited an event, downloaded CSV and generated a two-page print report. Synthetic fixtures included overlapping timed events, an all-day event, a multi-day event and a long name. The dark-mode print check verified dark heading text on white. The resulting PDF was parsed and visually inspected for financial sections, warnings, source IDs and notes; the underlying workspace was excluded from printing.

TypeScript, focused ESLint, formatting and whitespace checks passed. No production build was run because builds are reserved for the platform’s automatic validation. No migrations were applied to a remote database in this run. Browser and database fixtures used synthetic data; no authenticated production financial reconciliation or live checkout/payment test was performed. Sample screenshots, CSV and PDF in this directory are explicitly synthetic review artifacts.
