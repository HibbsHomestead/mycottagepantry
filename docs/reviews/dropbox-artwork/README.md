# Optional Dropbox artwork copies

Implemented the user-approved Dropbox direction. This does **not** complete 150 MB original uploads. Device uploads remain available at their existing limit. No S3, external storage service, persistent Dropbox OAuth connection, sync engine, or paid service was provisioned.

## Customer workflow

Product Mockups → Create/Edit mockup → Choose from Dropbox opens the official Chooser for the customer's own account. Cottage Pantry requests a bounded thumbnail, displays the source filename and reported size, then presents the actual copy dimensions, PNG byte size and alpha-channel status on switchable light/dark backgrounds. Approval is required before saving. The original stays in Dropbox unchanged. Customers can reject an unsuitable preview and upload a smaller transparent device copy instead.

The saved asset uses the existing private business-prefixed Netlify Blobs store and Database asset record. Mockups refer to its durable internal ID, never a Dropbox URL. Positioning, proportional sizing, rotation, templates, save/reopen, PNG/JPG export and optional gallery saving use the existing editor. Importing alone does not replace a primary product image or publish anything. Import updated copy creates/selects a new reviewed asset; earlier saved mockups are unchanged. Identical source/content retries reuse the same asset within the same product/business.

## Separate limits

| Stage | Enforced limit / behavior |
| --- | --- |
| Dropbox source | PNG/JPG/JPEG/WebP selection; positive reported byte size. No 100 MB or 150 MB processing guarantee. Source bytes and original dimensions are not downloaded. Chooser does not guarantee original dimensions or revision information. |
| Provider thumbnail download | At most 4,000,000 actual streamed bytes, 15-second network deadline, at most three redirects; each hop restricted to HTTPS Dropbox thumbnail endpoints. Original/share/download URLs are rejected. |
| Decoded imported image | At most 2048 pixels per axis / 4,194,304 pixels; static PNG/JPEG/WebP only. Header dimensions checked before decoding. Sharp uses an input pixel cap and an 8-second processing timeout. |
| Approved stored copy | Static PNG, at most 3,000,000 bytes, 2048 pixels per axis; server independently validates actual image contents and full decode before saving. Alpha supplied by Dropbox is preserved; missing alpha cannot be restored. No automatic lossy quality reduction. An oversized normalized PNG is rejected. |
| Editor | Loads the bounded internal copy in its original aspect ratio. Existing 128/480/800-pixel on-demand asset previews are separate. Existing device sources remain at 5,000,000 bytes and 40 MP. |
| Mockup export | Existing 100–6000-pixel width and 24 MP maximum; output height follows the blank image ratio. Existing enlargement warnings remain. A large export canvas does not restore source detail. Saved composition previews are additionally capped at 2400 pixels wide and the blank image's resolution. |

Check white artwork, transparency, color and text/detail before approval. An alpha channel alone does not prove that the artwork's intended transparency survived Dropbox. The feature makes no print-ready, color-management or full-resolution claim.

## Security, reliability and storage accounting

Verified app-user authentication is required (private demo sessions cannot import). Owner/Manager and the existing product-edit plan check apply to preview preparation and saving. Product authorization uses the current business's RLS-loaded records. Existing registration/plan write checks run before Blob writes. Asset reads resolve a record under the current business and use a business-prefixed storage key. Browser-supplied Chooser metadata is explicitly labelled `chooser-client` provenance, never treated as authorization or verified original-file metadata.

Stored source metadata includes provider, file ID, filename, reported original bytes, import time and actual copy dimensions/format/bytes/SHA-256. Business ownership is established by the Database tenant and Blob prefix. Revision is not fabricated. Temporary links are not stored, logged or sent to analytics. No cookies or credentials are forwarded to Dropbox downloads. Unknown Dropbox thumbnail hosts/routes fail closed and may require adjustment after a real provider test.

Selection, preview preparation and review can be cancelled without changing existing editor work. Preview preparation is abortable. No temporary objects are persisted, so abandoned previews need no storage cleanup. Saving displays measured XHR byte progress, then waits for the private commit; it cannot be cancelled ambiguously mid-commit. Failed saves retain the reviewed copy for retry while the editor is open. Content/business/product/source-based IDs and the existing business lock prevent duplicate retry records. Closing the editor before a failed save requires choosing/reviewing again; there is no background resume or browser-storage persistence.

