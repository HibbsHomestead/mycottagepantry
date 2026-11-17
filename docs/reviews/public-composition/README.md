# Public composition and private image delivery

The ordinary public layout now mounts the same approved botanical/ribbon component as the authenticated app. It is fixed to the viewport, decorative, and excluded from print. App layout offsets and existing dark/light palettes remain intact. Public pages use the existing Cottage palette independently of the private business startup preference, including before hydration. The wider 120rem cap is preserved; hero, story, closing action and footer share alignment and spacing. Cards, pricing comparisons and forms retain readable surfaces. Website wording, commercial terms, destinations and account/checkout handlers were preserved.

The homepage uses new desktop and phone captures of the real Products screen with synthetic Demo Kitchen records and real bread/cookie photographs. Feature screenshots referenced by the website were refreshed from the current components at both widths, including the photographed egg ingredient. Recipe screens use the application's current category icons. These are browser captures, not generated interfaces. No live private business data was used. Photo sources are documented beside the fixture files.

## Rendered checks

Inspected the live homepage before editing (`before-live-home-1440.webp`). Inspected the new complete landing page at 1440, 1100 and 390 CSS pixels, plus scrolled story captures on desktop and phone. Full-page captures show fixed decoration only in the initial viewport; `scrolled-story-*` captures show the same artwork behind lower content while scrolling.

`public-composition.spec.ts` passed: ordinary homepage, Features, Pricing, Help and Login at all three widths, stationary background bounds, no horizontal overflow, loaded screenshots, public theme isolation, actual desktop/phone Features navigation, and print exclusion. The phone navigation check waits for hydration before clicking. Existing feature screenshot/viewer checks passed at 1440 and 390. `shared-background-cards-toolbar.spec.ts` passed all three desktop/laptop/phone scenarios, covering app scroll/navigation persistence, ingredient presentation, product foreground/blur behavior and themes. Chromium only; physical phones and other engines were not tested.

## Image diagnosis and measurement

The old endpoint already produced correctly bounded 128/480/800px WebP previews. The identified costs were loading all workspace tables for each private image, rereading the original Blob, transforming it again on every request, and `private, no-store` forcing repeat transfers. The existing blurred product extension uses the identical thumbnail URL, and the measured six-card page made six image requests, not twelve. No separate signing endpoint was involved.

The endpoint now checks membership/entitlements and tenant RLS, queries only the owned graphic, and then serves the image. Immutable tenant/asset/version/size-specific WebP variants are stored in the existing Netlify Blob store. Old uploads gain variants on their first requested size, bounded to one image per request, without a bulk backfill or original rewrite. Cache failures still return the rendered image. Original-size access is retained. Uploads/replacements keep new asset IDs; the ETag also includes tenant and asset revision. Conditional responses are reached only after authorization and ownership checks. `private, no-cache` and `Vary: Cookie, Authorization` require revalidation rather than exposing photos through a public CDN or allowing a fresh browser cache to bypass revoked access.

The browser comparison used six distinct asset IDs drawn from two real 1200px photographs, the actual old Sharp algorithm and the new delivery helper, real HTTP requests/cache, and the actual Products UI. An isolated fixture proxy supplied the workspace, a test cookie supplied authorization, and a memory adapter stood in for Blobs. Chromium ran at 1440x1000 over unthrottled localhost. This did **not** measure production Identity, database, storage, regional latency or a customer's private account. The old/new full workspace-query cost is therefore excluded from these timings. Image-ready times use successful image decoding, including images reached by scrolling. A single comparison is evidence of cache behavior, not a production speed guarantee.

| Measurement | Before cold | After cold | Before repeat | After repeat |
| --- | ---: | ---: | ---: | ---: |
| Image requests | 6 | 6 | 6 | 6 conditional |
| Image body bytes | 328,446 | 328,446 | 328,446 | 0 |
| Browser transfer bytes, including overhead | 330,246 | 330,246 | 330,246 | 1,800 |
| All measured images decoded, ms from navigation | 876 | 867 | 824 | 605 |
| Original reads / transforms | 6 / 6 | 6 / 6 | 6 / 6 | 0 / 0 |

Filtering and returning via app navigation added zero image-body bytes after the change. A synthetic unauthenticated request was denied. Delivery tests covered variant reuse, unchanged originals, revision invalidation, tenant-separated keys and conditional responses without file reads. Existing component tests covered graceful image failure and replacement rendering. The first request for a missing variant still reads and transforms the original; cold image payloads were already resized and remain unchanged. Production response latency, real membership revocation and live replacement uploads require verification after deployment with an authorized session.

## Validation and release

TypeScript, 50 focused unit/component tests, focused ESLint and whitespace checks passed. The browser scenarios described above passed after updating stale capture selectors for the current Labels and Finance navigation. No schema or migration changed. The platform's automatic build/deploy workflow remained pending; no local production build, separate deployment, commit or pull request was created. The updated site was not claimed live. The remaining release blocker was automatic platform validation and publishing, followed by deployed authenticated image measurements.
