# Receipt popup and finance overview verification

The editor stayed a popup, following the final requested layout. Editable details and lines shared the left column, the original document filled the right, and actions remained in a fixed footer. Required receipt total and live difference stayed beneath the table. Details and history moved into a drawer; core editing required no tabs. The table retained one total row, and business/personal amounts appeared only for mixed receipts. Personal lines remained recoverable with Show excluded items and Restore.

## Screenshots

- [Desktop, 1366 × 768](popup-1366.png): eight confirmed lines, $25.00 receipt total, zero difference, and enabled Post.
- [Desktop, 1440 × 800](popup-1440.png).
- [Mobile, 390 × 844](popup-390.png).
- [Missing receipt total, desktop](missing-total-1366.png) and [mobile](missing-total-390.png): visible, focused input.
- [November overview](november-overview.png): $20.41 inventory acquisition, zero operating expenses, and one pending review.
- [Reference comparison](comparison.png): supplied SparkReceipt reference on the left, Cottage Pantry popup on the right.

The screenshots used the real rendered application with disposable browser fixtures and intercepted workspace requests. FordlandCBA was reproduced as a failed-extraction receipt with manually confirmed lines totalling $25.00; no private live receipt was fetched or edited. The PDF preview was synthetic. Paid extraction was not invoked. The supplied reference image was retained only for visual comparison.

## Checks

Four Chromium scenarios passed: desktop at 1366 × 768 and 1440 × 800, mobile at 390 × 844, and the November overview. Desktop assertions checked that all eight lines fit without scrolling the popup, editor pane, or line table. Receipt total received focus when missing; entering $25.00 produced Difference $0.00 and enabled Post. November checks verified spending, pending review, newest-first receipts, selected-period filtering, and the absence of false empty states.

126 focused unit, component, and database tests passed. These covered the $20 business / $10 personal / 8% tax example, restoration, actual and estimated tax allocation, mixed tax rates, discounts, split lines, rounding, saved document business amounts, posting, duplicate protection, correction/reversal, and tenant isolation. Unpaid bills remained expenses while spending counted their payments. The existing authoritative posting and original-receipt snapshot logic were reused.

TypeScript checking passed. Builds were left to platform validation. No applied migrations, posted records, stock balances, tax data, billing, Stripe, or live checkout were changed.
