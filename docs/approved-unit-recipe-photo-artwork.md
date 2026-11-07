# Approved unit, recipe, photo, and artwork implementation

The owner approved the ingredient setup and prepared-stock recipe-component plan, confirmed the exact private photo-pilot target and cost controls, and approved the four artwork samples. This report supersedes pending-approval language in the [historical review packet](unit-recipe-photo-artwork-checkpoint.md). No live stock migration, historical-cost rewrite, paid provider test, or manual deployment was performed.

## Ingredient mapping and compatibility

Edit Ingredient now places exactly five primary controls in Details & Costing, in the requested order. URL/Barcode import, identification, manual fields, currency, purchase tax, and shipping remain available. Additional relationships are edited only in Unit Conversions.

| Field                               | Stored relationship and compatibility                                                                                                                                                                                                     |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purchasing package unit             | Explicit `purchaseSetup.packageUnit`, consistent with the legacy `purchaseUnit`. Unknown physical package names require review rather than guessing a bag from 25 lb.                                                                     |
| Purchasing price                    | `purchaseSetup.price` is the price of one selected package. A known total for multiple packages displays total/count at full precision. Unchanged legacy `packagePrice` and `purchaseQuantity` retain their total/count meanings.         |
| Stock shelf unit                    | `storageUnit` remains a display preference. Canonical `unit`, `quantity`, weighted-average `cost`, stock ledger, and historical receipts are unchanged. A valid conversion to the canonical unit is mandatory.                            |
| # of stock units in purchasing unit | `purchaseSetup.stockUnits` edits one authoritative package-to-shelf relationship in the existing verified conversion graph. Same units require exactly 1. The relationship is read-only in Unit Conversions with an Edit in Details link. |
| Recipe unit                         | `recipeUnit` remains the default. Existing recipe lines keep their IDs, quantities, and units. A missing conversion is identified with a direct Unit Conversions link; no 1:1 fallback is used.                                           |

The adapter preserves the original total/count for an unchanged multi-package record: three bottles for $17.97 displays approximately $5.99 per bottle without replacing the $17.97 saved total. An explicitly changed setup retains the first legacy purchase basis for review and uses the existing current-cost rules. It never adjusts stock or weighted-average inventory valuation. Compatible unit conversions remain automatic; measured ingredient-specific relationships are checked for positive quantities, reverse duplicates, redundant automatic paths, and contradictory paths. Existing duplicate conversions remain visible for review on unrelated saves; changes cannot introduce duplicates or conflicts. The legacy conversion endpoint applies the same checks and treats identical retries as no-ops. Its former editor now opens the dedicated tab. Prepared ingredients can add measured relationships without inventing purchasing data.

The summary uses selected units and rounded currency while calculations retain precision. A bottle containing 3.7 oz shows 1 bottle = 3.7 oz, $5.99 per bottle, and $1.62 per oz. Bottle-stock configuration shows cost per bottle and includes recipe-unit cost only with a valid conversion. Missing relationships produce an explanation, never a fabricated zero cost.

The earlier read-only audit identified ambiguous 25 lb / 10 lb measurement totals, duplicated cup-to-weight relationships, and Dri-Tabs' 75 pack purchase basis alongside 1 pack = 75 each. These records are flagged for explicit review; none was guessed or corrected automatically. Ordinary edits cannot migrate canonical stock units. Such a migration still requires a separately approved before/after quantity and valuation reconciliation. No existing inventory balance or completed-batch cost was migrated.

See [desktop five fields](previews/ingredient-five-fields-1440.png), [phone five fields](previews/ingredient-five-fields-390.png), and [Unit Conversions](previews/ingredient-unit-conversions-1440.png).

## Recipe components and per-ingredient costs

Inspection found partial underlying compound-prep support. The approved first phase now exposes **Add ingredient** and **Add recipe component** within the existing Ingredients section of Create/Edit Recipe. A searchable picker shows source finished yield. Linked rows show amount/unit, proportional cost, prepared-stock mode, an estimate-follows-source note, and Open recipe. The link opens the source editor separately, preserving the unsaved parent.

A component line retains the existing prepared-stock ingredient foreign key and source recipe ID. Cost uses the source's finished yield, including its ingredients, labor, and overhead once; parent labor/overhead represents additional work. Different usage/yield units require an automatic compatible conversion or a verified relationship on the prepared ingredient. Unsupported arbitrary yield units and missing density are never inferred. Server validation rejects unavailable/cross-tenant sources, mismatched prepared-stock links, direct and nested cycles, and unsupported production modes.

Saving a linked parent may create an empty prepared-stock record and establish the source's compound-prep link. It does not produce or deduct stock. Source completion consumes raw ingredients and receives prepared stock. Parent completion consumes that prepared stock only; insufficient prepared stock blocks completion. It never also consumes the component's raw ingredients. Changing the yield unit of an already linked prep is blocked pending an explicit stock migration. Source edits update current estimates while completed usage and cost snapshots remain unchanged.

Manual prepared-ingredient statements, allergen declarations, review decisions, and reorder thresholds are preserved. Derived component allergens are stored separately and refresh from source ingredients; label statements/allergens continue expanding linked source recipes with provenance. No ingredient list is copied into the parent as disconnected lines.

**Later production phase:** “make with parent” needs explicit linked child operations, finished-yield/actual-cost transfer, failure reconciliation, and single stock deduction. That mode is rejected and is not presented as complete. The approved first phase supports prepared stock only.

