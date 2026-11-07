# Cloudflare deployment evidence

Update from the supplied failed-build log: Wrangler **4.158.0** executed `npx wrangler preview` after a successful Netlify-adapter build in `/opt/buildhome/repo`. Worker Previews is supported in that version; Cloudflare documents it as a separate Preview-build command. No active configuration path or verified Worker entry was identified. The concrete, separate adapter/configuration proposal and resource cost review are now in [cloudflare-preview-proposal.md](cloudflare-preview-proposal.md). The historical observations below do not establish the current remote deployment's configuration.

The test site is `https://mycottagepantry.curly-bread-52df.workers.dev/`. Its deployed commit, Worker entry point, authentication environment, database environment, and binding configuration remain **unknown**. The setup-screen commands are not evidence of the active deployment.

Repository inspection found `main`, the repository root, pnpm, and the build script `pnpm run build` → `vite build`. The Vite configuration uses the Netlify adapter. Client assets are in `dist/client`; the existing `dist/server/server.js` is a Netlify/TanStack server artifact, not a verified Cloudflare Worker entry. No Wrangler configuration, Cloudflare adapter, or full Cloudflare API implementation exists in this checkout.

The login banner is generated in `src/components/login-page.tsx` after an account-access transport/response-contract failure. Its request is `GET https://mycottagepantry.curly-bread-52df.workers.dev/api/account-access`, with same-origin credentials. The supplied trace `844eb07b-d833-4e65-afd7-a8c57989d244` contains an absent browser session and an account-access transport error, with no password-login event. It does not establish whether credentials were accepted.

A separate anonymous probe at 2026-11-07 21:03:29 UTC received HTTP 403, `application/json; charset=utf-8`, Cloudflare error `1010 / browser_signature_banned`. Its Ray reference was `a56f48f1aebb79f3-CMH` and its trace was `32d11f9f-c6c2-4eca-adcc-f5abb757bb04`. There was no application trace response header. The root URL received the same denial. This explains this environment's blocked probes; it does not prove the user's browser encountered that denial, nor that the Worker executed its API handler.

The existing Netlify email-provider account was confirmed by a read-only lookup. Repository authentication uses Netlify Identity; membership uses Netlify Database; uploads use Netlify Blobs. This does not establish what the active Cloudflare deployment uses. No connection was changed and no account, business, subscription, or data copy was created.

## Setup-screen values and deployment blockers

The current checkout is **not ready for a complete Cloudflare test deployment**. These are repository findings and proposed test settings, not changes to the active Worker:

| Setting | Value or finding |
| --- | --- |
| Worker/project name | `mycottagepantry` matches the supplied Worker. Keep testing on its `workers.dev` address; add no custom domains. The matching Netlify project name does not connect their runtimes. |
| Branch | `main` is the inspected checkout and Netlify branch. The active Cloudflare branch/commit is unverified. The inspected baseline commit was `d6ce6227d767649a057ca3928200f31c3e121d3f`; the Labels changes are additional uncommitted source changes. |
| Root directory | Repository root (`/` in a root selector, or `.` where a relative path is required). |
| Install command, if configurable | `pnpm install --frozen-lockfile`. `pnpm-lock.yaml` is present. The repository has no `packageManager` version pin; match and pin the version used by the verified install log before making this reproducible. |
| Build command | `pnpm run build`, which calls `vite build`. This currently builds for Netlify. |
| Node version, if configurable | `24` matches the checked-in Netlify build configuration and supported package engines. |
| Client output | `dist/client`. This is not the full backend. |
| Wrangler configuration path | None exists. Do not enter a guessed file path. |
| Worker entry point | None is implemented/configured in this checkout. `dist/server/server.js` is not a verified Worker entry. |
| Deploy command | No working full-app command can be supplied yet. `npx wrangler deploy` needs a valid Worker configuration/entry or assets configuration; neither provides the missing APIs automatically. |
| Preview command | The follow-up log verified execution of `npx wrangler preview` with Wrangler 4.158.0, which supports Worker Previews. It failed the required `previews` block check. This command was absent from repository scripts and was consistent with Cloudflare's documented Preview-build setting; the exact dashboard setting remained unverified. See the separate proposal for explicit configuration selection after adapter implementation. |
| Preview builds | Keep disabled for further automatic test deployment until authentication, data isolation, backend routing, and external-write controls are verified. |
| Cloudflare Access | Recommended enabled for a private test, if the account supports it. It is an additional site gate and does not repair application login or grant business membership. No setting was changed. |
| Advanced runtime settings | No verified compatibility date/flags, assets binding, database binding, storage binding, service binding, or runtime secret mapping exists. There are no safe exact values to invent. These require the actual Worker implementation and environment decision first. |

