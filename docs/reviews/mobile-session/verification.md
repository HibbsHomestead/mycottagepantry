# Mobile usability and sign-in verification

## Delivery status

Implemented and verified against local source. Publication is handled by the platform after this run; no new commit or deployment identifier is available yet. The final live API check on November 12, 2026 returned production commit `7b85218bf3c89459e56a7080026f3bb765db6904`, deployment `6af5f74c71b95d3ed7963875`, state ready. The earlier count fix (`e496157`, merged in `8c18292`) is in that published history. The subsequent scanner correction is in local starting revision `cc3afab`, but is absent from the published revision. This task's changes are also not yet published. The deployed scanner has **not** been verified with these changes.

## Causes and changes

Editable controls had competing compact/component text sizes, and the earlier 16px rule only covered workspace dialogs. A global mobile/coarse-pointer rule now ensures editable text computes to at least 16 CSS pixels, including public login, selects and custom comboboxes. Shared inputs and workspace field helpers supply numeric/decimal/email keyboards and enter-key hints; login uses username/current-password/new-password autocomplete. Unsolicited editor/search autofocus was removed. Pinch zoom remains enabled, without viewport restrictions or scripted zoom resets.

Dialog placement had competing ownership: Tailwind centering translations, workspace mobile transform rules, older count insets, and scanner-specific sizing. Portals are attached outside the app content; a transformed app ancestor was not established as the cause. The exact reported iPhone left displacement was not reproduced in Chromium, so its Safari-specific trigger remains unconfirmed. A competing height declaration was reproduced during the prior scanner work. The shared Radix DialogContent now gives bounded mobile presentations explicit visual-viewport dimensions/offsets and safe margins, clearing both transform and translate. The workspace-wide competing placement rule was removed. Inventory/scanner presentations retain their explicit foundation; full-page editors retain their separate presentation. Focus returns without scrolling, modal background scrolling remains locked, and opening a mobile dialog avoids focusing an editable field automatically.

Consumers checked include count list/start/resume, rapid scanner, unknown barcode assignment, partial/open packages, review/confirmation, logout, long recipe/ingredient editors, receipt upload/review and product/kit details. The scanner retains its full-screen mobile header and Close action, camera area, scan feedback/running count, manual fallback, Count another, Undo, and one scrolling body. Camera start/stop and scan/count logic were not changed in this extension; existing camera cleanup tests passed.

The previous navigation correction was present but incomplete. It used the whole visual-viewport bottom gap as a fixed bottom offset. Keyboard dismissal/focus transitions could expose navigation while that gap was still keyboard-sized. The viewport hook now keeps navigation hidden until the viewport recovers, hides it for modals, and applies only a small browser-toolbar gap outside keyboard/zoom states. Actual measured navigation height reserves content space. Sequential tests cover blur before keyboard dismissal, rotations, toolbar resizing, modal cancellation, section navigation and Back. No second navigation implementation or transformed app ancestor was found.

The Identity SDK's existing browser persistence was disconnected from its session cookies: getUser cleared a saved user when nf_jwt was missing after browser exit, and hydration of a saved user did not recreate the cookies. Both SDK hydration and the existing transitive refresh library could delete a session on temporary provider/network failures. Versioned pnpm dependency patches repair those paths while retaining the existing provider storage, forced provider refresh/revocation checks and provider cookie mechanism. No tokens were moved to a new store. Explicit authentication rejection clears the session; transient failures preserve it and permit retry. One shared in-flight restoration prevents concurrent application restoration calls. Workspace fetching also deduplicates requests and preserves already loaded editors on a failed background request.

Normal login previously combined startup/access screens, a second access-opening step and document replacement navigation. Successful credential submission now shows a short pending button state, then the existing purple oven loading animation, then the intended authorized page through router navigation. Returning users restore before the login form is displayed. Callback fragments still reach the provider handler; internal return destinations are validated. Genuine multiple-business choices remain. Normal diagnostic prose was removed; error references live under Technical details. Business failures use the oven retry state without deleting identity. There is no artificial animation delay. Logout has its own concise Cancel / Log out dialog and uses provider logout followed by one signed-out page.

Server identity verification, membership, subscription, workspace ownership, permission enforcement and sensitive-admin authentication remain intact. No schema, migration, inventory quantity/conversion, stock posting, billing or receipt accounting logic changed. Authenticated pages already omit the public header. The website cannot remove Safari's address/domain/browser controls; the supplied screenshot references were not available here to classify any external wrapper conclusively.

