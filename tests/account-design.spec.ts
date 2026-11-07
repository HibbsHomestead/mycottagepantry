import { test, expect } from '@playwright/test'
import { accessFixture } from './account-access-fixture'
import type { AccessStatus } from '../src/lib/access-state'

// These synthetic session/administration responses never use a customer account.
for (const width of [1440, 390, 320]) {
  test(`account, billing and platform states remain readable at ${width}px`, async ({
    page,
  }) => {
    test.setTimeout(90_000)
    await page.setViewportSize({ width, height: 960 })
    let status: AccessStatus = 'no_workspace'
    await page.route('**/api/account-access*', (route) =>
      route.fulfill({ json: accessFixture(status) }),
    )
    await page.route('**/api/registration*', (route) => {
      expect(route.request().method()).toBe('GET')
      const view = new URL(route.request().url()).searchParams.get('view')
      return route.fulfill({
        json:
          view === 'billing'
            ? {
                billing: null,
                workspace: { name: 'Fern & Flour Kitchen' },
                attempts: [],
                invoiceHistoryAvailable: false,
              }
            : { drafts: [], events: [], grants: [] },
      })
    })
    await page.route('**/api/workspace*', () => {
      throw new Error(
        'Account presentation must not read workspace business data',
      )
    })
    for (const [path, state, heading] of [
      ['/onboarding', 'no_workspace', 'Create your business'],
      ['/verify-email', 'email_unverified', 'Verify your email.'],
      ['/onboarding', 'membership_error', 'Account access unavailable'],
      ['/onboarding', 'access_denied', 'Workspace access denied'],
      ['/workspace/billing', 'workspace', 'Plan & billing'],
      ['/platform-registration', 'workspace', 'Signup & billing readiness'],
    ] as const) {
      status = state
      await page.goto(path, { waitUntil: 'networkidle' })
      await expect(
        page.getByRole('heading', { name: heading, exact: true }),
      ).toBeVisible()
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - innerWidth,
        ),
        path,
      ).toBeLessThanOrEqual(1)
      const card = page.locator('.registration-paper, .public-auth')
      expect(
        await card.evaluate((el) => getComputedStyle(el).backgroundColor),
      ).toBe('rgb(255, 255, 255)')
      if (state === 'email_unverified' || state === 'membership_error') {
        const action = page.getByRole('button', {
          name:
            state === 'email_unverified'
              ? 'Check account status'
              : 'Retry access check',
          exact: true,
        })
        await action.focus()
        expect(
          await action.evaluate((el) => getComputedStyle(el).outlineStyle),
        ).toBe('solid')
        expect(
          await action.evaluate((el) => el.getBoundingClientRect().height),
        ).toBeGreaterThanOrEqual(44)
      }
      if (path === '/workspace/billing') {
        await expect(
          page.getByText('No subscription assigned', { exact: true }),
        ).toBeVisible()
        if (width !== 320)
          await page.screenshot({
            path: `docs/previews/after-billing-${width}.png`,
            fullPage: true,
            animations: 'disabled',
          })
      }
      if (state === 'membership_error' && width !== 320)
        await page.screenshot({
          path: `docs/previews/after-account-error-${width}.png`,
          fullPage: true,
          animations: 'disabled',
        })
    }
  })
}
