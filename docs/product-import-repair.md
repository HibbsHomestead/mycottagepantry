# Product-link request and ingredient modal repair

## Request trace

The UI sends a same-origin `POST /api/workspace?productImport=1` with JSON `{ "url": "…" }`. The route is declared by `netlify/functions/workspace.mts` and establishes the workspace before calling `fetchProductDetails`. The extractor uses server-side Schema.org Product/Offer JSON-LD parsing, not an OCR/AI provider. It needs no provider key. The secure fetcher validates DNS/private addresses and every redirect, pins the resolved address, limits response bytes and time, and checks upstream status and MIME type.

A direct POST to `https://cottage-pantry-app.netlify.app/api/workspace?productImport=1` returned HTTP **401**, `text/html; charset=utf-8`, with `<!DOCTYPE html>` and a **Login Redirect** page pointing to Netlify edge-access. This response occurred before the application function or retailer extraction. The previous client unconditionally called `response.json()`, producing the reported parsing failure on this response class. This was not evidence of retailer blocking or missing extraction credentials. The protected request did not permit inspecting an authenticated user's exact backend response, so it did not establish whether other failures exist behind that gate. Site protection was preserved. Renew the authorized site-access session in another tab before retrying the still-open form; no automatic reload discards unsaved work.

The local Netlify emulator reached the actual function, but its database lacked `businesses`. It now returned HTTP **503**, `application/json`, with `WORKSPACE_SETUP_REQUIRED`, rather than treating this as product extraction or exposing a raw database error. Provisioning/migrations must be handled by the platform for that environment; no migration was applied or changed manually.

## Application response contract

Success: HTTP 200, `application/json`, `{ "products": [...] }`. Both server and client validate returned product fields against the shared schema. At least one named product is required; empty or malformed results are not success.

Application errors: non-2xx, `application/json`, `{ "code": "…", "error": "Readable explanation" }`. Codes include `METHOD_NOT_ALLOWED`, `ORIGIN_FORBIDDEN`, `WORKSPACE_SETUP_REQUIRED`, and `PRODUCT_IMPORT_FAILED`. Infrastructure/site-protection responses are outside the function's control. The client checks status and MIME before decoding and explicitly distinguishes access pages, HTML/SPA fallback, non-JSON upstream errors, empty responses and malformed JSON. Draft ingredient fields are untouched on failure; the busy state always clears.

Complete HTTP/HTTPS input is validated without truncating paths, product identifiers or query strings. HTTP links are upgraded server-side to HTTPS for secure fetching. The limit is 8,192 characters. Suggestions require field selection, existing cost-reference approval remains intact, and Save remains the only ingredient persistence action.

## Layout and verification

Add and Edit share the same actual Radix content sizing: 1040px maximum width, 24px desktop viewport margins, dynamic-viewport height constraint, centered flex layout, fixed header/footer and one scrolling body. Mobile uses 12px margins and one column. The generic sticky footer and 550px max-width no longer constrain the ingredient shell. Product URL/actions use a wrapping normal-flow row; optional label information and notes expand below the primary columns.

Chromium checks with explicit workspace/API fixtures passed at 1440×900, 1024×640 (dark appearance) and 390×844. Checks covered actual Add width, centered bounds, footer/body separation, scroll reachability, background lock, horizontal overflow, Cancel, and reopening Edit in the shared shell. Screenshots were visually inspected for desktop and mobile. These fixtures did not establish real database persistence.

The supplied Sam’s Club flour URL was fetched live through the server extractor and passed the shared response schema, returning the genuine product title, brand, barcode, SKU and 25 lb package size. No price was provided and none was invented. Unit tests covered unsupported source data, private URLs, selective field application, cancellation, photo failure, long URL preservation and HTML/empty/invalid responses. End-to-end authenticated Save and refresh remains unverified because of the protected deployed route and unprovisioned local database. No build was run manually.
