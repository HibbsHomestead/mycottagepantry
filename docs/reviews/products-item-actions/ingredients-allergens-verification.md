# Ingredient photos and declarations

The existing editor navigation was extended with a distinct ListChecks icon and Ingredients & Allergens button. Photos retained its Image icon and image controls only. Statement name, subingredients, source Contains/May contain text, allergen selections, and supplier review continued to read/write their original draft properties without new classifications or inference. General notes remained in Stock & Other Details.

The read-only view used its existing Radix tabs, with Inventory first/default, Ingredients & Allergens for declarations, and Identification & notes for unrelated metadata. Photos and shelf/bin label printing remained separate. No information was duplicated between read-only tabs. Existing blank-declaration language continued to say that absence of declarations did not confirm allergen-free status.

## Verification

- 33 tests passed across ingredient details, label ingredient statements, and label studio suites. Generated-label logic and field mappings were unchanged.
- Three isolated Chromium scenarios passed at 1440, 768, and 390 CSS pixels. Existing declaration values appeared in the new section. Photos hid declaration fields. Unsaved declaration edits survived section switching. Saving and reopening retained declaration edits and photo removal together.
- Browser checks covered full desktop labels, icon-only tablet/phone labels with accessible names, arrow-key navigation, Inventory default on reopening, no page overflow, bounded modal height, scrolling to the supplier-review checkbox, and Save remaining within the viewport.
- TypeScript, focused test-file ESLint, and git diff whitespace checks passed. No build command was run.
- Captures: [desktop](ingredients-allergens-editor-1440.png), [tablet](ingredients-allergens-editor-768.png), [phone](ingredients-allergens-editor-390.png).

Persistence checks used intercepted synthetic workspace data; no live business records were edited or deleted. No backend, migration, recipe calculation, tax, stock, or generated-label behavior changed. Native Safari was not tested. No branches or previews were deleted.

No deployed preview URL or exact deployed revision was available. The local Netlify development URL was http://localhost:8889; deployment status remained unverified and managed platform validation remained pending.
