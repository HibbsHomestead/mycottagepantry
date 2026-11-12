import { expect, type BrowserContext, type Page } from '@playwright/test'
import { accessFixture } from './account-access-fixture'
import { demoData } from '../src/lib/demo'

export const fixtureOrigin = 'https://mycottagepantry.com'
export async function installSessionJourney(context: BrowserContext) {
  const workspace = demoData()
  const member = {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Session test bakery',
    role: 'Owner',
  }
  const state = {
    signedIn: false,
    invalid: false,
    refreshFailure: 0,
    membershipFailure: false,
    workspaceFailure: false,
    refreshes: 0,
    passwords: 0,
    writes: 0,
    documents: 0,
    revoked: false,
    selection: false,
  }
  await context.routeWebSocket('**/*', (socket) => socket.close())
  await context.route(fixtureOrigin + '/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    if (request.isNavigationRequest()) state.documents++
    if (path.startsWith('/.netlify/identity/')) {
      if (path.endsWith('/token')) {
        const refresh =
          new URLSearchParams(request.postData() || '').get('grant_type') ===
          'refresh_token'
        if (refresh) {
          state.refreshes++
          if (state.refreshFailure)
            return route.fulfill({
              status: state.refreshFailure,
              json: { error: 'temporarily_unavailable' },
            })
        } else state.passwords++
        if (state.revoked || (!refresh && state.invalid))
          return route.fulfill({
            status: 400,
            json: { error: 'invalid_grant' },
          })
        state.signedIn = true
        const part = Buffer.from(
          JSON.stringify({
            sub: 'session-fixture',
            exp: Math.floor(Date.now() / 1000) + 3600,
          }),
        ).toString('base64url')
        return route.fulfill({
          json: {
            access_token: `synthetic.${part}.fixture`,
            refresh_token: 'synthetic-session-refresh',
            token_type: 'bearer',
            expires_in: 3600,
          },
        })
      }
      if (path.endsWith('/logout')) {
        state.signedIn = false
        return route.fulfill({ status: 204 })
      }
      if (path.endsWith('/recover')) return route.fulfill({ status: 204 })
      return route.fulfill({
        status: state.signedIn ? 200 : 401,
        json: state.signedIn
          ? {
              id: 'session-fixture',
              email: 'fixture@example.invalid',
              confirmed_at: '2026-01-01T00:00:00Z',
              user_metadata: {},
              app_metadata: { roles: [] },
            }
          : {},
      })
    }
    if (path === '/api/account-access')
      return route.fulfill({
        json: accessFixture(
          !state.signedIn
            ? 'signed_out'
            : state.membershipFailure
              ? 'membership_error'
              : state.selection
                ? 'workspace_selection'
                : 'workspace',
          {
            membership: state.signedIn && !state.selection ? member : null,
            memberships: state.signedIn
              ? state.selection
                ? [
                    member,
                    {
                      ...member,
                      id: '22222222-2222-4222-8222-222222222222',
                      name: 'Second authorized bakery',
                    },
                  ]
                : [member]
              : [],
          },
        ),
      })
    if (path === '/api/workspace') {
      if (request.method() !== 'GET') state.writes++
      return route.fulfill({
        status: state.workspaceFailure ? 503 : state.signedIn ? 200 : 401,
        json: state.workspaceFailure
          ? { error: 'Connection interrupted. Retry.' }
          : { workspace, role: 'Owner', demo: false },
      })
    }
    if (
      path === '/api/registration' &&
      url.searchParams.get('view') === 'access' &&
      request.method() === 'POST'
    ) {
      state.selection = false
      return route.fulfill({ json: {} })
    }
    if (path.startsWith('/api/'))
      return route.fulfill({ status: 503, json: {} })
    return route.fulfill({
      response: await route.fetch({
        url: 'http://localhost:3000' + path + url.search,
      }),
    })
  })
  return state
}
export async function signIn(page: Page) {
  await expect(
    page.getByRole('button', { name: 'Log in', exact: true }),
  ).toBeEnabled()
  await page
    .getByLabel('Email', { exact: true })
    .fill('fixture@example.invalid')
  await page
    .getByLabel('Password', { exact: true })
    .fill('synthetic-fixture-input')
  await page.getByRole('button', { name: 'Log in', exact: true }).click()
}
export async function appReady(page: Page) {
  await expect(page.getByRole('button', { name: 'Profile menu' })).toBeVisible()
}
