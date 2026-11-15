Subscription payment bookkeeping and application alignment

The billing success screen and Settings → Billing & Subscription gained an optional expense offer backed by verified Stripe invoices and successful captured charges. The server resolved the business from active membership and the stored checkout relationship; browser amounts and plan prices were not used to create expenses. Actual paid amounts, currencies, dates, merchant names, invoice references, discounts and tax details were retained. Existing Finance categories and its balanced journal planner were reused. “Software & subscriptions” displayed the existing Software category.

Recording required a payment account and explicit confirmation. Save for review created an ordinary Finance transaction draft without a journal or balance change; those drafts appeared on Finance Overview. Recorded payments linked to their Finance transaction details. Existing statement-import matching could match their register rows. No new automatic uploaded-receipt matching was added.

Business-specific automatic tracking defaulted off and required explicit consent plus valid account/category defaults. Successful webhook processing committed subscription access before starting a separate expense transaction. Billing-page refreshes retried reads, and a scheduled production job checked up to three opted-in checkout records every half hour. Missing/inactive defaults, closed periods and unsafe postings left payments for review. Tracking could be turned off after Finance access ended. It did not cancel subscriptions, delete entries or automatically backfill expenses.

Confirmed cash refunds became separate review items. Posting a reviewed full or partial refund created a linked contra-expense journal and preserved the payment. Credits were not treated as returned cash. Existing webhook configuration was unchanged; refunds were also discovered through billing refreshes and opted-in periodic checks. Refund adjustments required review rather than automatic posting.

The shared application page container was left-aligned against the existing main shell. Finance’s right anchor was removed while its sidebar, toolbar and internal proportions were preserved. Public layouts, dialogs and floating controls were unchanged.

| Requested view | Standard desktop | Ultrawide | Mobile |
| --- | --- | --- | --- |
| Finance | [1440px](finance-1440.png) | [2560px](finance-2560.png) | [390px](finance-390.png) |
| Inventory | [1440px](inventory-1440.png) | [2560px](inventory-2560.png) | [390px](inventory-390.png) |
| Dashboard | [1440px](dashboard-1440.png) | [2560px](dashboard-2560.png) | [390px](dashboard-390.png) |
| Settings | [1440px](settings-1440.png) | [2560px](settings-2560.png) | [390px](settings-390.png) |

| Payment view | Desktop | Mobile |
| --- | --- | --- |
| Optional offer | [1440px](offer-1440.png) | [390px](offer-390.png) |
| Review dialog | [1440px](review-1440.png) | [390px](review-390.png) |
| Tracking preference and recorded status | [1440px](preferences-1440.png) | [390px](preferences-390.png) |

Verification passed 103 focused tests across nine suites, including isolated PostgreSQL-compatible database tests for actual journal writes, drafts, provider uniqueness, tenant row security, permission denial, consent/default validation, no automatic backfill, disabled tracking, inactive accounts, discounts, tax, proration, full/partial refunds, currency mismatch and independent failure rollback. A handler test verified that billing committed before expense synchronization and still returned success when bookkeeping failed. Existing Stripe payment, webhook and subscription-change regressions passed. Nine browser checks covered all application sections, overflow, Finance navigation and five toolbar actions, plus the optional offer, review and preferences at desktop/mobile widths. TypeScript, focused ESLint and whitespace checks passed; schema generation found no further changes.

The screenshots used deterministic browser fixtures. Provider responses in automated tests were synthetic, and database tests used isolated PGlite instances; they were not live payment or production account tests. The implementation used the real existing Stripe request adapter and Finance journal planner, with no simulated success path in production code. Hosted Stripe payment/refund delivery, scheduling and email/account onboarding were not exercised. No real charges, refunds, subscriptions or customer financial records were created or changed.

A new forward migration was prepared for the payment links and preferences, with tenant policies, source uniqueness and Finance foreign keys. Applied migrations were preserved; application of the new migration and hosted validation remained with automatic deployment. No build command was run.

Existing Finance reporting supported USD. Other currencies remained available for review without conversion or posting to USD balances. A direct owner-paid subscription action was not added because the existing planner had no single owner-paid expense workflow; personally paid items could be saved for review and completed through the existing contribution/payment bookkeeping process. No automatic historical expense backfill was implemented.
