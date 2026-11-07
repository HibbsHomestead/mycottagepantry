# Approved catalog and separate package-photo implementation

The user approved the phased catalog plan and a separate package-photo implementation. The new workflows use the existing Add Item and Edit Ingredient drafts. URL import keeps its existing blank-field population and mapping behavior. Catalog and photo results wait for **Apply selected values**; applying does not save, receive stock, record a purchase, or publish anything.

The Categories recovery change remains [separate](category-load-recovery.md). The user reported that Categories was working; the original authenticated production incident was not reproduced and its cause is not asserted. Features-page work and the earlier ingredient-column layout change were not included.

## Delivered behavior

- Barcode lookup checks the authenticated account's ingredient, packaging, supply and package-offer identifiers first. A match says **Already in your account** and opens saved item details inside the popup with **Return to draft**. The unfinished draft stays mounted. The server also rejects a raced second Add Item creation with an existing barcode.
- Shared name/brand search and barcode lookup return published reference snapshots. Six generic starters contain only names and item types: flour, sugar, bakery boxes, cupcake liners, parchment and disposable gloves. They contain no invented brand facts, sizes, barcodes, images or allergen claims.
- Valid UPC-A, EAN-13 and compatible zero-prefixed GTIN-14 identifiers match without losing their stored strings. GTIN-14 package indicators remain distinct. Eight-digit external lookup requires an explicit EAN-8 or UPC-E choice; only explicitly identified UPC-E is expanded. Numeric Code 128/QR private identifiers retain exact matching. The camera keeps its existing native/ZXing formats and permission behavior; GTIN-14 storage support does not force a camera fallback. Scanner Enter does not submit the form, and simultaneous repeated lookups share an in-flight guard.
- USDA FoodData Central supplies food candidates only when the returned GTIN matches. It credits USDA and retains the source link. Brand name is used when supplied; a corporate brand owner is not substituted for an unknown brand. Full ingredient text is preserved, with explicitly labeled Contains and advisory/facility statements separated. Serving sizes, nutrition, guessed package contents and provider images are not imported. Packaging/supplies use the curated catalog, manual entry and internet fallback.
- Internet search is explicit. Its optional SerpApi adapter returns transient title/domain/link candidates labeled **Unverified**, without using snippets as ingredient evidence or copying images. Selecting a page retains its URL and puts it into the working URL importer. Unsupported-page errors leave that URL and the draft intact. Without paid-search enablement, an ordinary exact-barcode Google search link remains available.
- The compact checkbox review selects usable nonconflicting fields, leaves conflicting/uncertain alternatives unchecked, shows existing values and source quotes, supports Select all/Clear and inline full-text expansion, and requires one Apply action. A manual edit made during review invalidates the earlier approval instead of being overwritten. Package quantity/unit changes are reviewed together and use the existing explicit conversion adapter. Supplies do not receive food statements. Changed source statements return allergen review to an unreviewed state.

The legacy creation form that treats saving as receiving retained its URL workflow; the new catalog/photo entry point uses the current Add Item flow with its default no-stock save. The existing inventory transaction rules and costing formulas were not changed.

## Persistence, review and account access

A forward migration adds the reference items, identifiers, immutable revisions, tenant-scoped acceptance history, explicit submissions and provider counters. Matching Drizzle definitions include RLS and checks. Every previously applied migration remains untouched. Deployment applies the new migration automatically; it was tested in disposable PostgreSQL rather than applied manually to customer databases.

Workspace membership and the selected business are resolved by the existing verified server session. Shared reads require membership. Private source/submission rows have forced tenant policies, and acceptance history has a composite business/ingredient foreign key. Responses never expose another account's inventory, prices, suppliers, recipes, notes or uploads.

The administrator Content screen manages the shared reference catalog through the existing administrator gateway. Publishing requires current platform owner/admin access and completed MFA. Publication validates an allowlisted snapshot, cited source, reuse permission and an explicit statement of what was checked. **Reviewed** means only those fields were compared with that source; it does not certify allergens or establish laboratory verification. Generic starters and branded packages remain separate entry types. Barcode and exact identity duplicate checks run under database locks. Different valid barcodes do not merge packages merely because their names match.

Users preview the exact allowed fields and confirm sharing permission before submitting. No private images are accepted for sharing in this release. Duplicate retries are idempotent; repeated identical pending submissions are deduplicated within their own account. Administrators review the submitted snapshot, not the private record. A duplicate product must be reviewed against its existing entry; a correction creates a new immutable revision. Rejection does not publish anything.

Private records retain their saved values and accepted revision. **Check catalog updates** displays a field comparison; selected acceptance is saved only with the ingredient's explicit Save. Accepted revision/field history is appended rather than rewritten. Withdrawn/superseded entries leave search but remain addressable for history, and saved records show a status notice. Revised package information can be published as a reviewed revision while older private snapshots remain unchanged. Replacement recommendations, bulk starter imports and image redistribution are not included.

