import { test, expect, type Page } from '@playwright/test'
import { supportAiDefaults } from '../src/lib/support-ai'
import { installWorkspaceFixture } from './workspace-fixture'

const ticketId = '20000000-0000-4000-8000-000000000001'
const secondId = '20000000-0000-4000-8000-000000000002'
const tickets = [ticketId, secondId].map((id, index) => ({
  id,
  number: 17 + index,
  subject: index ? 'Label preview question' : 'Recipe method question',
  category: 'Question',
  status: 'in_progress',
  requesterEmail: 'demo-maker@example.test',
  createdAt: '2026-11-14T04:12:00Z',
  updatedAt: '2026-11-14T05:18:00Z',
  diagnostics: { route: '/oven#Recipes', aiReviewConsent: 'true' },
}))

// Real routes and components; only API transport uses synthetic records.
// Server authorization is exercised separately by platform-admin.test.ts.
async function fixture(page: Page, sessionStatus = 200, supportStatus = 200) {
  await installWorkspaceFixture(page)
  let sessionChecks = 0
  let signIns = 0
  let supportCalls = 0
  let documents = 0
  page.on('request', (request) => {
    if (request.resourceType() === 'document') documents++
  })
  await page.route('**/api/admin*', async (route) => {
    const url = new URL(route.request().url())
    expect(route.request().headers()['x-cp-admin']).toBe('1')
    if (url.searchParams.get('action') === 'login') signIns++
    if (url.searchParams.get('action') === 'session') {
      sessionChecks++
      return route.fulfill({
        status: sessionStatus,
        json:
          sessionStatus === 200
            ? {
                stage: 'authenticated',
                identityId: 'demo-admin',
                role: 'admin',
                expiresAt: '2026-11-14T05:48:00Z',
              }
            : {
                error:
                  sessionStatus === 401
                    ? 'Administrator session expired.'
                    : 'Administrator access denied.',
              },
      })
    }
    return route.fulfill({
      json: { rows: [], page: 1, total: 0, pageSize: 25 },
    })
  })
  await page.route('**/api/support*', async (route) => {
    supportCalls++
    expect(route.request().headers()['x-cp-admin']).toBe('1')
    const url = new URL(route.request().url())
    expect(url.searchParams.get('view')).toBe('staff')
    if (supportStatus !== 200)
      return route.fulfill({
        status: supportStatus,
        json: {
          error:
            supportStatus === 401
              ? 'Your administrator session expired or was revoked.'
              : 'Platform support access denied.',
        },
      })
    if (url.searchParams.has('ai'))
      return route.fulfill({
        json: {
          policy: supportAiDefaults,
          usage: [],
          conversations: [],
          actions: [],
        },
      })
    if (url.searchParams.has('settings'))
      return route.fulfill({
        json: {
          settings: {
            recipient: '',
            pendingRecipient: '',
            recipientVerified: false,
            fromAddress: '',
            replyTo: '',
            enabled: false,
            version: 1,
            verifiedIdentityEmail: 'demo-admin@example.test',
            deliveryBlock: 'Sending is paused.',
            senderApproved: false,
          },
        },
      })
    if (url.searchParams.has('ticket')) {
      const ticket = tickets.find(
        (t) => t.id === url.searchParams.get('ticket'),
      )!
      return route.fulfill({
        json: {
          ticket,
          messages: [
            {
              id: 'customer-message',
              kind: 'customer',
              own: false,
              body: 'Where can I update the method for my sourdough recipe?',
              createdAt: ticket.createdAt,
              attachments: [],
            },
            {
              id: 'private-note',
              kind: 'internal',
              own: true,
              body: 'Review the recipe editor steps before replying.',
              createdAt: ticket.updatedAt,
              attachments: [],
            },
          ],
          notifications: [],
        },
      })
    }
    if (route.request().method() === 'POST') {
      expect(route.request().postDataJSON().action).toBe('list')
      return route.fulfill({ json: { tickets, hasMore: false } })
    }
    return route.fulfill({ json: { staff: true, admin: true } })
  })
  return { counts: () => ({ sessionChecks, signIns, supportCalls, documents }) }
}

