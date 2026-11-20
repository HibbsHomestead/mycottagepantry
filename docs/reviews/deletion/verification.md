Code evidence: compound recipe save in netlify/functions/workspace.mts creates `prep-${item.id}` and sets `compoundRecipeId: item.id`. src/lib/recipe-components.ts reuses that explicit relationship for prepared inventory. The previous itemDeletionBlockers scanned the output's backlink and reported an unqualified ingredients/name string. This establishes a generated-output blocker in the implementation, not the identity of the customer's actual records.

Actual “Spiced Orange Finishing Sugar” IDs, stock and historical dependencies: not inspected through an authenticated live business session. No live records changed.

Passed checks:
- Vitest: item-deletion-database and mockup-handler, 17 tests.
- Playwright: deletion-review and category-mockup, six tests at desktop/tablet/phone widths. API responses were intercepted synthetic fixtures.
- TypeScript and git diff whitespace checks.
- Focused lint: no errors; existing item-deletion request-effect dependency warning.

Screenshots: blocked-1440.png, blocked-820.png, blocked-390.png. Phone dialog visually inspected. Mockup confirmation red styling also checked in the rendered browser.

Database tests used isolated PGlite fixtures, normal migrations and the real workspace handler. They covered atomic coordinated deletion and rollback, stock/history/external links/cycles, same-name independence, permission and tenant rejection. Browser fixtures checked cancellation, visible blocker explanation, failed deletion preservation and one request after a double click.

Preview URL / exact deployed revision: unavailable. Deployed browser checks and actual named-record dependency review remain outstanding. These results do not establish production deletion eligibility or a live deployment.
