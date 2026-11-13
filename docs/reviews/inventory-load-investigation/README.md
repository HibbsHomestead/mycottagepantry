Inventory access investigation — incomplete

The affected route was confirmed as `/oven#Inventory/Overview`. The reported time, November 12 at approximately 9:48 PM CST, corresponded to November 13 at 03:48 UTC. At that time production was on commit `a3810bd6135ba4fdb367bdfe76ff6c3bbc063fd3`, deployment `6af648f483328ccb0bf64b8a`. The preceding published deployment was `6af6365578ccba09ee5aa42c`, commit `fda8db8b929146d6057a03515da605f3826d9f00`. The preceding deployment was not independently established as the user's last working revision.

The intervening source change was the mobile Inventory action grid (`4ded04c`), affecting `inventory-tools.tsx` and its stylesheet. Shared photo upload work (`701a7210a65f9c2dc9cd64c053e724e6f4cc51d0`) initially existed only in preview deployment `6af688691b6094ec2b26711b`. During this investigation, production advanced independently to `ff7ea5e2b91dc189832b15b257450116b9f8242a`, deployment `6af68f5f44ed5f382cc8028a`, merging the photo-upload work and additional fabric purchase/expiry changes. The newly published changes included `supportsExpiry` checks in PantryInventory and stockStatus. These were absent from the revision published at the reported failure time. The earlier mobile overlay revision changed shared dialogs, navigation styling, and workspace session restoration. None of these changes was established as the cause.

An isolated Chromium browser could not access the user's existing signed-in browser session. The anonymous /oven request followed the expected account-access redirect. That did not establish that the reported failure was caused by authentication. The user confirmed that the screenshot contained the fallback but not its underlying exception.

The real deployed /oven document and JavaScript were also exercised with synthetic account-access and workspace HTTP responses. This was a browser interception only: no server authorization was changed, no customer data was accessed, and no database changes were made. Dashboard-to-Inventory navigation and direct reload passed on production, the preceding production deployment, and the photo-upload preview. The expanded production test passed four cases: 390px and 1440px, each with saved cards and table views and a saved quantity sort. Each case opened all eight Inventory tabs and Add Item. The fixture included a fabric record and empty categories; workspace writes were rejected and none were attempted. The synthetic records remained unchanged. Existing item dialogs, the complete six-button workflow, other app sections, and the user's actual quantities/costs still required verification after an actual correction.

The baseline screenshots were refreshed against the newly published `ff7ea5e` revision and showed the actual published UI rendered with synthetic responses. They were baseline evidence, not evidence that the affected private workspace was fixed:

- [Mobile synthetic baseline](production-synthetic-390.png)
- [Desktop synthetic baseline](production-synthetic-1440.png)

The only captured browser exception was a recoverable hydration mismatch, observed before the working Dashboard and after direct reload:

```text
Error: Minified React error #418 (HTML hydration mismatch)
    at ua (/assets/index-W-rD3cqU.js:9:32139)
    at pl (/assets/index-W-rD3cqU.js:9:84280)
    at Xd (/assets/index-W-rD3cqU.js:9:128067)
    at Yd (/assets/index-W-rD3cqU.js:9:128040)
    at Jd (/assets/index-W-rD3cqU.js:9:127901)
    at Pd (/assets/index-W-rD3cqU.js:9:123375)
    at Af (/assets/index-W-rD3cqU.js:9:136029)
    at MessagePort.D (/assets/index-W-rD3cqU.js:2:1769)
```

It did not produce the reported fallback during these tests and was not identified as its cause. No failed network response was captured in the synthetic production navigation tests. That did not validate the user's real workspace API response.

The production function and edge-function logs were rechecked specifically from 03:30 through 04:10 UTC on November 13. The function query returned 217 entries across all levels, including 18 workspace warnings: six each for the PDF canvas dependency, DOMMatrix polyfill, and Path2D polyfill. No error/fatal entries or Inventory exception stack were found. The edge-function query returned no entries. Two signed-out account-access events at 03:50:34 UTC coincided with the isolated anonymous browser probe; they did not establish an authentication cause for the user's failure. Inspection found no client exception reporter connected to the route fallback. Server logs did not identify the client rendering failure.

