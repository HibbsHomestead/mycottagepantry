import type { Page } from '@playwright/test'

/** Browser-only mount of the real application; no production route/auth bypass.
 * Callers must intercept /api/workspace with synthetic records before navigating. */
export async function installWorkspaceFixture(page: Page) {
  // Netlify's framework handler can consume Vite's module URLs. Keep the
  // browser on the Netlify origin while loading development resources from Vite.
  await page.route('http://localhost:8889/**', async (route) => {
    const response = await route.fetch({
      url: route.request().url().replace('localhost:8889', 'localhost:3000'),
    })
    await route.fulfill({ response })
  })
  await page.route('**/capture-fixture*', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><script type="module">import RefreshRuntime from "/@react-refresh";RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>(type)=>type;window.__vite_plugin_react_preamble_installed__=true;import("/src/test/capture-workspace.tsx").then(m=>m.mountScreenshotWorkspace())</script></body></html>',
    }),
  )
}
export function workspaceFixtureUrl(section = 'Dashboard') {
  return (
    'http://localhost:8889/capture-fixture?section=' +
    encodeURIComponent(section) +
    '#' +
    section.split('/').map(encodeURIComponent).join('/')
  )
}
