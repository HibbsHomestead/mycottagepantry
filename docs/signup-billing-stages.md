# Signup and platform billing checkpoints

> Historical implementation record. Square integration and its setup requirements were retired; see [the retirement record](./square-subscription-billing.md). For current connection evidence, see [Stripe status](./reviews/stripe-connection-status.md).

## Stage 1 — selected-plan registration

Added Get Started Free and Choose [Plan Name] links to the existing card footers. All five approved plan IDs can be selected, including Cottage Mercantile at $40 USD per business monthly. Existing card layout and tier definitions were retained.

The signup form saves the preference in Netlify Database before calling the existing Identity signup API. An opaque reference is passed through Identity metadata for retrieval after email verification, including verification in another browser. A same-site HttpOnly cookie supports ordinary continuation. The verified identity claims the preference; another identity cannot take an already claimed preference. Anonymous references expire after 30 days. Expired or invalid choices produce an error instead of becoming Free. Later explicit choices take precedence over old signup metadata. No passwords, payment credentials or consent are stored in this table.

Existing users follow the sign-in link. After server-verified authentication and membership lookup, existing members open their current business, or choose among their authorized businesses. Pending signup preferences and ambient plan URL parameters do not participate in that decision. An intentional validated return to billing remains supported; plan selection is available separately in billing. Only verified accounts without a business resume signup preferences for onboarding. Saving a preference creates no workspace, subscription, charge or entitlement. Paid account creation remains available while the pre-signup notice states: “You can create your account now. Paid activation is not yet available.”

Business setup continues through the existing consent-protected Free setup handler. It does not pass a paid plan into provisioning. The chosen paid preference remains separate and appears on onboarding and billing. The billing page uses the existing server billing evaluator to distinguish current access from a preference or pending payment. The existing server-owned checkout amounts, monthly variation verification, billing-owner authorization and release gates were retained. No browser price or billing period is accepted by the preference endpoint.

Added a forward migration for the preference table, forced row isolation and the fifth private-test preference. Existing migrations and customers were preserved. The private fixture still cannot activate a paid tier.

**Blocker:** approved Terms, Privacy and a policy revision are absent, so real public business creation remains gated. Account creation and preference preservation do not bypass this gate. Proposed Free count limits and unfinished feature restrictions remain inactive. A live Identity/email acceptance run still requires a deployed preview; local component/server tests do not prove email delivery.

**Owner action:** final Terms and separate Privacy approval remain pending. Operator/contact placeholders have been supplied for draft revision terms-v1.0; that did not approve the remaining legal provisions or open business creation. Production billing activation remains a later, separate approval.

**Validation:** 94 focused tests passed across eight files. Six additional onboarding/billing component checks passed; an existing recovery-page wording test remained failing when its file was run in full. Twelve Chromium checks passed for the actual changed source, covering every plan link, registration/sign-in continuation, all five card layouts and widths from 320 to 1440 pixels. TypeScript, focused new-source lint and whitespace checks passed. A broader lint invocation also found pre-existing explicit-any and effect-state rules in older schema/registration files; no clean full-repository lint result is claimed. The new database fixture verified forced row isolation, preference ownership, expiration and rejection of browser prices/periods. Previously generated local server artifacts were temporarily set aside to prevent the preview from serving the old pricing page, then restored. No build command was run.

## Stage 2 — platform Square authorization

Implemented Connect Square for the platform revenue account, separate from customer Square sales connections. Only the enabled platform owner can start or complete connection changes through the existing authenticated admin gateway. Password-only read access remains unchanged. A ten-minute state record binds the initiating session, identity, environment, origin and Lax HttpOnly browser cookie. The callback checks that bound session and owner grant, stores an encrypted authorization code, then returns to Admin Billing. It does not exchange tokens. A same-origin authenticated completion request requires the original Strict admin session; codes are consumed once even if exchange fails.

The server exchanges the code, verifies Square token permissions, merchant and available locations, and stages a connection for explicit owner confirmation. Confirmation names the merchant and selected active USD card-processing location. The existing connection remains in use until confirmation. Replacement is refused while subscriptions or open checkout attempts could be affected. Replacing an unused merchant/location invalidates mappings and previous readiness evidence. No subscription or customer membership is changed.

Credentials, refresh tokens and pending codes are encrypted with AES-256-GCM in Netlify Database, with purpose/environment binding and forced row policies. Tokens are decrypted only for server requests. Refresh is serialized by a database lock, and expired/revoked authorization requires reconnection without fallback to a different merchant. Legacy server-configured tokens remain supported where no OAuth connection exists. A new random Functions-scoped encryption key was generated for Deploy Preview without displaying or recording its value in a file.

Admin Billing separately reports account connection, permissions, location, four plan mappings, signed webhook/processing evidence, subscription synchronization evidence and live checkout. Exact callback/webhook URLs are derived from the deployed admin origin and shown in the setup checklist. No OAuth success enables checkout.

**Validation across the implemented stages:** 182 focused tests across twelve files passed, along with TypeScript, focused lint and whitespace checks. Twelve browser pricing/signup checks passed in the preceding stage. No live checkout was claimed from fixture results.

At the latest checkpoint, 111 tests across the five billing, OAuth, synchronization, admin and connection-component files were rerun successfully after adding trusted webhook URL derivation. TypeScript, focused lint and whitespace checks also passed at that checkpoint. The 182-test figure is aggregate evidence across the stages, not a claim that all twelve files were rerun at the latest checkpoint. Known older recovery-copy and broad-lint findings remain outside this focused result.

