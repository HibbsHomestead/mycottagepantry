import { test, expect } from '@playwright/test'
import { accessFixture } from './account-access-fixture'
import { demoData } from '../src/lib/demo'

test('mocked session: login → workspace → refresh → logout, with one safe return and no signup intent', async ({
  page,
}) => {
  let signedIn = false
  let workspaceRequests = 0
  await page.route('**/api/account-access', async (route) =>
    route.fulfill({
      json: accessFixture(signedIn ? 'workspace' : 'signed_out'),
    }),
  )
  await page.route('**/.netlify/identity/**', async (route) => {
    if (new URL(route.request().url()).pathname.endsWith('/token')) {
      signedIn = true
      await route.fulfill({
        json: {
          access_token: 'synthetic-browser-fixture',
          refresh_token: 'synthetic-browser-refresh-fixture',
          token_type: 'bearer',
          expires_in: 3600,
        },
      })
    } else if (new URL(route.request().url()).pathname.endsWith('/logout')) {
      signedIn = false
      await route.fulfill({ status: 204 })
    } else
      await route.fulfill({
        json: {
          id: 'synthetic-browser-identity',
          email: 'synthetic@example.invalid',
          confirmed_at: '2026-01-01T00:00:00Z',
          app_metadata: { roles: [] },
          user_metadata: {},
        },
      })
  })
  await page.route('**/api/workspace*', async (route) => {
    workspaceRequests++
    await route.fulfill({
      json: { workspace: demoData(), role: 'Owner', demo: false },
    })
  })
  await page.goto('/workspace#Pantry')
  await expect(page).toHaveURL(/\/login\?/)
  expect(workspaceRequests).toBe(0)
  await expect(
    page.getByRole('button', { name: 'Log in', exact: true }),
  ).toBeEnabled()
  await page
    .getByLabel('Email', { exact: true })
    .fill('synthetic@example.invalid')
  await page
    .getByLabel('Password', { exact: true })
    .fill('synthetic-fixture-input')
  await page.getByRole('button', { name: 'Log in', exact: true }).click()
  await expect(page).toHaveURL(/\/workspace\?accessTrace=.*#Pantry$/)
  await expect(
    page.getByText('Opening your workspace…', { exact: true }),
  ).toHaveCount(0)
  await expect.poll(() => workspaceRequests).toBeGreaterThan(0)
  await page.reload()
  await expect(page).toHaveURL(/\/workspace\?accessTrace=.*#Pantry$/)
  await expect.poll(() => workspaceRequests).toBeGreaterThan(1)
  await page.getByRole('button', { name: 'Profile menu' }).click()
  await page.getByRole('menuitem', { name: 'Account & sign in' }).click()
  await page.getByRole('button', { name: 'Sign out of your account' }).click()
  await expect(page).toHaveURL(/\/login(?:\?|$)/)
  await expect(
    page.getByRole('button', { name: 'Log in', exact: true }),
  ).toBeEnabled()
})

test('mocked failure: membership outage stays retryable without registration or workspace reads', async ({
  page,
}) => {
  let workspaceRequests = 0
  await page.route('**/api/account-access', async (route) =>
    route.fulfill({ json: accessFixture('membership_error') }),
  )
  await page.route('**/api/workspace*', async (route) => {
    workspaceRequests++
    await route.abort()
  })
  await page.goto('/onboarding')
  await expect(
    page.getByRole('heading', { name: 'Account access unavailable' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Retry access check' }).click()
  await expect(
    page.getByRole('heading', { name: 'Account access unavailable' }),
  ).toBeVisible()
  await expect(page).toHaveURL(/\/onboarding$/)
  expect(workspaceRequests).toBe(0)
  await expect(page.getByLabel('Business/display name')).toHaveCount(0)
})

test('mocked unverified session: verify-email has recheck and explicit sign-out, not a login loop', async ({
  page,
}) => {
  await page.route('**/api/account-access', async (route) =>
    route.fulfill({ json: accessFixture('email_unverified') }),
  )
  await page.goto('/verify-email')
  await expect(
    page.getByRole('button', { name: 'Check account status' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Check account status' }).click()
  await expect(page).toHaveURL(/\/verify-email$/)
  await expect(page.getByRole('link', { name: 'Return to login' })).toHaveCount(
    0,
  )
})

test('local real endpoint: signed-out requests do not provision a demo workspace', async ({
  request,
}) => {
  const access = await request.get('/api/account-access')
  expect((await access.json()).status).toBe('signed_out')
  const workspace = await request.get('/api/workspace')
  expect(workspace.status()).toBe(401)
})

test('mocked slow lookup waits before showing verified free workspace setup without creating a business', async ({
  page,
}) => {
  let workspaceWrites = 0
  await page.route('**/api/registration*', (route) => {
    if (route.request().method() === 'POST') workspaceWrites++
    return route.fulfill({ json: {} })
  })
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/account-access', async (route) => {
    await gate
    await route.fulfill({ json: accessFixture('no_workspace') })
  })
  await page.goto('/onboarding')
  await expect(
    page.getByRole('heading', { name: 'Checking account access…' }),
  ).toBeVisible()
  await expect(page.getByLabel('Business/display name')).toHaveCount(0)
  await expect(page).toHaveURL(/\/onboarding$/)
  release()
  await expect(
    page.getByRole('heading', { name: 'Create your business' }),
  ).toBeVisible()
  await expect(page.getByLabel('Business/display name')).toBeVisible()
  expect(workspaceWrites).toBe(0)
})

test('mocked selection rejects an unauthorized workspace and never reads business records', async ({
  page,
}) => {
  let workspaceReads = 0
  const memberships = [
    {
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Fixture A',
      role: 'Owner',
    },
    {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Fixture B',
      role: 'Owner',
    },
  ]
  await page.route('**/api/account-access', async (route) =>
    route.fulfill({
      json: accessFixture('workspace_selection', { memberships }),
    }),
  )
  await page.route('**/api/registration?view=access', async (route) =>
    route.fulfill({
      status: 403,
      json: { code: 'WORKSPACE_FORBIDDEN', error: 'Access denied' },
    }),
  )
  await page.route('**/api/workspace*', async (route) => {
    workspaceReads++
    await route.abort()
  })
  await page.goto('/workspace')
  await page.getByRole('button', { name: 'Fixture A · Owner' }).click()
  await expect(page.getByRole('alert')).toContainText('could not be opened')
  expect(workspaceReads).toBe(0)
  await expect(page).toHaveURL(/\/workspace$/)
})

test('mocked embedded signed-out context resolves onboarding to login without creating business data', async ({
  page,
}) => {
  await page.route('http://localhost:8889/access-test-parent', async (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<iframe title="App preview" src="http://localhost:8889/onboarding"></iframe>',
    }),
  )
  await page.route('**/api/account-access', async (route) =>
    route.fulfill({ json: accessFixture('signed_out') }),
  )
  await page.goto('http://localhost:8889/access-test-parent')
  const frame = page.frameLocator('iframe')
  await expect(
    frame.getByRole('button', { name: 'Log in', exact: true }),
  ).toBeEnabled()
  await expect(frame.getByLabel('Business/display name')).toHaveCount(0)
})
