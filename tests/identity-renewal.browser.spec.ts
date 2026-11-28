import { readFileSync } from 'node:fs'
import { expect, test, type BrowserContext, type Page, type Route } from '@playwright/test'
import ts from 'typescript'

const origin = 'https://cottage-auth-fixture.test'
const manager = ts.transpileModule(readFileSync(new URL('../src/lib/identity-session.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
const subject = 'isolated-test-account'
const jwt = (offset: number) => 'fixture.' + Buffer.from(JSON.stringify({ sub: subject, exp: Math.floor(Date.now() / 1000) + offset })).toString('base64url') + '.fixture'
const fresh = () => ({ access_token: jwt(3600), refresh_token: 'rotated-fixture' })
declare global {
  interface Window {
    renewal: typeof import('../src/lib/identity-session')
    stopWatching: () => void
  }
}

async function fixture(context: BrowserContext, refresh: (route: Route) => Promise<void>, count: number, expiresIn = -30) {
  await context.addCookies([
    { name: 'nf_jwt', value: jwt(expiresIn), url: origin, secure: true },
    { name: 'nf_refresh', value: 'initial-fixture', url: origin, secure: true },
  ])
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== origin) return route.abort()
    if (url.pathname === '/identity-session.js') return route.fulfill({ contentType: 'text/javascript', body: manager })
    if (url.pathname === '/demo-client') return route.fulfill({ contentType: 'text/javascript', body: 'export const activeDemoSession = async () => false' })
    if (url.pathname === '/.netlify/identity/token') return refresh(route)
    if (url.pathname === '/.netlify/identity/logout') return route.fulfill({ status: 204 })
    return route.fulfill({ contentType: 'text/html', body: `<!doctype html>
      <p id="status" role="status"></p>
      <form aria-label="Fixture recipe"><label>Directions<textarea></textarea></label></form>
      <script type="module">
        import * as renewal from '/identity-session.js'
        window.renewal = renewal
        window.stopWatching = renewal.watchIdentitySession(state => {
          document.querySelector('#status').textContent = state
        })
      </script>` })
  })
  const pages = await Promise.all(Array.from({ length: count }, () => context.newPage()))
  await Promise.all(pages.map(async (page) => {
    await page.goto(origin + '/oven#Recipes')
    await page.waitForFunction(() => !!window.renewal && !!navigator.locks)
    await page.evaluate(() => window.stopWatching())
  }))
  return pages
}

const renew = (page: Page) => page.evaluate(() => window.renewal.restoreIdentitySession())
const watch = (page: Page) => page.evaluate(async () => {
  const managerPath = '/identity-session.js'
  const renewal = await import(managerPath)
  renewal.watchIdentitySession((state: string) => { document.querySelector('#status')!.textContent = state })
})

for (const tabs of [2, 3]) {
  test(`${tabs} expired tabs share one slow token rotation`, async ({ context }) => {
    let calls = 0
    const pages = await fixture(context, async (route) => {
      calls++
      await new Promise((resolve) => setTimeout(resolve, 300))
      await route.fulfill({ json: fresh() })
    }, tabs)
    expect(await Promise.all(pages.map(renew))).toEqual(Array(tabs).fill('active'))
    expect(calls).toBe(1)
  })
}

for (const failure of ['offline', '503', '403']) {
  test(`${failure} retains the session and backs off across tabs`, async ({ context }) => {
    let calls = 0
    const pages = await fixture(context, (route) => {
      calls++
      if (calls > 1) return route.fulfill({ json: fresh() })
      return failure === 'offline' ? route.abort('internetdisconnected') : route.fulfill({ status: Number(failure), json: { error: 'temporarily_unavailable' } })
    }, 2)
    expect(await Promise.all(pages.map(renew))).toEqual(['retrying', 'retrying'])
    expect(calls).toBe(1)
    expect((await context.cookies(origin)).some((cookie) => cookie.name === 'nf_refresh')).toBe(true)
    await expect.poll(() => renew(pages[1]), { timeout: 7000 }).toBe('active')
    expect(calls).toBe(2)
  })
}

test('invalid grant clears once and a long in-progress form remains at its route', async ({ context }) => {
  let calls = 0
  const pages = await fixture(context, (route) => {
    calls++
    return route.fulfill({ status: 400, json: { error: 'invalid_grant' } })
  }, 2)
  const editor = pages[1].getByRole('textbox', { name: 'Directions' })
  const directions = 'Stir, fold, and document the fixture batch. '.repeat(100)
  await editor.fill(directions)
  await watch(pages[1])
  expect(await renew(pages[0])).toBe('expired')
  expect(await renew(pages[1])).toBe('absent')
  expect(calls).toBe(1)
  await expect(pages[1].getByRole('status')).toHaveText('expired')
  expect(pages[1].url()).toBe(origin + '/oven#Recipes')
  await expect(editor).toHaveValue(directions)
})

test('a new token that appears during a rejected refresh survives the re-check', async ({ context }) => {
  const [first] = await fixture(context, async (route) => {
    const replacement = fresh()
    await context.addCookies([
      { name: 'nf_jwt', value: replacement.access_token, url: origin, secure: true },
      { name: 'nf_refresh', value: replacement.refresh_token, url: origin, secure: true },
    ])
    await route.fulfill({ status: 400, json: { error: 'invalid_grant' } })
  }, 1)
  expect(await renew(first)).toBe('active')
  expect((await context.cookies(origin)).filter((cookie) => /^nf_(jwt|refresh)$/.test(cookie.name))).toHaveLength(2)
})

test('the tab schedules proactive refresh even without an API request', async ({ context }) => {
  let calls = 0
  const [first] = await fixture(context, (route) => {
    calls++
    return route.fulfill({ json: fresh() })
  }, 1, 90)
  await watch(first)
  await expect(first.getByRole('status')).toHaveText('active')
  expect(calls).toBe(1)
})

test('explicit logout notifies another tab and clears both cookies', async ({ context }) => {
  const [first, second] = await fixture(context, (route) => route.fulfill({ json: fresh() }), 2)
  expect(await renew(first)).toBe('active')
  await watch(second)
  await first.evaluate(() => window.renewal.signOutIdentity())
  await expect(second.getByRole('status')).toHaveText('signed-out')
  expect((await context.cookies(origin)).filter((cookie) => /^nf_(jwt|refresh)$/.test(cookie.name))).toHaveLength(0)
})
