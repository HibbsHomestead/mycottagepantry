import { test, expect } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'
import { demoData } from '../src/lib/demo'
import { bookSummary } from '../src/lib/checkbook'
import { sectionTabs } from '../src/lib/workspace-navigation'

for (const width of [1440, 390]) {
  test(`section navigation and rendered review ${width}`, async ({ page }) => {
    test.setTimeout(180000)
    await page.setViewportSize({ width, height: 1000 })
    await installWorkspaceFixture(page)
    const workspace = demoData()
    workspace.bookkeeping = [bookSummary(workspace, '2026-01-01', '2026-12-31')]
    workspace.ingredients
      .filter((i) => /flour/i.test(i.name))
      .forEach((i) => {
        i.imageAssetId = 'review-image'
      })
    workspace.graphic_assets = [
      ...(workspace.graphic_assets || []),
      {
        id: 'review-image',
        name: 'Review photo',
        fileUrl: '/review-photo.svg',
        widthPx: 120,
        heightPx: 180,
      },
    ]
    await page.route('**/review-photo.svg', (route) =>
      route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="180"><rect width="120" height="180" fill="white"/><rect x="18" y="20" width="84" height="140" rx="10" fill="#eee0bc"/><text x="60" y="95" text-anchor="middle" fill="#53482c">FLOUR</text></svg>',
      }),
    )
    await page.route('**/api/workspace*', async (route) => {
      if (route.request().method() === 'POST') {
        expect(route.request().postDataJSON().action).toBe('pantryView')
      }
      await route.fulfill({ json: { workspace, role: 'Owner', demo: true } })
    })
    const dir = 'docs/reviews/section-navigation'
    mkdirSync(dir, { recursive: true })
    for (const [section, tab] of Object.entries({
      Products: 'All Products',
      Inventory: 'Overview',
      Purchasing: 'Purchases & Receipts',
      Finance: 'Overview',
      Settings: 'Business Profile',
      Handmade: 'Overview',
      Production: 'Overview',
      Sales: 'Sales',
      Labels: 'Labels',
    })) {
      await page.goto(workspaceFixtureUrl(`${section}/${tab}`))
      await expect(page.locator('main h1')).toBeVisible()
      await page.waitForTimeout(700)
      await page.evaluate(() => document.fonts.ready)
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        section,
      ).toBe(true)
      if (section === 'Inventory') {
        const photo = page.locator('.pantry-photo img').first()
        await expect(photo).toBeVisible()
        await photo.scrollIntoViewIfNeeded()
        await expect(photo).toHaveJSProperty('complete', true)
        expect(
          await photo.evaluate(
            (el) => getComputedStyle(el.parentElement!).backgroundColor,
          ),
        ).toBe('rgba(0, 0, 0, 0)')
        await page.screenshot({
          path: `${dir}/inventory-loaded-image-${width}.png`,
          animations: 'disabled',
        })
        await page.evaluate(() => window.scrollTo(0, 0))
      }
      await page.screenshot({
        path: `${dir}/${section.toLowerCase()}-${width}.png`,
        animations: 'disabled',
      })
      if (section === 'Products') {
        await page
          .getByRole('button', { name: /View photo and details for/ })
          .first()
          .click()
        await page.screenshot({
          path: `${dir}/product-detail-${width}.png`,
          animations: 'disabled',
        })
        await page
          .getByRole('button', { name: 'Close', exact: true })
          .first()
          .click()
      }
      if (section === 'Inventory') {
        const nav = page.getByRole('navigation', { name: 'Inventory sections' })
        if (width === 390) {
          await nav.getByRole('button').click()
          await page.screenshot({
            path: `${dir}/inventory-mobile-expanded.png`,
          })
        }
        for (const dest of sectionTabs.Inventory) {
          if (
            width === 390 &&
            (await nav.getByRole('button').getAttribute('aria-expanded')) ===
              'false'
          )
            await nav.getByRole('button').click()
          await nav
            .getByRole('link', { name: dest, exact: true, includeHidden: true })
            .click()
          await expect(
            nav.getByRole('link', {
              name: dest,
              exact: true,
              includeHidden: true,
            }),
          ).toHaveAttribute('aria-current', 'page')
          expect(decodeURIComponent(new URL(page.url()).hash)).toContain(
            `/` + dest,
          )
          if (dest === 'Ingredients') {
            await page.screenshot({
              path: `${dir}/ingredients-${width}.png`,
              animations: 'disabled',
            })
            await page
              .getByRole('button', { name: 'Table', exact: true })
              .click()
            await page.screenshot({
              path: `${dir}/inventory-table-${width}.png`,
              animations: 'disabled',
            })
          }
        }
      }
    }
  })
}
