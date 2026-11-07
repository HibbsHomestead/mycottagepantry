# Product category management repair

## Root cause and the zero count

Products → Categories rendered only `CategoryTaxSettings`. The existing record list and add/edit controls were inside the product editor, behind Manage categories; the Categories tab never rendered them. The shell also offered Create product on that tab. Its tax-settings footer used an empty initial configuration as a numeric fallback, so it could display zero before a successful category request. This was a missing management surface and an unreliable presentation of loading state.

Stable category records already lived in the Oven's existing Netlify Database settings record (`productCategories`). Product associations already used `productCategoryId`. Legacy free-text `category` values were separate and were not counted as category records. No second category store or schema migration was needed.

The server's category request reused verified membership, explicit Oven selection when needed, tenant transaction settings and forced row-level policies. Source inspection found no separate category query accepting a browser-supplied Oven ID. The diagnostic database connection reported active row filtering for settings, products and memberships; its empty results could not establish the affected customer's actual record counts. Authenticated production inspection of that selected Oven remained unverified. No conclusion that the Oven had no categories was drawn from those filtered results.

The repaired page displayed counts only after a successful, schema-validated API response. Failed loads and permission failures showed a retryable error, not an empty list or zero. The same response supplied both the persisted category list and a separate review of products retaining legacy text.

## Implemented workflow

The tab gained the Product Categories heading, Add Category as its primary action, search, and an empty state with Add Your First Category. Rows showed category name, Food/Non-food classification, linked-product count, configured inherited treatment or Not configured, and edit/archive controls. Archived records remained visible and could be restored.

The main page and product selectors reused one category form, one configuration API and the same records. Category creation selected the returned stable ID immediately inside an open product draft without replacing other edits. Both food product and handmade/resale editors continued using that selector. Reopening a saved product retained its association; renaming retained the category ID and existing name-scoped tax-rule aliases. Blank names, normalized duplicates, stale revisions and unauthorized category references remained rejected server-side. Existing unclassified records retained their review status, while a classified record could not be changed back to an unclassified value.

Classification changes listed the affected product names and required confirmation of the affected count. The server independently checked the count under the existing Oven transaction lock. Completed transactions and existing product-level tax assignments remained unchanged.

Archive/restore required an explicit confirmation and Owner/Manager permission. The server blocked archiving any category still referenced by a product; the UI explained that products must first be reassigned. Archive marked the existing record inactive rather than deleting it, retained its ID/name, and removed it from new selections. Existing selection-preservation behavior and cross-Oven validation remained in place. The existing activity history recorded category changes.

Food/Non-food tax mappings moved into a clearly labeled, collapsed secondary Tax Settings section. That section shared the management page's loaded configuration, so mapping changes refreshed displayed treatment labels immediately. The separate Settings → Taxes workflow remained available. No configured rate, rate calculation, jurisdiction rule, compounding behavior, tax source, or saved historical tax snapshot was migrated by this repair.

## Migration boundary

No schema or business-data migration was added or executed. Legacy free-text names remained visible for owner review. Converting them later required an explicit exact-name-to-stable-ID mapping, decisions about capitalization/whitespace conflicts, and confirmed Food/Non-food classification. Switching existing product-level tax assignments to inheritance remained a separate reviewed migration. This repair did not merge names, infer classifications, replace legacy values, or seed the illustrative categories in any deployed database. Test categories existed only in isolated fixtures.

## Verification and deployment

The final full automated suite passed 838 tests, with 15 opt-in tests skipped, across 98 passing and seven skipped files. The focused category suites passed 21 tests with one opt-in external-source test skipped. TypeScript, focused ESLint and whitespace checks passed.

Disposable PostgreSQL tests created Bread as Food and Bags as Non-food, assigned both to products, saved and reopened them, checked their distinct inherited configured tax results, renamed a category without changing its links, read the persisted records again, and rejected cross-Oven access and references. They also checked blank/duplicate validation, classification/mapping confirmation counts, preservation of completed-sale snapshots and existing tax assignments, stale revisions, direct archive attempts with linked products, explicit confirmation, archive/restore persistence, new-selection rejection for archived categories, permissions and generic-settings bypass protection. No deployed business database was changed by these tests.

Component tests exercised the actual Products → Categories shell route, main action, list/search, inherited labels, affected product names, failed/permission/loading states, empty-state creation, read-only access, archive/restore confirmation and retained legacy values. Existing selector tests covered inline creation, immediate selection and unsaved product edits.

Thirteen Chromium checks passed with no page errors using the current WorkspaceApp in its development-only capture fixture at localhost:8889. The checks created Food and Non-food categories, assigned and reopened both products, created a category inline while retaining unsaved fields and selecting the new record immediately, renamed and reopened a linked category, refreshed the page, confirmed archive behavior, and checked 1440- and 390-pixel layouts without horizontal overflow. Screenshots were visually inspected. These checks used synthetic intercepted API responses; they did not replace the real SQL/API tests or establish authenticated production acceptance. The normal local SSR route initially referenced unavailable cached asset files, so browser rendering used the current source fixture rather than that stale SSR output.

The last production deployment observed during this repair was `6aea61a12f9fe06457332eec`, published November 3, 2026 at 22:36:15 UTC. It predated this repair. Automatic platform validation and publication, followed by authenticated production acceptance in the intended Oven, remained pending. No build command or manual deployment ran, and all eighteen applied migrations remained unchanged.
