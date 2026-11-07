# Ingredient URL import regression

The ingredient importer was repaired to fill available blank fields in the existing popup draft. Multiple offers now contribute their shared product details immediately; choosing a fulfillment offer fills a blank price. Manual entries and reviewed ingredient/allergen wording require explicit replacement. Package contents now reach the current Add Item fields. No retailer parser, database schema, stock posting, popup layout, calculation-card design, Square configuration, or Production setting was changed.

**Release verification remains incomplete:** the available deployed preview required sign-in. Its actual import API returned HTTP 401 before extraction. The deployed client was reproduced with a replay of the real retailer payload and synthetic workspace/access responses. The corrected client was tested in Netlify dev with those captured public responses. Those rendered tests establish the client correction; they do not establish authenticated backend acceptance on a newly deployed preview.

## Exact URLs tested

Reported failing product:

https://www.samsclub.com/ip/Arm-Hammer-Pure-Baking-Soda-13-5-lbs/13960262278?classType=REGULAR&athbdg=L1103&from=/search

Separate historical regression check:

https://www.samsclub.com/ip/Member-s-Mark-Bread-Pizza-Flour-25-lbs/13909715756

Both URLs were retrieved live using the application's existing secure fetcher on November 6, 2026 at approximately 23:19 UTC. Public parsed responses were captured in the browser-test fixtures. The URL submitted by the popup was asserted exactly, including `classType=REGULAR&athbdg=L1103&from=/search`; the flour URL was asserted separately.

## Observed request and state flow

The deployed preview inspected was https://agent-6aee582a8e4458aa6402a58a--mycottagepantry.netlify.app. Opening `/oven#Inventory/Ingredients` redirected the unauthenticated browser to sign-in. Separate actual POST requests to `/api/workspace?productImport=1` for each exact URL returned `401`, JSON, `SIGN_IN_REQUIRED`, and “Log in on this site to open your existing oven.” No authenticated retailer request through that deployed API was observed. This is an application-session failure and is not evidence of Sam's Club blocking.

The current server fetch/extraction code nevertheless retrieved both exact retailer URLs successfully in this environment. Baking soda produced three fulfillment offers: shipping $9.42 USD, pickup $8.98 USD, delivery $8.98 USD. All shared the same name, brand, identifiers, 13.5 lb package and `Sodium Bicarbonate 100%` ingredient text. The flour produced three $10.98 USD offers with fulfillment/membership conditions and the original full ingredient and Contains text. These observations rule out a parser failure for these particular retrieved responses; they do not promise future prices or access from another environment.

Replaying the baking-soda payload into the **actual deployed client**, while isolating workspace/auth reads with synthetic fixtures, reproduced the empty form. Immediately after Import, the offer selector was `-1` and the rendered item name was empty. After manually choosing an offer, checking Name, Purchase package quantity, Purchase unit and Package price, and applying them, the current form still showed an empty Amount in each package and an empty Cost per package, with Purchase unit incorrectly set to `lb` for this package setup.

Three client causes were confirmed:

1. `search()` stored products in local review state, selected no offer for a multi-offer response and cleared all field selections. It never called the parent draft callback. Even identical name/ingredient fields remained unapplied until a second manual review action.
2. The importer supplied legacy `purchaseQuantity`/`purchaseUnit`, while Add Item's current Package & Cost section reads `amountPerPackage` in the stock unit and a separate purchase package type. No contents value reached the rendered package-amount input.
3. Apply deliberately excluded `packagePrice` and stored only `listedOnlinePrice`. The current Cost per package input reads `packagePrice`, so it remained blank despite an extracted/selected price.

No subsequent reset was needed to explain these blank fields: the values had never reached those draft keys. The fix uses the latest committed draft when the asynchronous request completes, so entries made during loading are preserved. Section switching, repeated import and existing-record editing were then checked for state loss.

## Extracted fields versus rendered fields

The following values were observed in the corrected **local rendered popup** using the real captured responses and a blank new-ingredient draft. They are not claimed as screenshots of a newly deployed fix.

