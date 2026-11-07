# Business help desk — architecture proposal

This proposal supersedes the notification-only support direction. It does not activate a service, email address, public form, DNS change or migration. The existing in-app ticket system remains intact. No personal mailbox is connected or imported.

## Recommendation

Use **Freshdesk Growth with a small server-side Cottage Pantry bridge**, subject to owner selection and the acceptance checks below. Freshdesk becomes the single support conversation store, email processor, public help center and private agent inbox. The app supplies verified requester context and a secure link; it does not grow a second email client. This is the hybrid option, with a dedicated service doing the mail and help-desk work.

For a one-agent launch this has a slightly higher fixed service cost than custom mail transport, but substantially less engineering and ongoing responsibility for MIME parsing, reply routing, malware screening, agent composition, drafts and delivery failures. Disable all provider AI, chat, campaigns, automated outreach and trial AI features. Their inclusion in a provider plan is not permission to use them.

Two material limitations require review: **Freshdesk personal ticket-reply drafts last only 24 hours, are not shared and do not cover public/private notes**; durable new-outbound drafts must be tested separately. Also the agent inbox is normally `https://<chosen-tenant>.freshdesk.com/a/tickets`, not a promised `support.mycottagepantry.com/admin` application. A future `/admin` entry may link/redirect to the verified agent portal but must not bypass its authentication. If persistent drafts for every compose mode or the exact private URL are non-negotiable, choose a custom implementation after estimating that scope. Neither limitation is silently treated as satisfied.

## What exists today

`/support` and `/platform-support`, backed by `/api/support`, provide authenticated requester-only tickets, replies, screenshots, private support notes, statuses and protected notification settings. Platform roles are separate from workspace roles. Netlify Database stores records with forced row-level policies; Netlify Blobs stores private normalized screenshots. These records must be preserved.

The optional Postmark adapter is **notification-only and disabled**. It does not receive mail or thread email replies. It says “Reply in Cottage Pantry.” It is not a business inbox and has not passed real sender/delivery tests. There is no public searchable help center, external inquiry workflow, proactive email composer, CC/forwarding workflow, assignment, spam/archive management or general email drafts. No current feature should be described as a connected email help desk.

## Options and verified provider requirements

Public official pages were fetched for this revision. Prices below are USD, exclude taxes, account-specific discounts, mailbox costs and support labor; checkout terms and region remain to be checked before any purchase. A trial is not production readiness. No accounts were created.

| Requirement | A. Dedicated service: Freshdesk Growth | B. Custom: Netlify + Postmark Pro | C. Hybrid: recommended |
| --- | --- | --- | --- |
| One-agent price | **$23/month** month-to-month, or **$19/agent/month billed annually ($228/year)** | **$16.50/month** starting at 10,000 sent/received emails; Netlify usage, mailbox/routing and engineering extra | Growth price + existing Netlify usage for a small bridge; mailbox/routing extra |
| Custom domain | Custom public portal URL and SSL after DNS verification; branding settings need a selected-account check | Exact public and private routes under our control | Provider-hosted branded `support.mycottagepantry.com`; app remains separate |
| Public help center | Searchable knowledge base and customer portal included in Growth | Must build article publishing, search, access and contact handling | Use provider articles, search, contact and secure portal |
| Private inbox | Provider agent portal; exact `/admin` not promised | Can build `/admin`, with separate strong agent auth | Provider inbox; app links there for authorized staff |
| Inbound/outbound | Email ticketing and replies; custom-address incoming mail requires forwarding or a supported mail server | Pro includes inbound processing and outbound transport; these do not supply an inbox | Provider processes all email; no duplicate notification transport |
| New outbound / CC / forwards | New Email requires explicit admin enablement; recipients, CC/BCC and forwarding documented | Must build recipient validation, composer, headers, drafts and sent-state handling | Native composer and forwarding; app does not become an email proxy |
| Drafts | Personal reply drafts: 24-hour lifetime; not shared or for notes. Outbound-draft durability unverified | Can build durable private drafts and autosave | Same native draft limitations; a release decision, not an assumed capability |
| Attachments | Typically 20 MB per email on paid plans; secure-download login setting and malware scanning documented | Validate/quarantine private Blobs; screenshot-only initially; scanning required before broader types | Provider secure attachments for email; app screenshots uploaded server-side after authorization |
| Ticket export | Admin account export includes ticket content in XML; ordinary ticket CSV is not a full conversation/attachment backup | Build complete permission-controlled export, including references to retained files | Preserve legacy export, plus provider account/API export; verify attachment completeness by restore test |
| App/account integration | Public contacts and provider customer portal exist independently of app accounts | Full native integration, fully our responsibility | Thin server API bridge with verified identity and authorized workspace context; no business-record replication |
| Security | Provider customer/agent permissions and secure-attachment settings; configure strong agent auth and test tenant/account settings | Full responsibility for strong auth, public abuse, HTML, uploads, token links, audits and isolation | Provider secures agent/mail surface; app enforces requester ownership on its bridge |
| Maintenance / limits | Mail fair-use **250 outgoing emails/hour** on Growth; API **100 calls/minute**, ticket create/update 50/min, ticket/contact list 40/min | Pro base 10,000 emails, then **$1.30/1,000**; default provider activity retention 45 days; app storage/retention separate | Service limits plus bridge outbox, reconciliation and provider-outage handling |

