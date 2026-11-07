# Labels, duplication and preserved designs

Labels now has one saved-design list and one editor. Create a label, choose its product, design and preview it, then explicitly Save before printing. Starting designs are optional inside creation. Templates are no longer created or assigned through a separate workflow. Old Templates/My Labels/Saved Labels URLs lead to the same Labels list.

Every saved design has Duplicate. It opens a new, independent, unsaved draft named `[Name] — Copy`, with an editable name and product selection. The complete editable document is cloned, including Front and Back, dimensions, layouts, element identities/groups/positions/rotation, fonts and rich text, colors, artwork, bindings and rendering version. Supported reusable print settings and brand/source context are preserved. A duplicate does not inherit saved print jobs, resolved data snapshots, revision history, or device credentials. Shared artwork/font references are retained without cascading deletion.

New and duplicated drafts do not autosave or create recovery checkpoints. Cancel creates no saved label, link, version, recovery checkpoint or print job. Save validates and persists the complete document and product link atomically; uncertain-response retries reuse the same document and operation reference. Output requires explicit Save when a new label or its design/source settings have changed. Saved labels retain recovery checkpoints, recovery export/import, revision conflicts, and retry protection.

New labels store a source and optional product link. The existing `label_templates` document table remains an internal storage name. Its new nullable `product_id` column has a composite business/product foreign key and allows any number of labels per product. Editable source/brand/print context remains in the document JSON. The forward migration adds no data backfill and preserves existing forced tenant policies. Products do not receive an automatic label. Product Details lists every explicit new link and preserved legacy link with Preview/Print and Edit actions. Product forms show linked labels without a template-assignment selector.

Changing the product re-resolves dynamic text/images on every side through the existing shared resolver. Changing source kind or record drops incompatible batch/product context; the server rejects mismatched batch recipes and output against a different saved source/brand. Manual text stays editable and unchanged. Source changes clear manual-text review, identify manual fields on both sides, and require acknowledgment before saving/printing. Preserved designs containing static text also display a review warning before output. The optional display-name rule remains unchanged: non-whitespace `labelMainName`, otherwise the product name, without storing that fallback in the optional field. Preview and printing share this resolution path.

Independent element rotation, Front/Back stock/run handling, and same-tab modal/iframe browser printing remain in place. Print settings preserve copies, sheet/roll geometry, sides, order and a printer selection reference; printer configuration and credentials remain per device. The browser-print engine was not rewritten.

## Existing-record protection and pending conversion

Existing labels, templates, product `labelDesignId` links, revisions, assets and jobs are retained without conversion. They appear in the same Labels list as preserved designs, with original preview/printing available. Their Edit action opens an independent unsaved copy. Original records are protected from save/delete and obsolete template-assignment endpoints reject writes until a conversion inventory is reviewed. New workflow labels support edit, duplication, confirmed single/bulk soft deletion, and cancellation without affecting other designs or shared assets.

Before converting existing records in the intended account environment:

- Inventory explicit product links, shared designs, per-product customizations, Front/Back layouts, missing references, assets/fonts, and recoverable source/print context. Record exact originals and planned copies; do not infer links from names or past print jobs.
- Keep individual labels with one explicit link intact. Make a complete independent copy for each product currently sharing a template/design, retaining the original as provenance/history. Preserve unlinked designs without assigning a guessed product. Do not bulk-create labels for products or built-in starters.
- Flag static ingredients/allergens, ambiguous source/print overrides, missing assets/fonts, deleted links and unsupported multipart/extensions for manual review. Current supported multipart storage is Front + Back; no unsupported format is flattened.
- Obtain approval for the dry-run mapping before conversion. Use a persistent idempotent mapping and retain originals internally without restoring a second user-facing template editor.

The account environment and owner-data inventory remain unverified. No existing-record conversion, overwrite, relinking or deletion was performed by this change.

## Validation limits

Automated component and disposable database tests cover draft cancellation/no autosave, complete duplication, source changes and manual review, multiple product labels, atomic saves/idempotent retries, independent edits/deletion, preserved originals, cross-business foreign keys/authorization, shared rendering, rotation, and printing. Product forms and account-entry regressions are checked separately. These tests do not establish deployed Cloudflare authentication, owner-data acceptance or physical printer output. No build or manual deployment was run.
