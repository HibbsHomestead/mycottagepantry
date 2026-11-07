# Cloudflare preview configuration proposal

This is a proposal, not an installed adapter, an active Wrangler configuration, or a deployed migration. It preserves `vite.config.ts`, `netlify.toml`, the existing build scripts, and all Production settings. No resources, credentials, deployments, or external writes were approved or created. The Product Details and label-color fixes are independent of this proposal.

## What the failed build establishes

The supplied log identifies Wrangler **4.158.0**, working directory `/opt/buildhome/repo`, build command `pnpm run build` → `vite build`, frontend output `dist/client`, and server output `dist/server/server.js`. The decisive adapter message is:

> Netlify ✓ Wrote SSR entry point to .netlify/v1/functions/server.mjs

The build succeeded for Netlify; the subsequent **`npx wrangler preview`** command failed its required `previews` configuration check. This is not evidence of a working Cloudflare SSR bundle or API backend. `dist/server/server.js` and the generated Netlify function must not be entered as a verified Worker entry.

The current `vite.config.ts` installs `@netlify/vite-plugin-tanstack-start` **1.3.19**, then `tanstackStart()`. `package.json` has neither Wrangler nor the Cloudflare Vite plugin, and its `preview` script means **local `vite preview`**, not a Cloudflare deployment. No Wrangler configuration exists in the checkout or in the previously inspected complete trees of the five available GitHub branches. No repository workflow contains the executed Cloudflare command. The supplied log does not identify a configuration path or source commit, so no path is claimed as the configuration actually used by that remote command. The diagnostic alone does not prove that a configuration file was loaded.

Cloudflare's [branch-build documentation](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/) states that new Workers use `npx wrangler preview` as their Preview command. An existing integration's one-time switch to Worker Previews also replaces its previous Preview command with that command. Production builds separately execute the Deploy command, explaining how the previously shown `npx wrangler deploy` can coexist with this failure. **Preview-build settings are the likely source, consistent with the log and documented default. Their exact dashboard value and the failing branch remain unverified.** No setting was changed.

An empty `previews` object is valid in this Wrangler version. Cloudflare's [configuration rules](https://developers.cloudflare.com/workers/previews/configuration/) keep assets and compatibility settings at the top level; variables and resource bindings must be explicitly specified for Previews. Secrets are separately managed, not stored in a config file. Clearing that check alone does not implement the missing adapter, login, APIs, or storage.

## Separate minimum: a UI-only Worker preview

The smallest useful independent step is an SSR/UI test with **no backend connection**. It cannot verify login, saved business data, uploads, server rendering of print exports, or the remaining backend migration. Backend endpoints explicitly return an unavailable response before frontend rendering. This restriction makes an empty `previews` block appropriate for this candidate: it has no application variables, secrets, database, storage, or service bindings. Its entry must not import Netlify Functions or initialize business data.

The following complete files are proposed for a separate review branch. They are shown here only; none is active in the checkout. `mycottagepantry-ui-test` is a proposed new test Worker name, not an approved or provisioned resource. It deliberately differs from the existing `mycottagepantry` Worker. Its compatibility date and flag are candidate settings for that new test Worker, not changes to an existing Worker's settings.

Proposed **`cloudflare/preview/wrangler.jsonc`**:

```jsonc
{
  "$schema": "../../node_modules/wrangler/config-schema.json",
  "name": "mycottagepantry-ui-test",
  "main": "../../src/cloudflare-preview-server.ts",
  "compatibility_date": "2026-11-07",
  "compatibility_flags": ["nodejs_compat"],
  "assets": {
    "run_worker_first": ["/api", "/api/*", "/.netlify", "/.netlify/*"]
  },
  "previews": {}
}
```

