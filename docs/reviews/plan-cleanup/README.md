Rendered signup and pricing review at 1440px desktop and 390px mobile. Screens use synthetic signed-out account and purchase-availability responses, with no account creation or billing mutations.

| View | Desktop | Mobile |
| --- | --- | --- |
| Signup, selected Mixing Bowl, fields and Continue | [Desktop](signup-1440.png) | [Mobile](signup-390.png) |
| Complete pricing cards | [Desktop](pricing-1440.png) | [Mobile](pricing-390.png) |
| Detailed comparison and exclusions | [Desktop](comparison-1440.png) | [Mobile](comparison-390.png) |

The comparison table scrolls horizontally on mobile and vertically through the full feature list. Included, Not included, Partial, Coming soon and Under review retain their shared availability definitions.

Browser checks cover all five radio selections, query-string plan preservation, pricing links, shared prices, comparison access, mobile overflow, and a missing-tier checkout response that disables only the unavailable plan and shows one plain-language notice. Signup tests mock Identity and confirm plan-intent handoff, required verification messaging, login continuation, and failed-request handling. Billing regression tests use synthetic providers; no live charges or subscriptions were created.
