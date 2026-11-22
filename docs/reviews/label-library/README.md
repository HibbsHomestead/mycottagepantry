# Saved label deletion and card layout

The missing controls were caused by `workflowVersion === 1` checks on both selection and Delete rendering. Preserved designs predate that workflow version. The server independently rejected preserved records, required one record kind per deletion request, and rejected any design referenced by a product. The confirmation dialog also disabled its submit button for linked designs.

The library now selects saved records by ID regardless of workflow version. It submits mixed selections atomically through the existing authenticated workspace API. Optional record-kind validation remains compatible with older clients; the server derives each tombstone’s kind from its own saved record. Bakery scope comes from verified membership, and existing Owner/Manager authorization and forced database row-level policies remain in force.

Deletion clears only matching `products.data.labelDesignId` pointers and records a `deletedAt` marker in the same transaction. It never routes product updates through stock/cost calculation saves. Separate labels that reuse identical designs remain untouched. Existing markers and stale-save checks prevent an old response, refresh, or interrupted editor save from recreating a deleted record. Recovery checkpoints remain unchanged; explicitly recovering one creates an independent unsaved copy with a fresh ID.

The Labels view uses a content-width container query with one, two, three, or four columns. Its compact header and toolbar retain the existing application theme and section navigation. Each card includes its checkbox, aspect-preserving front/back previews, product information, explicit width/height, side count, contextual preserved badge, and always-visible actions. Recovery starts collapsed, with checkpoint names/times and editable-file import inside the disclosure. Select All names its search/filter scope, while selected records remain counted when filters change. The bulk toolbar appears only for a nonempty selection.

Verification used synthetic browser fixtures and an isolated PostgreSQL test database. No real saved labels, products, checkpoints, or inventory records were deleted. Automated coverage included normal and preserved deletion, mixed bulk deletion, cancellation, linked-product safety, deletion persistence after reload, sibling-design preservation, cross-bakery rejection, failed deletion, read-only controls, recovery retention/collapse, and existing editor/duplicate/preview behavior.

Rendered screenshots:

- [Wide desktop, 1920px](labels-1920.png)
- [Desktop, 1280px](labels-1280.png)
- [Narrow screen, 1000px](labels-1000.png)
- [Phone, 390px](labels-390.png)

These screenshots show the local development server with synthetic records, not a deployed site. No build or deployment command was run. Deployment remained unverified; the previously reported database branch-capacity blocker was not modified.

Validation passed: 56 focused component/database tests, four Chromium viewport tests (1920, 1280, 1000, and 390 pixels), TypeScript checking, and whitespace checks. Browser tests also exercised Preview/Print, preserved-design editing, and duplication.
