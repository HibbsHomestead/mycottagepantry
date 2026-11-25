# Label printing

Product Preview Label and Print Label actions open the same read-only modal in the current app tab. It displays the explicitly assigned saved design, populated product data, physical dimensions, zoom, quantity and existing printer/sheet settings. Close restores the underlying detail screen. Edit Label explicitly opens that saved design with the same product context.

The shared browser print workflow prepares a server-authorized snapshot and renders label-only output in an isolated same-origin iframe. It waits for the document, required fonts, image decoding and layout, then calls browser printing without opening another tab or window. A required asset that fails or times out blocks printing. Use **Cancel preparation** before the browser takes over; the design stays intact. Preview zoom does not affect physical dimensions. Opening or closing the native dialog never confirms physical printing or deducts stock.

Browser printing is available without a bridge. Select the matching paper size in the installed printer driver, disable headers/footers, and use actual size / 100% scaling. The app creates one page per roll label and sets the requested physical dimensions; browser code cannot force every driver setting. Use one driver copy because the document already contains the selected quantity. Download PDF and PNG remain available.

Printer profiles are saved privately in the workspace database and scoped to the current device cookie and user. Another computer needs its own setup. Clearing cookies requires selecting the profile again. Profiles record the design dimensions, loaded width across the printhead, loaded length in the feed direction, artwork rotation, optional resolution, calibration offsets and driver color options. Known resolution is metadata; output goes through the installed driver.

## Roll orientation and calibration

In Label Studio → Print & Export, choose Roll / thermal (or Single labels). Select or create the print profile, then enter the dimensions of the loaded stock, across the printhead first. For a 3 × 4-inch design on a 4 × 3-inch roll, enter 4 × 3 and choose 90° clockwise or 270° (90° counterclockwise). Save the profile to approve that direction. Select the saved profile on subsequent runs. The design stays 3 × 4 inches, and the app rotates the entire design once onto each 4 × 3-inch page without reflowing or scaling it.

The roll artwork preview shows how the current profile places the selected run's first design on the loaded media. The separate calibration preview shows the leading edge at the top and a fixed arrow along the feed direction. TOP, BOTTOM, the triangle in the design's top-left corner, and the measurement guide turn with the artwork. Press **Print one test label** only after confirming the preview and saving the profile. In the print dialog, select matching stock, actual size / 100%, and one copy. Disable browser headers and footers and any extra driver rotation. Compare the printed corner, feed edge and distance between the guide ticks with the preview before printing a run. Driver settings and printer margins can still affect the result.

Browser print and downloaded roll PDFs use the selected profile; direct printing sends an already-oriented PDF and does not request an extra QZ rotation. If an existing direct profile relied on the old driver orientation setting, recheck its media and print one calibration label before running a batch. Without a profile, one-label pages use the original design dimensions. Sheet output uses its own page dimensions, with no artwork rotation. Standalone PNG exports remain design artwork at 300 DPI, not a printer-ready media page. The separate shelf-label export retains its own layout controls.

## Front + Back sets

Quantity means **Number of products**: 1 product prepares 1 Front + 1 Back; 12 products prepare 12 Front + 12 Back, or 24 individual stickers. Complete sets are the default. Front-only and Back-only replacement printing does not change the saved template. Matching dimensions and shape support grouped or alternating order on compatible stock. Different dimensions or shape prepare separately selected runs with their stock size and copy count. Each run requires an explicit submission and correct loaded stock; the app does not automatically switch stock or scale one side to the other.

The editor, product previews, browser printing, PNG and new-format PDFs use the same SVG canvas. Existing single-label PDFs retain their original vector exporter. New-format PDFs rasterize the shared canvas at 300 DPI with exact physical page sizes. TTF/OTF fonts are supported; uploaded WOFF/WOFF2 fonts require browser print or PNG, with an explicit PDF error instead of substitution. PNG downloads one image per selected side rather than duplicating the product quantity. Runs are capped at 200 individual labels; matching-stock complete sets therefore allow up to 100 products per run. Missing/overflowing content identifies its side and field; an empty populated side blocks set output.

## Direct printing setup

Install QZ Tray 2.2 or newer on a supported desktop, plus the printer manufacturer's normal operating-system driver. Mobile devices use browser printing. Obtain a QZ-compatible trusted signing certificate and corresponding private key according to QZ's signing documentation. Certificate/support arrangements and renewal may incur vendor charges; consult QZ's current terms.

