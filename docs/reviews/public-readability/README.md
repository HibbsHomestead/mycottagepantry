# Public width and readability review

Public marketing sections now use generous responsive containers up to 120rem, with consistent gutters and paragraphs capped at 65 characters. Pricing uses a container-driven grid with an 18rem minimum card width, allowing five plans to wrap instead of shrinking their text. Comparison features remain available in the existing keyboard-focusable scrolling table. Authentication and registration retain bounded solid panels.

The public scale is independent of application density preferences: body text and plan descriptions are 1.125rem; navigation, controls, notes and comparison content are at least 1rem. Nested registration styles were also updated. Existing content, plan definitions, API behavior and checkout code were not modified. The original cover SVG remains gated by `cover-preview=1`.

## Ready hosted graphic preview

These are the actual ready deployment URLs verified during this run. This deployment precedes the new readability edits; the platform must publish the updated preview before those edits appear here.

- [Homepage](https://deploy-preview-81--mycottagepantry.netlify.app/?cover-preview=1)
- [Inventory](https://deploy-preview-81--mycottagepantry.netlify.app/oven?cover-preview=1#Inventory/Ingredients)
- [Finance](https://deploy-preview-81--mycottagepantry.netlify.app/oven?cover-preview=1#Finance/Register)
- [Login](https://deploy-preview-81--mycottagepantry.netlify.app/login?cover-preview=1)
- [Admin entry — authentication required](https://deploy-preview-81--mycottagepantry.netlify.app/admin?cover-preview=1)

Anonymous Inventory and Finance visits correctly redirect to Login; the existing access redirect drops the graphic parameter. Open the exact workspace URL again after signing in. These links do not provide anonymous populated workspace access. The admin entry is live protected routing, not a simulated authorization route. Populated workspace and admin review captures below used synthetic browser responses; no live administrator session was tested.

## Matching rendered captures

Each pair uses the same viewport, default browser zoom (100%) and browser fixtures. Original PNG browser captures were encoded as WebP for storage. The background is enabled in both versions.

| Page          | 1440px before                         | 1440px after                        | 390px before                         | 390px after                        |
| ------------- | ------------------------------------- | ----------------------------------- | ------------------------------------ | ---------------------------------- |
| Homepage      | [Before](before-home-1440.webp)       | [After](after-home-1440.webp)       | [Before](before-home-390.webp)       | [After](after-home-390.webp)       |
| Features      | [Before](before-features-1440.webp)   | [After](after-features-1440.webp)   | [Before](before-features-390.webp)   | [After](after-features-390.webp)   |
| Pricing cards | [Before](before-pricing-1440.webp)    | [After](after-pricing-1440.webp)    | [Before](before-pricing-390.webp)    | [After](after-pricing-390.webp)    |
| Comparison    | [Before](before-comparison-1440.webp) | [After](after-comparison-1440.webp) | [Before](before-comparison-390.webp) | [After](after-comparison-390.webp) |
| Signup        | [Before](before-signup-1440.webp)     | [After](after-signup-1440.webp)     | [Before](before-signup-390.webp)     | [After](after-signup-390.webp)     |
| Login         | [Before](before-login-1440.webp)      | [After](after-login-1440.webp)      | [Before](before-login-390.webp)      | [After](after-login-390.webp)      |

## Graphic direction

The [cover comparison](../cover-graphics/comparison.webp) places the supplied cover beside the rendered SVG treatment. The [graphic review](../cover-graphics/README.md) includes all five surfaces in purple/light, Orchard Green, dark and mobile variants. Public palette overrides and admin dark captures are visual simulations. All populated admin captures use simulated authorization and records; they are not authenticated live admin tests. Admin keeps its default brand behavior.

## Verification limits

Production builds are prohibited by this run's platform instructions and are performed automatically after edits. No production build was run, so there is no build pass/fail result or defensible classification of build regressions. Live authentication, billing, subscriptions and checkout were not exercised. The source changes are scoped to public/registration CSS and browser review evidence.

The 200% zoom layout check uses a 720px CSS viewport, equivalent to a 1440px window at 200% zoom. A separate check doubles the root text size and verifies 36px body text without page overflow. These checks do not constitute a manual browser toolbar zoom review. Onboarding shares the updated registration styles; a fully authenticated onboarding sequence was not exercised.

## Final measured results

| Rendered content  | Before                 | After |
| ----------------- | ---------------------- | ----- |
| Public body       | 16px                   | 18px  |
| Navigation        | 14px                   | 16px  |
| Plan descriptions | 15px                   | 18px  |
| Buttons           | 14px                   | 16px  |
| Comparison cells  | 15px                   | 16px  |
| Login inputs      | See route measurements | 16px  |

The full [before](before-measurements.json) and [after](after-measurements.json) measurements cover 390, 768, 1366, 1440, 1920 and 2560px. All seven public routes passed the final overflow and typography checks. Verification used a synthetic unverified account; no verification message was sent. The 720px zoom-equivalent reflow checks and 200% root text resizing checks passed.

Both graphic browser checks passed, including all eight themes and Light/Dark/System behavior, populated Inventory and Finance fixtures, simulated admin rendering, and absence of the decorative background on ordinary URLs. Both public readability browser checks passed. The 19 targeted public/signup unit tests, TypeScript, focused ESLint, formatting and whitespace checks passed. An initially missing Chromium binary was installed; a nested 15px comparison-cell rule was corrected before the final passing run. No production build failure was observed because no build was run.