Required implementation work includes a compatible TanStack/Workers build adapter and entry, explicit API dispatch before any frontend fallback, identity/session verification and refresh on the intended provider, tenant-aware access to the approved database environment, private upload/storage adapters, native-dependency replacements or a deliberately authorized backend architecture, and explicit test controls for scheduled/external writes. This investigation did not implement a Cloudflare migration or proxy the test site to Production.

## Runtime dependencies and isolation

No application `VITE_*` build-time environment variables were found. `DEPLOY_ID` is an optional public build-marker input; it is not a credential. Build tooling needs no business secrets.

The names below describe the current Netlify code. They are **not a verified Cloudflare configuration**. Setting identically named Worker variables does not implement the Netlify runtime APIs that read them.

| Name or dependency | Current location and purpose | Separate test requirement |
| --- | --- | --- |
| `NETLIFY_DB_URL` | Server-only database connection secret used by `@netlify/database`. | Identify and approve the database environment before providing any connection. Never put it in a build variable or browser bundle. |
| `NETLIFY_DB_DRIVER` | Server runtime database-driver selection. | The selected driver and connection path must support the actual runtime. |
| Netlify Identity context and `/.netlify/identity/*` | SDK/provider configuration and session refresh supplied by Netlify; browser requests use the current origin. No user-configured Cloudflare Identity binding is defined. | Implement and verify provider routing, session verification/refresh, and callback origins for the intentionally selected account environment. Existing Netlify cookies do not automatically authenticate a different hostname. |
| `NETLIFY_BLOBS_CONTEXT` and Netlify Blobs runtime | Server-only platform context for private object access. Stores: `receipts-private`, `label-fonts-private`, `label-graphics`, `label-print-pdfs`. | No R2/bucket/service binding is defined. Do not copy Netlify context or credentials to pretend these stores are isolated. Implement authorized storage in the approved test architecture. |
| `CONTEXT`, `DEPLOY_URL`, `URL`, `COMMIT_REF` | Platform deployment metadata used by SDKs, diagnostics, origin checks, and integration gates. | Do not impersonate Production metadata to bypass host/context checks. |
| `QZ_CERTIFICATE`, `QZ_PRIVATE_KEY` | Optional server-side QZ signing credentials; browser printing does not require them. | Leave unavailable unless a separate approved test printer-signing setup is needed. Never expose private-key material to the client. |
| `SQUARE_SANDBOX_ENABLED`, `SQUARE_PRODUCTION_BILLING_ENABLED`, `SQUARE_BILLING_ENCRYPTION_KEY` | Server-only Square flags and encrypted credential handling. | Do not provision Production credentials or encrypted merchant connections for the test. Merely withholding an access-token variable is insufficient if merchant credentials already exist in the selected database. |
| `SQUARE_SANDBOX_*`, `SQUARE_PRODUCTION_*` | Current suffixes include `ACCESS_TOKEN`, `API_VERSION`, `LOCATION_ID`, `MERCHANT_ID`, `WEBHOOK_SIGNATURE_KEY`, `WEBHOOK_URL`, `APPLICATION_ID`, `APPLICATION_SECRET`. | None is required for label testing. Keep Square disconnected unless sandbox testing is separately intended and verified. Do not change live webhook targets. |
| `SUPPORT_EMAIL_ENABLED`, `SUPPORT_POSTMARK_SERVER_TOKEN`, `SUPPORT_VERIFIED_FROM`, `SUPPORT_EMAIL_ORIGIN`, `SUPPORT_EMAIL_WEBHOOK_SECRET` | Optional outbound email and delivery integration on the server. | Keep external email disabled and credentials absent on a separate test. |
| `ADMIN_SMS_ENABLED`, `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET`, `TWILIO_VERIFY_SERVICE_SID`, `ADMIN_MFA_ENCRYPTION_KEY` | Optional server-side admin SMS/MFA. | Do not copy Production credentials; admin origin rules currently do not accept this Workers.dev hostname. |
| `REGISTRATION_PRIVATE_TESTS_ENABLED` | Server-side private registration fixture gate. | Keep disabled; account-check errors must not become business creation. |
| `AI_ENABLED`, `SHOPPING_SEARCH_ENABLED`, `CATALOG_INTERNET_SEARCH_ENABLED`, `PACKAGE_PHOTO_PILOT_ENABLED`, `RECEIPT_READING_ENABLED` | Server-side optional service controls; associated optional API names include `SERPAPI_API_KEY`, `USDA_FDC_API_KEY`. | Keep paid/external actions explicitly disabled for an isolated label/login test. Some flags are default-on, so absence alone is not a general safety guarantee. |