There is deliberately no source `assets.directory`: the Cloudflare Vite plugin [generates it from the client build output](https://developers.cloudflare.com/workers/vite-plugin/reference/static-assets/). No SPA fallback is configured for API requests. The API patterns explicitly run the Worker first, including when a browser sends an HTML navigation request. No custom domain, Production route, cron, queue, or resource binding is added.

Proposed **`vite.cloudflare-preview.config.ts`**:

```ts
import { defineConfig } from 'vite'
import { cloudflare } from '@cloudflare/vite-plugin'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { appVersionPlugin, createAppVersion } from './scripts/app-version.ts'

export default defineConfig({
  resolve: { tsconfigPaths: true },
  build: { outDir: 'dist-cloudflare' },
  environments: {
    client: { build: { outDir: 'dist-cloudflare/client' } },
    ssr: { build: { outDir: 'dist-cloudflare/worker' } },
  },
  plugins: [
    tailwindcss(),
    cloudflare({
      configPath: './cloudflare/preview/wrangler.jsonc',
      viteEnvironment: { name: 'ssr' },
      remoteBindings: false,
      persistState: false,
    }),
    tanstackStart(),
    viteReact(),
    appVersionPlugin(createAppVersion(process.cwd())),
  ],
})
```

This follows Cloudflare's [TanStack Start adapter and custom-entry guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/). The separate Vite configuration contains only the Cloudflare deployment adapter; it does not import or modify the Netlify adapter configuration. Cloudflare's [plugin API](https://developers.cloudflare.com/workers/vite-plugin/reference/api/) supports an explicit `configPath` and the `ssr` Vite environment. Explicit client and SSR output directories keep this candidate separate from `dist/client`, `dist/server`, and `.netlify/v1/functions`.

Proposed **`src/cloudflare-preview-server.ts`**:

```ts
import handler from '@tanstack/react-start/server-entry'

export default {
  fetch(request: Request) {
    const { pathname } = new URL(request.url)
    const backendPath =
      pathname === '/api' || pathname.startsWith('/api/') ||
      pathname === '/.netlify' || pathname.startsWith('/.netlify/')

    if (backendPath || !['GET', 'HEAD'].includes(request.method)) {
      return Response.json(
        { error: 'Backend access is unavailable in this UI-only preview.' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      )
    }

    return handler.fetch(request)
  },
}
```

The documented framework entry is **`@tanstack/react-start/server-entry`**; the custom entry delegates UI requests to it and denies backend requests. It never treats the Netlify-generated server file as a Worker. `nodejs_compat` does not make native Node addons or Netlify's platform services available. Login/account-access errors are expected at this stage and must remain visibly unavailable; client business data must not be persisted in browser storage or a local file.

### Dependency, command, and artifact selection

Proposed additional development dependencies are **`@cloudflare/vite-plugin@1.67.0`** and **`wrangler@4.158.0`**, pinned exactly with the lockfile updated in that separate change. Registry metadata for plugin 1.67.0 declares Vite `^6.1.0 || ^7.0.0 || ^8.0.0` and Wrangler `^4.156.1`, matching the repository's Vite 8.3.5 and the supplied Wrangler version. This is a dependency-range check, not a successful app build or runtime test. No dependency was installed or changed here.

Proposed additional script (preserving `build`, `dev`, and local `preview`):

```json
{
  "build:cloudflare-preview": "vite build --config vite.cloudflare-preview.config.ts"
}
```

The proposed Cloudflare test build setting is `pnpm run build:cloudflare-preview`, not the existing Netlify-oriented `pnpm run build`. The proposed Preview command, **only after review, successful build validation, and deployment approval**, is:

```sh
pnpm exec wrangler preview --config dist-cloudflare/worker/wrangler.json --name ui-review
```

The source configuration path is `cloudflare/preview/wrangler.jsonc`; the **generated deployment configuration** is expected at `dist-cloudflare/worker/wrangler.json` because the candidate explicitly sets that SSR output directory. The plugin generates the compiled `main` and the relative client assets directory there and carries through the `previews` property. Its published 1.67.0 source was inspected for this output behavior. After the separate build, assert that this exact file exists, that `previews` is an object, that its entry exists, and that its assets resolve to `dist-cloudflare/client`. Stop on a mismatch. Do not guess a compiled entry filename, edit generated output as the lasting fix, or rely on an implicit `.wrangler/deploy/config.json` selection.

The above is a deployment command, not a validation command, and was not run. The existing Production Deploy command remains unchanged. No automatic configuration/deploy discovery is proposed.

## Requirements for a functional, isolated application preview

The complete application **does** require preview-specific services. An empty object cannot deliver that application. The lower-risk proposed architecture keeps the existing Node backend on a **separate Netlify test project** and uses Cloudflare only for the UI/SSR and a reviewed same-origin gateway. This retains Netlify Database and Blobs, tenant policies, transactional accounting, native label/image rendering, and verified server authentication. It is still additional implementation work, not an existing connection.

| Proposed resource | Purpose and isolation requirement | Cloudflare configuration consequence |
| --- | --- | --- |
| New Worker `mycottagepantry-ui-test` | Separate test UI/SSR; no Production domain or traffic. | The UI-only candidate above needs no data bindings. |
| New Netlify project `mycottagepantry-cf-test` (name subject to availability) | Run existing Node Functions and renderers in a test environment; no automatic main deployment. | A future gateway needs an explicitly approved test origin in `previews.vars`. Never default to the existing Production site. |
| New, empty Netlify Database for that test project | Apply the tenant schema and reviewed test-only seed data; use synthetic businesses and test memberships. | Keep database connection secrets inside that Netlify test backend. Do not expose them to the Worker or browser. |
| Separate Identity instance and test accounts | Test sign-in, refresh, callback origins, membership, logout, and demo-cookie isolation. Do not reuse Production users or identities automatically. | Same-origin Identity/API routing and cookie behavior require explicit implementation and testing; hostname changes do not carry authentication. |
| Private Blobs stores in the new test project | Separate receipts, uploaded fonts, graphics, and generated print files; synthetic assets only. | Keep storage access on the test backend, with verified tenant ownership. No R2 migration is required. |
| Test-only gateway authentication material, if the gateway is enabled | A newly generated, server-only origin-authentication secret; not application-user authorization. | Add only after the gateway reads it; manage it as a Preview secret outside version control. No such secret is needed for the UI-only candidate. |

Netlify's ordinary Deploy Previews [copy Production data into their database branch](https://docs.netlify.com/build/data-and-storage/netlify-database/#database-branching). A branch of the current Production database is therefore **not** the proposed isolation solution. Start a separate test project/database, review bootstrap and seed migrations for Production-specific enrollment/owner records, and seed approved test identities only. Applied migrations remain immutable. No Production data export, copy, deletion, or connection is part of this proposal.

The gateway must dispatch `/api/*`, `/.netlify/functions/*`, and `/.netlify/identity/*` before SSR/assets fallback. It needs an exact test-origin allowlist, no Production fallback, correctly scoped cookies, trusted-origin/CSRF checks, validated user sessions on the backend, retained tenant ownership and row policies, and no caching of private responses. Admin hosts, callback URLs, print/font resources, authentication refresh, and redirects/headers currently defined for Netlify need an explicit routing audit. A service binding is not a shortcut to a Preview: Cloudflare [documents that Preview service bindings call the bound Worker's production deployment](https://developers.cloudflare.com/workers/previews/resources/#limitations).

Directly moving the backend to a Worker would additionally require replacing/porting Netlify Function context, Identity verification, Database/Blobs access, filesystem/font loading, `sharp`, `@resvg/resvg-js`, `@napi-rs/canvas`, and PDF rendering. A compatibility flag is insufficient. No D1, R2, KV, Hyperdrive, or external database is proposed for business persistence.

All test integrations require explicit disabling at the server, including default-on paid/search/AI features. Leave Square billing/merchant writes and webhooks, outbound support email, SMS, registration fixtures, QZ signing, and scheduled/background external work unavailable. Omit their Production credentials and merchant records. Synthetic initial data is essential because withholding an environment token alone does not disable credentials already stored in a database. A functional preview's configuration is a separate change after its test resources, route policy, and gateway code are approved.

## Resource costs for review

Public rates below were checked on **2026-11-07**. They are estimates and published billing formulas, not a quotation for this account or approval to spend. Existing account usage shares the included allowances. No purchase, upgrade, resource provisioning, or billing setting change occurred.

| Resource | Published rate / planning cost |
| --- | --- |
| UI-only Worker Preview | Workers Free allows 100,000 dynamic requests/day at 10 ms CPU/invocation; a small test can cost **$0** if it fits the runtime and shared quotas. Workers Paid has a **$5/account/month minimum**, including 10 million requests and 30 million CPU-ms/month; overages are **$0.30/million requests** and **$0.02/million CPU-ms**. A new test Worker does not itself establish whether an account upgrade is needed. |
| Static UI assets | Static asset requests are free/unlimited. Requests routed through Worker code consume Worker request/CPU allowance. No separate preview database or bucket charge is needed for the UI-only candidate. |
| Workers Builds | Free: 3,000 build minutes/month; Paid: 6,000 included, then **$0.005/minute**. For example, 20 builds of three minutes use 60 minutes; incremental charge is $0 only if the shared allowance remains. |
| Netlify test Functions and Database | On published credit plans: Functions **10 credits/GB-hour**; Database **10 credits/compute-unit-hour** per its database billing example; database egress **20 credits/GB**. A test with 1 Function GB-hour, 10 database compute-unit-hours, 0.1 GB database egress, 0.1 GB web egress, and 10,000 web requests uses about **116 credits**, excluding storage, authentication, and any setup deploy charge. |
| Netlify requests, files, and deploys | Web requests **2 credits/10,000** and web egress **20 credits/GB**. Deploy Previews/branch deploys cost 0 deploy credits; a deploy to the primary URL of even a test project costs **15 credits**. Private file delivery consumes platform usage. Database storage's published page still references a July 1, 2026 transition without a current numeric storage rate; no storage-free guarantee is made. |
| Converting the test estimate to money | Published credit-based Pro top-ups are **1,500 credits/$10**, purchased in packs. 116 credits is about **$0.77 of pack value**, or about **$0.87** with one 15-credit test-project deploy; actual additional charge can be $0 within available included credits or at least a $10 pack when purchased. This is not the team's verified contract, remaining balance, or a guaranteed bill. Storage and any Identity/service add-ons still need account-specific confirmation before provisioning. |
| Identity and optional site gating | Use only a small, separately approved test user set. Identity eligibility/limits and any add-on charges require confirmation for the account; no $0 promise is made. Cloudflare Preview URLs are public by default. Any optional Access policy and its plan/seat cost also require separate approval before deployment. Neither is activated here. |

Sources: [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [Workers Builds pricing](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/), [Netlify Database billing](https://docs.netlify.com/build/data-and-storage/netlify-database/billing-and-usage/), [Netlify credit meters](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/), and [credit packs](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/buy-credit-packs/). An approval should name the chosen scope/resources and a spend cap; no resources are currently approved.

## Validation and release boundaries

No Cloudflare build, dry-run upload, preview deployment, or Production deployment was performed. This run reserves builds for platform validation, and this proposal has not installed its candidate dependencies. A separate implementation needs type checks, a Cloudflare-adapter build, assertions on the generated config/entry/assets, and local Worker-runtime checks that APIs return JSON rather than HTML and cannot contact Production. UI-only approval would not certify login/backend behavior.

A later functional preview needs tests for each user's separate page colors and saved data, session refresh/logout/callbacks, tenant isolation and rejected cross-tenant IDs, isolated uploads and fonts, native exports, and denied external integration writes. These gates are additional to the completed Netlify application tests documented in [preview-and-label-fixes.md](preview-and-label-fixes.md).

The inspected checkout and observed Netlify Production baseline is **`9d00553cd06b9a143b4a8634d9aae0680715149a`**. It does not contain these uncommitted fixes. This run does not create commits; the change commit is assigned by the platform afterward. There is **no active Wrangler fix file or fix commit to report**. The exact proposed source path is `cloudflare/preview/wrangler.jsonc`, documented above; its explicit `previews` property addresses the reported check once the separate adapter/entry implementation exists.

Before any future push: Netlify has automatic Git builds enabled for `main`; Cloudflare's official integration has also reported a successful build check on that same baseline commit. Treat pushing or merging shared `main` as capable of deploying **both Netlify and Cloudflare**. Preview-branch filters are not verified, so a non-main push is not assumed deployment-free either. No main branch update, push, merge, commit creation, deployment trigger, or Cloudflare/Netlify setting change was performed. Deployment and test-resource approval remain required. This proposal does not resolve or certify the login/backend migration.