**Tested:** database-backed callback/session/origin/expiry/replay checks; owner-only connection controls; one-time exchange; separate confirmation; invalid location and affected-account replacement refusal; encrypted storage and environment isolation; token refresh/revocation; credential exclusion from admin responses and ordinary metadata reads; seven distinct UI statuses and confirmation controls. These use provider mocks. A separate real read-only Sandbox check returned HTTP 200 for merchant and location, matched the configured merchant and confirmed an active USD card-processing location. No Square resource changed.

**Setup update:** the Sandbox application ID, application secret and webhook signing key were supplied through secure project setup for Deploy Preview. Their values were not read back or placed in source. Webhook URL defaults now come from the trusted deployed origin; a valid explicit override remains supported.

**Blocked:** the deployed URLs still need registration with Square and the platform owner must complete authorization and merchant/location confirmation. Live authorization/refresh/reconnection acceptance remains pending.

**Owner action:** after this preview is deployed, register the exact deployed URLs and supported events shown in Admin Billing, then choose Connect Square → Verify Square authorization → confirm the named platform merchant and billing location. The supplied secure credentials are retained; they do not need to be sent again.

## Stage 3 — checkout, webhook and synchronization path

Added a signed Production webhook endpoint and environment-specific reconciliation. Both webhook paths validate the exact configured notification URL, raw-body signature, merchant and supported event type before durable deduplication. They store references only. Processing uses canonical Square reads, scopes correlation by environment and merchant, and serializes workspace updates. Savepoints isolate individual failures so a retry cannot abort the rest of the batch. Signed scheduled dispatch uses a background function for longer provider/invoice reads. Durable successful sync records replace the previous hard-coded null Production sync field; no successful record is invented for an empty job.

Sandbox catalog setup searches before creating, uses stable idempotency keys and stops on incomplete/ambiguous catalog results. Every paid plan, including Mercantile, retains the approved monthly USD amount. Existing mappings can be verified with read-only provider calls in either environment. Checkout rechecks the canonical variation's price, monthly cadence and parent plan before creating a hosted link. Production resource creation remains refused until the owner approves the exact resource change.

Failed initial payments retain Free access. Failed links must be invalidated before retry is released. Unresolved payment correlation blocks another payment and shows support guidance. Expired checkouts are invalidated and held for review rather than risking a late duplicate. Subscription access is based on canonical settled invoice coverage, never a redirect. Stale versions are ignored. Existing Sandbox seven-day renewal grace and paid-period cancellation behavior were retained. Production policy-dependent access changes remain disabled before release, even while read-only synchronization evidence is collected.

**Tested:** real Postgres-compatible migration fixtures for all four paid plan activations, no access before settled payment, stale provider reads, paid-period cancellation, failed initial payment, signed webhook duplicates and tampering, environment separation, uncorrelated event review, SQL-failure savepoints, and authenticated background dispatch. These use provider mocks and are not live Sandbox acceptance.

**Blocked:** Production billing policies, exact resource creation, final feature readiness, Mercantile's user limit, seller timezone interpretation and live acceptance remain unresolved. No Production resource, subscription or entitlement was changed.

**Owner action:** complete the Sandbox checkpoint first. Later review the exact Production resources and policies, then separately approve Production release. The code release gate remains false.

## Stage 4 — live acceptance and release remain gated

Required live demonstrations remain outstanding: real Free signup/email verification/business creation; each of the four paid selections through checkout and correct access; checkout cancellation/retry without duplicates; delayed/duplicate notifications; failed renewal and cancellation; real OAuth refresh and reconnection. Automated mocks and database fixtures are separate evidence. The existing twelve browser signup/pricing checks passed in Stage 1.

Real public business creation still requires final approved Terms and a separate accurate Privacy Policy. The owner supplied operator/contact facts for draft revision terms-v1.0 only. Those facts were inserted into the draft Terms; effective date, final legal approval, refund/cancellation policy and governing-law/venue provisions remain pending. The public policy fields and creation gate were retained.

**Owner action:** complete Square URL registration, owner authorization and the live Sandbox acceptance checklist. Provide final policy approval only when the draft Terms and separate Privacy are ready. Production checkout must remain disabled until acceptance and an explicit later release approval.

## Separate retailer import investigation

The current importer and save flow were inspected before proposing changes. Existing Sam’s Club extraction already supports explicit structured ingredients, accessible statements and product-matched specifications. It preserves ingredient wording/parentheses, separates Contains and advisory source fields, and requires review before replacing reviewed information. The current historical flour URL returned ingredient text, a Contains statement and package prices through the secure fetcher. It returned no advisory statement; absence was not treated as allergen-free. This observation did not reproduce the new failure and did not write a customer record.

The historical owner-supplied URL was https://www.samsclub.com/ip/Member-s-Mark-Bread-Pizza-Flour-25-lbs/13909715756. No Aldi URL or retailer-specific Aldi extraction was found. The current exact failing URLs, and Aldi store/fulfillment context where relevant, remain necessary to identify whether source retrieval, parsing, mapping, draft application or saving is responsible. No new parser was invented from an assumed page shape, and no other retailer’s price was substituted.

**Blocker recorded after the owner reply:** the reply contained unfilled product-link/name/price templates, not actual failing URLs. No current Sam’s Club nested-ingredient/advisory item or Aldi package-price regression can be reproduced from those placeholders. Their current root causes remain unconfirmed. No retailer parser or saved customer ingredient was changed. The historical flour observation is the only live source evidence and does not establish a fix for the reported failures. No repeat request was raised.
