# Barcode lookup verification

The reported barcode was `051500141335` (Smucker’s orange marmalade).

## Live provider findings

USDA FoodData Central returned HTTP 200 with zero records. With the configured SerpApi credential, Google returned HTTP 200 with `organic_results_state: Fully empty` for the exact quoted barcode. That is an empty search, not missing authorization. The integration now activates when its credential is configured unless explicitly disabled, and empty Google results receive an accurate notice.

Open Food Facts returned a record whose `0051500141335` GTIN exactly matched the scanned UPC after validated GTIN normalization. The record provided ORANGE MARMALADE FRUIT SPREAD, SMUCKER'S, `17.25 oz (1 LB 1.25 oz) 489g`, a front photo, and source ingredient text. No allergen-free claim or inferred allergen tags were imported. The original ingredient text was preferred over the alternate language field, which contained OCR artifacts. Community data and licensing attribution were displayed for review.

## Checks

121 targeted unit/component/database tests passed; three existing import tests were skipped. Coverage included exact barcode filtering, leading zeros, source outage and web fallback, configured search without a second enablement flag, empty Google responses, package quantities versus nutrition serving sizes, unknown allergens, private inventory isolation, scanner behavior, draft review, and product-page import. TypeScript, targeted lint and whitespace checks passed.

Two Chromium browser cases passed at 390 and 1440 pixel widths using the real provider requests and real product-import parser. A simulated camera stream and detector delivered the reported UPC to the actual scanner callback. Each case opened Add Item, retained a manually entered name through scanner return, automatically looked up the UPC, selected the public product-page candidate, imported and applied available details, offered the photo for explicit approval, preserved `051500141335`, and kept the dialog within horizontal viewport bounds. No item saves or stock writes occurred. Workspace/authentication and quota storage used isolated fixtures; these tests did not access a customer account or copy a photo into customer storage.

## Publication boundary

No build, commit, pull request or direct deployment command was run. The managed workflow publishes source changes after this run. Production publication and lookup against the resulting deployed revision could not be verified within the editing session. The signed-in customer workspace and physical-phone camera remain unverified; local live-provider browser checks do not establish deployed behavior.
