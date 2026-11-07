# Walmart product import: owner URL investigation

## Scope and live reproduction

The exact owner-supplied Wesson product URL, including its original `athAsset`, `classType` and `adsRedirect` query parameters, was preserved in `src/test/fixtures/walmart-owner-url.ts`. The item path was `/ip/Wesson-Pure-Cholesterol-Free-Canola-Oil-128-fl-oz/10291484`. No query was removed, no alternate product was substituted, and no fields were inferred from the URL slug.

The application’s existing DNS-validated, address-pinned HTTPS fetcher fetched that URL. On November 1, 2026 at 21:28:13 UTC, it followed the response to `https://www.walmart.com/blocked` and received a 15,567-byte HTML page titled **Robot or human?**. The visible challenge asked the visitor to activate and hold a button to confirm they were human. The successful fetcher return required final HTTP 200. The page contained no Product JSON-LD scripts, no `__NEXT_DATA__` product hydration, no Open Graph product metadata, and no password input. Retests at 21:29:43 and 21:30:55 UTC returned the same challenge and page size. No challenge was solved or bypassed.

The original extractor recognized some challenge titles but omitted “Robot or human?”. It then found no supported Product JSON-LD and emitted speculative login/location wording. This reproduced the owner’s exact error branch. The updated parser classified the same live response as an explicit access challenge.

This evidence establishes a restricted, non-product response to this server request. It does not establish that a retailer login, selected store or variant is needed. It does not establish how the real product page renders or which product formats it contains, because that page was not returned. Extraction did not succeed, so field mapping was not reached. Historical owner request telemetry was not available; this was a new live reproduction of the supplied link.

## Fields retrieved from the live response

| Field                         | Result                                                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Product name and brand        | Unavailable; challenge page only                                                                                                     |
| Product image                 | Unavailable                                                                                                                          |
| Package quantity/unit         | Unavailable; no value inferred from the URL                                                                                          |
| Pack count                    | Unavailable                                                                                                                          |
| Listed package price/currency | Unavailable; no zero or estimate substituted                                                                                         |
| Source and retrieval time     | Exact requested URL, final challenge URL and check time were recorded as investigation evidence, not saved as an imported ingredient |

Walmart product importing remained **unavailable for this exact request**. No Walmart-wide support was claimed.

## Changes

The importer recognized the observed challenge, used the requested neutral message when it could not establish a cause, and distinguished known HTTP denial, missing-page, other upstream status, timeout and recognized network failures. The shared secure fetcher preserved upstream HTTP status in a typed error while retaining recipe behavior, DNS/private-address checks, redirect validation, byte limits and timeouts. Raw network errors were not exposed. A password field in an unrelated sign-in widget no longer established a login requirement; explicit sign-in page evidence was required when no product data was found.

For accessible pages, parsing added bounded `mainEntity`/list nesting and a product-specific public metadata fallback requiring `og:type=product`. It read available name, brand, image, product price/currency and source independently. Conflicting metadata prices or currencies were rejected without discarding other fields. This fallback was tested with synthetic fixtures, not an accessible Walmart product page. No unobserved Walmart hydration format was advertised as supported.

Partial results could omit a name or price while retaining other useful fields. Explicit package-size text and count were reviewable without inventing a total. Ambiguous regional volume units still required manual confirmation. Missing price remained missing; whitespace and non-price values were not converted to zero. Listed online prices retained the existing purchase-price confirmation requirement.

The review panel showed available fields, missing fields, source and retrieval time. Selected package text and count persisted through both ingredient creation and editing in the existing JSON-backed records, with server validation. No migration was needed. The failure notice became: **“Your entries are still in this form. Keep this page open to continue manually.”** No recovery after refresh was promised or added. Import failures did not apply a patch, clear parent form entries, refresh the page, log out, or replace workspace state.

No paid service, new integration, retailer credentials, alternate identity path, or access-control bypass was introduced. Authentication, memberships, billing configuration, beta presentation and policy readiness were outside this repair.

## Validation and limits

The opt-in live observation test was `TEST_LIVE_WALMART=1 npx vitest run src/lib/walmart-live-inspect.test.ts`. Its successful run meant that the response and error classification were observed, not that product import succeeded. The live source remained a challenge.

Synthetic tests covered metadata-only partial results, absent prices and names, explicit currency without price, conflicting metadata, safe package interpretation, challenge/sign-in distinction, HTTP/network/timeout errors, field selection and unchanged parent-form values. Workspace API tests used mocked Identity/Database boundaries to save, reopen twice, edit and reopen selected package metadata and manually supplied cost. They verified that count/text did not silently change purchase quantity or price. These were not real-provider login tests or production database persistence tests.

A complete live-product apply/save/reopen acceptance could not be performed: the exact URL yielded no product fields, and no authenticated owner workspace session was available. No synthetic price or saved test item was presented as live Walmart data. No production business records were written for this investigation.

## Deployment

The latest confirmed production deployment was `6ae7ab0d8aded88f3fdfa681`, published November 1, 2026 at 21:12:39 UTC, commit `c49e931f5506394876bbed5cd5fa8d3e03c8e330`. It predated this repair. No deployment containing the importer changes was confirmed during this run. Platform-managed validation and publication remained pending; no manual build, commit or stale-artifact deployment was performed.
