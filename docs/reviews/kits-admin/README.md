These captures show synthetic demonstration records in the real application UI using Chromium on the development server. They show desktop (1440px) and mobile viewport emulation (390px), not real-device testing. No customer records were changed for these screenshots.

| View | Desktop | Mobile emulation |
| --- | --- | --- |
| Kit editor and costing | [Desktop](kit-editor-1440.png) | [Mobile](kit-editor-390.png) |
| Reopened kit contents | [Desktop](kit-details-1440.png) | [Mobile](kit-details-390.png) |
| Business access confirmation | [Desktop](operational-admin-1440.png) | [Mobile](operational-admin-390.png) |

Browser checks are reproducible with `npx playwright test tests/kits-admin.browser.spec.ts --workers=1` while Netlify dev runs on port 8889. Browser save responses use synthetic API fixtures; persistence and authorization are covered separately by database tests.