Growth includes ticketing/shared inbox and a customer portal/knowledge base on its current pricing page. Its custom-portal, outbound, export, attachment and draft requirements are supported by the official articles linked below. The broad current/legacy plan badges on some articles are not sufficient proof of every account setting: verify secure customer access, branding depth, required status labels, agent MFA enforcement, compose-mode draft behavior and export completeness in a selected-plan sandbox before commitment. Enterprise-grade account audit logs/IP restrictions are advertised on higher tiers; do not assume Growth includes those. Ticket activity history is distinct from full administrative audit coverage.

**Alternative dedicated shortlist:** Help Scout currently displays Standard **$25/user/month**, Plus **$45/user/month**, Pro **$75/user/month**. The pricing page places its **secure customer portal in Plus**; Standard alone should not be presented as meeting that requirement. Standard API access is listed at 200 calls/minute. Its Free plan lists five users, one inbox, one Docs site, 100 contacts/month and 10 articles. Free is not assumed to satisfy custom-domain branding, API bridge and secure ticket access. This proposal does not rely on a free help-desk plan. Annual discount and any extras need an actual quote; they are not assumed here.

**Custom transport correction:** Postmark Basic is $15/month but the current pricing page places **inbound processing in Pro ($16.50) and Platform ($18)**. The earlier notification-only Basic budget is not a valid full inbound/outbound architecture budget. Pro includes 10 sending domains and 45-day default activity retention. Its activity history is not the durable ticket store. App support would still need Netlify Database/Blobs and operational monitoring. No paid service is enabled.

## Domain and mailbox audit / owner configuration

A read-only public DNS lookup found **no MX or TXT records for `mycottagepantry.com`** and no resolving MX/CNAME/TXT records for `support.mycottagepantry.com` during this audit. This is a point-in-time DNS observation, not a complete registrar/account audit. No personal accounts were inspected. It does **not** prove whether an individual mailbox, forwarding rule or purchased email subscription exists. `support@mycottagepantry.com` is the owner's proposed address, not an established/verified mailbox. Purchasing a domain does not create mail service. No SMTP recipient probes or live test emails were sent.

Owner/account work, after selection:

1. Confirm the registrar/DNS owner, current authoritative zone, existing mail service/aliases and any existing recipients. Choose a **dedicated business support address**, never the personal mailbox. Choose the provider tenant/region, budget, retention and acceptable draft/URL limitations. Review data-processing terms and agent access security.
2. Create the approved help-desk account with one agent, strong MFA and a separately secured recovery method. Grant additional support agents deliberately; customer workspace roles grant no agent seats. Turn off AI and unsolicited automation immediately, including trial defaults.
3. Set the public portal hostname to `support.mycottagepantry.com`. Add only the exact **provider-generated CNAME/verification records** after approval. Freshdesk provisions SSL after verification (documentation allows up to 24 hours). Review CAA and proxy requirements. Do not guess a CNAME target, change website apex/www records or move nameservers merely for this setup.
4. Confirm or provision mailbox/forwarding service for `support@mycottagepantry.com`. Freshdesk's custom-address incoming path needs a mailbox/route forwarding to its generated ingestion address, or a supported mail-server connection. A separate business routing/mailbox subscription may be needed. It is not the personal inbox and is not assumed included in Growth. Request an exact provider quote before purchase; **$1–$6/month is a budgeting assumption, not a verified mailbox offer**.
5. Authenticate sending with the selected provider's DKIM records and reviewed SPF/return-path configuration. Merge authorized SPF senders into the existing single SPF policy; never add conflicting SPF policies. Review aligned DMARC initially in monitoring mode as appropriate, then enforcement after evidence. Preserve all existing website/mail DNS records and verify the actual zone before changing anything.
6. Verify the support sender and use `Cottage Pantry Support <support@mycottagepantry.com>`. Configure reply routing to the same help-desk conversation. Configure an optional **private notification destination separately**, with recipient confirmation; it has not been supplied or inferred. No personal mailbox import is needed. Until a deliberate email cutover passes testing, existing in-app notifications must continue to instruct users to reply in the app.

