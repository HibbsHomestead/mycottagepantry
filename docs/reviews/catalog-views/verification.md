# Recipe and product views

Recipes & Designs and All Products now use Ingredients’ compact controls and offer both cards and tables. The Ingredients action tooltip was extracted unchanged into `ActionTip`, and the existing card/table markup became the shared `CatalogViewToggle`, also used by Ingredients. Both pages reuse `inventory-primary-actions` styling, the `pantry-view-toggle` selected states, Radix dropdowns/tooltips, and compact `SectionCategoryTools`. Ingredients’ appearance and behavior were retained.

Recipes retain create, import, export, add-category and manage-category workflows. Products retain export and a primary create menu with separately labeled kit, food, handmade and resale choices. Category actions use Ingredients’ overflow menu. The All Products filter includes the existing eligible categories across product sections; classification remains separate. The other product tabs retain their prior toolbar layouts.

Each page derives one filtered, ordered record collection for its count, cards and table. Existing recipe costing, product card cost validation, profitability, currency formatting, detail routes and product record menus were reused. No per-row requests or new costing calculations were added. Recipe tables show category, yield, existing labor time, batch and unit costs. Product tables show type, category, price, cost, profit and margin with the same incomplete-data states as cards.

View preferences follow Ingredients’ server persistence: authenticated-user/demo-session preferences in the existing workspace settings JSON in Netlify Database, with independent recipe and product keys. Responses expose only the current user’s selection; general settings writes preserve the preference maps. No migration or business-record changes were needed. Mobile table selection stays a real table within a labeled, focusable horizontal scroll region, overriding the older global mobile card transformation only on these pages. The botanical/ribbon background and theme variables were retained.

## Files

- `src/components/action-tip.tsx`: shared Ingredients tooltip.
- `src/components/catalog-controls.tsx`: shared view toggle, compact actions and immediate view selection.
- `src/components/catalog-controls.css`: scoped responsive catalog layout and scrollable tables.
- `src/components/inventory-tools.tsx`: imports the extracted tooltip.
- `src/components/pantry-inventory.tsx`: uses the extracted view toggle with its existing behavior.
- `src/components/section-categories.tsx`: compact-menu tooltip and optional combined category filter scopes.
- `src/components/workspace-app.tsx`: focused recipe/All Products toolbar and table integration.
- `src/components/product-cards.tsx`: product table with shared costing and record actions.
- `src/components/product-cards.test.tsx`: supplies the tooltip environment used by the application.
- `src/lib/workspace.test.ts`: server preference independence, role access, privacy and validation checks.
- `tests/catalog-views.browser.spec.ts`: isolated rendered workflow checks and screenshots.
- This evidence document and the twelve screenshots alongside it.

## Verification

Chromium used the actual application at `http://localhost:8889/capture-fixture` through Netlify dev. Workspace requests were intercepted with synthetic demo records, including preference saves and category responses. No customer account or real business data was changed. This verifies the rendered application and mocked reload responses, not a remote database integration.

Four browser scenarios covered both pages at 390px and 1440px: cards/table rendering, matching record names/order/counts, search, category filtering including a category from another product section, state retention, selected states, save/reload preferences, category menu and dialogs, recipe creation/import, CSV downloads, every product creation choice, detail opening and access to final records. Product menus were opened with touch at mobile size and keyboard at desktop size. Keyboard-focus export tooltips were checked. Mobile tables retained table display and their own horizontal overflow without page-wide horizontal overflow. Additional desktop screenshots covered both views in the Orchard dark theme.

The related component suite passed 40 tests across product cards, Ingredients views, inventory toolbar actions and product categories. The focused actual workspace-handler suite passed two preference tests (80 unrelated tests were intentionally excluded), including per-user privacy, independent page preferences, accepted roles and invalid-page rejection. TypeScript, targeted ESLint for the new controls/product presentation/browser test, and whitespace checks passed. No build command was run; the managed platform performs build validation after edits.

## Screenshots

| Page | Mobile cards | Mobile table | Desktop cards | Desktop table |
| --- | --- | --- | --- | --- |
| Recipes | [390px](recipes-cards-390.png) | [390px](recipes-table-390.png) | [1440px](recipes-cards-1440.png) | [1440px](recipes-table-1440.png) |
| Products | [390px](products-cards-390.png) | [390px](products-table-390.png) | [1440px](products-cards-1440.png) | [1440px](products-table-1440.png) |

Dark desktop: [recipe cards](recipes-cards-dark-1440.png), [recipe table](recipes-table-dark-1440.png), [product cards](products-cards-dark-1440.png), [product table](products-table-dark-1440.png).

## Deployment and branch retention

The managed checkout reported `main`. The read-only deployment inventory contained no deploy with these edits. This task’s deployment ID, preview URL and preview database branch identifier were not yet available. The local verification URL above is not a deployed preview. The automatic build/deployment, deployed browser verification, remote preference persistence check and task-preview protection remain pending. No claim of a live update is made.

The existing production deployment was `6afe588cdd462bb732dd8993`, commit `600ed761da662871e61f9fb0ca88886ec4c84ba9`, at `https://mycottagepantry.com`, with production database branch `production`. The latest preceding ready preview was `https://deploy-preview-98--mycottagepantry.netlify.app`, deploy `6afe343e155e3fa6aacf1fd3`, source branch `agent-without-a-section-87b8`, commit `8b3cd186aa24ea67b5303e41999845a480300b14`. These deployments do not contain this task’s changes.

`agent-without-a-section-87b8` and its preview are verified cleanup candidates from the completed prior task: the current production merge commit identifies pull request 98 and directly includes that preview’s source commit as a parent. This identifies candidates only; no branch or preview was deleted. Its database branch identifier was unavailable and must be identified before any exact-target database cleanup approval. No other branch was classified as verified obsolete.

All existing previews, deployments and database branches were retained. Retain the forthcoming task preview and its database branch throughout review. There was no task-specific deployed preview available to pin or protect during this run, so protection cannot be reported as completed.
