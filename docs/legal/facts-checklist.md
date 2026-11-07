# Consolidated Terms and Privacy review package

Status: **proposed, not final, not published**. Review date: November 1, 2026. This package supersedes the earlier open-ended checklist. It contains proposed legal language rather than asking the owner to draft legal clauses. No further questions were raised in this preparation pass.

| Document | Exact proposed revision | Effective date |
| --- | --- | --- |
| [Proposed Terms](./terms-DRAFT.md) | CP-TERMS-2026-11-01-R1 | To be confirmed at final approval |
| [Proposed Privacy Policy](./privacy-DRAFT.md) | CP-PRIVACY-2026-11-01-R1 | To be confirmed at final approval |

Both documents are complete proposals except for the marked factual gaps. Conditional disclosures and proposed processes remain visibly qualified; neither document is ready to represent all production practices as verified. Changing the text after review requires a new revision. Owner authorization to prepare these documents is not approval of these exact completed versions or acceptance on behalf of application users.

## Owner facts still blank

The owner's answer identified the following facts as owner-supplied but did not supply values. Product names, demo records, site account names, and domains are not substitutes.

| ID | Required fact | Current value |
| --- | --- | --- |
| O1 | Exact legal operator name | Not supplied |
| O2 | Entity type | Not supplied |
| O3 | State and country | Not supplied |
| O4 | Public business/mailing address, if applicable | Not supplied; applicability must be confirmed |
| O5 | Working support email | Not supplied |
| O6 | Working privacy email | Not supplied |
| O7 | Intended minimum user age | Not supplied |
| O8 | Initial launch countries | Not supplied |

## Implementation findings and evidence

Evidence below comes from current source inspection, not production traffic, account data, environment values, delivery receipts, vendor contracts, or a runtime audit. “Implemented” means a callable code path exists, not that a provider has received production data. No credentials or business records were inspected.

| Topic | Confirmed implementation | Active versus unknown | Source evidence |
| --- | --- | --- | --- |
| Hosting and authentication | Netlify Functions and Identity; server verification and workspace membership checks | Core dependencies; real-provider login success was not retested for this documentation task | `netlify/lib/verified-session.ts`, `netlify/functions/identity.mts`, `netlify/lib/account-access.ts` |
| Structured records and files | Netlify Database and Blobs; tenant ownership and role checks | Core storage paths; provider retention and processing regions not verified | `db/schema.ts`, `netlify/functions/workspace.mts`, `netlify/lib/support-core.ts` |
| Browser fonts | Stylesheet imports Google Fonts; label fonts also have a server fetch route | Included application requests, not merely a planned integration; browser/network delivery not tested | `src/styles.css`, `netlify/lib/google-label-font.ts` |
| Analytics and advertising | No analytics SDK, ad pixel, session replay, or ad integration found in inspected source | Hosting-level analytics, script injection, external business practices and sale/sharing unknown; no blanket “no tracking” claim | `src/routes/__root.tsx`, source-wide tracking searches |
| Assistant AI | Netlify AI Gateway path using Perplexity Sonar; feature and gateway checks | Conditional implementation; production activation, invocations, contracts, and provider retention unknown | `netlify/lib/cottage-assistant.ts`, `netlify/lib/feature-flags.ts`, `src/lib/cottage-assistant.ts` |
| Receipt AI | Google Gemini extraction after AI feature check | Conditional implementation; production activation and transfers unknown | `netlify/lib/receipt-extraction.ts`, `netlify/lib/feature-flags.ts` |
| Shopping search | SerpApi request path requiring release gate and configuration | Conditional implementation; production enablement and use unknown | `netlify/lib/price-search.ts`, `netlify/lib/feature-flags.ts` |
| Account email | Identity account email workflows | Sender, underlying transport, delivery and retention not confirmed | `src/components/login-page.tsx`, Identity integration |
| Support email | Postmark adapter; production-only approval, sender, recipient and settings checks; ticket-link notifications | Conditional implementation, not confirmed active; storing a ticket does not prove delivery | `netlify/lib/support-mail.ts`, `netlify/lib/support-settings.ts` |
| URL imports | User-requested recipe/product HTTPS fetching and optional image retrieval | Implemented; successful access depends on source restrictions, no retailer-wide support established | `netlify/lib/product-import.ts`, `netlify/lib/recipe-import.ts`, `netlify/functions/workspace.mts` |
| Billing | Square Sandbox code and historical billing state exist | Separate from current free account journey; no subscription, checkout, payment or card requirement added | `netlify/lib/square-sandbox.ts`, `netlify/lib/free-registration.ts` |
| Printing | Browser printing and optional QZ adapter/signing paths | Implementation does not establish installed local software, connectivity, or a hosted printer recipient | `src/lib/qz-bridge.ts`, `netlify/lib/qz-print.ts` |
| Cookies and local storage | Session mechanisms, selected workspace, demo session and print-device cookies; local appearance cache | Print-device maximum age is one year; complete SDK/platform storage inventory and lifetimes unknown | `netlify/functions/workspace.mts`, `src/lib/appearance.ts`, `netlify/lib/account-access.ts` |
| Diagnostics | Sanitized verification failure classifications, timing, trace and provider status | This establishes inspected access-log fields only; platform logs and retention unknown | `netlify/lib/verified-session.ts`, `netlify/lib/account-access.ts` |