Provider-account confirmation and approval are outstanding. Read-only DNS checks incur no provider signup; hiding or changing app UI does not cancel any existing external subscription.

## Public and private page outline

**Public root:** branded logo, cream/purple colors, accessible article search, six task-oriented help categories, and links to Contact support, Pricing/general inquiries, Account/login help and My conversations. Article examples: entering a package price, reviewing a recipe import, receiving versus pricing stock, completing an individual batch, reviewing a label, and exporting records. Publish only reviewed instructions for implemented features.

**Public contact:** no paid plan or app identity requirement. Email, subject, one category and message; supported optional screenshot. Categories: General question, Pricing / pre-sales, Account / login, Billing, Bug / technical issue, Feature request. Keep an obvious “I can’t sign in” route that never asks for a password. Do not reveal whether an address has an app account. Use generic acknowledgment, body/upload limits, spam screening and rate limits. New external contacts remain support contacts only: no app user provisioning, workspace creation or entitlement grant.

**Secure ticket access:** require the provider's verified customer identity for the portal, or a reviewed expiring single-use email-access link. Contact without an app account must work. A ticket number is display/search information, never an access credential. Turn off unauthenticated public ticket links; secure attachments require login. Whether the selected plan can enforce these settings for all paths is a launch gate. Do not claim native expiring links exist if unverified.

**Private inbox:** provider agent URL as disclosed above. Left navigation for inbox, assigned/unassigned, drafts (with lifetime notice), waiting, resolved, spam/archive and articles; main search/category/status/assignee filters; conversation view with requester, minimal app context, explicit Reply/Forward/Private note modes, CC review, attachments, delivery failures and action history. New email composition is one-to-one business support only. Map New / In progress / Waiting on customer / Resolved to provider statuses/custom fields, preserving provider closed/spam/archive distinctions. Verify exact status customization in Growth before promising labels. No 24/7, live-chat or response-time promises.

## Data and permission model

The provider stores contacts, tickets, messages, attachment references, assignee/group and internal notes. The app keeps **minimal Netlify Database bridge records**, not a second conversation database:

- `support_contact_link`: provider contact ID, verified app user ID when present; email alone does not establish app identity. External-only contacts have no app user/workspace ID.
- `support_conversation_link`: internal opaque ID, provider ticket ID, requester user ID or external contact, optional authorized workspace context, source and category. Workspace context is diagnostic metadata, never a workspace-wide sharing grant.
- `support_operation`: unique requester/idempotency key, operation type, durable state, attempt count, next attempt and provider IDs. Save before dispatch. Add unique provider/source IDs so retries cannot duplicate a ticket/message.
- `support_provider_event`: unique event ID/hash, signature/auth result, received/processed timestamps and sanitized outcome. No message bodies, authentication tokens or email access tokens in logs.
- `support_access_audit`: support actor, action, conversation, time and result; no secret values. Any future break-glass customer-workspace access needs an independent, explicit, time-limited audited grant.

| Actor | Public articles/contact | Conversation read/reply | Internal notes | Agent composition/assignment | Provider/admin settings | Business records |
| --- | --- | --- | --- | --- | --- | --- |
| Visitor / prospect | Yes, abuse-protected | Only after verified recipient authentication | Never | No | No | No |
| Signed-in requester | Yes | Own linked conversations only | Never | No | No | Existing authorized app membership only |
| Other workspace member / Owner / Manager | Yes | Own requests only; same-workspace membership grants nothing | Never | No | No | Existing authorized app membership only |
| Explicit platform support agent | Yes | Support inbox within assigned scope | Yes | Yes | Only assigned provider capabilities | No automatic access |
| Platform support administrator | Yes | Authorized support scope | Yes | Yes | Separately granted, strongly authenticated | No automatic access |

Every API call revalidates app identity and requester ownership; client ticket/workspace IDs are selectors only. Check attachments through the same authorization. Filter private notes server-side before customer responses, exports or notifications; do not depend on CSS. Only deliberately added CC recipients can receive conversation mail, and adding a CC is a privacy-sensitive action requiring visible review. Forwarded content must be deliberately selected; internal notes never join the forwarded thread. Never trust an inbound From header as an app identity or a membership grant.

