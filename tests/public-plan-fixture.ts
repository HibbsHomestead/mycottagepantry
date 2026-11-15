import type { Page } from '@playwright/test'
import { launchPricing, type PlanId } from '../src/lib/launch-plans'
import { accessFixture } from './account-access-fixture'

/** Synthetic public responses only. No hosted signup or billing mutation is sent. */
export async function installPublicPlanFixture(page: Page, unmapped?: PlanId) {
  // Netlify dev can discover an earlier generated framework handler. Keep API
  // emulation on Netlify and load the current frontend from its Vite process.
  await page.route('http://localhost:8889/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.startsWith('/api/') || path.startsWith('/.netlify/'))
      return route.fallback()
    const response = await route.fetch({
      url: route.request().url().replace('localhost:8889', 'localhost:3000'),
    })
    return route.fulfill({ response })
  })
  await page.route('**/.netlify/identity/**', (route) =>
    route.fulfill({ status: 401, json: {} }),
  )
  await page.route('**/api/account-access**', (route) =>
    route.fulfill({ json: accessFixture('signed_out') }),
  )
  await page.route('**/api/registration?view=policies', (route) =>
    route.fulfill({ json: { policy: null } }),
  )
  await page.route('**/api/stripe/billing**', (route) => {
    if (
      route.request().method() === 'GET' &&
      new URL(route.request().url()).searchParams.get('view') === 'availability'
    ) {
      const tiers = launchPricing.plans.map((plan) => ({
        id: plan.id,
        purchasable: plan.id !== 'free' && plan.id !== unmapped,
        reason:
          plan.id === 'free'
            ? 'Free account setup. No payment method required.'
            : plan.id === unmapped
              ? 'A validated recurring Price mapping is missing for this tier.'
              : 'Available monthly subscription.',
      }))
      return route.fulfill({
        json: {
          plans: tiers.filter((p) => p.purchasable).map((p) => p.id),
          tiers,
        },
      })
    }
    return route.fulfill({
      status: 401,
      json: { code: 'SIGN_IN_REQUIRED', error: 'Log in to continue.' },
    })
  })
}
