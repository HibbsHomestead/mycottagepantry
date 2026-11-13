# Ingredient editor and phone dialog follow-up

Both issues remain open until managed publication and verification of the affected signed-in workspace. No customer records were accessed or altered.

## Exact deployed crash frame

The supplied `oven-DJCpJHuI.js:22:9402` was inspected directly in the served asset. It points into the minified `IngredientDetail` editor initialization object at `threshold:q(e.threshold||0,e.unit,I,e.conversions)`. The component frame at column 7184 identifies the same component by its ingredient/workspace/canEdit/close/open/save/onWorkspace/initialEditing props. This maps to `IngredientDetail.edit()` and `convert(i.threshold || 0, i.unit, storage, i.conversions)`, not the read-only detail renderer. The adjacent reorderQuantity conversion has the same problem, including for zero amounts. The editor's Opening stock balance also called each → can without a fallback.

Draft initialization now uses the existing strict saved-unit display selection. Saved reorder amounts stay in fields labeled with their actual units. The shelf preference remains can. Submission converts those labeled draft amounts into the selected shelf unit only after conversion/basis validation; unresolved saves remain blocked. Changing shelf units keeps package-contents and reorder-amount bases separate. Cancel performs no mutation. Opening-stock balance and read-only reorder values use saved units when required. The warning identifies the missing relationship. Cost cards retain available saved quantities/current costs and known package calculations; unsupported derived values say “Conversion required.” The new cost-display catches accept only the exact missing-relationship error and propagate other errors.

## Production phone reproduction

A browser loaded production assets at https://mycottagepantry.com/oven with intercepted synthetic workspace/account-access responses. At 390 × 844, opening All-purpose flour from Inventory Overview reproduced bounds x=-171, y=-398, width=366, height=820. Computed top and left were both 12px; computed translate was still `-50% -50%`, while transform was the identity matrix. Thus the remaining Tailwind individual translation shifted the correctly anchored dialog by half its own size. This was the actual read-only Radix portal popup, outside the workspace shell, not a banner or an ingredient-editor page.

The read-only dialog uses modal presentation and did not use the ingredient editor shell. Prior shared viewport rules set its bounds but did not eliminate the winning translation in the deployed cascade. Development CSS resolved translate to none, so local development alone did not reproduce that production cascade difference. Ingredient Details now opts out of the generic centering and animation utility classes entirely. Scoped CSS preserves desktop centering above 1024px. Mobile/tablet retain the shared visual-viewport bounds, safe-area spacing and single shell scroll. The portal, approved content layout, cost cards, photo styling and linked usage were preserved. The regression asserts absence of translation utility classes as well as actual viewport bounds.

## Verification

45 unit/component tests passed across ingredient details, cost cards, Pantry inventory, stock-unit basis, purchase setup and shared overlays. This included an unchanged missing each/can fixture, blocked unresolved save, saved reorder fields, Cancel with no save, valid existing conversions, unsupported-unit error propagation, and a verified 1 can = 2 each correction on a synthetic fixture. The correction test submitted shelf-unit reorder amounts, then ran the real updateIngredient validation and checked that saved stock, recorded cost and saved reorder amounts remained unchanged.

Six local browser cases passed at 390, 820 and 1440px, each in Cards and Table. They exercised Overview and Ingredients, AP flour open/close/reopen, pumpkin open → Edit Ingredient, saved name/reorder fields/current balance, warning, Cancel, scrolling, repeated dialog bounds and unchanged inventory totals/fixture snapshots. No workspace writes occurred. Phone read-only bounds after the change were x=12, y=12, width=366, height=820. Screenshots in the adjacent editor-and-mobile-follow-up directory show synthetic AP flour fixtures. Local browser checks used the real workspace component through the development fixture harness; they do not establish that unpublished production bundles or the customer's signed-in records are fixed.

TypeScript and targeted lint passed. The ingredient-detail test file retained two confirmed pre-existing lint errors (explicit any and unused _url). No build command was run. No migrations, business records, stock, historical costs, ledger, permissions or persistence were changed.

## Publication and outstanding verification

The live site check during this run returned published commit `7ac3ad71c239c3055f483593aed8d6706dfa8ba0`, deployment `6af69c5ddb20d027f35714c5`, published `2026-11-13T05:13:53.422Z`. This is the pre-correction deployment; it is not a publication of this work. These source changes were prepared for managed publication. The run did not create a commit or deploy directly.

A new published commit/deployment, production bundle verification, and the user's actual signed-in pumpkin Edit Item and AP flour phone workflows remain unverified. Both issues stay open. The unchanged missing-conversion fixture must be reused after publication; manually repairing the customer's pumpkin is not verification of this fix. Existing Inventory access handling and safe diagnostics were preserved.
