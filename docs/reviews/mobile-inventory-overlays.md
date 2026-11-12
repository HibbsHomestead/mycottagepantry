# Mobile inventory overlay correction

The rapid scanner now uses a full-screen phone presentation, including landscape phone dimensions. A compact header keeps Close reachable while one body scrolls through the camera preview, last scanned item/package and running count, Undo, partial-package handoff, manual barcode entry, Count another, and camera controls. Tablet and desktop retain a bounded dialog.

## Investigation and cause

The old implementation combined three positioning systems: the default DialogContent Tailwind centering translations, workspace-wide mobile positioning/transform overrides, and the earlier inventory-tool inset correction. The scanner additionally supplied a separate `:has(.count-running)` height/scroll override. Layout ownership depended on workspace presence, selector specificity and stylesheet order; the scanner never had an explicit mobile screen presentation. The portal was attached outside the application content, so a transformed application ancestor was not established as the cause. Camera permission was unrelated to positioning.

The original 320-pixel Chromium reproduction remained horizontally bounded. The precise iPhone left displacement was **not reproduced**, so its device-specific trigger remains unconfirmed. This correction removes the conflicting centering dependency rather than claiming a conclusively reproduced Safari root cause. During regression development, a competing inventory-tool height declaration demonstrably overrode the new visual-viewport height until the scoped foundation selector took ownership; reduced-keyboard-viewport checks now cover this failure.

The earlier correction was already included in production: the live Netlify lookup returned commit `7b85218bf3c89459e56a7080026f3bb765db6904`, ready deployment `6af5f74c71b95d3ed7963875`. Main history includes the earlier correction commit `e496157` through merge `8c18292`. The recurring report was therefore not dismissed as an unpublished earlier patch.

## Scope and preserved behavior

`DialogContent` gained opt-in inventory/scanner presentations with local visualViewport dimensions and offsets, safe-area padding, no centering transforms or size animation, and explicit focus restoration to the launching control. Generic workspace mobile positioning excludes these presentations; other dialog consumers keep their existing behavior. Radix retains body portals, modal focus management and background scroll locking. The scanner header stays outside the single scrolling body. No overflow is hidden to conceal controls, and zoom remains enabled.

The shared foundation covers InventoryTools' session list/start/resume, entry/review/confirmation, barcode assignment/match dialogs, BarcodeScanner, and ShelfLabels. ShelfLabels was inspected and its existing phone/tablet/desktop browser workflows were run because it shared the old inventory-tool shell. The newer rapid-count setup, assignment, partial-package form and review/confirmation are in-page panels rather than additional dialogs; they were exercised through the actual workflow without converting them into overlays.

No inventory commands, conversions, quantities, server code, schema or migrations changed. Drafts, queued scans, assignment persistence and Undo retain their existing logic. Camera acquisition remains explicit and independent of ordinary renders. Closing/unmounting still releases tracks, including streams arriving after close.

## Verification

Chromium browser emulation covered 320×568, 375×667, 390×844, 430×932, 844×390, 820×1180, 1180×820 and 1440×1000 for count dialogs; rapid-count workflows covered widths 320, 375, 390, 430, 820, 844 (390-pixel landscape height), and 1440. Tests assert dialog bounds, no horizontal content overflow, full-screen phone geometry, and each visible button/input/select's bounds after scrolling it into reach. They also cover top/scrolled-page opening, close/reopen, focus return, scroll-lock release/reacquisition, blocked background wheel scrolling, long unbroken item/error text, simulated keyboard height/offset changes, and a narrow horizontally offset visual viewport simulating zoom/pan.

Rapid-count workflows exercised manual scans, running package evidence, partial/open-package handoff and retained quantity entry, unknown barcode assignment, queued package application, reload/resume, review, confirmation, stock/report assertions and CSV. Those use disposable intercepted records and the existing count command processor; no customer inventory was read or changed. The partial handoff entered a draft amount and reopened the scanner without submitting that partial quantity. Actual camera frames and stream lifecycle were mocked in the camera tests.

Sixteen targeted overlay/scanner browser tests passed. The focused component/domain suites passed 24 tests. TypeScript, targeted ESLint and whitespace checks passed. Five additional inventory browser workflows passed, covering ordinary barcode/assignment and shelf-label consumers, PDF export and retained failed-receipt drafts. No build command was run.

WebKit was downloaded but could not launch because the environment lacked its system libraries; installing them required unavailable root authentication. No real iPhone Safari, physical keyboard, camera or hardware scanner was available. Keyboard, toolbar and pinch-zoom behavior was simulated through visualViewport changes, not verified on hardware. Safe-area CSS was implemented but actual notches/home indicators were not hardware-tested.

## Rendered screenshots

These are viewport captures, not full-page captures that can misrepresent a fixed overlay's screen position. The dark camera area is the inactive preview, not a captured physical camera feed.

- [320-pixel scanner](../previews/rapid-count-scanning-320.png)
- [375-pixel scanner](../previews/rapid-count-scanning-375.png)
- [390-pixel scanner](../previews/rapid-count-scanning-390.png)
- [430-pixel scanner](../previews/rapid-count-scanning-430.png)
- [Landscape scanner](../previews/rapid-count-scanning-844.png)
- [Tablet scanner](../previews/rapid-count-scanning-820.png)
- [Desktop scanner](../previews/rapid-count-scanning-1440.png)
- [Count-session dialog](../previews/count-session-responsive-390.png)

## Publication status

Changes were prepared for the existing platform-managed recording and publication workflow. This run did not create commits or pull requests directly. A new published commit/deployment identifier was not available before that workflow ran. The production revision above precedes this correction. **The corrected deployed scanner was not verified.** Local fixture/browser verification does not establish production or real-device verification; publication and a real-phone follow-up remain outstanding.
