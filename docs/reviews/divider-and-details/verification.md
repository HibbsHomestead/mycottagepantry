# Divider and Ingredient Details verification

The existing saved design was named **Hearthside Winter Simmer Potpouri** (the linked product used **Potpourri**). Its existing divider ID was `f1231321-4516-4037-9841-4f55aeb850a5`. It was read from the owning workspace in a read-only database transaction. The complete existing design, relevant product, original uploaded font, Google font, and original artwork were used for the browser capture; the divider was never deleted or recreated.

## Actual cause and corrected geometry

The saved element had `x=18`, `y=171`, `width=180`, `height=2`, and `rotation=0`. Both SVG and PDF line rendering used the local endpoints `(0,0)` and `(width,height)`, making the page endpoints **(18,171)** and **(198,173)**. Its visible angle was **0.6365935759634864°** despite the reported zero rotation. This was real endpoint geometry, not an antialiasing or zoom artifact.

There was no saved group ID on the divider and no inherited rotation or skew. The SVG parent clipped the label; its viewport and editor zoom scaled both axes uniformly. Group IDs elsewhere in the editor coordinate dragging, not inherited SVG transforms. Changing a line's height or resizing its corner changed its endpoint slope while previously leaving the displayed raw rotation unchanged.

The compact **Make horizontal** icon now sets the visible line angle to zero through the existing document patch and history workflow. It compensates for the endpoint slope with a precise rotation of **−0.6365935759634864°**, preserving the original positive width/height model and save validation. Rounding that compensation to 0.1° would leave a residual slope, so the operation preserves full precision. The resulting label-space endpoints are approximately **(17.994444615901642,172)** and **(198.00555538409836,172)**. Their center remains **(108,172)** and their length remains **180.01111076819672 pt**. The element's ID, stroke, color, opacity, group membership, and array/layer position remain unchanged. Every other saved element was compared unchanged.

The line angle input and rotation-handle readout now include endpoint slope. Pointer rotation and angle snapping use that same visible angle. The editor selection highlight follows the actual line and places resizing handles at its existing endpoints, avoiding a slanted bounding rectangle over a horizontal stroke. Existing non-line rotation behavior is preserved.

## Rendered and exported checks

The existing design passed browser checks at **50%, 100%, and 200%** using its actual zoom controls. Endpoint coordinates were measured through the complete SVG screen transform, including ancestors and zoom. Endpoint equality was checked to 0.000005 screen pixels, allowing Chromium's matrix precision. Unit geometry checks used much tighter precision. Undo restored the original slope; redo restored horizontal geometry. Numeric height edits and actual endpoint-handle resizing updated the visible angle; one undo restored the horizontal divider.

Saving validated and serialized the full existing document, then reopening remounted the application and reloaded the saved response. Preview/Print, the actual browser-print iframe, downloaded 300-DPI PNG, and downloaded PDF all preserved the horizontal divider. PDF output invoked the application's existing server PDF renderer with the original fonts and artwork. Pixel checks compared the stroke's vertical center at 20% and 80% of its length in both output rasters; the difference was below 0.03 output pixels. Native printer hardware was not involved.

The original business record was read only. Browser save/reopen and print-job bookkeeping used isolated API fixtures populated with that existing record; they did not write to the live business or prove authenticated production persistence. The changes await the managed publication workflow and subsequent authenticated live verification. No migration was changed and no build command was run.

Screenshots and output:

- [Before/after comparison of the same divider](divider-comparison.png)
- [Before, full editor](divider-before.png) / [After, full editor](divider-after.png)
- [Preview/Print](divider-preview.png)
- [Downloaded PNG](divider-export.png) / [Downloaded PDF](divider-export.pdf)

## Ingredient Details layout

The missing-purchase notice and its original edit action moved from the left column to a compact right-column notice below Recipe usage. The standalone package-cost explanation moved inside the existing **How this is calculated** disclosure. The duplicate missing-purchase notice/action inside that disclosure was removed. The six colorful cards, values, photo container/CSS/cropping/placeholder, recipe links, and edit/print actions were preserved. No costing, conversion, inventory, or ingredient mutation logic changed.

At **1440 × 900**, the default collapsed popup fit without internal scrolling. It was also checked at **1024 × 900** and **390 × 900**, with screenshot pairs at each size. The phone maintained image → Recipe usage → purchase notice → calculation content. Existing photo-size checks with an uploaded portrait and twelve linked recipes passed at 1440, 390, and 320 pixels, comparing the container to its original shared layout and verifying the final recipe link remained usable. Overflow retained the normal dialog scroller; no nested scrolling area was added. Expanding calculations retained one purchase action and the moved explanation. The purchase action opened the existing editor, Cancel retained the original ingredient, and recipe navigation worked with zero ingredient writes. No reference screenshot attachment was available in this run, so exact matching to its unspecified viewport could not be confirmed.

- Desktop [before](ingredient-before-1440.png) / [after](ingredient-after-1440.png)
- Tablet [before](ingredient-before-1024.png) / [after](ingredient-after-1024.png)
- Phone [before](ingredient-before-390.png) / [after](ingredient-after-390.png)

## Checks

58 focused Vitest cases passed across transforms, ingredient details/cost cards, Label Studio, preview, label backgrounds, and browser-print layout. Seven popup/photo/toolbar browser cases passed, plus both the existing-design capture and the default synthetic divider regression. TypeScript and whitespace checks passed. Targeted lint passed for the transform, canvas, geometry toolbar, and new browser tests. Existing lint counts in Ingredient Details (22 errors, one warning) and Label Studio (four errors, seven warnings) matched the original source; IngredientCostCards had no findings.