## Threading, reliability and content safety

Prefer native provider email processing. Freshdesk documents Message-ID, In-Reply-To/References, ticket markers and requester checks. Its documentation notes Message-ID expiry after seven inactive days; configure/test its additional identifier and requester protections for late replies. **Never merge based only on a subject match.** Same subject from unrelated senders must produce separate conversations. Test spoofed ticket markers, new recipients and CC/forward behavior explicitly. If the provider cannot meet the access/threading requirement under configuration, reject the candidate rather than advertise it as complete.

Any bridge webhook must have an authenticated secret/signature verified before processing, constant-time comparison where applicable, replay protection and event deduplication. Confirm the provider's actual supported authentication method; do not assume every event has a cryptographic signature. If signed delivery events are unavailable, use authenticated callbacks plus server-side provider verification/polling and scoped event permissions. Persist/ack valid events before bounded processing. Obey Retry-After and API sublimits. Unknown outcomes require reconciliation by provider IDs before resending; no blind retry of email or ticket creation. Native ingestion must also pass duplicate-forwarding, retries, auto-responder, bounce and loop tests. Avoid enabling both forwarding and mailbox ingestion for the same mail.

Preserve queued/draft/accepted/sent/delivered/failed/bounced/suppressed states separately wherever the provider exposes them. “Accepted” or “sent” is not evidence of delivery. Freshdesk documents “Message not delivered” errors; it has not established comprehensive delivery receipts for every message in this audit. Show **delivery unconfirmed** where receipts are unavailable. Saving a message or ticket must survive email/notification failure.

Treat MIME and HTML as hostile: sanitize allowlisted content, block scripts/forms and unsafe links, default to plain text, and block automatic remote images/tracking pixels. Validate filenames, MIME signatures, size/count and download headers; quarantine attachments pending malware scanning. Freshdesk documents malware scanning and secure attachments; verify that customer and agent paths enforce those settings and remote-content blocking. No unsupported guarantee is made before this test. A custom alternative starts with PNG/JPEG/WebP screenshots only, private Netlify Blobs and normalized images; broader email attachments require an approved scanner/quarantine service and cost/security review.

## Preserving the current system and phased implementation

1. **Provider decision / sandbox, no live sending:** approve vendor/budget/draft limitations, agent MFA, legal/data region, export/retention and branding. Validate the paid-plan settings using synthetic data and provider sandbox tools. Do not connect a mailbox or enable real notifications. Author reviewed initial help articles and contact privacy text.
2. **Public portal and mail setup, after explicit approval:** configure domain/mail routing with a DNS backup/change list; authenticate sending; configure guest contact and secure portal access, attachments, spam/loops, CC visibility and statuses. One-agent setup first. Disable AI, campaigns and duplicate acknowledgments. Real inbound/outbound tests require separate approval and an approved test recipient.
3. **App bridge / legacy cutover, reviewed before migration:** add an additive migration only; preserve existing tickets/files and access in read-only legacy history until an owner-reviewed idempotent import is validated. Never bulk export private notes to public messages. Retain source IDs/mapping, counts and attachments, dry-run reconciliation and rollback. Route new in-app Get help to the same provider inbox via the backend. Associate only verified requester/workspace context and sanitized route without query strings. Do not silently migrate or duplicate current tickets. Disable the old notification queue only during a deliberate per-ticket cutover so two systems do not mail users.
4. **Invite-only support pilot:** complete the tests below and verify exports/restoration, failures, retention, security and operating limits. Confirm “email connected” only after approved inbound and outbound tests pass. Then publish support navigation and approved help content for all plans and external visitors. This does not open app signup or billing.

## Acceptance tests before release