## Current data capabilities and limits

| Area | Current capability | Missing or unverified |
| --- | --- | --- |
| Retention | Persistent records/files; immutable operational/accounting history in selected workflows | No supplied category schedule, universal purge, verified provider/log/backup expiry, or approved retention period |
| Correction/deletion | Individual workflow updates and replacement records where allowed | Record edits or SQL deletions are not a complete erasure process; no verified coordinated Identity, database, file, support, log and backup cleanup |
| Export | CSV reports and JSON snapshot of client workspace state | Not complete portability, attachments/support export, or verified round-trip recovery |
| Backup | User-triggered JSON download | Settings explicitly say automatic scheduling and restoration are unavailable; platform backup coverage, expiry, and restore capability unverified |
| Account closure | Authentication and membership controls exist | No verified complete self-service closure or documented manual fulfillment process; logout is not deletion |
| Requests | Support tickets/messages and role-protected support workflows exist | No supplied monitored privacy mailbox, assigned handler, request verification procedure, rights register, or response commitment |

Export evidence: `src/components/workspace-app.tsx` constructs the JSON download from workspace state; `src/lib/reports.ts` and `src/lib/domain.ts` support CSV; `src/components/settings-workspace.tsx` states backup limitations. Stock/production/accounting controls in `netlify/functions/workspace.mts` and migration triggers explain why correction does not always mean overwriting or deleting history. No applied migration was edited.

## Exact owner/operator actions before publication

1. Supply O1–O8 once. Establish monitored support/privacy mailboxes, test receipt, assign a responsible handler and a backup handler. No response-time promise is proposed beyond applicable law.
2. Establish a request register with restricted access. Define how the handler verifies identity and workspace authority without collecting unnecessary documents, resolves other members' interests, identifies applicable rights, records decisions, and communicates results or limits.
3. Verify the actual production feature status and settings for AI, shopping search, and support email using authorized administration. Check provider-side invocation/delivery records if asserting actual use. Resolve conditional paragraphs to enabled, disabled, or unavailable status before publishing; never infer activation from credentials or adapters alone. No new service purchase is requested.
4. Verify production analytics, injected scripts, cookie/storage behavior, account email transport, operational administrator access, and provider contracts/locations. Determine whether regional transfer disclosures or processor terms are required. No full production audit was performed here.
5. Inventory database records, Identity accounts, Blobs, support records, diagnostic logs, providers and backups. Assign retention purposes and justified periods or review criteria to each. Document legal/accounting holds and how immutable business history is handled. No schedule is supplied by this package.
6. Create and verify a manual fulfillment runbook for access/export, correction, closure and deletion. Identify what can safely be done now, required tooling for remaining stores, provider cleanup steps, membership effects, and what cannot yet be erased. Do not promise erasure until those steps are workable. Any future destructive action requires its own task authorization; this package performs none.
7. Establish a workable material-change notice procedure and incident owner. Review the proposed governing-law clause, eligibility, privacy roles/legal bases, rights and regulator disclosures against O3/O8. The proposed liability wording uses applicable law without an invented cap, arbitration or indemnity requirement.
8. Review the resulting exact completed revisions together and confirm their effective date at final approval. If resolving gaps changes these texts, increment revision identifiers before that review. Publication must reproduce the approved versions; users must explicitly consent for themselves through the registration flow.

These are factual completion and operational actions, not a second set of repeated questions. Proposed future procedures in the drafts do not assert current capabilities. No retention schedule, automatic deletion, support SLA, or paid-service terms were invented.

## Application boundary

The registration policy configuration remains empty in `src/lib/free-registration-policy.ts`. The proposed revisions are not wired to public policies or consent. No acceptance record, workspace activation, account deletion or reset was created. Existing-account login and membership resolution remain independent of policy readiness. No application source or database migration was changed for this review package.