Current backend routes remain Netlify Functions, including `/api/account-access`, `/api/workspace`, `/api/registration`, `/api/signup-plan`, support/admin APIs, Square callbacks/webhooks, and `/.netlify/functions/google-label-font`. Import, upload, font/artwork retrieval, PDF creation and print-job preparation rely on those handlers. Native canvas/Sharp/SVG rendering and filesystem-based font/assets access have not been verified on Workers. Netlify redirects in `netlify.toml` also require an explicit equivalent if the test architecture needs them.

Repository inspection found scheduled Square sandbox reconciliation (every five minutes), Production reconciliation (every five minutes with an offset), and support notifications (every ten minutes). The reconciliation dispatcher can target `https://mycottagepantry.com` in Production context. Production subscription creation has a code release gate, but canonical reads, token refresh, database updates and other external paths still exist. This is not proof of a safely sandboxed test. No Cloudflare cron triggers or deployed integration flags could be inspected. No Square/billing/schedule code was changed in this Labels task.

Production data isolation remains **unknown**, not established. The safe separate-environment proposal is an approved isolated authentication environment, an empty schema-only test database, and isolated private object storage, with synthetic test accounts/data and integrations off. That would not automatically contain the existing Hibbs account or its records. Resolving existing credentials to existing Hibbs data requires an explicitly approved account/data environment decision after the current deployed targets are identified; no copy, migration, replacement business, or connection change was performed.

## Request and authorization evidence

The banner's catch in `src/components/login-page.tsx` covers the `/api/account-access` request and response contract, and can also catch later navigation failures. `src/lib/account-access-client.ts` rejects non-success HTTP responses, non-JSON responses, invalid JSON and invalid response schemas. A frontend HTML fallback is therefore a plausible failure class, but it was **not observed** in the blocked probe and cannot be established for the original browser request from the supplied events.

`netlify/functions/account-access.mts` defines the actual JSON endpoint. Normal caught identity/membership failures resolve to JSON `identity_error` or `membership_error` states, rather than automatically provisioning a business. Logs use `area: account_access` and a matching trace ID. No corresponding Cloudflare Worker invocation/log was accessible for the original trace. There is no evidence supporting a CORS diagnosis for the same-origin request.

Read-only anonymous Netlify checks returned `/login` HTTP 200 HTML, `/api/account-access` HTTP 200 JSON `signed_out` (trace `c9c6c7ca-1e9b-4f3a-8212-aebe7931d9bb`), and `/api/workspace` HTTP 401 JSON `SIGN_IN_REQUIRED`. These establish continued anonymous availability and rejection of an unauthenticated workspace request; they do not establish an authenticated Hibbs session. No passwords or session credentials were supplied or used.

