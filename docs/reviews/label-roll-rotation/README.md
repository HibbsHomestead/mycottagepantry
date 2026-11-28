# Label Studio roll rotation verification

An isolated browser fixture reproduced the failure before the fix: after saving a 4 × 3 in media profile with a 90° turn for a 3 × 4 in design, the printer selector still read `browser`. The `LabelPrintOptions` save callback in `LabelStudio` only updated the legacy session state. Modern labels read `doc.printSettings.printingMethod`, so the saved profile never reached the preview, browser print CSS, or PDF request. Those renderers already handled the rotation correctly when explicitly given the profile.

Saving media now selects the profile through the same draft update as the printer dropdown. **Save label** keeps that selection on reopen. Roll and single-label output no longer fall back silently if a device-scoped profile is missing. The existing `printPlacement` geometry remains authoritative: width and height swap on quarter turns, the artwork rotates and translates without scaling, and the browser `@page` (zero margins) and PDF page use the physical media dimensions. No mirror flag exists in the saved profile model.

| Synthetic fixture | Verified physical page | Chromium print-layout evidence | Rasterized exported PDF |
| --- | --- | --- | --- |
| 3 × 4 in, 90° clockwise | 4 × 3 in (288 × 216 pt) | [Screenshot](browser-print-preview-3x4-90.png) | [Image](pdf-3x4-90.png) |
| 3 × 4 in, 270° (90° counterclockwise) | 4 × 3 in (288 × 216 pt) | [Screenshot](browser-print-preview-3x4-270.png) | [Image](pdf-3x4-270.png) |
| 4 × 3 in, 270° | 3 × 4 in (216 × 288 pt) | [Screenshot](browser-print-preview-4x3-270.png) | [Image](pdf-4x3-270.png) |
| 3 × 3 in, 0° and 180° | 3 × 3 in (216 × 216 pt) | [0°](chromium-print-3x3-0.png), [180°](chromium-print-3x3-180.png) | [0°](pdf-3x3-0.png), [180°](pdf-3x3-180.png) |
| Two distinct mixed packs, 90° | 6 × 4 in per page (432 × 288 pt) | [Morning](chromium-print-mixed-1.png), [Afternoon](chromium-print-mixed-2.png) | Chromium print-to-PDF |

The portrait fixture also passed at 0° and 180°. Each geometry case checked three Chromium-print pages and two pages from each export engine. Corner markers, text, and barcode pixels were checked on every page; PDF page rotation metadata remained 0° because the turn was baked into the content. Mixed packs retained distinct text on their rotated pages. A separate [Studio screenshot](studio-output-preview.png) came from the browser test that saved and reloaded the profile; that test inspected the real Print iframe and intercepted the PDF request to verify the media profile ID. The PDF raster tests called the real export engines directly, not a deployed endpoint.

**Not verified:** the native print dialog UI, non-Chromium browsers, a physical printer, or any deployed revision. The print-layout screenshots are Chromium screenshots of the actual print document under print CSS; the page sizes came from Chromium's PDF output, not screenshot dimensions. The supplied Deploy Preview logs show a Netlify Database branch quota failure before compilation. No database branches, migrations, or real records were changed. A physical test label is required: the browser or driver can override page size, rotate, or scale independently. Select matching media and actual size (100%), turn off extra rotation and headers/footers, and check one label before a run.
