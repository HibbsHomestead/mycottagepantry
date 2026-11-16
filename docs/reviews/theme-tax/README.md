# Theme and product-pricing review

The shared appearance palettes now coordinate warm surfaces, accent-tinted borders, restrained static background gradients and shadows. Existing business-scoped preferences remain in `settings.appearance`; the existing local appearance cache remains a startup hint. All eight palettes and Light/Dark/System modes remain available. The blocking head script uses the generated palettes. Portals inherit document-level tokens. No second provider or preference migration was introduced.

The public site and authentication pages use the same foundation. Public pages retain the existing behavior of respecting this browser's saved appearance hint. Admin panels, navigation, primary buttons and focus indicators use shared tokens. Platform administration ignores the business startup hint and defaults to the brand palette. No administrator-specific saved appearance preference or selector existed in the inspected admin implementation; none was added. Remaining specialized admin diagnostic/status styling was preserved. Authenticated admin dashboards/tables were not accessible for live verification.

The referenced Facebook cover and popup attachment were unavailable in the supplied project assets. Colors followed the written description and existing brand palette; no exact cover sampling is claimed.

## Product costs and tax cause

The shared Product Details summary wrapped independent costing and tax-dependent profitability in one catch. Any tax-resolution error returned a warning instead of all cards. The summary now retains independently calculated cost breakdowns and saved selling prices with their actual stored tax basis. It omits profit/margin/tax-dependent suggested pricing until resolution. Missing costs remain explicitly unavailable.

Owner/Manager users can open Settings → Taxes from the compact message. Other roles receive guidance to ask an authorized user. No tax rate, exemption, category mapping, effective date or stored business record was changed. Existing labels, recipe/BOM links, mockups and production controls remain in place. The missing-image state is compact; existing Edit Product image actions remain available. Creating a mockup still requires no tax calculation or inventory/finance posting.

The popup uses the same `applicableTaxes` resolver as the rest of the application. Stable category IDs map classification to configured rate IDs, then active dates and scopes filter them. The quoted warning means configured category treatments produced no applicable rate on the resolver date. The code uses an ISO UTC date by default; effective-date boundaries are inclusive. No confirmed mapping/lookup defect was found. Live business tax configuration and business-local date policy were not audited, so the exact customer's jurisdiction/scope/date mismatch remains undiagnosed. The display defect was fixed; a customer configuration correction is not claimed.

## Artwork upload audit — 150 MB NOT enabled

| Stage | Existing behavior and limitation |
| --- | --- |
| Client | Mockup uploads accept PNG/JPEG/WebP, maximum 5,000,000 bytes. They decode before checking 40 MP. No resumable upload, byte progress or cancellation protocol exists. |
| Hosting | Uploads use the synchronous `/api/workspace?upload=1` Netlify Function. The buffered function request ceiling is about 6 MB, with binary/base64 overhead reducing practical payload capacity. 100–150 MB multipart requests cannot reach the handler. Raising application validation would not fix this. |
| Server | Content-length guard is 6,000,000 bytes; file guard is 5,000,000 bytes. Actual contents are inspected by `image-size`, then fully decoded by Sharp with a 40,000,000-pixel limit. Supported detected formats are PNG, JPEG and WebP. |
| Storage | Private `label-graphics` Blobs keys are business-prefixed; authenticated asset reads first find a record in that business's RLS-loaded asset list. Blobs supports objects up to 5 GB; capacity per object is not the blocking limit. The installed supported SDK has no browser presigned PUT/resumable multipart upload API. Storage credentials must never be sent to the browser. |
| Processing/timeouts | The synchronous request performs decode validation and writes the original. No durable processing job/session, resumability or abandoned-part cleanup exists. A longer timeout cannot bypass the request-size ceiling. |
| Previews | Asset requests can generate 128/480/800 px WebP responses on demand. These are not persisted derivatives. The editor loads original base/artwork bitmaps. Increasing input sizes without replacing this path would risk browser memory. Alpha is preserved; originals are retained unchanged. |
| Export | Browser rendering already limits output to 100–6000 px wide and 24 MP. Output height follows the base aspect ratio. The editor now displays resulting dimensions and the limits before export. Save previews are further bounded to 2400 px wide and current original resolution. No server high-resolution background export workflow exists. |
| Quotas | Existing upload handling has no artwork-specific storage reservation/usage accounting. No entitlement or storage quota was increased. A new large-file workflow must reserve quota and account for temporary parts and derivatives before accepting uploads. |

