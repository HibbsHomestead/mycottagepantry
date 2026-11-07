# Mobile inventory, scanning and shelf labels

## Implemented scope

Basic scanning and shelf/bin labels were added to the existing authorized inventory workflow, without a Cottage Kitchen-only gate or a subscription change. Existing product/package Label Studio was preserved. AI and shopping comparison remained deferred; no external barcode product lookup was added.

- Pantry: Find barcode, Scan to receive, reviewed inventory count sessions, individual item shelf/bin action, bulk selection (up to 100 per label export) and location-label entry where item locations exist.
- Item editor: scan into default or package barcode fields, retain manual editing and duplicate warnings. Unknown scans offer explicit linking to an existing item or an unsaved item draft; an existing default barcode is not silently replaced.
- Shelf labels: item name/location by default; optional threshold/unit, SKU, existing barcode, internal QR and short text. Tape/fixed media, mm dimensions/margins, 0/90° orientation, text size, wrapping or single line, PDF copies, physical-size preview, PDF/PNG exports and personal/device media profiles.
- Camera: explicit Start rear camera permission, HTTPS check, native supported-format detection, lazy ZXing browser fallback, manual entry, one result per scanning session. Tracks stop on detection, close, unmount, page hide or backgrounding. A second intentional scan requires opening/starting again. Frames stay on device.
- Raw barcode strings preserve leading zeros; surrounding whitespace is trimmed. Canonical comparison never overwrites the stored code. Checksum-valid UPC-A and EAN-13 with a zero prefix match; UPC-E expands only when the decoder/stored metadata explicitly identifies UPC-E and the expanded checksum passes. Eight digits alone are not guessed to be UPC-E instead of EAN-8. Code 128 remains exact text. Package matches retain their offer context and multiple matches require choice.
- Internal QR uses `cottage-pantry:item:<opaque-id>`. The scanner resolves only an item already present in the authorized workspace response. It never follows arbitrary scanned URLs or treats a QR as proof of access. There is no public/private-data download endpoint added for a label.

## Receiving and count safety

A receive scan fills the ordinary receipt draft, requiring purchase quantity/unit and price review. Unknown package data stays empty. Conversion uses explicit item conversions and recorded package quantities; no universal bag/skein/roll contents are invented. A receipt discloses weighted-average valuation, ledger and accounting effects. New UI receipt/adjustment operations carry stable IDs; identical retries return without another movement/journal, while reused IDs with changed values are rejected. Legacy API callers without an operation ID retain their pre-existing behavior and should adopt IDs before claiming universal retry safety.

Count sessions are stored in Netlify Database in a new workspace-owned `inventory_counts` table. Draft creation and line saves never change stock, costs or journals. Lines store actual quantity, entered unit, canonical quantity, observed system balance and a server-derived inventory revision. Partial quantities require verified conversions. Completion needs explicit review/confirmation and an existing stock-adjustment role. Business-level transaction locking, session revisions and completed status protect concurrent requests and retries. Each changed item gets one movement and its associated balanced journal under the existing adjustment accounting basis. Equal counts create no adjustment.

If the item’s balance, units, tracking/conversion context or movement history changed after counting, the entire completion fails. The user must refresh, inspect the ledger and recount the affected item; the app does not guess the timing of a physical count or overwrite a stale balance. Completed count records are immutable. SQL RLS restricts the workspace and a trigger rejects cross-workspace item references. Generic writes cannot forge count completion. A single new additive migration is pending platform application; no existing migration was changed and no production migration was applied manually.

Metadata-only actions (media settings, barcode linking, count drafts/lines) bypass business cost rollups and financial seeding/writes. Browser exports are local and never submit a print job or stock operation. Media profiles are keyed server-side to verified member/device context; other members’ private profile maps are stripped from responses.

## Responsive audit and evidence

Browser automation mounts the actual WorkspaceApp with synthetic workspace API responses. This tests app components/layouts, **not a real authenticated production session**. Chromium was available; WebKit/Safari and physical phones were not available.

| Workflow | Inspection / automated evidence | Remaining real-device verification |
| --- | --- | --- |
| Navigation | Desktop/mobile navigation suite: expanded Pantry, saved preference, child links, active state, keyboard and mobile scrolling | iPhone Safari/Android browser chrome, rotation, actual touch |
| Inventory / ingredient forms | Main Pantry at 390/412/820/1440 px without page overflow; add/edit dialog suite at phone/tablet/desktop widths, one body scroller, reachable footer, draft preserved on import failure | Real keyboards, dictation, autofill, small phone/landscape |
| Recipe import/review | Recipe page layout checked; existing parser/review code retained; no claim of exhaustive import-form testing in this work | Full import/edit/reorder/save on both phones with representative source formats |
| Product linking | Products page layout checked; existing link workflow and authorization retained | Complete existing-product linking and conversion warnings on both devices |
| Receive / adjust | Ambiguous barcode choice; partial quantity; non-JSON failed receipt retains draft; retry reuses operation ID. API tests verify posting once | Full/partial package scan, units, receipt review and adjustment UI with physical camera |
| Count | API tests: draft no stock effects, unauthorized/foreign item denial, stale movement rejection, recount then idempotent completion. Disposable SQL test: RLS, foreign references and completed-history protection | Count multiple real items, interrupted network, simultaneous stock movement and observed counting time |
| Batches | Production page layout checked; existing completion behavior retained | Full scaling, actual usage, conversion/coverage review and completion on phones |
| Labels | Actual shelf-label previews and PDF export checked at four widths; PDF page dimensions asserted; existing product-label unit/component/print tests passed | Owner reports ¾-inch tape (19.05 mm); E1 printable area, app import, physical size/readability and barcode scans remain unverified |
| Finances | Finances page layout checked; existing entry code retained | Full sales/expense entry, keyboard and error recovery on phones |

Mobile controls use 16px form text and touch-friendly buttons/check labels. A visual-viewport listener constrains dialogs above the keyboard’s reported visible area; this is an implementation, not proof of actual Safari keyboard behavior. Dialogs remain viewport bounded and scrollable; local preview scroll areas are contained. No offline-save promise was added. Failed mutations retain their form inputs and show a readable error for non-JSON responses. Unsaved count fields remain transient; saved count lines persist server-side. No browser storage was added for business records or preferences.

## Tests and deployment limits

The targeted suite passed 93 unit/API/component/SQL tests, including retained product-label tests. API/Identity tests used mocks; a disposable PGlite database exercised the new migration’s actual policies and triggers. Browser tests used mocked workspace data and generated local export files. No provider request, live stock adjustment, financial posting, email or physical print was performed during verification. Tests do not establish production migration readiness, real-camera performance, physical scan/print quality, live authentication or deployed database persistence.

Before release, verify the additive migration on an isolated platform preview, then exercise deployed authorized reads/writes with two separate test workspaces, concurrent requests and revoked memberships. Run physical-device acceptance with printed UPC-A/UPC-E/EAN-13/EAN-8/Code 128 and internal QR; denied/unavailable cameras; raw codes/leading zeros; ambiguous/unknown codes; package quantities and missing conversions; retries; count movement conflicts; and keyboard/rotation behavior across all entry forms. Confirm no network camera-frame upload and no AI/shopping calls.

The [Cottage CMS investigation](cottage-cms-investigation.md) proposes staged imports only. The [MakeID E1 report](makeid-e1-compatibility.md) lists unverified compatibility and an owner-controlled print test. The [demonstration shelf label](previews/shelf-bin-label.svg) uses editable **example** dimensions of 60 × 20 mm, not an E1 specification.