| Field                     | Baking soda extraction                      | Rendered result                                                                                    |
| ------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Name                      | Arm & Hammer Pure Baking Soda, 13.5 lbs.    | Same text in Item name immediately after Import                                                    |
| Brand                     | ARM & HAMMER                                | Same text immediately                                                                              |
| Supplier                  | Samsclub.com                                | Existing Sam's Club vendor ID matched; no vendor created                                           |
| Package amount            | 13.5 lb                                     | 6123.496995 g in Amount in each package; current stock unit g retained                             |
| Purchase package type     | No structured type extracted                | Generic `package`; an entered `bag` remains `bag`                                                  |
| Price/currency            | Shipping 9.42 USD; pickup/delivery 8.98 USD | Blank until offer selection; pickup selection filled 8.98 and retained its listed-price disclosure |
| Barcode                   | 033200003403                                | Same string; leading zero retained                                                                 |
| Retailer identifier       | 13960262278                                 | Retained separately from internal SKU and barcode                                                  |
| Original ingredient text  | Sodium Bicarbonate 100%                     | Full text in Subingredients                                                                        |
| Contains                  | Not returned                                | Remained blank and was identified as unavailable                                                   |
| Advisory/facility wording | Not returned                                | Remained blank and was identified as unavailable                                                   |
| Description               | Four source bullet paragraphs               | Preserved in Notes across sections                                                                 |
| Photo                     | Source image URL returned                   | Preview only; existing photo retained until explicitly selected for import                         |

The separate flour check populated `Member's Mark Bread & Pizza Flour, 25 lbs.`, `Member's Mark`, 25 lb / 11339.80925 g, the selected 10.98 USD price, barcode `078742251462`, retailer identifier `13909715756`, and the original statement:

> Bleached wheat flour, malted barley flour, niacin, reduced iron, thiamine mononitrate, riboflavin, folic acid.

`Contains wheat.` appeared in Source Contains statement. No advisory statement was returned or invented. The label ingredient display name (`statement`) and allergen checkboxes remain manual review fields; the original supplier statement is retained in `subingredients`, as in the existing import model. Missing statements never mean allergen-free.

## Correction and safeguards

The importer now fills blank shared fields as soon as a validated response arrives, using consensus across all returned products/offers. It waits for an explicit fulfillment choice before applying a price, even when multiple offers happen to have the same price. It does not silently change the price when another offer is selected after a value has been entered; the conflict is reviewable.

The Add Item mapping converts the stated source contents to the selected stock unit using existing verified conversion rules. It uses a generic purchase package type when none has been entered and preserves an entered bag/bottle/package type. A missing weight/volume conversion leaves the amount unapplied and identifies the conversion needed. Legacy edit forms keep their existing quantity/unit representation. Conflicting manual package measurements or currency prevent automatic price application to the wrong cost basis.

Only blank fields are populated automatically. Nonempty manual fields, explicit zero prices, verified wording, current photos, item type, existing record identity, stock and stock options stay intact. Replacement still uses the existing field-selection review and reviewed-wording confirmation. Imports update the same parent draft, never navigate or auto-save. Existing inventory filters and scroll are preserved. Online price remains labeled as an estimate, separate from an actual receipt. The existing calculation-card money formatter also keeps the imported nonzero per-gram cost visible ($0.00147/g for the selected baking-soda offer) instead of showing $0.00.

Missing fields are listed inside the popup. Empty/invalid responses preserve the draft and show an error. An image-only response with a failed photo does not count provenance as a usable field and does not report successful application.

## Rendered verification and screenshots

Browser checks covered blank and manually completed new drafts at 1440 and 390 pixels, the existing ingredient editor, reviewed-wording replacement, exact request URLs, identity-preserving explicit save, all Add Item sections, repeated import, typing during a delayed response, partial extraction, request/extraction/response-shape failures, and an image-only/failed-photo response. Existing popup workflow tests covered cancellation, uploaded-photo retention, unchanged inventory context and a single save. These checks used synthetic workspace records and intercepted public product responses; customer records were not modified.

Actual deployed client before the fix, with public extraction replay and synthetic workspace/access responses:

- [Import returned offers while the name remained empty](previews/ingredient-url-before-preview.png)
- [Manual Apply still left package amount and price empty](previews/ingredient-url-before-package-preview.png)
- [Actual unauthenticated preview sign-in screen](previews/ingredient-url-preview-sign-in.png)

Corrected local rendered client, with the same captured public source response:

- [Populated item details, desktop](previews/ingredient-url-after-details-1440.png) and [mobile](previews/ingredient-url-after-details-390.png)
- [Populated package cost and contents, desktop](previews/ingredient-url-after-package-1440.png) and [mobile](previews/ingredient-url-after-package-390.png)
- [Preserved baking-soda statement, desktop](previews/ingredient-url-statements-1440.png) and [mobile](previews/ingredient-url-statements-390.png)
- [Separate flour statement and Contains regression](previews/ingredient-url-flour-regression.png)

Authenticated import and rendered-field verification on the automatically generated new deploy preview remains the release acceptance step. No successful authenticated preview request, deployed fix screenshot, save to a real workspace, or Production deployment is claimed here.
