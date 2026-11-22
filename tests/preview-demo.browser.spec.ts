import { expect, test, type BrowserContext } from '@playwright/test'
import { demoWorkspaceSeed } from '../netlify/lib/demo-workspace-seed'
import { accessFixture } from './account-access-fixture'
test.setTimeout(90000)
test.use({ actionTimeout: 20000 })
test.afterEach(async ({ context }) => {
  await context.unrouteAll({ behavior: 'ignoreErrors' })
})
const origin = 'https://preview.example.test'
async function install(
  context: BrowserContext,
  options: { stale?: boolean; blocked?: boolean } = {},
) {
  let active = false,
    entries = 0,
    resets = 0,
    providerPasswords = 0
  const workspace = demoWorkspaceSeed()
  const member = {
    id: '11111111-1111-4111-8111-111111111111',
    name: workspace.settings[0].name,
    role: 'Owner',
  }
  await context.routeWebSocket('**/*', (socket) => socket.close())
  await context.route(origin + '/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname
    if (path === '/embed')
      return route.fulfill({
        contentType: 'text/html',
        body: '<iframe title="Agent preview" src="/login"></iframe>',
      })
    if (path === '/api/demo') {
      if (request.method() === 'GET')
        return route.fulfill({
          json: url.searchParams.has('session')
            ? { active }
            : { enabled: true },
        })
      const body = request.postDataJSON()
      if (body.action === 'enter') {
        entries++
        if (body.username !== 'demo' || body.password !== 'demo')
          return route.fulfill({
            status: 401,
            json: {
              error: 'Use the public sandbox username demo and password demo.',
            },
          })
        active = !options.blocked
      }
      if (body.action === 'reset') {
        resets++
        active = true
      }
      if (body.action === 'exit') active = false
      return route.fulfill({ json: { ok: true } })
    }
    if (path === '/api/account-access')
      return route.fulfill({
        json: accessFixture(active ? 'workspace' : 'signed_out', {
          membership: active ? member : null,
          memberships: active ? [member] : [],
        }),
      })
    if (path === '/api/workspace')
      return route.fulfill({ json: { workspace, role: 'Owner', demo: true } })
    if (path.startsWith('/.netlify/identity/')) {
      if (path.endsWith('/token')) providerPasswords++
      return route.fulfill({
        status: options.stale ? 200 : 401,
        json: options.stale
          ? {
              id: 'stale-browser-account',
              email: 'stale@example.invalid',
              confirmed_at: '2026-01-01T00:00:00Z',
              app_metadata: {},
              user_metadata: {},
            }
          : {},
      })
    }
    if (path.startsWith('/api/'))
      return route.fulfill({
        status: 403,
        json: { error: 'Disabled in demo.' },
      })
    return route.fulfill({
      response: await route.fetch({
        url: 'http://localhost:3000' + path + url.search,
      }),
    })
  })
  return {
    entries: () => entries,
    resets: () => resets,
    providerPasswords: () => providerPasswords,
  }
}

test('public demo credentials open the normal app, with reset confirmation and persistent banner', async ({
  page,
  context,
}) => {
  const state = await install(context)
  await page.goto(origin + '/login')
  await page
    .getByText('Use demo username and password', { exact: true })
    .click()
  await page.getByLabel('Demo username', { exact: true }).fill('demo')
  await page.getByLabel('Demo password', { exact: true }).fill('wrong')
  await page
    .getByRole('button', { name: 'Open demo workspace', exact: true })
    .click()
  await expect(page.getByRole('alert')).toContainText('public sandbox')
  await page.getByLabel('Demo password', { exact: true }).fill('demo')
  await page
    .getByRole('button', { name: 'Open demo workspace', exact: true })
    .click()
  await expect(
    page.getByText('Demo workspace — sample data only.', { exact: true }),
  ).toBeVisible({ timeout: 20000 })
  expect(state.providerPasswords()).toBe(0)
  page.once('dialog', (dialog) => dialog.dismiss())
  await page
    .getByRole('button', { name: 'Reset demo data', exact: true })
    .click()
  expect(state.resets()).toBe(0)
  page.once('dialog', (dialog) => dialog.accept())
  await page
    .getByRole('button', { name: 'Reset demo data', exact: true })
    .click()
  await expect.poll(state.resets).toBe(1)
  await expect(
    page.getByText('Demo workspace — sample data only.', { exact: true }),
  ).toBeVisible({ timeout: 20000 })
  await page.reload()
  await expect(
    page.getByText('Demo workspace — sample data only.', { exact: true }),
  ).toBeVisible({ timeout: 20000 })
})

test('Try demo remains available beside stale browser-session errors without using provider login', async ({
  page,
  context,
}) => {
  const state = await install(context, { stale: true })
  await page.goto(origin + '/login')
  await page.getByRole('button', { name: 'Try demo', exact: true }).click()
  await expect(
    page.getByText('Demo workspace — sample data only.', { exact: true }),
  ).toBeVisible({ timeout: 20000 })
  expect(state.entries()).toBe(1)
  expect(state.providerPasswords()).toBe(0)
})

test('embedded cookie rejection offers a new-tab fallback without retry loops', async ({
  page,
  context,
}) => {
  const state = await install(context, { blocked: true })
  await page.goto(origin + '/embed')
  const frame = page.frameLocator('iframe')
  await frame.getByRole('button', { name: 'Try demo', exact: true }).click()
  await expect(frame.getByRole('alert')).toContainText(
    'blocked the demo session cookie',
  )
  const link = frame.getByRole('link', {
    name: 'Open preview in new tab',
    exact: true,
  })
  await expect(link).toHaveAttribute('target', '_blank')
  await expect(link).toHaveAttribute('href', '/login')
  expect(state.entries()).toBe(1)
})
