# Compact kit components — rendered verification

The product card and Kit Details now share a compact, clickable `Product name ×count` list. The editor now uses separated rows with a linked name, quantity input, extended cost and Remove action. Each row has one inline “Display component details” disclosure containing quantity/cost basis, included production costs, attached packaging, ingredient/allergen sources and the existing limitations. Cost and unsupported-basis errors remain visible when collapsed.

The approved Kit Details calculation cards and photo/layout components were unchanged. No domain calculations, stored quantity semantics, tax rules, stock operations, migrations or uploaded images were changed.

## Evidence limits

These screenshots rendered the actual application components with a deterministic synthetic **Pass the Bread** workspace fixture, using the three requested component names/counts and existing repository artwork. An authenticated private workspace and the attached reference files were not available to the runner. These captures verify the implementation against the pre-change rendered code; they do not establish the contents, costs or photograph of the private Pass the Bread record. API writes were intercepted, so no customer data or inventory was changed by the checks.

## Matching viewport captures

Before captures were taken before application edits. All full-page dialog captures used the viewport shown below. Product-card images are element captures from that viewport. Editor captures were scrolled to the components; the default after view fits all three rows instead of one large panel.

| Viewport | View | Before | After |
| --- | --- | --- | --- |
| 1440 × 950 | Product card | [Before](before-card-1440.png) | [After](after-card-1440.png) |
| 1440 × 950 | Kit Details | [Before](before-details-1440.png) | [After](after-details-1440.png) |
| 1440 × 950 | Editor, collapsed | [Before](before-editor-1440.png) | [After](after-editor-1440.png) |
| 1440 × 950 | Editor, expanded | [Before](before-expanded-1440.png) | [After](after-expanded-1440.png) |
| 768 × 950 | Product card | [Before](before-card-768.png) | [After](after-card-768.png) |
| 768 × 950 | Kit Details | [Before](before-details-768.png) | [After](after-details-768.png) |
| 768 × 950 | Editor, collapsed | [Before](before-editor-768.png) | [After](after-editor-768.png) |
| 768 × 950 | Editor, expanded | [Before](before-expanded-768.png) | [After](after-expanded-768.png) |
| 390 × 950 | Product card | [Before](before-card-390.png) | [After](after-card-390.png) |
| 390 × 950 | Kit Details | [Before](before-details-390.png) | [After](after-details-390.png) |
| 390 × 950 | Editor, collapsed | [Before](before-editor-390.png) | [After](after-editor-390.png) |
| 390 × 950 | Editor, expanded | [Before](before-expanded-390.png) | [After](after-expanded-390.png) |

## Actual results

- **33 browser tests passed** (1.9 minutes): eight refinement checks, twelve existing kit Details/navigation checks, two kit creation/save checks, and eleven existing regular Details/media checks.
- **27 unit tests passed** across kit Details, product cards and kit domain tests.
- TypeScript (`tsc --noEmit`), ESLint for every changed TypeScript module/test, and `git diff --check` passed.
- No build command was run; platform build validation is separate.

The refinement checks exercised independent disclosures, unchanged unsaved quantities through toggles and editor tabs, all attached packaging entries and available ingredient statements/allergens, extended costs from the existing costing function, removal, save/reopen, missing costs, unsupported quantity basis, unavailable source data, and long names at phone/tablet widths. They asserted no horizontal overflow or internal component scrolling, no writes from viewing/toggling/editing before Save, and unchanged non-kit records and stock data after Save. Existing checks covered linked product return, Kits filtering/search/Create kit, category validation and the regular Product Details layout.

At 1440 and 768 pixels, before/after measurements matched dialog dimensions, column widths, title, photo geometry, first cost-card geometry, all card amounts and background colors, and the image URL. At 390 pixels those measurements also matched except that the first calculation card moved upward by 198 pixels as the list above it became shorter. The photo remained 324 × 280 pixels. Full measurements are in the paired `before-geometry-*.json` / `after-geometry-*.json` files.

## Reproduction

Start the configured Netlify development server on port 8889, then run:

```sh
npx playwright test tests/kit-components.spec.ts tests/kit-details.spec.ts tests/detail-cost-cards.spec.ts tests/compact-details.spec.ts tests/product-detail-media.spec.ts tests/kits-admin.browser.spec.ts --grep-invert 'operational business admin' --workers=1
npx vitest run src/components/kit-details.test.tsx src/components/product-cards.test.tsx src/lib/product-kits.test.ts
npx tsc --noEmit
```

The browser-only fixture proxies development resources to the configured Vite port because the local framework handler consumed those module URLs. No production route/authentication bypass was added. The new refinement test compares against saved before geometry by default; `KIT_REFINEMENT_CAPTURE=before` captures the baseline when run against the original source.

[Browser test output](browser-results.txt) · [Unit test output](unit-results.txt)
