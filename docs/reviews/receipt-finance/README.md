# Receipt workflow and finance dashboard review

The receipt editor now follows Capture → Process → Review → Confirm. It retains the original document, starts with a compact summary, and opens one item editor at a time. Phone layouts use stacked rows and a thumbnail with a dedicated receipt viewer. Returning from the viewer restores the editing position and corrections. Failed or partial extraction retains usable values, and manual entry works without a document or extraction provider.

Direct line amounts and quantity × unit-price entry now calculate totals immediately. Matching uses the existing inventory catalogs, expense categories, and shared inventory-creation dialog. Business expenses and personal purchases do not require inventory items. New inventory creation requires explicit approval and does not receive stock. Confirmation explains the expense, inventory acquisition, personal allocation, quantities, and unresolved items before using the existing atomic posting workflow.

Finance Overview now includes colorful summaries, a shared date filter, monthly income/expense bars, expense categories, scoped attention lists, searchable underlying records, and existing quick actions. Other finance pages, reports, product/ingredient layouts, kit calculations, billing, registration, integrations, and artwork were preserved.

## Receipt calculations and posting

- Monetary lines use decimal parsing and integer cents, with half-up rounding once per line. Quantity × price and direct-amount modes remain distinct from stock quantity and package contents.
- The calculated subtotal is the sum of net line amounts after additional line discounts. Existing extracted net amounts and their informational discounts are not discounted again.
- Tax-exclusive total = calculated subtotal − additional receipt discount + receipt tax + additional shipping/fees + explained rounding adjustment. Tax-inclusive receipts retain included tax without adding it again. Unknown tax or treatment remains incomplete.
- The optional printed/imported total remains separate. Differences block posting until explicitly resolved. The existing rounding policy allows an explained adjustment of at most five cents; larger differences require correcting missing or incorrect receipt values.
- Personal lines contribute to the full receipt total. Receipt-level adjustments are allocated proportionally in cents across business and personal lines, retaining the existing acquisition-cost policy and an exact final total.
- Saving drafts, reading documents, matching items, and uploading files do not post expenses or receive stock. Final confirmation uses the existing Cash-account posting policy and records stock, valuation, expense, and journal effects atomically. Personal amounts retain the existing owner-draw treatment.
- Already posted v2 receipt retries produce no further effects. A lost response is checked against saved receipt status. A failed confirmation rolls back all effects. Historical posted records are not recalculated or rewritten.
- Same-file posted receipts remain blocked. Merchant/date/amount evidence produces a possible-duplicate warning requiring explicit review. Existing supported expense/bill attachment saves corrections and links the receipt without another expense or stock event; it does not imply a new bank-import integration.

## Dashboard definitions

| Figure | Source and scope |
| --- | --- |
| Recorded income | Canonical saved product-sale amounts excluding tax, including signed refund/discount effects, plus consignment commission and approved deduction income. |
| Recorded expenses | Saved non-inventory expense rows, including recorded bills, plus product-sale processing fees and the business share of consignment fees. Signed reversing rows remain on their recorded dates. |
| Income less expenses | The two figures above subtracted in cents. Before cost of goods sold; neither accounting profit nor available cash. |
| Sales tax collected | Saved product/consignment sales-tax collections and signed refund adjustments within the selected period. Not outstanding tax liability. |
| Trend/categories/underlying rows | The same canonical records and date range as the summary cards. Selecting a month or category opens its source rows. |

Draft/pending/cancelled/failed records are excluded from figures. Receipt headers, matched purchase transactions, bill payments, owner activity, transfers, and processor payouts are not summed again. Inventory acquisition remains an asset rather than an operating expense. No records show a dash; missing amounts show “Incomplete”; recorded zeros display $0.00. Attention lists use the selected period and explicitly include undated receipt drafts. Reconciliation status is distinct from an imported bank match.

## Data and migration status

No schema change or migration was required. All applied migrations remained unchanged. New receipt arithmetic and review fields were stored additively in the existing receipt/line JSON, with `arithmeticVersion: 2` identifying new calculations. Existing Netlify Database persistence, private receipt storage, ownership checks, row-level security, stock ledger, immutable records, and audit history were retained. Existing posted records kept their original behavior.

## Verification

The final functional run passed **116 tests across 13 suites**. It exercised receipt arithmetic, complete/partial/failed extraction fixtures, manual completion, quantity/price changes, discounts, inclusive/exclusive tax, shipping, mismatch blocking, personal allocation, item matching/creation, duplicates, existing-expense attachment, draft/reopen, retries, atomic rollback, lost-response recovery, financial definitions, camera-scanner behavior, and product/ingredient/kit regressions. Database checks called the real workspace handler against disposable PGlite data, including cross-business access denial and reader/write authorization. Customer business records were not used for test postings.

Reproduction command:

