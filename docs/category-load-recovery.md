# Categories load and recovery investigation

The client recovery defects were repaired. **The original failure in the affected authenticated account has not been reproduced**, because this run has no authenticated browser session for that account. The observed signed-out 401 is not evidence that the user's signed-in failure is an authentication problem. The user subsequently reported that Categories was working and closed the live diagnosis; no further authenticated trace was requested. The production incident cause remains unproven.

## Request and authorization findings

The Categories page, product-editor category selector, and category tax-mapping editor all use **GET `/api/workspace?productCategories=1`**. There is no separate tax-settings HTTP request for these controls. The endpoint loads the tenant-scoped workspace and returns categories, product associations, revision, tax mappings and configured rates in one JSON response. Category changes and explicit mapping changes use **POST to the same endpoint**, with an operation and expected revision.

The server establishes Identity verification and active workspace membership before category handling. Reading is available to accepted workspace roles; creation/editing and mapping changes require Owner or Manager. Workspace selection, transaction-local tenant settings, forced row-level policies, serialized mutations, and existing duplicate/revision checks are unchanged. No business ID or role was supplied from the browser or spoofed for a live request.

The live unauthenticated probe on November 7, 2026 was:

```text
GET https://mycottagepantry.com/api/workspace?productCategories=1
HTTP 401
Content-Type: application/json
{"code":"SIGN_IN_REQUIRED","error":"Log in on this site to open your existing oven."}
```

This response came from the existing no-session guard before category loading. No authenticated production server exception or browser console error was captured. The read-only database connection exposed zero settings rows under its current visibility; that result was not interpreted as an empty account and no tenant filtering was bypassed.

## Confirmed client causes and targeted repair

Before this change, Add Category on the Categories page was disabled by `!api.data || api.loading || api.saving`; the inline Add category used `!api.data || api.saving`. The entire response had to pass one Zod schema, including tax mappings/rates, before `api.data` existed. A bad tax field could therefore disable independent category operations despite a valid category list and HTTP 200. The catch discarded the cause and replaced it with the same generic message used for HTTP/authentication, network, server and response-format failures.

Retry already incremented the request trigger and issued another GET. It did not repair a repeatable server/response failure. During retry, `api.data && !api.loading` unmounted the management list's nested tax editor. Its local unsaved mapping draft was lost; a failed retry also discarded the previous loaded configuration. These recovery defects were independently reproducible with isolated fixtures.

The repair introduced category-specific response handling that retains the HTTP status, known error code, endpoint, and validation field paths. JSON errors, non-JSON routing/site-access responses, invalid JSON, and successful HTTP responses with invalid category shape are distinguishable. Validation diagnostics report field locations, not saved field values. No credentials, session headers or business data were logged.

Category and tax responses now have independent validation/state within the same request. A validated category list, product-association list and revision allow category management even if the tax portion is unreadable. Tax errors remain visible and retryable; no fallback rate or tax-mapping patch is applied, inherited treatment is marked unavailable, and tax mapping controls stay disabled until their own successful validation. A complete HTTP/network/backend failure still blocks category writes because no current category revision/list was loaded. No empty-list fallback or replacement categories are created.

The last successful list, product selection, search, open category form and mounted tax editor now survive retry and failure. Stale category data is labeled Last loaded and cannot authorize a mutation. Successful retry explicitly clears the error and restores authorized controls. A visible explanation states that category changes require a successful list load. Category creation continues through the original server handler and selects the returned ID in an open product draft; no forced-enable bypass was added.

No backend, authentication, tax-rate helper/calculation, migration, persisted tax setting, existing category assignment, Features page, ingredient layout, URL importer, recipe, inventory transaction, label, Square, billing or subscription change was made. Catalog and photo work was approved separately and implemented in separate modules; it was not part of this Categories repair.

## Actual validation

The focused final unit/component/database run passed **79 tests**, with **2 opt-in tests skipped**, across 10 files. The category, product editor, food product form, barcode review, URL import, draft mapping and barcode helper suites were included. The unchanged food-product fixture emitted an existing React list-key warning; no test failed.

New checks covered independent category creation with malformed tax data, tax-only recovery without replacement rates, HTTP 401/403 versus invalid HTTP-200 category data, non-JSON 401/404 and invalid JSON, failed retry with retained category/tax edits, recovery clearing alerts and re-enabling Add Category, and preservation of the selected product category. The new disposable PostgreSQL test created a category, read it in a new request, and compared tax settings/mappings, products, ingredients, recipes, sales and stock ledger with their earlier values. Existing SQL checks covered permission denial, duplicate rejection and cross-account isolation. Identity verification was a test adapter in those SQL tests; it was not a live signed-in session.

Two Chromium checks passed at 1440px and 390px using the real application with intercepted synthetic workspace responses. They exercised an initial HTTP 503, a successful retry, category creation interrupted by a save failure and another failed GET, retention of category-name/classification and unsaved tax-mapping edits, recovery, immediate list insertion, and reopening the screen. They compared saved tax configuration and the existing product selection before/after, checked horizontal bounds, and reported no page errors. These were fixture persistence checks, not authenticated deployed persistence. The first browser attempt lacked the installed Chromium binary; after installing it, a label locator needed correction before the final passing run.

Actual rendered captures were visually inspected: [desktop recovery](previews/category-recovery-success-1440.png), [phone recovery](previews/category-recovery-success-390.png), [desktop failed retry with retained edits](previews/category-recovery-failure-1440.png), and [phone failed retry with retained edits](previews/category-recovery-failure-390.png). All captured records were synthetic demonstration data.

Type checking, targeted lint, source formatting and whitespace checks passed. No build command or manual deployment was run. Customer data was not changed.

## Current incident status

The user reported “nevermind it seems to be working now.” No new production-session access or diagnostic response was requested after that answer. The verified recovery defects above remain repaired. The signed-out 401 must not be presented as the cause of the original authenticated incident.
