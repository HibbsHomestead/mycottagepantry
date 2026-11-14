# Support inbox in the admin layout

The Support inbox was integrated into the existing administrator shell. The sidebar, header, account controls, session footer, and mobile scrolling navigation stayed mounted across sidebar navigation. Support inbox remained highlighted for both the list and selected conversations. Redundant Administration links were removed, notification settings stayed within the shell, and compact support panels used the available content width. Existing inbox and conversation URLs were preserved.

The standalone presentation came from `/platform-support` rendering `SupportPage` directly under the root route, with its own `SupportFrame` header and a constrained public-page container. Administration used a different root-level route and shell. Both routes were moved under a shared pathless parent; sidebar links used the router so opening Support no longer reloaded the document or recreated the shell. Initial administrator session restoration displayed a neutral checking state before showing sign-in controls.

Authentication was inspected separately. The old sidebar link was a relative `/platform-support` link on the same admin host. Support used the same host-only administrator session, verified administrator grant, and origin checks as Administration. It did not impose a separate sign-in or second-factor requirement. Its Admin sign-in link appeared only after a 401 response and retained the selected conversation in a validated return path. Expired/revoked sessions still required sign-in, and a customer Identity session alone still did not grant administrator access. Required verification for sensitive admin AI actions remained on the existing server endpoints.

Unauthenticated production GET checks on November 14, 2026 showed `https://mycottagepantry.com/admin` returning 302 to `https://admin.mycottagepantry.com/admin`. This was the existing restricted-origin redirect. Both `/admin` and `/platform-support` on the restricted host returned 200 without a Location header. No automatic HTTP authentication redirect was found on that navigation. These public document checks did not establish an authenticated production session.

| Verification | Result |
| --- | --- |
| Sidebar → inbox → conversation → Customers | Passed at 390, 820, and 1440 pixels; the same header DOM node remained mounted, with no additional document navigation or administrator session restoration and no sign-in request. |
| Inbox refresh and direct conversation links | Passed; the selected thread and active Support navigation were restored. |
| Browser Back/Forward | Passed between two conversations and between a conversation and Customers. |
| Notification settings | Opened and closed within the shared shell, retaining the selected conversation and active Support entry. |
| Signed-out and unauthorized page access | 401/403 fixtures blocked conversation content and private admin AI. Support endpoint expiry/permission failures remained visible and blocked protected content after parent session restoration. |
| Real server authorization | Existing isolated database tests passed for portal-only sessions, signed-out/expired/revoked/non-admin denial, exact origins, private admin conversations, customer isolation, and required verification for sensitive actions. |
| Existing Support workflows | Browser regression checks passed for customer ticket creation/replies/reopen, private notes, reviewed AI reply drafts, ticket status, saved AI limits, and signed-out requests to the real local support function. |
| Responsive layout | Desktop retained separate ticket and conversation columns; phone/tablet stacked them using existing admin navigation, without horizontal document overflow. |

The focused unit/component/server run passed 124 tests across five files. The final two-file component rerun passed 23 tests. Seven new navigation/access browser checks and nine existing browser regression checks passed in Chromium. TypeScript, targeted application/new-suite lint, and whitespace checks passed. Builds were left to managed validation.

Browser captures used the real local routes and components with synthetic API responses and demonstration accounts/tickets. Server tests used disposable PostgreSQL-compatible databases with the applied policies. No production administrator credentials were available for authenticated production verification. No support records, migrations, customer data, notification delivery configuration, permissions, cookie attributes, AI models, or usage policies were changed.

Rendered previews: [desktop inbox](inbox-1440.png), [desktop conversation](conversation-1440.png), [tablet conversation](conversation-820.png), and [mobile conversation](conversation-390.png).
