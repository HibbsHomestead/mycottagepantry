import { test, expect } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { demoData } from '../src/lib/demo'
import { bookSummary } from '../src/lib/checkbook'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

for (const width of [1440, 390]) {
  test(`shared application layout ${width}`, async ({ page }) => {
    test.setTimeout(180000)
    await page.setViewportSize({ width, height: 1000 })
    await installWorkspaceFixture(page)
    const workspace = demoData()
    workspace.bookkeeping = [bookSummary(workspace, '2026-01-01', '2026-12-31')]
    await page.route('**/api/workspace*', (r) =>
      r.fulfill({ json: { workspace, role: 'Owner', demo: true } }),
    )
    const dir = 'docs/reviews/readable-page-layout'
    mkdirSync(dir, { recursive: true })
    for (const [name, route] of Object.entries({
      inventory: 'Inventory/Overview',
      purchasing: 'Purchasing/Purchases & Receipts',
      finance: 'Finance/Overview',
      products: 'Products/All Products',
      recipes: 'Production/Recipes & Designs',
      settings: 'Settings/Business Profile',
      handmade: 'Handmade/Overview',
      sales: 'Sales/Sales',
      labels: 'Labels/Labels',
      dashboard: 'Dashboard',
    })) {
      await page.goto(workspaceFixtureUrl(route))
      const main = page.locator('main.application-page')
      await expect(main.locator('h1')).toBeVisible()
      await page.waitForTimeout(500)
      await page.evaluate(() => document.fonts.ready)
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        name,
      ).toBe(true)
      const nav = main.locator(
        '.section-workspace > nav, .section-workspace > .book-nav',
      )
      const summary = main.locator(
        ':scope > .pantry-summary, :scope > .page-overview:not(:empty)',
      )
      if ((await summary.count()) && (await nav.count())) {
        const s = (await summary.first().boundingBox())!
        const n = (await nav.first().boundingBox())!
        expect(n.y, name).toBeGreaterThanOrEqual(s.y + s.height)
        const layout = (await main.locator('.section-workspace').boundingBox())!
        expect(s.width).toBeCloseTo(layout.width, 0)
      }
      const sizes = await main
        .locator(
          'input, select, td, .internal-section-links > a, .book-nav button',
        )
        .evaluateAll((els) =>
          els
            .filter((el) => el.getClientRects().length)
            .map((el) => ({
              text: el.textContent?.slice(0, 30),
              size: parseFloat(getComputedStyle(el).fontSize),
            })),
        )
      expect(
        sizes.filter((s) => s.size < 16),
        name,
      ).toEqual([])
      await page.screenshot({
        path: `${dir}/${name}-${width}.png`,
        fullPage: true,
      })
    }
  })
}

test('200 percent desktop reflow and finance actions', async ({ page }) => {
  test.setTimeout(180000)
  // A 1440×1000 desktop at 200% browser zoom has a 720×500 CSS viewport.
  await page.setViewportSize({ width: 720, height: 500 })
  await installWorkspaceFixture(page)
  const workspace = demoData()
  workspace.bookkeeping = [bookSummary(workspace, '2026-01-01', '2026-12-31')]
  await page.route('**/api/workspace*', (r) =>
    r.fulfill({ json: { workspace, role: 'Owner', demo: true } }),
  )
  for (const [name, route] of Object.entries({
    inventory: 'Inventory/Overview',
    purchasing: 'Purchasing/Purchases & Receipts',
    finance: 'Finance/Overview',
    products: 'Products/All Products',
    recipes: 'Production/Recipes & Designs',
    settings: 'Settings/Business Profile',
  })) {
    await page.goto(workspaceFixtureUrl(route))
    const main = page.locator('main.application-page')
    await expect(main.locator('h1')).toBeVisible()
    await page.waitForTimeout(300)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      name,
    ).toBe(true)
    const clipped = await main
      .locator('button')
      .evaluateAll((els) =>
        els
          .filter(
            (el) =>
              el.getClientRects().length &&
              el.clientHeight &&
              el.scrollHeight > el.clientHeight + 2,
          )
          .map((el) => el.textContent),
      )
    expect(clipped, name).toEqual([])
    await page.screenshot({
      path: `docs/reviews/readable-page-layout/${name}-200-reflow.png`,
      fullPage: true,
    })
    if (name === 'finance') {
      for (const action of [
        'Upload receipt',
        'Record a transaction',
        '+ Money in',
        '+ Money out',
        'Transfer',
      ]) {
        const button = main.getByRole('button', { name: action, exact: true })
        await expect(button).toHaveCount(1)
        await button.click()
        await expect(page.getByRole('dialog')).toBeVisible()
        await page.keyboard.press('Escape')
      }
    }
  }
})