Route/module loading failure was not reproduced with deployed assets. A rendering exception, inventory query failure, authorization failure, or a specific record or saved tab/filter remained unconfirmed for the affected session. Inspection found render-time unit conversions in PantryInventory that could throw for incompatible recorded units, but no affected record or matching exception was available; no speculative unit or data changes were made.

The user authorized a minimal diagnostic path because browser console access was unavailable. An Inventory-only, collapsed details section with a Copy error details button was added to the existing fallback. It captured the running tab's opaque app-version marker, error timestamp, allowlisted workspace pathname without query/hash, standard error type, allowlisted error message, and sanitized application stack/component stack. Known public application filenames and offsets were retained; unknown messages, function names, paths, external origins, and query strings were omitted or redacted. Unknown error properties and causes were never enumerated. The existing router catch hook supplied the React component stack.

The main workspace load and mutation requests retained their existing request/response behavior. A recent failed request on Inventory could contribute only the fixed `/api/workspace` path, HTTP status (or null for a transport failure), fixed body-omitted description, and a strictly validated random Netlify request correlation ID. Diagnostics did not read response bodies, request bodies, cookies, authorization headers, or inventory records. Failed requests expired from diagnostic association after 60 seconds and successful reads cleared the association. Reports stayed ephemeral in the browser, were copied only on user action, and were never persisted or sent to a new telemetry endpoint. Clipboard denial fell back to a selectable, read-only text field. Working pages and login pages gained no diagnostic UI.

No correction to the underlying Inventory failure, rollback, database migration, data replacement, storage clearing, or permission change was performed. The diagnostic source changes were prepared for the managed deployment workflow; no diagnostic commit or deployment was published directly during this run. The last checked production revision was `ff7ea5e2b91dc189832b15b257450116b9f8242a`, deployment `6af68f5f44ed5f382cc8028a`.

Nineteen targeted unit/component/SSR tests passed. TypeScript and lint checks for the diagnostic files passed. Two browser tests exercised the real router fallback and clipboard at 390px and 1440px using a deliberately invalid synthetic unit conversion and a synthetic 503 response. Four local browser cases verified Dashboard-to-Inventory navigation, direct reload, all eight Inventory tabs, saved cards/table views, and Add Item. Four existing compact-action browser tests passed at 320px, 390px, 430px, and 820px. The inherited empty-workspace test failed because its Identity mock omitted `hydrateSession`; the same failure was reproduced using the unchanged HEAD workspace source. Local development's missing generated `/app-version.json` returned 404 without interrupting the workflow; the report used the version compiled into the tab. No build command was run.

Controlled fallback screenshots showed the new diagnostic control, not the user's actual failing data or a verified restoration:

- [Collapsed mobile fallback](controlled-fallback-collapsed-390.png)
- [Expanded mobile fallback](controlled-fallback-expanded-390.png)
- [Collapsed desktop fallback](controlled-fallback-collapsed-1440.png)
- [Expanded desktop fallback](controlled-fallback-expanded-1440.png)

After the diagnostic change is published, the reproduction step is: reload `https://mycottagepantry.com/oven#Inventory/Overview`, expand Inventory error details on the fallback, and choose Copy error details. The copied report can then identify the actual exception without requesting private inventory data. The actual root cause and affected signed-in workflow remain unverified, so the issue remains open.

Verification command:

```sh
INVENTORY_TEST_ORIGIN=https://mycottagepantry.com npx playwright test tests/inventory-runtime.spec.ts --reporter=line --timeout=20000
```

The original production baseline passed four cases. The same four cases passed against the newly published revision during the continuation. Synthetic records did not reproduce the user's signed-in failure. This investigation did not establish a root cause or verify a fix.