Account/provider counters use Netlify Database, including failed outbound attempts. Current daily account caps are 60 USDA requests, 10 paid internet searches and 20 photo reads, with aggregate hourly caps of 800, 150 and 100 respectively. Photo reads have an account-level active reservation. Missing configuration and ordinary web links do not consume external-provider quota. Existing SerpApi Shopping usage shares the provider subscription; the catalog counter does not replace that subscription's overall allowance.

## Separate package-photo reader

Optional Front and Back / label inputs accept either side alone; two additional close-ups stay collapsed. One Extract action sends all selected photos to Gemini `gemini-3-flash-preview` through Netlify AI Gateway. Each field carries a source photo, visible quote and uncertainty; conflicting alternatives remain separate and require selection. Extraction never invokes URL import's automatic fill path.

JPEG, PNG and WebP are supported. The browser applies EXIF orientation, offers explicit Rotate/Replace/Remove, downsamples and re-encodes; the server independently decodes, rotates, bounds dimensions and strips metadata. There are at most four prepared images and 4 MiB total. HEIC/HEIF is explicitly unsupported, with JPEG-export/retake recovery. Existing chosen product images are untouched; keeping an extraction image as a product photo is not included.

Images remain transient browser File/Blob objects and request buffers. No permanent uploader, image store, shared catalog publication, raw-image/OCR logging or extraction-image database record is used. Removing/canceling/closing releases local previews and rejects late results. Token counts/model/status are retained without contents. Gateway input/output content is not retained by the gateway; Google may retain paid-service inputs for abuse monitoring for up to 55 days. Local Remove cannot promise provider deletion. The interface discloses that limitation.

The estimate remains **$0.005–$0.015 per extraction**, based on $0.50/M input and $3/M output tokens, approximately 0.9–2.7 Netlify AI credits. Retries cost another call. Token accounting includes thinking when returned by the provider. This estimate was not measured against live Gateway inference in this run. No structured nutrition storage or recipe nutrition calculation was added.

## Actual verification

The final focused regression run passed **143 tests**, with **2 existing opt-in checks skipped**, across **18 files**. Subsequent focused SQL/provider checks also passed after final mapping and quota refinements. TypeScript, targeted lint, formatting and whitespace checks passed. No build command was run.

The database tests used the complete migration chain in disposable PGlite with a non-superuser application role and mocked Identity verification. They exercised tenant policies/composite references, private-first matching, generic search, MFA publishing gates, duplicate rejection, no-stock creation, reopening saved snapshots, immutable history, explicit selective revision acceptance, contribution isolation and withdrawal. They did not impersonate a real production login or modify customer data.

Component/provider/image tests exercised repeated Enter scans, retry recovery, unsupported pages, latest manual-edit preservation, long text, separate statements, conflicting photo alternatives, back-only extraction, rotation/EXIF stripping, unsupported bytes, late-result cancellation, preview cleanup, administrator editing and sanitized provider failures. External HTTP/model responses were synthetic. No real provider coverage, authenticated deployment session, camera hardware permission flow or paid Gateway latency/cost benchmark is claimed.

Chromium exercised the actual rendered application at 1440px and 390px using synthetic intercepted responses. Catalog/photo checks covered existing-item return, failed lookup/retry, review without autosave, long text, phone layout bounds, back-only photo preparation/rotation, uncertainty, selected URL handoff and unsupported-page recovery. The independent Categories checks covered failed retries, preserved category/tax drafts, successful creation and reopening. Screenshots contain synthetic demonstration records only:

| View                        | Desktop                                                 | Phone                                                  |
| --------------------------- | ------------------------------------------------------- | ------------------------------------------------------ |
| Compact lookup controls     | [Rendered](previews/catalog-controls-1440.png)          | [Rendered](previews/catalog-controls-390.png)          |
| Catalog field review        | [Rendered](previews/catalog-review-1440.png)            | [Rendered](previews/catalog-review-390.png)            |
| Separate photo field review | [Rendered](previews/package-photo-review-1440.png)      | [Rendered](previews/package-photo-review-390.png)      |
| Categories recovery         | [Rendered](previews/category-recovery-success-1440.png) | [Rendered](previews/category-recovery-success-390.png) |

## External setup and limitations

Secure project setup subsequently configured `USDA_FDC_API_KEY` for production and deploy previews. The secret was not read back or copied into files. It was not injected into the current local process, so no live USDA smoke test was performed; deployed runtime connectivity remains unverified. When configuration is unavailable, food lookup says it is not connected and preserves manual/catalog/URL entry. USDA's published default quota is 1,000 requests/hour/IP, its data is CC0, and coverage is incomplete.

No SerpApi key or paid-search enablement was configured. In-app Google organic search stays off pending the subscription/content-rights check and server-side configuration; exact-barcode external web links work in the meantime. The approved proposed Starter price remains $25/month for 1,000 searches, shared with other SerpApi use. Returned retailer pages and images have separate rights; no unrestricted redistribution is assumed. Open Food Facts remains deferred because of its database/image licensing obligations.

Gemini uses the Gateway's default SDK configuration and needs no user-provided model key. Live Gateway availability, latency, token/cost benchmarks and an authenticated deployed smoke test remain unverified. Browser/device camera and HEIC conversion were not claimed as tested. Rendered screenshots and passing fixture/database tests do not substitute for those live checks.
