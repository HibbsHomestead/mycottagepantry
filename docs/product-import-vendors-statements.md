# Product import: packages, vendors, and package statements

The missing ingredient statement was an extraction gap. The reported Sam’s Club flour page supplied no `Product.ingredients` value, but its accessible Specifications content contained a labeled Ingredients paragraph followed by a separate Contains statement. The importer previously read only the structured ingredient property. The response schema, ingredient form field, and save/update paths already supported `subingredients`; this failure happened before those stages.

The secure product fetcher retrieved the previously reported [Member’s Mark Bread & Pizza Flour, 25 lb](https://www.samsclub.com/ip/Member-s-Mark-Bread-Pizza-Flour-25-lbs/13909715756) page on November 2, 2026 at 01:00:12 UTC. The updated extraction returned this exact wording:

> Bleached wheat flour, malted barley flour, niacin, reduced iron, thiamine mononitrate, riboflavin, folic acid.

It separately returned “Contains wheat.” No May contain or facility statement was extracted from that response. The source supplied package quantity 25 lb, barcode `078742251462`, and retailer SKU `13909715756`. These identifiers remained separate strings. This was a live source retrieval, not a claim about all Sam’s Club products. The 10 lb package example was covered with synthetic data; the available historical reported URL was the 25 lb product.

## Resulting behavior

Import review now offers purchase package quantity and unit once, with pack count only when supplied. Raw source package wording is retained as provenance rather than offered as a second selectable field. Uncertain parsing receives a review message beside quantity/unit; no total or pack count is invented. Existing stored package metadata is preserved.

Vendor review loads the authorized workspace’s current vendors and matches normalized website domains, known retailer aliases, and vendor names. A single match is suggested by stable vendor ID. Multiple matches require a choice. A searchable selector also exposes other existing vendors. Brand remains independent. Failed vendor loading offers a retry and never becomes a no-match result. New vendor creation requires its own explicit confirmation; the server rechecks existing matches under the workspace mutation lock and reuses a match on retries. Import, Apply, and ingredient saves do not create vendors. Existing vendor names, notes, contacts, and other data are retained.

Ingredient statements are read from explicit structured properties, labeled accessible product sections, and the observed Sam’s Club product specifications after matching the source product IDs. Ingredient order, nested subingredient parentheses, and punctuation remain intact. Contains and May contain/facility wording remain separate from ingredients and description. Product names, brand, general descriptions, and customer-review text do not supply an inferred ingredient statement. Missing text displays: “Ingredient statement not available from this page. Paste the package text or enter it manually.”

The trace is source retrieval → statement extraction → validated import response → editable review → selected form fields → ingredient save/update → fresh workspace read. Applying statements clears reviewed status. Replacing different existing reviewed wording requires an additional explicit selection. Imported wording does not select allergen checkboxes or mark allergens reviewed. Both creation and editing expose the separate saved source statements.

The lower review uses a short description preview with Expand/Edit, full-width statement fields sized to their content, compact SKU/barcode inputs, collapsed Source details, a retailer/date/link summary, and Copy source URL inside expanded details. The original requested URL and retrieved URL are retained separately. The footer stays in document flow with selection count, Apply/Cancel, and one apply-versus-save explanation. Collapsing sections retains edits and selections.

## Validation and deployment

The focused automated suite passed 171 tests; three existing opt-in live cases were skipped. Coverage included vendor aliases/domains, ambiguous/no matches, list-load failure and retry, explicit creation and retry reuse, tenant-scoped vendor access, foreign-ID rejection, repeated import/apply/save, vendor-data preservation, nested ingredient wording, separate allergen/cross-contact text, missing statements, and reviewed-text replacement. SQL persistence boundaries were mocked, not production writes.

Four Chromium browser tests passed at 1440 px and 390 px. Using synthetic API records, they exercised selective Apply, explicit Save, failed-save recovery, double-click protection, vendor reuse, separate statement persistence after reopen/refresh, collapsed edits, keyboard disclosure controls, leading-zero identifiers, overflow, and accessible actions. Screenshots were inspected. These were real browser interactions with mocked account/API boundaries, not authenticated production acceptance.

The separate opt-in live observation passed through the application’s secure source fetcher and returned the real statement quoted above. No customer records were written. No authentication, billing, migration, or existing vendor data was changed.

The latest confirmed production deployment remained `6ae7b3bdd27a02b549057595`, commit `c4ce26108c70f3c752b544a5b04fde2c1b83f56f`, published November 1, 2026 at 21:49:57 UTC. It predated this fix. Testing used the changed local source served through Netlify dev; no new production deployment containing this fix was available during the run. Platform build/publication validation and authenticated production acceptance remained pending.
