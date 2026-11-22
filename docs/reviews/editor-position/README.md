# Editor positioning and compact packaging

The label inspector now has a Position panel with Arrange and Layers tabs. Arrange provides one-step and end-of-stack ordering, six label-relative alignment controls, and an independent Safe area / Label edges reference. Safe area is the default. Alignment uses document coordinates and rotated bounds, moves grouped elements together, respects locks, and uses the existing undo/redo history. Layers stays synchronized with canvas selection and supports selection, ordering, locking, and visibility.

Advanced measurements start collapsed and display width, height, X, and Y in inches while retaining points internally. Aspect-ratio locking applies to both measurement changes and canvas resizing. Rotation and opacity remain editable. Text formatting stays separate. Existing saved designs are never automatically realigned, resized, or migrated.

Background hit detection handles blank workspace and blank label clicks. A completed click clears selection; pointer movement, cancellation, scrollbar gutters, rulers, and element gestures do not. Escape clears selection outside inputs and dialogs. Settings, dropdowns, toolbars, and handles retain selection. Text changes continue to update the existing document before deselection.

Product packaging assignments now use compact rows with a searchable, portalled picker, narrow quantity/unit fields, per-row Details disclosures, summaries, and visible red trash actions. Notes and Required retain their values when collapsed. Adding focuses the new picker. The unpackaged conflict message explains the existing rule without deleting any assignments. The section retains the same product-draft callbacks, validation, save/cancel behavior, costing, and inventory calculations.

Validation passed: 56 focused component/geometry/save/product tests, TypeScript checking, whitespace checking, and four Chromium browser tests at 1440px and 390px. A separate regression run including the general product editor passed 61 tests. Browser coverage included alignment across zoom levels, both references, deselection/control interactions, inch measurements, saved-label reload, matching Print Preview geometry, collapsed and expanded packaging details without horizontal overflow, searchable dropdowns inside the popup, add/remove focus, Save persistence, and Cancel discarding changes. Tests used synthetic records. No live records were changed and no build/deploy command was run.

Screenshots from the local development server:

- [Desktop position panel](position-1440.png)
- [Phone position panel](position-390.png)
- [Desktop packaging rows](packaging-1440.png)
- [Phone packaging rows](packaging-390.png)
