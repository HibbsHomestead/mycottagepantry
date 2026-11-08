# Business cottage-food disclaimer

## Where to edit it

**My Oven → Settings → Business Profile → Edit business profile → Cottage-food disclaimer → Save settings.**

Open [Business Profile](https://mycottagepantry.com/oven#Settings/Business%20Profile), click **Edit business profile**, then scroll down inside **Your business details**. The textarea is near the bottom, immediately after **Tax rates and jurisdictions**. This is business label text, separate from Terms and Privacy policies.

## Source and deployment findings

| Check | Finding |
| --- | --- |
| Current source | The field already existed in `src/components/workspace-app.tsx`, opened from `src/components/settings-workspace.tsx`. It edits `settings.disclaimer`. A second settings field was unnecessary. |
| Deployed interface | The field was visible and editable in the actual client served by `mycottagepantry.com`, using synthetic Owner/workspace API responses. Save settings was enabled. |
| Actual owner's session | Not accessed. This check did not verify the owner's authentication, current business selection, saved text, or a live backend save. |
| Server permissions and isolation | The existing save handler was tested with an isolated database fixture: Owners could save their own business text, separate businesses resolved different text, and a read-only member's change was rejected. |

[Rendered deployed interface, 1440 × 1000](previews/business-disclaimer-live-owner-fixture.png). The screenshot contains demo business data and an empty disclaimer; it does not show the owner's saved statement. Live API requests were intercepted, and no live write was submitted.

## Label connection

The existing `business.disclaimer` binding was already available, but it could resolve a product override, a brand default, or the business fallback. That precedence was preserved so existing statements and designs retain their behavior.

An explicit **Business cottage-food disclaimer** dynamic field was added in source. It resolves only the current business's saved `settings.disclaimer`, including its existing punctuation, line breaks, and whitespace. Missing text stays empty. No placeholder statement was inserted and no existing text or design was changed.

After this change is released, use **Labels → open/create label → Editor → Front or Back → Elements → Dynamic field → Business cottage-food disclaimer**. The selected element keeps the normal typography, position, width, height, and rotation controls. Add it only where desired; existing designs are not rearranged.

Editor, preview, and new print jobs use the shared resolver. Duplication preserves the dynamic binding on each side rather than baking in the current text. Existing print jobs retain their historical snapshots. This new explicit option is a source change and was not deployed during this work.

## Verification

The four focused suites passed all 32 tests, covering exact text resolution, empty values, legacy overrides, business isolation and permissions, Front/Back insertion, editable controls, saved designs, duplication, SVG rendering, and browser-print output. The opt-in Playwright test of the deployed client, TypeScript checking, test-file lint, and whitespace checking also passed. Linting the two production source files reported existing errors and warnings; comparison against the baseline found no new diagnostics. No build command, migration, push, or deployment was run.
