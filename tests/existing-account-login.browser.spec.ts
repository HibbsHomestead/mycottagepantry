import { test, expect } from '@playwright/test'
import { accessFixture } from './account-access-fixture'
import { demoData } from '../src/lib/demo'

const origin = 'https://mycottagepantry.com'
const member = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Existing bakery fixture',
  role: 'Owner',
}

for (const scenario of [
  { name: 'no pending selection', search: '', stale: false },
  { name: 'unavailable cookie reference', search: '', stale: true },
  { name: 'retired URL plan', search: '?plan=retired-plan', stale: true },
]) {
  test(`synthetic existing-account login: ${scenario.name}, refresh, sign out and back in`, async ({
    page,
    context,
  }) => {
    let signedIn = false
    let planRequests = 0
    let businessWrites = 0
    let workspaceReads = 0
    const workspace = demoData()
    workspace.settings[0].name = member.name
    const originalRecords = JSON.stringify(workspace)
    await page.routeWebSocket('**/*', (socket) => socket.close())
    // All requests to the intended origin are intercepted, including page assets.
    // This checks browser routing/cookies on that origin, not live production auth.
    await page.route(origin + '/**', async (route) => {
      const request = route.request()
      const path = new URL(request.url()).pathname
      if (path.startsWith('/.netlify/identity/')) {
        if (path.endsWith('/token')) {
          signedIn = true
          return route.fulfill({
            json: {
              access_token: 'synthetic-browser-fixture',
              refresh_token: 'synthetic-browser-refresh-fixture',
              token_type: 'bearer',
              expires_in: 3600,
            },
          })
        }
        if (path.endsWith('/logout')) {
          signedIn = false
          return route.fulfill({ status: 204 })
        }
        return route.fulfill({
          status: signedIn ? 200 : 401,
          json: signedIn
            ? {
                id: 'synthetic-existing-identity',
                email: 'fixture@example.invalid',
                confirmed_at: '2026-01-01T00:00:00Z',
                app_metadata: { roles: [] },
                user_metadata: {},
              }
            : {},
        })
      }
      if (path === '/api/account-access')
        return route.fulfill({
          json: accessFixture(signedIn ? 'workspace' : 'signed_out', {
            membership: signedIn ? member : null,
            memberships: signedIn ? [member] : [],
          }),
        })
      if (path === '/api/signup-plan') {
        planRequests++
        return route.fulfill({
          status: 409,
          json: {
            code: 'PLAN_SELECTION_EXPIRED',
            error:
              'Your saved plan choice is unavailable or expired. Choose your intended plan again; no plan or access was changed.',
          },
        })
      }
      if (path === '/api/workspace') {
        if (request.method() !== 'GET') businessWrites++
        else workspaceReads++
        return route.fulfill({
          status: signedIn ? 200 : 401,
          json: signedIn
            ? { workspace, role: member.role, demo: false }
            : { code: 'SIGN_IN_REQUIRED' },
        })
      }
      if (path.startsWith('/api/')) {
        if (request.method() !== 'GET') businessWrites++
        return route.fulfill({ status: 503, json: {} })
      }
      return route.fulfill({
        response: await route.fetch({
          url: 'http://localhost:8889' + path + new URL(request.url()).search,
        }),
      })
    })
    if (scenario.stale)
      await context.addCookies([
        {
          name: 'cp_signup_intent',
          value: '22222222-2222-4222-8222-222222222222',
          url: origin,
          httpOnly: true,
          secure: true,
          sameSite: 'Lax',
        },
      ])

    async function logIn() {
      const submit = page.getByRole('button', { name: 'Log in', exact: true })
      await expect(submit).toBeEnabled()
      await page
        .getByLabel('Email', { exact: true })
        .fill('fixture@example.invalid')
      await page
        .getByLabel('Password', { exact: true })
        .fill('synthetic-fixture-input')
      await submit.click()
      await expect(page).toHaveURL(
        /^https:\/\/mycottagepantry\.com\/oven\?accessTrace=[a-f0-9-]+(?:#.*)?$/,
      )
      await expect(
        page.getByRole('button', { name: 'Profile menu' }),
      ).toBeVisible()
      await expect.poll(() => workspaceReads).toBeGreaterThan(0)
      expect(new URL(page.url()).searchParams.has('plan')).toBe(false)
      await expect(
        page.getByText('Choose your intended plan again', { exact: true }),
      ).toHaveCount(0)
    }

    await page.goto('/login' + scenario.search)
    await logIn()
    await page.reload()
    await expect(
      page.getByRole('button', { name: 'Profile menu' }),
    ).toBeVisible()
    await expect.poll(() => workspaceReads).toBeGreaterThan(1)
    await page.getByRole('button', { name: 'Profile menu' }).click()
    await page.getByRole('menuitem', { name: 'Account & sign in' }).click()
    await page.getByRole('button', { name: 'Sign out of your account' }).click()
    await expect(page).toHaveURL(origin + '/login')
    // The same stale browser reference is still present; no browser-data reset.
    if (scenario.stale)
      expect(
        (await context.cookies()).some((c) => c.name === 'cp_signup_intent'),
      ).toBe(true)
    await logIn()
    expect(planRequests).toBe(0)
    expect(businessWrites).toBe(0)
    expect(JSON.stringify(workspace)).toBe(originalRecords)
  })
}
