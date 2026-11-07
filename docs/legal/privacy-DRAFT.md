# Proposed Privacy Policy

Proposed revision: **CP-PRIVACY-2026-11-01-R1**. Effective date: **to be confirmed at final approval**.

**PROPOSED — NOT FINAL OR PUBLISHED.** This proposed notice distinguishes current capabilities from proposed procedures. Owner facts and production configuration gaps are listed in the [review package](./facts-checklist.md); the notice cannot be finalized until those gaps are resolved. No acceptance or new operational commitment is recorded by this draft.

## 1. Responsible operator

Cottage Pantry is operated by **[O1: legal operator name]**, a **[O2: entity type]** based in **[O3: state and country]**. Public business or mailing address, if applicable: **[O4: address or confirmed not applicable]**. Support: **[O5: working support email]**. Privacy and data requests: **[O6: working privacy email]**. Neither the product name nor a demo business name identifies the legal operator.

## 2. Information handled

Account creation supplies an email address and password to Netlify Identity. The application uses identity identifiers, verified-email status, roles, and memberships to control workspace access. It stores business profiles, preferences, and records you choose to enter, including ingredients, recipes, products, inventory, production, sales, accounting and tax records, and labels. These records may contain information about customers, suppliers, or other people if you enter it.

Supported workflows store uploaded documents, receipts, images, fonts, and related metadata. Support workflows store submitted ticket text, messages, optional screenshots, diagnostic context, and operational support records. Do not include secrets or unnecessary sensitive information.

Access diagnostics include a trace reference, deployment/context, fixed failure classification, elapsed time, attempt count, and provider status when available. The inspected session-verification diagnostics exclude credentials and raw provider responses. This does not establish the content or retention of all infrastructure logs. Hosting and authentication necessarily handle network requests; the production inventory of IP, device, and request logs remains to be verified before publication.

## 3. Purposes and responsibilities

Current application purposes include authenticating users, enforcing memberships, storing and displaying business records, performing requested calculations and imports, providing exports and support workflows, and diagnosing access or service failures.

Proposed allocation: the operator determines processing for account administration, service security, and support. Business users determine the business information they enter and the lawful basis for using information about others. Where the operator processes personal data solely on a business user's instructions, any legally required processor terms must be established before that use. Accepting these Terms is not blanket consent to optional tracking or unrelated processing.

Applicable legal bases, controller/processor obligations, and regional disclosures depend on the operator and launch countries. These remain a legal applicability gap until O3 and O8 are supplied; this draft does not assume a jurisdiction or legal basis.

## 4. Service providers and recipients

Netlify provides application hosting and server execution, Netlify Identity for authentication, Netlify Database for structured records, and Netlify Blobs for supported files. Authentication email uses the Identity mechanism; the configured sender, underlying mail transport, delivery, and associated retention are not established by source inspection.

The application stylesheet requests Google Fonts directly from browsers. Google receives the font request and associated network information. Server-side label font requests also contact Google's font services. User-requested product and recipe URL imports contact the chosen source site; image retrieval may contact its image host. Following an external link also contacts that site's operator.

**Conditional services — activation unresolved, not confirmed active recipients:** source includes a Netlify AI Gateway path to Perplexity Sonar for assistant requests, a Google Gemini receipt-extraction path, SerpApi shopping search, and Postmark support notifications. Each requires configuration and activation checks. If enabled and invoked, assistant input and selected context are sent for inference, receipt content is sent for extraction, shopping search sends item/search details, and support email sends recipient details and a notification with a ticket link. Postmark notification text does not include the ticket message body. Before publication, the operator must resolve which conditional services are actually available and disclose their providers, purposes, and terms accordingly. Code presence does not prove any production transfer occurred.

Square code is sandbox-oriented and separate from the free launch journey. Free account registration creates no subscription or payment-provider call. No card information is required. Historical billing records or configuration do not establish active launch payment processing. Local QZ printer connectivity is an optional adapter, not evidence of an enabled hosted integration or a successful print.

Production provider contracts, processing locations, subprocessors, and cross-border safeguards remain unverified. No statement that all processing occurs in a particular country is made.

## 5. Cookies, browser storage, and tracking

Authentication uses provider session mechanisms; the SDK can use browser storage. The application uses a workspace-selection cookie, a private demo session cookie where applicable, and a print-device cookie for device-specific settings. The source sets the print-device cookie as Secure, HttpOnly, SameSite=Lax with a one-year maximum age. Theme and display-mode preferences are cached in browser local storage. Unsaved editor values are not durable draft recovery.

Source inspection found no application analytics, advertising pixels, session replay, or advertising SDK. This is not a verified production network or hosting-settings audit. Optional infrastructure analytics, injected scripts, a full cookie/storage lifetime inventory, and actual sale/sharing practices remain to be checked. Google Fonts requests are an observed third-party browser dependency, even without an analytics SDK.

Proposed rule: use session and preference mechanisms for their stated functions and do not introduce optional analytics, advertising, or unrelated tracking without reviewing required disclosures and choice controls. This proposal is not evidence that a consent-management mechanism exists.

## 6. Retention, deletion, and closure

Structured records and supported files persist in their platform stores. The application preserves certain completed production, stock, and posted accounting histories against direct edits. Some corrections require new records. These controls do not define a legal retention schedule.

No owner-approved retention schedule or response-time commitment has been supplied. No verified complete self-service account closure, automated cross-provider deletion, backup erasure, or general retention cleanup service exists in the reviewed workflows. Deleting an individual record or signing out does not establish erasure from every store or provider.

Proposed future practice: establish category-specific retention purposes and review periods; verify request authority; remove or anonymize supported data when appropriate; document legal and shared-workspace exceptions; and coordinate file, Identity, provider-log, and backup handling. This requires the operator actions in the review package before it can be described as an operating process. No automatic deletion, arbitrary deadline, or backup expiry is promised here.

## 7. Access, exports, and requests

CSV reports and a JSON workspace snapshot are implemented. These do not provide complete portability of all files and support records. Automatic backup scheduling and backup restoration are unavailable in the application. Platform backup coverage, retention, and restoration have not been verified.

Proposed request procedure: contact the privacy email above for access, correction, export assistance, deletion, or closure. The operator verifies identity and business authority, assesses applicable rights and other members' interests, explains supported actions and limits, and keeps a request record. Do not send passwords or unnecessary identity documents. Applicable law may provide additional rights, complaint channels, and mandatory response periods. Country-specific rights and regulator details require the launch-country review; no voluntary response deadline is invented.

This email procedure requires a monitored mailbox, assigned handler, and workable fulfillment process before adoption. It is not a claim that those arrangements are already in place.

## 8. Security and access

The application verifies identities and workspace memberships server-side and scopes business records through tenant ownership checks and database policies. These safeguards do not guarantee absolute security. Authorized operational/support access, infrastructure logging, incident response, and notification procedures require operational verification; no security certification or breach-response deadline is asserted. Proposed rule: limit administrative access to authorized service purposes and handle incidents according to applicable law through an assigned operator.

## 9. Audience and changes

The proposed service audience is business users aged **[O7: minimum age]** or older in **[O8: initial launch countries]**. The operator must review child-privacy and regional requirements before finalizing those choices. No unsupported claim about never receiving children's information is made.

Proposed practice: publish an updated revision and effective date when this notice changes, communicate material changes through a working service or account channel, and obtain any legally required choice or consent before new processing. This requires a notice owner and process. The effective date of this proposal remains to be confirmed at final approval.