for (const width of [390, 820, 1440]) {
  test(`shared admin navigation, conversations, history and refresh at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 960 })
    const api = await fixture(page)
    await page.goto('/admin?section=customers')
    await expect(
      page.getByRole('heading', { name: 'Customers', exact: true }),
    ).toBeVisible()
    const restored = api.counts()
    const nav = page.getByRole('navigation', {
      name: 'Administration sections',
    })
    await page.locator('.admin-topbar').evaluate((header) => {
      header.setAttribute('data-persistence-check', 'mounted')
    })
    await nav.getByRole('link', { name: 'Support inbox' }).click()
    await expect(
      page.getByRole('heading', { name: 'Support inbox' }),
    ).toBeVisible()
    await expect(
      nav.getByRole('link', { name: 'Support inbox' }),
    ).toHaveAttribute('aria-current', 'page')
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1)
    await expect(page.locator('.admin-topbar')).toHaveAttribute(
      'data-persistence-check',
      'mounted',
    )
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
    await expect(
      page.getByRole('link', {
        name: /^Administration$|Back to Administration/,
      }),
    ).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Sign in$/ })).toHaveCount(0)
    if (width === 1440) {
      const columns = await page
        .locator('.support-grid')
        .evaluate((grid) => getComputedStyle(grid).gridTemplateColumns)
      expect(columns.split(' ')).toHaveLength(2)
      const shell = await page.locator('.support-shell').boundingBox()
      const main = await page.locator('.admin-main').evaluate((el) => ({
        width: el.clientWidth,
        left: parseFloat(getComputedStyle(el).paddingLeft),
        right: parseFloat(getComputedStyle(el).paddingRight),
      }))
      expect(shell!.width).toBeCloseTo(main.width - main.left - main.right, 0)
      await page.screenshot({
        path: 'docs/reviews/admin-support-layout/inbox-1440.png',
        fullPage: true,
      })
    }
    await page.getByRole('button', { name: /Recipe method question/ }).click()
    await expect(
      page.getByText('Where can I update the method for my sourdough recipe?'),
    ).toBeVisible()
    await expect(
      nav.getByRole('link', { name: 'Support inbox' }),
    ).toHaveAttribute('aria-current', 'page')
    await expect(
      page.getByText('Private internal note', { exact: true }),
    ).toBeVisible()
    await expect(
      page.locator('summary').filter({ hasText: 'Private admin AI assistant' }),
    ).toBeVisible()
    await page.getByRole('button', { name: /Label preview question/ }).click()
    await expect(page).toHaveURL(new RegExp('#ticket=' + secondId))
    await page.goBack()
    await expect(page).toHaveURL(new RegExp('#ticket=' + ticketId))
    await expect(
      page.getByRole('heading', { name: 'Recipe method question' }),
    ).toBeVisible()
    await page.goForward()
    await expect(
      page.getByRole('heading', { name: 'Label preview question' }),
    ).toBeVisible()
    await nav.getByRole('link', { name: 'Customers', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Customers', exact: true }),
    ).toBeVisible()
    await page.goBack()
    await expect(
      page.getByRole('heading', { name: 'Label preview question' }),
    ).toBeVisible()
    await expect(page.locator('.admin-topbar')).toHaveAttribute(
      'data-persistence-check',
      'mounted',
    )
    expect(api.counts().sessionChecks).toBe(restored.sessionChecks)
    expect(api.counts().documents).toBe(restored.documents)
    expect(api.counts().signIns).toBe(0)
    await page.reload()
    await expect(
      page.getByRole('heading', { name: 'Label preview question' }),
    ).toBeVisible()
    await page.goto('/platform-support#ticket=' + ticketId)
    await expect(
      page.getByRole('heading', { name: 'Recipe method question' }),
    ).toBeVisible()
    await expect(
      nav.getByRole('link', { name: 'Support inbox' }),
    ).toHaveAttribute('aria-current', 'page')
    if (width === 390)
      await nav
        .getByRole('link', { name: 'Support inbox' })
        .scrollIntoViewIfNeeded()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1)
    await page.screenshot({
      path: `docs/reviews/admin-support-layout/conversation-${width}.png`,
      fullPage: true,
    })
    await page
      .getByRole('button', { name: 'Notification settings', exact: true })
      .click()
    await expect(
      page.getByRole('heading', { name: 'Platform notification settings' }),
    ).toBeVisible()
    await expect(
      nav.getByRole('link', { name: 'Support inbox' }),
    ).toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
    await page
      .getByRole('button', { name: 'Notification settings', exact: true })
      .click()
    await expect(
      page.getByRole('heading', { name: 'Recipe method question' }),
    ).toBeVisible()
    expect(api.counts().signIns).toBe(0)
  })
}

for (const status of [401, 403]) {
  test(`direct conversation remains blocked when admin session returns ${status}`, async ({
    page,
  }) => {
    const api = await fixture(page, status)
    await page.goto('/platform-support#ticket=' + ticketId)
    await expect(page.getByRole('button', { name: /^Sign in$/ })).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Recipe method question' }),
    ).toHaveCount(0)
    await expect(
      page.locator('summary').filter({ hasText: 'Private admin AI assistant' }),
    ).toHaveCount(0)
    expect(api.counts().supportCalls).toBe(0)
    expect(api.counts().signIns).toBe(0)
  })
  test(`support permission and expiry checks remain enforced after admin restoration: ${status}`, async ({
    page,
  }) => {
    await fixture(page, 200, status)
    await page.goto('/platform-support#ticket=' + ticketId)
    await expect(page.getByRole('alert')).toContainText(
      status === 401 ? 'expired or was revoked' : 'access denied',
    )
    await expect(
      page.getByRole('heading', { name: 'Recipe method question' }),
    ).toHaveCount(0)
    await expect(
      page.locator('summary').filter({ hasText: 'Private admin AI assistant' }),
    ).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Admin sign-in' })).toHaveCount(
      status === 401 ? 1 : 0,
    )
  })
}