The compact per-line cost display uses the existing recipe-costing function and currency formatter in both Create/Edit Recipe. Quantity, unit, and selection changes update it immediately. Missing price or conversion shows Cost unavailable with a reason; a positive contribution below $0.01 shows <$0.01. The rest of the recipe layout remains intact.

See [desktop component](previews/recipe-prepared-component-1440.png), [phone component](previews/recipe-prepared-component-390.png), and [ingredient costs](previews/recipe-line-cost-edit-1440.png).

## Private photo pilot

The approved grant targets only contact@hibbshomestead.com's verified Identity and workspace. Each server request enforces that exact pair, active workspace authentication/role, account grant, kill switch, rate validity, persistent duplicate protection, one in-flight request, and budget reservations. UI visibility comes from the same server-derived capability. Other accounts retain manual, URL, and barcode workflows. Public features/pricing, tiers, billing, and Square are unchanged.

The forward migration adds tenant-protected grants and an extraction-attempt ledger. Limits are 20/day, 100/month, $2/month estimated provider token spend, with at most $0.05 reserved per request. There are no automatic retries or owner exemptions. The bounded supported non-reasoning reader has a conservative maximum estimated token cost of $0.0256 per request. Unknown outcomes retain reservations; invalid model/usage accounting suspends processing. The approved grant is configured for release after deployment/migration, which was not manually run here. No paid extraction was used for validation.

Front/back/close-up photos, evidence review, shared draft, and explicit save remain. Credentials stay server-side. See [verified bounds, sources, expiry, kill switches, usage accounting and provider limitations](photo-pilot-operations.md).

## Artwork library and template boundary

All 14 requested subjects are finished original black-outline assets: bananas, carrots, coffee, unbranded Jamaican rum, cinnamon rolls, strawberry, spiced orange, orange, gingerbread, pumpkin, cranberry orange, chocolate, brownie, and generic spiced biscuit/cookie butter. [Commercial-use rights](../public/artwork/LICENSE.md) are documented; no paid image generation occurs during selection, preview, or print.

Create/Edit Product's Images & Labels area provides the selected preview, Choose artwork, Upload my own, and Remove artwork. The compact searchable dialog has named thumbnails, aliases, keyboard/touch controls, and selected state. Product artwork persists separately from the product photo/business logo. Uploaded raster assets use the existing authenticated private account pipeline. Only allowlisted static library IDs or authorized workspace assets may be saved; arbitrary URLs are rejected.

A template's existing `product.graphic` placeholder resolves the selected product artwork through the shared preview/print renderer. It controls size and position. Different products can supply different artwork to the same unchanged template; no artwork renders when none is selected. Existing designs/custom images are untouched. Selection and preview do not create label documents or insert artwork blocks.

**Dependency still outstanding:** the broader proposed product-assigned reusable-template migration is not fully implemented. Existing assignments may reference independent designs or templates; creating a label from a template still copies a design. This work supplies dynamic product artwork to existing bindings and preserves all assignments. A later integration should introduce explicit reusable-template assignment, resolve it directly at preview/print time, and preserve independent custom designs until a reviewed migration. No existing label is silently converted to that model.

SVG remains crisp in browser previews/printing. PDF/PNG export uses matching prepared 1200 × 960 transparent derivatives, at least 300 DPI up to 4 × 3.2 inches; larger placement receives the existing resolution warning. PDF output is raster-based. See [all subjects](previews/artwork-full-library.png), [desktop picker](previews/artwork-library-picker-1440.png), [phone picker](previews/artwork-library-picker-390.png), and [actual 3 × 2 inch label sheet](previews/artwork-library-print-size.pdf). Print at 100% for physical size.

## Net weight and URL importer

The optional numeric Net weight (oz) field stores ounces and shares one formatter across form feedback and the resolved text used by label preview, browser print, and export. 9.5 or 9.50 produces **Net Wt. 9.5oz (269g)**. Grams use ounces × 28.349523125 and truncation; clearing stores null and omits the complete line. Zero/negative/invalid values are rejected. No recipe or stock values supply this field.

Unambiguous legacy ounce-weight text can normalize on an explicit product save while preserving original free text. Ambiguous, fluid-ounce, count, and conflicting gram text remain available for review. The audit found 16oz (516g), which conflicts with 453g, and 5oz (142g), which conflicts with the requested 141g truncation. They were not silently rewritten. Bound template text uses the complete generated value once, retaining font, position, alignment, and size. Separate literal custom text is not automatically rewritten.

The Open Walmart button was replaced by the exact requested bold, helper-size notice directly under the URL controls. The URL field, Import action, and other import behavior were preserved.

## Validation

Focused tests covered all six ingredient configurations/save-compatibility cases; partial finished-yield costs, conversions, cycles, tenant isolation, allergen provenance, prepared-stock production, immutable completed costs; artwork persistence/removal and shared-template rendering/export; photo gates/budgets/idempotency/uncertain usage; net-weight formatting/migration/print parity; and the URL notice. Disposable database fixtures exercised the real API and forced tenant policies. Browser checks used synthetic workspace fixtures at 1440px and 390px and generated the print-size artwork PDF. No customer business records or paid inference were used by these tests.

Final verification passed **195 tests across 18 files**, with two opt-in checks skipped, and **10 Chromium checks** across desktop and phone. Type checking, lint on the new source/test modules, and whitespace checks passed. Existing legacy lint findings remained outside this scoped work. No build command or manual deployment was run; the platform performs its own build validation.
