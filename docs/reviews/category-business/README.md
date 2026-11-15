Category and business-details review
====================================

Screenshots use a synthetic workspace with long business details and existing component tax rates. No live business records were changed to capture them. Desktop captures are 1440px wide; mobile captures are 390px wide.

| View | Desktop | Mobile |
| --- | --- | --- |
| Business details before | [Before](business-before-1440.png) | [Before](business-before-390.png) |
| Business details after | [After](business-after-1440.png) | [After](business-after-390.png) |
| Existing tax components expanded | [Components](components-1440.png) | [Components](components-390.png) |
| Category management | [Categories](categories-1440.png) | [Categories](categories-390.png) |
| Material editor with newly selected category | [Material](material-editor-1440.png) | [Material](material-editor-390.png) |
| Food product editor | [Food](editor-food-1440.png) | [Food](editor-food-390.png) |
| Handmade product editor | [Handmade](editor-handmade-1440.png) | [Handmade](editor-handmade-390.png) |
| Ingredient editor | [Ingredient](editor-ingredient-1440.png) | [Ingredient](editor-ingredient-390.png) |
| Packaging editor | [Packaging](editor-packaging-1440.png) | [Packaging](editor-packaging-390.png) |
| Recipe editor | [Recipe](editor-recipe-1440.png) | [Recipe](editor-recipe-390.png) |

The business dialog uses compact desktop rows and stacked mobile fields, with optional costing defaults and disclaimer settings collapsed. A simple default tax configuration uses one percentage input. Component configurations retain their existing rates in an expandable editor, with a qualified nominal total instead of a competing combined-rate field. The same saved rate collection drives both presentations. Tax-inclusive/exclusive behavior, scopes, dates, compounding and jurisdiction details remain available. Blank and explicitly entered zero remain distinct.

Playwright exercises actual workspace components with fixture-backed requests routed through the category handlers, including all six section toolbars and category creation from unfinished editors. Database tests exercise authorization, tenant separation, category changes with assigned records, unchanged stock, tax inheritance after archiving, and unchanged saved tax configuration. These checks do not constitute a live production save.