```sh
npx vitest run src/lib/receipt-totals.test.ts src/lib/receipt-document.test.ts src/lib/receipt-extraction.test.ts src/lib/receipt-database.test.ts src/lib/finance.test.ts src/lib/finance-dashboard.test.ts src/components/finance-receipt.test.tsx src/components/finance-workspace.test.tsx src/components/barcode-scanner.test.tsx src/components/ingredient-detail.test.tsx src/components/product-editor.test.tsx src/components/kit-details.test.tsx src/lib/product-kits.test.ts
```

All **7 receipt/dashboard browser tests passed** at phone, tablet, and desktop widths. They covered automatic totals, line removal, manual entry, partial/failed extraction, multipage preview, explicit item creation, exact scroll restoration, saved corrections, reduced viewport height with a focused field, date-filter drill-downs, horizontal overflow, and reachable confirmation. The baseline receipt fields measured 12px; the new finance fields measured at least 16px. Pinch zoom remained enabled and camera initialization was unchanged.

```sh
npx playwright test tests/receipt-finance.spec.ts tests/receipt-review.spec.ts --workers=1 --reporter=line
```

The earlier combined 27-test browser run passed 26 tests and failed one unchanged kit-photo geometry assertion by 0.000061px. That exact assertion subsequently passed on the original baseline and current source. All 27 distinct checks therefore passed across the run and targeted rerun; the initial failure was not hidden or weakened. No kit source, assertions, or review artifacts were changed.

TypeScript passed (`npx tsc --noEmit`), new production modules passed ESLint, and `git diff --check` passed. The existing changed modules retained 135 baseline ESLint errors with matching per-rule counts; whole-project lint was not clean. The final component rerun passed all 17 checks without unhandled errors after adding the missing JSDOM scroll API shim; actual scrolling was checked in the browser. No build command was run; automatic platform build validation remained pending.

### Unverified and limited

Testing used Chromium viewport emulation, not physical iPhone/iPad Safari. Keyboard coverage simulated viewport-height changes; it did not prove real Safari keyboard behavior or focus-zoom behavior. WebKit could not run because required system libraries were unavailable. Camera/microphone permission behavior on physical devices was not revalidated.

Live receipt extraction and its accuracy on the owner's documents were not tested. The existing reader/provider was retained, with no paid extraction integration or model change. Complete/partial/failure results were tested with controlled fixtures. Manual entry and review remained usable when extraction was unavailable. HEIC/HEIF preview still depended on the existing conversion/browser support, with the original available through the viewer. The referenced screenshots were not accessible as attached files in this run; the supplied written visual requirements guided the design.

## Before/after evidence

Each pair used the same synthetic fixture and viewport. Finance captures were full-page images; receipt captures showed the initial review position. The initial total was intentionally incomplete until the unknown tax treatment was confirmed.

| Viewport | Finance before | Finance after | Receipt before | Receipt after |
| --- | --- | --- | --- | --- |
| Phone · 390 × 900 | [Before](before-finance-390.png) | [After](after-finance-390.png) | [Before](before-receipt-390.png) | [After](after-receipt-390.png) |
| Tablet · 768 × 900 | [Before](before-finance-768.png) | [After](after-finance-768.png) | [Before](before-receipt-768.png) | [After](after-receipt-768.png) |
| Desktop · 1440 × 900 | [Before](before-finance-1440.png) | [After](after-finance-1440.png) | [Before](before-receipt-1440.png) | [After](after-receipt-1440.png) |

[Phone receipt-editing demonstration](phone-editing-demo.webm) · [Phone confirmation](phone-confirmation.png)

The 390 × 844 demonstration entered 2 × $6, changed a line discount, observed immediate totals and mismatch feedback, recovered from a failed extraction retry without losing edits, saved a draft, reviewed $21.00 business expense and $4.20 personal allocation, confirmed once, and reopened the preserved receipt record. It used synthetic Meadow Supply evidence and made no real business posting.

## Repository and deployment status

Implementation and evidence were present locally on `main`, based on the latest main revision verified at task start: `fe0725297eccc86b89f71c295faecea9fd76bc73`. The supported publishing mechanism was the platform's automatic recording and publishing of workspace changes after the run. No direct commit, branch creation, pull-request creation, or deploy command was used.

At the final status check on November 11, 2026, no new commit ID or pull-request URL had been assigned. Repository publication and automatic deployment of these edits remained pending platform processing. The required next platform action was to record/publish the workspace changes and run automatic deployment validation.

Production at <https://mycottagepantry.com> remained ready on deployment `6af3282bec947661e15148fa`, branch `main`, revision `fe0725297eccc86b89f71c295faecea9fd76bc73`, published November 10, 2026. That deployment predated this implementation. No new deployment URL or deployed verification was available; the screenshots and test results demonstrated the local implementation only.
