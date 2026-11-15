Mixed receipt allocation extended the existing receipt inbox, original-document preview, purchasing planner, accounting journals, stock ledger, and correction services. Draft allocations were stored separately from merchant amounts and printed quantities in the existing business-scoped receipt records.

Desktop kept entries on the left and the document on the right. Mobile opened the document separately. Details and Line Items preserved edits across tab changes; the allocation summary stayed visible while scrolling. The inbox gained a Needs review filter.

Personal lines created no business transaction, expense, journal, inventory or COGS. Splits accepted percentage or money amounts; inventory required an independent business quantity, unit and confirmation. Known matching units also checked quantity/cost consistency. Proportional receipt adjustments were labeled, and custom adjusted line amounts supported actual item-specific tax, discount and fee treatment. The original total was required and reconciliation was enforced on the server.

Corrections reversed existing business effects with the existing stock-availability checks and created a linked draft with a new ID. Posted receipts, original documents, journals and historical lines stayed immutable. Correction drafts retained authorized access to the original document. Retries reused the existing correction or posting. No schema changes or applied migration edits were needed. Stripe, subscriptions, webhooks and checkout were unchanged.

Validation used synthetic browser workspaces and disposable PGlite database records. Seventy focused unit, component and database tests passed across the focused runs. TypeScript passed. Two Chromium scenarios passed at 1440px and 390px, covering multipage document navigation, desktop column alignment, mobile preview switching, draft save/resume, confirmed split stock, posting and overflow. Database tests covered cross-business and read-only rejection, original-document access after correction, duplicate upload/post/correction protection, immutability and reposting after reversal. Business-report tests excluded personal amounts and avoided counting receipt totals twice.

Negative receipt lines remained unsupported by the existing purchasing service. The review directed refunds to the existing purchase correction/reversal workflow, which was exercised with disposable records. Missing extracted lines remained blank and could be entered manually. No new AI service or model was added. Physical printer, camera and live OCR services were not exercised.

A broader workspace suite found three existing label-save/print failures. All three were reproduced with the unchanged baseline workspace handler; they were outside this receipt change.

Screenshots: [desktop review](review-1440.png), [desktop split](split-1440.png), [390px review](review-390.png), and [390px split](split-390.png).