Configure the server-only `QZ_CERTIFICATE` and `QZ_PRIVATE_KEY` environment variables. PEM values may contain actual newlines or escaped newline sequences. Never include the private key in client code. Without these settings the app explicitly offers browser printing.

In Label Settings > Printers, consent to connecting the local bridge, select an installed printer, and save its profile. Set the artwork rotation in Label Studio and print one test label. Check alignment and clipping on the physical output before production. Calibration offsets shift the already-rotated artwork without scaling it; the driver printable area may require additional margins.

The authenticated workspace API constructs and signs discovery requests and immutable, device-scoped PDF print jobs. It does not sign arbitrary client request text. Each print job can receive signing authorization once, within ten minutes. A failed or uncertain submission is never retried automatically: check the printer queue first. A queue acknowledgment does not prove a physical label printed.

## Verification limits

Automated roll tests render Chromium print-to-PDF and both server PDF engines at 0°, 90°, 180°, and 270°. They check physical page sizes, copy count, corner placement, text, and an imported barcode image. These are digital checks, not proof of physical printing. For a driver-specific issue, record the printer make/model, operating system, browser/version, driver name/version, QZ Tray version if used, the configured paper size and orientation, and how the one-label test differs from the preview.

## Mixed assortments

Open **Labels → Assortments** or use the assortment link on a saved production run. A fixed preset provides reusable contents; a variable assortment requires the actual combinations and their container counts. Enter quantities in individual items or selling packages as packed. The app never converts packages to items. A linked fixed basket must match the selling-package components on its saved or locked production definition; this does not add substitution, costing, or stock allocation to basket production.

Choose rectangular single-label stock and review each outer or enabled component label. The preview separates product ingredients, subingredients, intentional allergen declarations, and reviewed cross-contact advisories. It uses current reviewed product sources, not a reconstruction of historical ingredients. Do not approve unless those statements match the actual contents. Missing review and overflow block approval; choose larger stock instead of removing or shrinking text. The selected template provides stock dimensions, not its graphic design. The workflow does not generate nutrition facts, certify compliance, or replace any required inner labels.

Approval stores an immutable browser-print snapshot. Changed inputs or source declarations require re-review; a new packing plan supersedes previous plans on the same run line without rewriting their artwork. Set outer copies per container and optionally print one component label per wrapped item or selling package. Confirm physically printed and applied/verified separately. These actions do not update costs or stock. Assortment output currently uses browser printing, including browser Save as PDF where available, rather than a separate PNG, server PDF or direct-printer export.

## Preparation measurements

The test harness called the real browser preparation function on the same isolated fixtures before and after the change. It used five cold and five repeat runs per fixture, with controlled fetch/decode delays and a stub at the native print boundary. Values are median / slowest observed milliseconds. The fixture does not measure live server/database, browser-dialog, OS spooler, or printer time.

| Fixture | Cold before → after | Repeat before → after |
| --- | ---: | ---: |
| One simple label | 80 / 122 → 28 / 68 | 54 / 58 → 24 / 30 |
| One image label | 103 / 113 → 30 / 40 | 58 / 70 → 14 / 25 |
| 24 copies of one image label | 502 / 517 → 31 / 60 | 422 / 456 → 26 / 31 |
| Three different designs with shared assets | 188 / 192 → 29 / 39 | 144 / 148 → 14 / 26 |
| Two distinct mixed-assortment designs | no baseline → 31 / 40 | no baseline → 14 / 24 |

The 24-copy fixture decoded one shared asset instead of 24 and produced about 182 KB instead of 6.3 MB of print HTML. Three designs requested shared assets 3 times instead of 12. Preparation reuses assets only within a job, and browser printing uses a compact response instead of re-reading and returning the workspace. The first server-side workspace read remains; the fixture does not quantify its impact. Look at the request's `Server-Timing` header and `Label print:` performance measures for live app-side stages. Compare their endpoint—the browser print call—separately from dialog display and when the printer actually outputs the label.

Run the isolated timing fixture with `LABEL_PRINT_BENCH=1 npm test -- --disableConsoleIntercept src/lib/label-print-performance.test.ts`. Run browser rendering checks with `RUN_LABEL_CHROMIUM=1 npm test -- src/lib/label-roll-output.test.tsx`. That suite exercises the populated print iframe and checks desktop and emulated mobile Chromium output; it is not a test of a physical phone, a desktop driver, or a printer.
