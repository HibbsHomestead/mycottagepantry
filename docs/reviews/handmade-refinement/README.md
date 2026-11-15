Handmade refinement was verified in the rendered application with synthetic records at 1440px and 390px. No real inventory or orders were changed. Browser coverage is in `tests/handmade-refinement.spec.ts`.

| Screen | Desktop | Mobile |
| --- | --- | --- |
| Handmade listing | [1440px](list-1440.png) | [390px](list-390.png) |
| Handmade detail | [1440px](detail-1440.png) | [390px](detail-390.png) |
| Product editing | [1440px](edit-1440.png) | [390px](edit-390.png) |
| BOM editing | [1440px](bom-1440.png) | [390px](bom-390.png) |
| Existing baked-product listing | [1440px](baked-reference-1440.png) | [390px](baked-reference-390.png) |
| Existing baked-product detail | [1440px](baked-detail-reference-1440.png) | [390px](baked-detail-reference-390.png) |
| Existing baked-product editor | [1440px](baked-edit-reference-1440.png) | [390px](baked-edit-reference-390.png) |

The latest refinement replaced the separate Handmade detail page with the same Radix popup shell, shared item/photo layout and cost-card primitives used by food products. The initial view shows the photo, summary and estimated cost analysis; BOM and recorded history remain in keyboard-accessible detail tabs. Desktop and mobile captures above were refreshed. The pictured linen bag is a synthetic illustration served only by the browser fixture, not a customer asset.

Additional mobile capture: [scrolled cost analysis](costs-390.png). Product and BOM saves, cross-tab validation, unsaved-navigation cancellation, failed-save recovery, direct detail reload, back/forward navigation, popup close, missing-photo fallback, legacy/incomplete costs, and unchanged fixture stock balances passed in Chromium at 1440px and 390px. Popup and page horizontal overflow checks passed. Food product listing, detail and editor were opened and captured for comparison. No production data was used.
