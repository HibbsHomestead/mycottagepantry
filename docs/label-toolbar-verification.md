Label Studio’s element inspector was compacted into familiar text and geometry controls. The common tools were placed above the text/source fields. Per-word fonts, pairings, fit-to-box, text background, grouping, conditional visibility, and help remained available under Advanced. Existing rendering, print output, document storage, and canvas transforms were retained.

Verification used synthetic workspaces and API responses. No customer records were changed. The new browser scenarios covered immediate SVG formatting, keyboard activation, retained selection, fractional numeric entry, center-pivot rotation/reset, color preview/cancel/apply, undo/redo, layer order, disabled controls for shapes, mixed per-word fonts, and save/reload restoration. The saved canvas was compared before and after reload with attribute order normalized. A separate two-sided label scenario verified preview and the actual browser-print iframe.

Validation passed:

- 107 regression tests across 16 label-related files. The two changed editor suites were rerun successfully after the final source changes.
- Six new Playwright scenarios, including layouts at 1762, 1280, 1150, and 390 pixels.
- The existing two-sided background/save/reopen/print Playwright scenario.
- TypeScript checking, formatting checks, and lint on the new toolbar and browser test. Existing lint findings in the three edited legacy components matched their original counts and rules.

The separate older product-preview browser suite encountered a fixture-routing failure before reaching the editor: its workspace request returned HTML instead of mocked JSON. That suite was stopped after two cases timed out; its remaining product-detail cases were not counted as passing.

Screenshots of the synthetic inspector: [wide desktop](previews/label-compact-tools-1762.png), [desktop](previews/label-compact-tools-1280.png), [narrow desktop](previews/label-compact-tools-1150.png), and [phone](previews/label-compact-tools-390.png). Common text and geometry controls fitted without horizontal clipping, and paired numeric fields stayed on the same row.

Publishing was left to the managed workflow. No build command or manual deployment was run. Verification of this change on a deployed editor remained pending that publication.
