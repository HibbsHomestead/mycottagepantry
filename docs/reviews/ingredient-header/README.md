Ingredient editor refinement
============================

These captures show the actual React ingredient editor with synthetic Hibbs demo records. Desktop is 1044 × 1177, matching the dimensions used in the existing ingredient layout review; mobile is 390 × 844. No live records were used or changed.

| View | Desktop | Mobile |
| --- | --- | --- |
| Before | [Before](before-1044.png) | [Before](before-390.png) |
| Compact header and identification | [After](after-1044.png) | [After](after-390.png) |
| Lookup expanded | [Lookup](lookup-1044.png) | [Lookup](lookup-390.png) |

The header contains the thumbnail, title, ingredient name, metadata, close button and all four existing section buttons. Its tabs scroll horizontally on mobile; the form body owns vertical scrolling and Save/Cancel remain outside it. Identification uses a full-width name and Category, paired Brand/Preferred vendor fields, and paired barcode/SKU fields with an inline Scan barcode button. URL lookup can be collapsed without unmounting its inputs; barcode, catalog and permitted photo extraction remain available in a secondary disclosure, alongside pasted text. Purchase-basis warnings and confirmation remain intact.

Implemented classification behavior
-----------------------------------

The old Inventory group was the fixed `categoryId`/`category` list. Selecting it also set `usedAs` (ingredient, packaging, supply or material), which affects inventory navigation, recipe eligibility and packaging behavior. The newer Category selector saved `sectionCategoryId`; it supplied scoped category filters, management, descriptions, parents and archive state. Previously, selecting either did not synchronize the other. They did not represent independent food-ingredient classifications.

The editor and ingredient creation now expose one Category selector with Add/Manage actions. The existing item type remains separate; an existing item's type is still fixed by server validation. Selecting a scoped category synchronizes legacy classification mirrors without changing item type or purchase units. The workspace read boundary maps unambiguous legacy assignments to that same scoped source without writing records. Related inventory/search/display labels therefore agree with category filters. Category renames retain previous names, allowing old labels to resolve without rewriting stock, historic records or an open editor's revision. No database columns or applied migrations were removed or changed.

Conflicting saved labels/IDs remain unchanged and display a review notice. Legacy writers resolve changed labels through the same section-scoped category list; ambiguous matches and invalid or foreign section assignments are rejected. A deliberate Category selection confirms the assignment. Archived assignments remain identifiable.

Purchasing and imports retain vendor/package/cost fields and use the same compatibility boundary for classification changes. Recipe ingredient links use record IDs and quantities; eligible item types still come from `usedAs`. Costing uses quantities, verified conversions and recorded costs. Reports derive inventory/cost data and use a separate ledger expense classification; product tax treatment uses product category/tax settings. Ingredient category selection does not assign product taxes or recalculate historical records.

Verification
------------

TypeScript checking passed. The final focused Vitest run passed 84 tests across ingredient editing, compatibility mapping and conflicts, import review, catalog lookup, inventory browsing, and disposable-database ingredient/recipe/category handlers. Four browser scenarios passed: ingredient editor checks at both sizes and existing category creation/editor-draft scenarios at desktop and 390px. They covered header placement, horizontal overflow, all four sections, retained drafts, lookup expansion, a pinned header/footer, visible failed-save errors, retries and unchanged fixture records. Existing category scenarios exercised creation across all six supported sections and creation without losing editor drafts. Network responses were synthetic; these checks did not exercise live retailer services, camera hardware or production database writes. Builds were left to platform validation.
