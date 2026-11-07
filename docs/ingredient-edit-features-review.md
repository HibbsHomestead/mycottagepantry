# Ingredient editor and Features visual review

Edit Ingredient now uses compact, independently flowing groups. Purchase & costing stays on the left, with Recipe usage immediately below it. Inventory settings, Label information & notes, conversions, and source specifications flow on the right. On mobile, Recipe usage follows those groups. Closed disclosures occupy their header row; conversions open directly without a second nested disclosure. The popup retains one scrollable body and its visible Cancel / Save changes footer.

Identification and photo controls were grouped more compactly. An empty edit-photo placeholder was removed while photo selection and upload remained available. The approved read-only Ingredient Details layout and image placement were preserved. Import, shared-draft mapping, cost calculations, stored precision, validation, stock operations, and the save API were retained.

## Actual before/after captures

The only supplied attachment was the Product Edit reference, measuring **1044 × 1177**. Desktop captures use that viewport; mobile captures use **390 × 844**. The requested ingredient was absent from the repository's demo records, so these images render the real application with the same synthetic **Spiced Orange Finishing Sugar** record before and after the change. Its values are demonstration values, not a reproduction of a private saved ingredient. Captures were made locally using deterministic API responses; they do not claim authenticated deployed-database verification.

| State                                             | Before                                                         | After                                                        |
| ------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------ |
| Purchase / Inventory area, desktop                | [Before](previews/ingredient-edit-before-groups-1044.png)      | [After](previews/ingredient-edit-after-groups-1044.png)      |
| Label information & notes expanded, desktop       | [Before](previews/ingredient-edit-before-labels-1044.png)      | [After](previews/ingredient-edit-after-labels-1044.png)      |
| Ingredient-specific conversions expanded, desktop | [Before](previews/ingredient-edit-before-conversions-1044.png) | [After](previews/ingredient-edit-after-conversions-1044.png) |
| Narrow-screen purchase area                       | [Before](previews/ingredient-edit-before-groups-390.png)       | [After](previews/ingredient-edit-after-groups-390.png)       |
| Label information & notes expanded, mobile        | [Before](previews/ingredient-edit-before-labels-390.png)       | [After](previews/ingredient-edit-after-labels-390.png)       |
| Conversions expanded, mobile                      | [Before](previews/ingredient-edit-before-conversions-390.png)  | [After](previews/ingredient-edit-after-conversions-390.png)  |

The previous layout left the right side empty beneath Storage location and postponed full-width disclosures until the costing section ended. The replacement puts those disclosure headers directly beneath Inventory and allows Recipe usage to follow costing independently. The popup viewport and readable type sizes were retained.

## Features images replaced

All six previous screenshots showed older navigation or controls. No additional UI illustrations appeared on the Features page.

| Visual     | Current screen used                                                                                                     |
| ---------- | ----------------------------------------------------------------------------------------------------------------------- |
| Costing    | Homestyle White Bread recipe detail with Cost breakdown expanded                                                        |
| Inventory  | Inventory → Ingredients, Table view; balances, unit costs, values and stock status                                      |
| Recipes    | Production → Recipes & Designs, with current recipe cards and costs                                                     |
| Production | Production Runs, including demo batch history and stock checks                                                          |
| Labels     | Existing label designer with a Homestyle White Bread demonstration design; mobile zoom adjusted to show the whole label |
| Finances   | Tax Center with October demo transactions selected using the existing Last month filter                                 |

Each visual has an actual desktop and mobile capture. Consistent frames and the existing screenshot viewers were retained; viewers now fit their images to the available width. Inventory, recipe-list, and production alternative text was corrected to name the current screens. The descriptions and availability statements were reviewed; no further description mismatch was identified. Feature availability, pricing, subscription claims, page structure, and branding were preserved.

No existing Features visual was deferred. The newly revised Edit Ingredient popup was deliberately excluded from marketing captures pending review of this change.

Updated rendered Features page: [Desktop, 1440px](previews/features-refreshed-1440.png) · [Mobile, 390px](previews/features-refreshed-390.png).

Readable section crops: [Desktop Inventory section](previews/features-inventory-1440.png) · [Mobile Inventory section](previews/features-inventory-390.png).

## Verification

Twenty ingredient browser checks passed, covering editor grouping, one scrollable body, footer visibility, precision in the submitted draft, URL-import conflicts and preservation, and the read-only photo layout at desktop and narrow widths. Three Features browser checks passed, capturing all six screens and checking both responsive pages, image selection, all screenshot viewers, Escape/focus restoration, no horizontal page overflow, and no business-data requests from the public page. Twenty-one focused unit/component tests passed. Type checking, formatting, whitespace checks, and lint for the updated tour and new capture checks passed.

The existing ingredient and finance source files retained the same lint findings as their unchanged baselines; no new findings were added. No build command ran, and no database migration or customer-data change was required.
