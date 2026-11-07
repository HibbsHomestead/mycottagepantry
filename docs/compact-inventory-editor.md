# Compact inventory editor and live card photos

Add Item now starts with Item Type and keeps three short sections: Details, Purchase & Stock, and More. Ingredients and explicitly classified food resale add an Ingredients & allergens tab; fabric and yarn add their own applicable tab. Values stay in the same draft across tab and method changes. Existing resale selection, photo upload, supplier selection, pack confirmation, opening stock, purchase receipts, dates, notes, specifications, and verified conversions remain available.

Manual, Barcode, and URL controls show one entry method at a time. Manual entry has no empty import panel. URL entry keeps the URL and Import button on one desktop row, a small pasted-text action, and the Amazon Share → Copy link helper. Import review still requires selecting fields to replace and keeps the chosen inventory type. Camera failure messages appear only after a failed camera attempt.

The editor has no scrolling dialog body. At normal desktop sizes, each standard tab fits with Cancel and Save visible. Narrow screens, short viewports, longer import reviews, and expanded content use a full-page editor with document scrolling. Textareas grow with their content. Radix retains focus trapping, accessible titles, descriptions, and keyboard tab navigation; the background application is removed from the page layout and made inert during page editing. Unsaved-change protection remains enabled. Save checks fields across all tabs, flags affected tabs, opens the first invalid section, and focuses its invalid field. Server failures keep the draft and open the relevant section.

Live ingredient, material, packaging, supply, handmade, and resale inventory cards use the shared PantryPhoto component and a consistent 3:2 image area across the top of each card. The original linked asset is contained in that area without stretching or cropping. Status badges sit above the photo, and quantities and stock actions stay below it. Empty grid columns prevent a single item stretching across the entire desktop. Add Item and existing ingredient, fabric, material, and product editing have useful photo previews.

Cottage Pantry Admin gained a Reset password button on its sign-in page. The email-only form requests recovery through Netlify Identity and gives a generic confirmation that does not disclose account existence. Recovery requests use the existing origin checks and persistent IP/account rate limits. Provider failures show a retryable error. Recovery emails use the existing main-site callback and password form; the owner then returns to admin sign-in. Recovery creates no administrator session and does not grant privileges or bypass the security key/passkey requirement.

## Previews

These screenshots render the real components against synthetic browser fixtures. They are not production customer records. The egg photograph is an existing licensed test image.

| View                            | Desktop                                               | Mobile                                              |
| ------------------------------- | ----------------------------------------------------- | --------------------------------------------------- |
| Add Item                        | [1440 px](previews/add-item-1440.webp)                | [390 px](previews/add-item-390.webp)                |
| Actual finished-goods inventory | [1440 px](previews/live-finished-inventory-1440.webp) | [390 px](previews/live-finished-inventory-390.webp) |
| Admin password recovery         | [1440 px](previews/admin-password-reset-1440.webp)    | [390 px](previews/admin-password-reset-390.webp)    |

## Validation

The full automated component/server suite passed 898 tests, with 15 skipped. It included creation and edit round trips, type-specific drafts, import review and field mapping, pack conversions, receipt retries, costing, dates, stock movements, tenant isolation, and admin recovery authorization/rate limits. TypeScript, focused source lint, and whitespace validation passed.

Eighteen browser checks passed: ten new checks in Chromium and eight existing checks across Chromium and Firefox. The new browser checks exercise all five item types and applicable tabs at 1440×900, 1366×768, 390×844, 720×450, and 320×450. The reduced desktop viewport checks reflow at the space available with 200% browser zoom; they are not a physical-device certification. Checks cover keyboard focus trapping and return, unsaved-change confirmation, nested scroll detection, action reachability, retained edits, hidden-tab validation, full-page import review, expanding long descriptions, selected import fields, save payloads, live card image sizing, stock receiving entry points, and the admin recovery form. Existing browser checks cover photo preview/edit entry and decoded barcodes with simulated camera denial and manual fallback.

Business data and database migrations were not changed. Original stock, costing, dates, package conversion rules, product associations, and receipt posting remain server-controlled. Browser network responses were fixtures; production stock posting and delivery of a real recovery email were not exercised.

## Deployment

The deployment target is the existing `mycottagepantry` Netlify project, serving https://mycottagepantry.com and https://admin.mycottagepantry.com. The verified published baseline was production deployment `6aeba1f8587b124a7cc8dbba`, published November 4, 2026 at 21:23:08 UTC. These changes await the platform's automatic validation and deployment; that baseline is not a deployment of this update. No new deployment ID was available during editing, and no manual build or deployment was run.