## Session policy and passkeys

The application continues to use the existing @netlify/identity provider persistence. Its SDK maintains its provider session in its existing storage and sets Secure, SameSite=Lax, Path=/ session cookies; these remain SDK-managed and JavaScript-readable as required by this provider. This work does not claim they are HttpOnly. SDK access-token renewal runs before token expiry. Restoration after missing cookies forces a provider refresh before recreating cookies. Logout uses the provider's existing revocation/clearing flow. Membership failures and outages never grant new access.

No new persistent-session duration, permanent session, password storage, remember-me checkbox or competing bearer-token system was enabled. The provider controls refresh-session validity; its installed consumer SDK exposes no configurable finite remember-me duration. A new duration cannot safely be promised or enabled through this SDK. Private browsing, cleared website data, revoked sessions and explicit logout remain limits. Real provider password-reset/revocation behavior needs production-provider verification.

Consumer passkeys were not added. The installed @netlify/identity 2.0.0 public consumer API, and inspected 2.0.1 API, expose no provider-supported WebAuthn registration, sign-in, credential naming/removal or challenge endpoints. No supported consumer flow was established for this provider configuration. Existing separate platform-admin passkey/TOTP and recent-auth safeguards remain unchanged. No fake button, custom consumer credential registry, biometric handling or provider migration was introduced. Password login/recovery remain available.

## Verification results

All browser verification used Chromium emulation and synthetic provider/workspace responses against current source. No customer account or stock was modified. Netlify dev was started on 8889; its stale generated server output was detected, so browser fixtures explicitly loaded current Vite source on 3000 instead of accidentally testing old generated pages.

- 16 overlay/count/scanner browser tests passed across 320, 375, 390, 430 CSS-pixel phones, landscape, tablet and desktop. These assert bounds and reachable controls, draft retention, background lock, assignment, partial packages and review, rather than screenshots alone.
- 5 sequential mobile navigation tests passed, including measured content clearance and hit-testing controls through keyboard/modal/navigation transitions.
- 4 provider-SDK journey tests passed: protected destination, one credential submission, oven loading, no new document navigation, logout cancel/confirm, signed-out reload, returning session, missing session cookies with provider storage retained, provider 503/retry, membership failure with identity retained, background workspace failure, invalid credentials, expired access token with one successful refresh, revoked refresh, and genuine multiple-business choice.
- 6 existing desktop/mobile login browser tests passed, including recovery behavior.
- Receipt/kit consumer selection initially had 6 passes and one timeout caused by the old test selecting nonexistent “All recorded.” Updating that assertion to the current “All time” option made the remaining 390px finance/receipt test pass. Receipt editing, preview return and scroll position were covered.
- The expanded unit selection finished with 155 passes and one unrelated public pricing assertion failure: it expects the old Cottage Mercantile plan heading. Pricing code and that test were unchanged. Focused authentication/access/scanner suites passed (76 tests).
- TypeScript and targeted lint passed. No build was run, per platform validation rules.

## Evidence

- [Login, 390px](login-390.png)
- [Existing oven loading screen, 390px](oven-390.png)
- [Logout dialog, 390px](logout-390.png)
- [Navigation, 390px](navigation-390.png)
- [Scanner, 320px](scanner-320.png), [375px](scanner-375.png), [390px](scanner-390.png), [430px](scanner-430.png), [tablet](scanner-820.png)
- [Phone login/logout recording](login-logout-390.webm)

The screenshots were visually inspected. The recording uses synthetic credentials and a mocked provider; it is not evidence of production sign-in.

## Checks still needed

No physical iPhone/iPad Safari was available. Safari/WebKit execution was unavailable because required system libraries were missing. Actual iOS focus zoom, native keyboard positioning/dismissal, safe-area hardware, browser toolbar transitions, password-manager autofill UI, real camera/barcode detection and OS browser suspension/restart remain unverified. Keyboard/toolbar/zoom changes were simulated through viewport events; browser reopening was simulated with a new tab and removed session cookies while retaining provider storage. No real biometric/passkey ceremony was tested or added.

After the platform publishes, record its new commit and deployment IDs and repeat the complete journey on the deployed custom domain, including real Identity login, provider outage/retry, expired/revoked refresh, recovery, explicit logout/reopen, sensitive admin reauthentication, scanner assignment/partial flows and the navigation sequence. Test both physical iPhone and iPad Safari in portrait/landscape with password autofill, keyboard and browser controls. Preview-domain sessions are origin-specific and do not transfer automatically to the custom domain.
