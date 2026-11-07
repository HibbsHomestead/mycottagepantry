# Cottage Pantry architecture

This is a TanStack Start React application deployed to Netlify. It is a bakery back-office workspace, not a storefront.

## Key directories

- `src/routes/index.tsx`: responsive app shell, nine navigation sections, shared forms and detail dialogs. Navigation uses URL hashes so refresh preserves the section.
- `src/components/bakery-art.tsx`: original SVG bakery illustrations and product thumbnails.
- `src/styles.css`: reusable UI styles, ivory/olive theme, DM Sans and Lora typography, responsive navigation and print label layout.
- `src/lib/domain.ts`: normalized unit categories, explicit verified cross-category conversions, recipe cost calculations, currency and CSV formatting.
- `src/lib/demo.ts`: deterministic Hibbs Homestead Market seed and compound cost rollup.
- `src/lib/reports.ts`: derived report rows and quoted CSV parsing.
- `db/schema.ts`: Drizzle schema; composite tenant keys link recipes, ingredients, products, packaging, batches, sales, and ledger. JSON data provides extensible business fields alongside normalized relational keys and stock columns.
- `netlify/functions/workspace.mts`: server-authoritative workspace API, authentication, private demo session provisioning, seeded records, role enforcement, transactional stock/cost/accounting operations.
- `netlify/database/migrations/`: generated schema plus organization security policies, stock constraints, journal balance/immutability triggers.

## Conventions and invariants

All persistent data belongs in Netlify Database. Never persist business data in browser storage or a local JSON file. Client demo data is a read-only initial preview until the private API connects. Client calculations provide immediate feedback; server mutations validate values independently.

Every request establishes business ownership from verified Identity membership or a cryptographically random HttpOnly demo cookie. The cookie hash is stored server-side. Every query includes business ownership and every organization table has forced row-level policies using transaction-local settings. Never accept business IDs or roles from client input. Composite foreign keys prevent references crossing organizations.

Stock cannot change without a ledger record. Receipts use weighted average unit cost; batch completion locks actual usage and costs in one transaction. Completed batches and posted journal entries cannot be edited. New records and corrections use new IDs. Compound prep costs roll up without rewriting historical runs. Prevent compound cycles. Never guess density, allergens, or tax rules. Tax collected is separate from revenue.

Use Radix dialogs with titles/descriptions, visible form labels, focus states, and responsive tables. Label printing is a browser print page; do not claim certified compliance or built-in nutrition analysis. Integration placeholders must explicitly indicate unavailable connectivity.

Netlify automatically installs and validates this project after edits. Follow the current run's validation restrictions; do not start a server or build when prohibited. Read changed source files for verification. Keep migration files synchronized with schema changes and preserve explicit security triggers when regenerating an unapplied initial migration.

Future work: expand typed columns and foreign keys for currently foundational entities, invitations/member administration, purchase-order line receiving, inventory lot selection and expiry allocation, draft/reversing journal editor, secure receipt uploads, integrations. Do not present these as implemented.