- An external prospect and a locked-out customer can contact without a paid plan/app account; neither action creates app access or a workspace.
- A verified app user creates a single ticket through repeated/concurrent clicks; reply from a normal email client reaches that same conversation. Test changed subjects, identical subjects from two people, forwarded mail, late replies beyond seven days, CC recipients and forged markers.
- New outbound, reply, forward and CC/BCC work with the verified application sender. Verify drafts across refresh/24-hour expiry and the proposed status mapping. Do not label “draft saved” durable if the provider expires it.
- Authenticated agent roles and MFA enforced; customer Owner/Manager cannot enter the agent inbox. Requester B cannot use requester A's ticket ID, access link, cached response, export or attachment URL; removed agents lose backend/provider access.
- Internal notes absent from all customer APIs, portal views, outbound replies, forwards, notifications and customer exports. Support has no implicit inventory/finance access.
- No active remote images, script/HTML injection or executable attachments. Quarantined malicious/oversize/type-spoofed files cannot download; secure attachment links require authorized identity.
- Forged/duplicate/replayed webhooks denied/deduplicated. Provider outage, 429, delayed callback, ambiguous send, worker restart and duplicate inbound forwarding preserve records without duplicate sends. Auto-responder and bounce loops terminate.
- Delivery indicators distinguish provider acceptance from actual delivery/failure. Failed notification never deletes the conversation. Export includes full conversation/notes classification and recoverable attachment references; restore with synthetic data.
- All production links use the approved support domain. Preview/test environments cannot email real people by default. No inventory, accounting, subscriptions, AI or shopping calls occur.

## Costs and capacity assumptions

At 100 new conversations/month and roughly 600 inbound/outbound message events, the assumed volume is below the cited native hourly mail limits and custom Pro base allowance, but bursts, spam, API polling and attachment size still need monitoring. With two 0.5 MB screenshots per conversation, retained files add roughly 100 MB/month before overhead, email MIME expansion and downloads. These are sizing assumptions, not measured usage or promised limits.

Hybrid budget: **$23/month help desk** plus an unquoted dedicated mail/forwarding service and incremental Netlify bridge usage. Annual Growth would commit $228 upfront before tax; it is not a $19 month-to-month offer. Custom budget starts at **$16.50/month mail transport**, then Netlify Database/Blobs/functions, malware handling, domain/mail routing, monitoring and ongoing development. Existing hosting/database pricing and account credits were not accessed; no zero-cost claim is made. Human support time remains separate (for example 100 tickets × 15 minutes = 25 hours/month). No bulk mail, newsletter, hosted personal inbox or AI cost is included.

## Official sources checked

- [Freshdesk pricing](https://www.freshworks.com/freshdesk/pricing/) — Growth monthly/annual pricing and included portal/ticketing. Monthly price also appears in the page's plan configuration.
- [Custom portal URL and DNS](https://support.freshdesk.com/support/solutions/articles/37590-set-up-a-custom-portal-url-and-verify-dns) — domain verification, SSL, proxy/CAA requirements and agent/default portal distinction.
- [Support email setup](https://support.freshdesk.com/support/solutions/articles/37541-set-up-your-support-email) — custom-address forwarding/mail-server setup and sender verification.
- [Outbound email](https://support.freshdesk.com/support/solutions/articles/211974-overview-of-outbound-emails) — enablement, CC/BCC, recipient/contact behavior, default Closed state and 250/hour Growth fair use.
- [Ticket actions](https://support.freshdesk.com/support/solutions/articles/231527-perform-ticket-actions) — replies, notes and forwarding.
- [Draft limitations](https://support.freshdesk.com/support/solutions/articles/237804-how-can-i-see-drafts-by-another-agent-) — personal-only drafts, 24-hour expiry and no note drafts.
- [Attachment security](https://support.freshdesk.com/support/solutions/articles/50000001751-attachment-security) and [attachment limits](https://support.freshdesk.com/support/solutions/articles/196643-what-is-the-size-limit-for-attachments-to-a-ticket-reply-) — secure login and malware scanning; older plan names in the size article require account verification.
- [Full-content export](https://support.freshdesk.com/support/solutions/articles/237405-how-can-i-export-tickets-including-the-content-of-the-ticket-) — account admin XML export versus ordinary CSV.
- [Email markers and requester checks](https://support.freshdesk.com/support/solutions/articles/50000009268-overview-of-email-channel) and [threading](https://support.freshdesk.com/support/solutions/articles/50000011687-understand-threading-logic).
- [Freshdesk API](https://developers.freshdesk.com/api/) — native outbound/forward/conversation endpoints, rate/subrate limits and Retry-After.
- [Delivery failures](https://support.freshdesk.com/support/solutions/articles/230165-resolve-email-delivery-failures) — failure handling, not universal proof of delivery.
- [Help Scout pricing](https://www.helpscout.com/pricing/) — alternative plans, secure portal placement, API and Free limits.
- [Postmark pricing](https://postmarkapp.com/pricing) — inbound Pro requirement, prices, email allowances and activity retention.

These are published capabilities and requirements, not tests of a purchased/connected account. Any unverified behavior above remains a selection or launch blocker.
