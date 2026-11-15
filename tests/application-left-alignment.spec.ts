import { test, expect } from '@playwright/test'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'
import { demoData } from '../src/lib/demo'
import { bookSummary } from '../src/lib/checkbook'
for (const width of [1440, 2560, 390])
  test(`all workspace containers align left ${width}`, async ({ page }) => {
    test.setTimeout(120000)
    await page.setViewportSize({ width, height: 1000 })
    await installWorkspaceFixture(page)
    const w = demoData()
    await page.route('**/api/workspace*', (route) => {
      if (new URL(route.request().url()).searchParams.has('productCategories'))
        return route.fulfill({
          json: {
            categories: [],
            mappings: {},
            rates: [],
            products: w.products,
            revision: 1,
          },
        })
      w.bookkeeping = [
        {
          ...bookSummary(w, '2026-01-01', '2026-12-31'),
          settings: { bills: false, invoices: false },
        },
      ]
      return route.fulfill({
        json: { workspace: w, role: 'Owner', demo: true },
      })
    })
    await page.route('**/api/stripe/billing*', (route) =>
      route.fulfill({
        status: 401,
        json: { error: 'Sign in to manage billing.' },
      }),
    )
    for (const section of [
      'Dashboard',
      'Inventory',
      'Recipes',
      'Products/All Products',
      'Handmade',
      'Production',
      'Sales',
      'Purchasing/Purchases & Receipts',
      'Finance/Overview',
      'Labels',
      'Settings',
    ]) {
      await page.goto(workspaceFixtureUrl(section))
      await expect(page.locator('main.app-page')).toBeVisible()
      const main = await page.locator('main.app-page').boundingBox()
      const shell = await page.locator('.main-shell').boundingBox()
      expect(Math.abs(main!.x - shell!.x)).toBeLessThan(2)
      expect(main!.width).toBeLessThanOrEqual(1750)
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
      if (
        ['Dashboard', 'Inventory', 'Finance/Overview', 'Settings'].includes(
          section,
        )
      )
        await page.screenshot({
          path: `docs/reviews/subscription-expenses/${section.split('/')[0].toLowerCase()}-${width}.png`,
          fullPage: true,
        })
    }
  })