An immediate Blob write failure triggers best-effort deletion and transaction rollback. Database/Blob commits are not one atomic operation: an ambiguous commit/connection failure can leave an unreferenced object. The deterministic key permits reconciliation on retry, but there is no newly added scheduled orphan sweeper. Saved assets are durable after the import completes and do not depend on an open browser or a Dropbox connection.

The existing app enforces record quotas, not artwork-byte quotas. No artwork quota, reservation allowance, entitlement increase or storage metering was invented. This is the bounded existing-storage path, not a large-file quota/reservation system. Existing Netlify storage, transfer and compute usage apply; customer Dropbox account capacity applies to originals. No new paid service or charges were created during testing.

## Developer-app setup

1. In the Dropbox developer console, use an app with Chooser/Saver support. The preview environment already supplies `DROPBOX_CHOOSER_APP_KEY`; use the corresponding app. The Chooser app identifier is intentionally public, not a token or app secret. No Dropbox app secret is needed or returned to the browser.
2. Register exact Chooser/Saver hostnames used by customers: `mycottagepantry.com`, `mycottagepantry.netlify.app`, and `admin.mycottagepantry.com` if the editor is served there. Register each actual deploy-preview hostname used for testing, and `localhost` for local testing if supported by the app console. Domain registration is not verified by this implementation run.
3. Ensure the identifier is available to the server in every intended deployment context, including production before rollout. Only preview configuration was observed; no environment configuration was changed in this run. The authenticated config endpoint delivers the public identifier to the official `dropins.js` script. Missing configuration or blocked script/browser support displays an unavailable state and leaves device uploads available.
4. Test a real customer account through the allowed domain. No persistent scopes, refresh tokens, OAuth callback or disconnect handling are required for Chooser-only selection. The integration does not retain Dropbox account access after selection.

Official references: [Chooser setup, supported fields and thumbnail sizing](https://www.dropbox.com/developers/chooser). Dropbox documents 2048 as the largest thumbnail bounding box, `mode=fit` for uncropped proportions and thumbnail expiration after four hours. It does not guarantee suitable thumbnails or transparency for large source images.

## Verification and remaining acceptance

`src/lib/dropbox-artwork.test.ts` uses synthetic image bytes and intercepted provider responses. Together with existing mockup unit tests, 19 focused checks passed. They cover source validation, temporary-link stripping, unsafe URL/redirect rejection, dimensions/bytes, supplied white-alpha preservation, JPEG/WebP normalization, retry identity and role/business boundaries.

`tests/dropbox-artwork.spec.ts` passed at desktop 1440px and mobile 390px. It uses synthetic Dropbox and workspace responses. It exercises cancelled selection, review/approval, failed save and retry, internal artwork selection, placement/rotation, PNG and JPG exports, gallery save/reopen, templates and continued device uploads. Browser exports measured 1600 × 1760 pixels. Review screenshots explicitly label the evidence as synthetic. `verification.txt` records the actual synthetic copy dimensions/bytes; the displayed 100,123,456 source bytes are fabricated fixture metadata and are **not a real large-file test**.

TypeScript checking and focused ESLint passed. No build command, live tax/billing change, production record mutation or charge was performed. Existing theme and tax-summary changes and migration files were preserved.

| Required real acceptance | Status |
| --- | --- |
| Owner's approximately 100 MB Dropbox file; actual original size/dimensions | Not tested: no owner file/account access supplied. |
| Actual preview availability, quality, transparency, white art, JPG/WebP | Not tested against Dropbox; synthetic image processing passed only. |
| Real import bytes/dimensions, import/processing times | Not measured. |
| No preview, unsupported file, expired link and interrupted live request | Defensive paths implemented; real provider cases not exercised. |
| Private storage, expired-link save/reopen/export, changed/deleted source | Durable internal references implemented; authenticated live acceptance not exercised. |
| Cross-business live access restrictions | Code uses existing tenant boundaries; synthetic authorization/identity checks passed. Two-business live test not performed. |
| Real desktop/mobile Chooser and allowed domains | Not verified. Browser UI fixtures passed at both sizes. |

The integration is implemented for review but is **not production-ready or validated for real 100 MB artwork** until these real account/domain/artwork tests pass. No real original-file size, pixel dimensions, upload/import time, processing time or export-quality result can be honestly reported from this run.
