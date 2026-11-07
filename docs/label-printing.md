# Label printing

Product Preview Label and Print Label actions open the same read-only modal in the current app tab. It displays the explicitly assigned saved design, populated product data, physical dimensions, zoom, quantity and existing printer/sheet settings. Close restores the underlying detail screen. Edit Label explicitly opens that saved design with the same product context.

The shared browser print workflow prepares the existing server-authorized print job and renders label-only output in an isolated same-origin iframe. It waits for embedded fonts, images and painting, then invokes the native print dialog without opening another tab or window. Preview zoom does not affect physical dimensions. Canceling or closing the native dialog leaves the preview available; the job remains prepared, never marked successfully printed because the dialog closed. Missing assignments, unavailable designs, missing field values, rendering failures and print blockers are shown in the preview.

Browser printing is available without a bridge. Select the matching paper size in the installed printer driver, disable headers/footers, and use actual size / 100% scaling. The app creates one page per roll label and sets the requested physical dimensions; browser code cannot force every driver setting. Use one driver copy because the document already contains the selected quantity. Download PDF and PNG remain available.

Printer profiles are saved privately in the workspace database and scoped to the current device cookie and user. Another computer needs its own setup. Clearing cookies requires selecting the profile again. Profiles record dimensions, orientation, optional resolution, calibration offsets and driver color options. Known resolution is metadata; output goes through the installed driver.

## Front + Back sets

Quantity means **Number of products**: 1 product prepares 1 Front + 1 Back; 12 products prepare 12 Front + 12 Back, or 24 individual stickers. Complete sets are the default. Front-only and Back-only replacement printing does not change the saved template. Matching dimensions and shape support grouped or alternating order on compatible stock. Different dimensions or shape prepare separately selected runs with their stock size and copy count. Each run requires an explicit submission and correct loaded stock; the app does not automatically switch stock or scale one side to the other.

The editor, product previews, browser printing, PNG and new-format PDFs use the same SVG canvas. Existing single-label PDFs retain their original vector exporter. New-format PDFs rasterize the shared canvas at 300 DPI with exact physical page sizes. TTF/OTF fonts are supported; uploaded WOFF/WOFF2 fonts require browser print or PNG, with an explicit PDF error instead of substitution. PNG downloads one image per selected side rather than duplicating the product quantity. Runs are capped at 200 individual labels; matching-stock complete sets therefore allow up to 100 products per run. Missing/overflowing content identifies its side and field; an empty populated side blocks set output.

## Direct printing setup

Install QZ Tray 2.2 or newer on a supported desktop, plus the printer manufacturer's normal operating-system driver. Mobile devices use browser printing. Obtain a QZ-compatible trusted signing certificate and corresponding private key according to QZ's signing documentation. Certificate/support arrangements and renewal may incur vendor charges; consult QZ's current terms.

Configure the server-only `QZ_CERTIFICATE` and `QZ_PRIVATE_KEY` environment variables. PEM values may contain actual newlines or escaped newline sequences. Never include the private key in client code. Without these settings the app explicitly offers browser printing.

In Label Settings > Printers, consent to connecting the local bridge, discover/select an installed printer, set its exact size and orientation, save the profile, and print a test label. Check alignment and clipping on the physical output before production. Calibration shifts artwork without scaling it; the driver printable area may require additional margins.

The authenticated workspace API constructs and signs discovery requests and immutable, device-scoped PDF print jobs. It does not sign arbitrary client request text. Each print job can receive signing authorization once, within ten minutes. A failed or uncertain submission is never retried automatically: check the printer queue first. A queue acknowledgment does not prove a physical label printed.

## Verification limits

Automated checks cover color conversion, picker preview/apply/cancel, PDF generation, transparency handling, print dimensions, exact copy counts, and signing cryptography. No physical printer model or operating system was tested. Production asset inspection requires authenticated access to the protected deployment; deployed PDF/PNG and physical alignment still need verification there.