Required infrastructure work is an authenticated, durable chunk-upload session protocol using small function requests and private Blobs parts, with Database-backed ownership, quotas, chunk manifest, idempotency and expiration; an authorized background assembler/validator/preview generator; cancellation and scheduled abandoned-part cleanup; and an authorized large-original download mechanism that also avoids buffered function response limits. Alternatively, a supported private browser-to-storage multipart capability would need to become available. No paid service is required or added by this change. The browser editor must use derivatives with original-coordinate geometry and load originals only in bounded rendering jobs. Merely routing a 150 MB body to a background function also fails the incoming request ceiling.

Because those facilities are absent, the 5 MB limit remains accurate. The interface does **not** advertise “Artwork files up to 150 MB each.” Unsupported PSD, AI, PDF and SVG import support is not implied. No 100 MB, near-150 MB or over-150 MB file was uploaded to storage; upload/processing times and large-file save/reopen, interrupted retry, cancellation/cleanup and cross-business runtime results are unavailable. No successful large-file workflow is claimed.

## Verification and evidence

Browser captures use synthetic business fixtures and intercepted read-only API responses. They do not establish live authenticated storage persistence or production billing behavior. The public page captures use local rendered routes. The admin captures show the sign-in gate only.

`inventory-{theme}-{light|dark}.png` shows the same Inventory page in all eight palettes. Desktop/mobile captures cover Inventory, Finance, Purchasing, Settings, public homepage, pricing, login, signup, admin sign-in, and product details with valid/missing tax setup. Product-detail captures use synthetic handmade BOM costs and a clearly synthetic configured tax rate. Mockup access is checked with incomplete tax setup. Full-page captures exercise long-page background continuity.

Prior layout screenshots remain available under `../application-standard/before/`; they are historical references, not fresh paired captures from this run. Fresh before screenshots, authenticated admin dashboard/dense tables, physical mobile devices, separate real account sign-ins, production tax data and LIVE checkout were not tested. No charges, subscription changes or production-record mutations were performed.

| Page | Desktop | Mobile |
| --- | --- | --- |
| Product, valid tax | [Dialog](dialog-valid-tax-1440.png) | [Dialog](dialog-valid-tax-390.png) |
| Product, missing tax | [Dialog](dialog-missing-tax-1440.png) | [Dialog](dialog-missing-tax-390.png) |
| Handmade, missing tax | [Dialog](handmade-missing-tax-1440.png) | [Dialog](handmade-missing-tax-390.png) |
| Inventory | [Full page](inventory-1440.png) | [Full page](inventory-390.png) |
| Finance | [Full page](finance-1440.png) | [Full page](finance-390.png) |
| Purchasing | [Full page](purchasing-1440.png) | [Full page](purchasing-390.png) |
| Settings | [Full page](settings-1440.png) | [Full page](settings-390.png) |
| Homepage | [Full page](home-1440.png) | [Full page](home-390.png) |
| Pricing | [Full page](pricing-1440.png) | [Full page](pricing-390.png) |
| Login | [Form](login-1440.png) | [Form](login-390.png) |
| Signup | [Form](signup-1440.png) | [Form](signup-390.png) |
| Admin sign-in only | [Gate](admin-1440.png) | [Gate](admin-390.png) |

| Inventory theme | Light | Dark |
| --- | --- | --- |
| Cottage Purple | [Light](inventory-cottage-light.png) | [Dark](inventory-cottage-dark.png) |
| Plum Pantry | [Light](inventory-plum-light.png) | [Dark](inventory-plum-dark.png) |
| Orchard Green | [Light](inventory-orchard-light.png) | [Dark](inventory-orchard-dark.png) |
| Berry Market | [Light](inventory-berry-light.png) | [Dark](inventory-berry-dark.png) |
| Blueberry | [Light](inventory-blueberry-light.png) | [Dark](inventory-blueberry-dark.png) |
| Terracotta Kitchen | [Light](inventory-terracotta-light.png) | [Dark](inventory-terracotta-dark.png) |
| Midnight | [Light](inventory-midnight-light.png) | [Dark](inventory-midnight-dark.png) |
| Neutral Ink | [Light](inventory-ink-light.png) | [Dark](inventory-ink-dark.png) |

The rendered dark-mode review exposed an existing token-name mismatch: internal navigation and floating controls requested `--primary-foreground`, while the palette supplied `--primary-ink`. A shared alias now gives both components the intended readable dark text on pale dark-mode accents. The legacy back-to-top control also uses semantic accent, text, shadow and focus tokens without changing its position.
