# MakeID E1: compatibility findings and test gate

Reviewed 31 October 2026. Owner-confirmed information: MakeID, E1 profile/model, 203 dpi, iPhone, Continuous option, reported Bluetooth printing from the phone, and **¾-inch installed tape (19.05 mm nominal width)**. The displayed device identifier is not treated as a model number. The tape width is owner-supplied, not an independently verified E1 media specification. These observations do not establish printable area, AirPrint support or browser Bluetooth support.

## Official sources inspected

- [MakeID support/software](https://www.makeid.com/global/support) links the consumer app download and the developer SDK.
- Its consumer [app download](https://www.jingjingfun.com/app-international/) links Apple app ID **1422600491**, currently named [MakeID Label](https://apps.apple.com/us/app/makeid-label/id1422600491). The Apple listing describes Bluetooth label editing/printing with fonts, symbols, borders and templates. The listing returned version 3.4.2 during research. It did not establish PNG/PDF/share-sheet/template import or E1-specific dimensions.
- [MakeID Label Pro](https://apps.apple.com/us/app/makeid-label-pro/id6476973130) describes pictures, barcode/QR and Excel import, and names devices including P31, D50, P54, P32, P51A, P71, DL and GP31. **E1 was not named**. These capabilities cannot be transferred to the owner's consumer app or used to recommend an upgrade for E1 without confirmation.
- The official support page links [MakeID-Developer/label-print](https://github.com/MakeID-Developer/label-print). Its root guide documents mobile Bluetooth and computer USB examples, and the repository includes iOS/Android examples, drivers, JavaScript and HTTP documentation.
- The [JavaScript guide](https://github.com/MakeID-Developer/label-print/blob/main/JS/Readme.md) requires installed/running local print-server software. The [HTTP guide](https://github.com/MakeID-Developer/label-print/blob/main/HTTP/print-service-plugin-api-docs.md) documents a PC localhost service. **This is not proof of direct browser Bluetooth or an iPhone web integration.** No local service or printer driver was installed or invoked.
- Repository [drivers](https://github.com/MakeID-Developer/label-print/tree/main/Drivers) name D50, P31, P51 and P71 Windows packages; no E1 driver was found there. General desktop support for other MakeID devices does not establish E1 computer support.
- The current official [printer lineup](https://www.makeid.com/global/label-printers) did not provide an E1 specification. No official E1 tape-width/printable-width table was verified in these sources.

| Requirement | Finding for the owner's E1 |
| --- | --- |
| Resolution | 203 dpi supplied by owner; independent E1 specification still needed |
| Tape widths / supported sizes | Owner reports installed **¾-inch tape = 19.05 mm nominal width**. Other supported E1 widths and label lengths remain unverified; do not infer from Continuous or other models |
| Printable area, margins, feed/cut allowance | **Unverified**; do not assume full tape width |
| Bluetooth in the owner's iPhone app | Owner reports it works; not exercised here |
| PNG/image import | Not established for this E1/app combination; needs app inspection or manufacturer confirmation |
| PDF/shared-file/template import | Not established; do not promise a share-sheet handoff |
| SDK / app-to-app integration | Official SDK exists, but E1 model support, licensing, iOS host requirements and app deep-link/import contract remain unverified |
| Browser / computer printing | No E1 browser Bluetooth, AirPrint or desktop driver compatibility verified |
| Physical output | **Not tested**; no print job sent |

## Implemented transport-independent label creation

Pantry item actions and bulk selection open separate **shelf/bin/location** label tools. Existing product/package Label Studio remains intact. Shelf labels default to item name and recorded location; optional reorder threshold/unit, internal SKU, existing barcode, internal QR and short text can be selected. No stock balance or price is included by default. Code 128 encodes an existing stored code without fabricating a retail barcode; internal QR text is a selector resolved only inside the signed-in authorized workspace, not a public record URL or bearer secret.

User-defined tape or fixed media supports mm dimensions, explicit horizontal/vertical margins, 0/90° orientation, point-sized text, wrapping/single-line, PDF copies and saved **member/device-specific** media profiles in Netlify Database settings. Profiles are media settings, not printer detection. Editable example dimensions are not E1 specifications. Preview uses physical dimensions but is scaled on screen. Estimated and browser-measured text overflow blocks export; small text warns. Barcode readability still requires a scan test.

PDF page size is explicit in millimetres. PNG dimensions use the selected dpi (including 203), but consumer apps may ignore intended physical size or resize images. No automatic printing or MakeID service connection is included. Files are generated locally from records already authorized in the workspace; camera frames are not uploaded.

## Applying the supplied ¾-inch measurement

¾ × 25.4 = **19.05 mm**. At the owner-reported 203 dpi, the full tape width corresponds to **152.25 pixels** before raster rounding. This is a physical-media calculation, **not a claim that the E1 prints 152 dots across**. The printable area may be narrower and the app may use a nominal 19 mm media setting; neither can be inferred here. Do not force a rounded dot count into an undocumented printer command.

The generic editor can represent 19.05 mm as the tape's short dimension and a separately chosen label length. Enter only confirmed printable margins and verify orientation. No E1 preset or saved customer profile was created automatically. The existing 60 × 20 mm demonstration remains explicitly an illustration; it is not a print-ready E1 template. A manufacturer-app handoff remains conditional because the exact installed app/import behavior has not been established. These unknowns are recorded rather than asking the owner the same questions again.

## Recommended route and prerequisites

Use correctly sized **PDF/PNG export as a generic fallback** today, without representing it as a tested E1 handoff. For the owner's E1, establish the app name/version and whether its image element accepts Photos/imported PNGs before proposing “save image → import in MakeID → print.” If supported, verify crop, scaling, orientation and margins on the real device. PDF-to-app, shared files and imported templates remain conditional until demonstrated. If the app cannot import artwork, use its native text editor to reproduce the label fields at the measured size; this is a manual workflow, not synchronized printing. A standard OS-driver PDF path is suitable only for a printer/OS with verified driver support.

Request manufacturer confirmation through the official support channel for E1 tape sizes, actual printable dots/mm, minimum margins/feed/cut allowances, consumer app import types and E1 SDK support/licensing. Do not substitute Pro, install a service or driver, or implement proprietary Bluetooth commands based on another model.

## Actual-size acceptance plan (requires owner participation)

1. Use the owner-supplied nominal tape width of **19.05 mm**; establish the usable print width, feed/cut limits and app behavior from manufacturer documentation or owner-run inspection. The installed app/version and iOS/browser remain unspecified; no compatibility assumption is made. Record a media profile only after verification. At 203 dpi one dot is approximately 0.1251 mm; round pixel dimensions deliberately and measure the result.
2. Export one demonstration label with short text, location, a measurement border/ruler and separately an existing test barcode/internal QR. Check the exported PDF page box and PNG pixel dimensions. Current automated browser tests verify PDF page dimensions; they cannot measure physical tape.
3. After explicit owner approval, use the verified app/driver handoff for **one** print. Disable fit-to-page/crop/scaling where possible; use actual size. Measure with a ruler; inspect margins, cut position, text, barcode quiet zones and sharpness. Adjust profile, then test copies/rotation without wasting a long tape run.
4. Scan the physical code using real iPhone Safari and Android Chrome. Confirm exact text/leading zeros, authorized-workspace matching and no stock side effects. Check long names and the narrowest supported media.
5. Record states separately: **profile saved → printer detected (if actually reported) → job submitted (if supported) → physical print verified by owner**. An open print dialog, downloaded image, SDK “success” or queue acceptance is not physical verification.

No MakeID compatibility claim should be published until these checks pass. No physical/device test, paid service activation or printer software installation was performed in this work.
