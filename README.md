# Cottage Pantry

Cottage Pantry is a responsive operational workspace for cottage-food bakers and micro-bakeries. It connects package purchases, pantry stock, recipe costs, product margins, production runs, label previews, and financial recordkeeping.

The seeded Hibbs Homestead Market workspace includes ingredients, compound preps, recipes, products, purchasing history, sales, expenses, and production examples. Each anonymous visitor receives a separate persisted database workspace through an HttpOnly cookie, lasting 30 days. Identity accounts receive their own business workspace; demo data is not automatically merged into accounts.

## Technology

React 19, TypeScript, TanStack Start and Router, Vite, Radix UI, Lucide, Netlify Functions, Netlify Identity, and Netlify Database (managed PostgreSQL). Drizzle defines the schema and migrations. Database transactions protect receiving and batch completion; organization policies and composite foreign keys protect tenant boundaries.

## Run locally

Install Node.js 22.13+ or 24 and pnpm, run `pnpm install`, link to the Netlify project, then run:

```sh
netlify dev --port 8889
```

Use Netlify Dev so database, Identity, and Functions are available. Database migrations are applied by Netlify during deployment. After editing `db/schema.ts`, generate a named migration with `pnpm exec drizzle-kit generate --name describe_your_change`. Database security policies and journal triggers are included in the initial migration.

## Working features

- Inventory receipt, transparent unit costing, weighted average stock cost, low-stock views, adjustments, and ledger history.
- Recipe and compound-prep costing, yield, labor, overhead, product packaging, retail/wholesale fields, and target-margin calculator.
- Production scheduling, shortages, actual ingredient usage, atomic deductions, immutable completed runs, locked historical costs, and make-again.
- Weight-ordered label previews, compound expansion, supplier-entered allergen review, business disclaimer, and browser PDF printing.
- Manual sales and expenses, historical sales cost snapshots, estimated P&L, cash movement, tax tracking, and balanced capital-contribution journal entries.
- CSV imports for ingredients, recipes, products, sales, and expenses; data and report exports.

## Scope and review

Square connectivity, automated tax filing, team invitations, receipt uploads, label-printer connections, and barcode scanning are not enabled. Purchase orders currently track summary details; stock is received through individual Pantry receipts. Several future entities have schema foundations with extensible JSON fields. The accounting UI provides a balanced capital-contribution workflow, rather than a complete general-ledger editor. Financial summaries are estimates and do not replace professional accounting advice. Demo conversion weights are saved examples; verify your own ingredient conversions. Label content and jurisdiction-specific disclaimer text require owner review. Nutrition analysis is outside this release.
