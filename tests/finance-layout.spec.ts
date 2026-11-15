import { test, expect } from '@playwright/test'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'
import { demoData } from '../src/lib/demo'
import { bookSummary } from '../src/lib/checkbook'
for (const width of [1440, 2560, 1280, 390])
  test(`finance layout ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    await installWorkspaceFixture(page)
    const w = demoData()
    await page.route('**/api/workspace*', async (route) => {
      const u = new URL(route.request().url())
      w.bookkeeping = [
        {
          ...bookSummary(
            w,
            u.searchParams.get('bookFrom') || '2026-11-01',
            u.searchParams.get('bookTo') || '2026-11-30',
          ),
          settings: { bills: false, invoices: false },
        },
      ]
      await route.fulfill({ json: { workspace: w, role: 'Owner', demo: true } })
    })
    await page.goto(workspaceFixtureUrl('Finance/Overview'))
    const nav = page.getByRole('complementary', { name: 'Finance sections' })
    await expect(page.locator('.checkbook')).toBeVisible()
    await expect(page.locator('.section-tabs')).toHaveCount(0)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy()
    if (width >= 1280) {
      const box = await page.locator('main').boundingBox()
      expect(width - box!.x - box!.width).toBeLessThan(100)
    }
    await page.screenshot({
      path: `docs/reviews/finance-navigation/overview-${width}.png`,
      fullPage: true,
    })
    const from = page.getByLabel('From', { exact: true })
    await from.fill('2026-10-01')
    await page
      .getByRole('button', { name: 'Upload receipt', exact: true })
      .click()
    await expect(
      page.getByRole('dialog', { name: 'Upload receipt' }),
    ).toBeVisible()
    await expect(page).toHaveURL(/#Finance\/Overview$/)
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(from).toHaveValue('2026-10-01')
    await expect(
      page.getByRole('button', { name: 'Upload receipt', exact: true }),
    ).toBeFocused()
    for (const action of [
      '+ Money in',
      '+ Money out',
      'Transfer',
      'Record a transaction',
    ]) {
      await page.getByRole('button', { name: action, exact: true }).click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toHaveCount(0)
    }
    for (const dest of [
      'Register',
      'Accounts',
      'Mileage',
      'Reports',
      'Settings / Categories',
      'Advanced',
      'Advanced reports',
      'Receipt inbox',
    ]) {
      if (width < 1000)
        await nav.getByRole('button', { name: /^Bookkeeping ·/ }).click()
      await nav.getByRole('button', { name: dest, exact: true }).click()
      if (dest === 'Receipt inbox') {
        await expect(page).toHaveURL(/#Purchasing\/Purchases%20%26%20Receipts$/)
        continue
      }
      await expect(
        nav.getByRole('button', {
          name: dest,
          exact: true,
          includeHidden: true,
        }),
      ).toHaveAttribute('aria-current', 'page')
    }
  })