## Dashboard locations and safe evidence

These are read-only inspection steps. No Edit/Deploy/Save action is needed. Product navigation labels can vary; the named destination and information below identify each screen.

| Cloudflare screen | Sanitized information needed |
| --- | --- |
| **Workers & Pages → mycottagepantry → Deployments → active deployment/version → deployment details** | Active deployment/version ID and time, repository, branch, commit, deployment source, and whether that version serves the supplied `workers.dev` address. The active version matters more than the most recent failed build. |
| **mycottagepantry → Settings → Builds / Build configuration** | Repository root, branch, install/build/deploy/preview commands, package-manager version, build output, and configuration-file path. In the corresponding build log, only the lines naming the detected adapter/configuration path and generated Worker entry are needed. Exclude lines containing environment values. |
| **Active deployment/version → source**, or **Edit code** without saving | Worker entry filename; sanitized imports/exported `fetch` handler; dispatch for `/api/account-access`, `/api/workspace`, and `/.netlify/identity/*`; assets fallback order. If source comes from Git, its exact public repository path and commit are sufficient. No generated bundle containing credentials should be shared. |
| **mycottagepantry → Settings → Variables and Secrets** | Names and types only, for the active runtime environment and preview environment separately. Do not reveal or copy values. Build variables and runtime secrets must be distinguished. |
| **mycottagepantry → Bindings** | Binding names and types: database/Hyperdrive, D1, object storage/R2, service bindings, or other backend services. Record the target environment as Production, isolated test, or unknown. Omit connection strings, credentials, database URLs, and private data. |
| **mycottagepantry → Settings → Domains & Routes**, and **Triggers / Cron Triggers** | The test hostname's route and scheduled-trigger presence. Inspect only; do not change domains, DNS, routes, schedules, or webhook destinations. |
| **mycottagepantry → Observability → Logs / Live logs**, for the active version | Search the original trace above and the browser failure time. Safe fields are invocation time, Worker version, method/path, status, diagnostic stage/code, and request/Ray reference. Application stage names include `backend_identity`, `session_verification`, `membership_lookup`, `workspace_resolution`, and `access_decision`. Exclude headers, cookies, token-bearing URLs, request bodies, user records, and raw exception bodies. No matching event is itself a useful observation; it is not proof of why routing failed. |
| **Account/zone Security Events**, if that hostname's events are available | A matching Ray reference and the event's action/error classification can distinguish a Cloudflare security denial from a Worker invocation. Workers.dev events may not appear in a custom-domain zone. Do not weaken protection to accommodate this investigation. |

The browser's **Developer Tools → Network → GET /api/account-access** can establish the original request's timestamp, final host/path, HTTP status, response content type, and safe error code/body classification. Response references such as `X-Access-Trace` and `CF-Ray` are safe to transcribe. Do not share request headers, cookies, authorization, tokens, passwords, raw HAR exports, or private account-response payloads. The previously supplied browser events do not contain these HTTP details.

If authentication is intentionally routed to an existing provider, only its public host and environment classification are relevant. The current provider, database environment, cookie delivery/refresh behavior, and allowed callback origins must be identified before proposing a connection change. No CORS cause is established for this same-origin account-access request.

## Acceptance still required

No authenticated Cloudflare acceptance test has passed. The remaining checks are sign-in to the intended existing account environment; the correct existing Hibbs membership and data; sign-out and sign-in again; unauthorized/cross-business denial; executable backend routes; imports; uploads and authorized retrieval; label preview, print preparation and physical output. A visible page and a successful client build do not substitute for these checks.

Do not deploy the current checkout as a completed migration, point a test Worker at Production, create a replacement business, copy records, repoint Square webhooks, or disable Netlify to work around missing evidence. Any environment-connection proposal requires separate approval after its current targets are identified.
