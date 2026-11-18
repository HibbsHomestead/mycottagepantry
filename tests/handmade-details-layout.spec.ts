import { test, expect } from '@playwright/test'
import { demoData } from '../src/lib/demo'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

for (const width of [1440, 1024, 768, 390]) {
  for (const mode of ['light', 'dark']) {
    test(`Handmade detail media layout ${width} ${mode}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 })
      await installWorkspaceFixture(page)
      const w = demoData()
      w.settings[0].appearance = { theme: 'cottage', mode }
      w.products.push({
        id: 'layout-product',
        name: 'Handmade botanical market bag with a long descriptive product name',
        description:
          'Hand stitched linen with botanical artwork and reinforced handles. '.repeat(
            5,
          ),
        taxSource: 'category',
        productCategoryId: 'craft',
        workflow: 'handmade',
        imageAssetId: 'main',
        price: 35,
        quantity: 4,
      })
      w.settings[0].productCategories = [
        { id: 'craft', name: 'Handmade', classification: 'non_food' },
      ]
      w.settings[0].categoryTaxMappings = { non_food: [] }
      w.graphic_assets = [
        {
          id: 'main',
          fileUrl: '/api/workspace?asset=main',
          name: 'Main photo',
        },
        ...['one', 'two'].map((id) => ({
          id,
          productId: 'layout-product',
          category: 'product-mockup',
          name: `Botanical ${id}`,
          fileUrl: `/api/workspace?asset=${id}`,
          inProductGallery: true,
        })),
      ]
      await page.route('**/api/workspace*', (route) => {
        if (route.request().url().includes('asset='))
          return route.fulfill({
            contentType: 'image/svg+xml',
            body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400"><rect x="5" y="5" width="290" height="390" fill="#b2b990"/><text x="25" y="200" font-size="22">Botanical artwork</text></svg>',
          })
        return route.fulfill({
          json: { workspace: w, role: 'Owner', demo: true },
        })
      })
      await page.goto(
        workspaceFixtureUrl('Handmade/Products & Bills of Materials') +
          '?product=layout-product',
      )
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      const info = dialog.locator('.handmade-product-information')
      const media = dialog.getByRole('complementary', { name: 'Product media' })
      await expect(media.locator('img')).toHaveCount(3)
      await expect(info.locator('img')).toHaveCount(0)
      await expect(info.locator('.cost-card')).toHaveCount(10)
      await expect(info.getByText('Tax setup needs attention')).toBeVisible()
      const ib = (await info.boundingBox())!,
        mb = (await media.boundingBox())!
      if (width >= 900) expect(mb.x).toBeGreaterThanOrEqual(ib.x + ib.width)
      else expect(mb.y).toBeGreaterThanOrEqual(ib.y + ib.height)
      expect(
        await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true)
      await expect(
        media.getByRole('button', { name: 'Create mockup' }),
      ).toHaveCount(1)
      await expect(
        media.getByRole('button', { name: 'Edit mockup', exact: true }),
      ).toHaveCount(2)
      await dialog.screenshot({
        path: `/tmp/handmade-details-${width}-${mode}.png`,
      })
      for (const tab of [
        'Bill of Materials & Costing',
        'Production History',
        'Inventory & Sales',
        'Overview',
      ]) {
        await info.getByRole('tab', { name: tab, exact: true }).click()
        await expect(
          info.getByRole('tabpanel', { name: tab, exact: true }),
        ).toBeVisible()
        expect(
          await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
        ).toBe(true)
      }
      await info
        .getByText('How this is calculated', { exact: true })
        .scrollIntoViewIfNeeded()
      await dialog.screenshot({
        path: `/tmp/handmade-details-costs-${width}-${mode}.png`,
      })
      await media
        .getByRole('heading', { name: 'Visual mockups' })
        .scrollIntoViewIfNeeded()
      await dialog.screenshot({
        path: `/tmp/handmade-details-media-${width}-${mode}.png`,
      })
      await expect(
        media.getByRole('link', { name: 'Download PNG' }).first(),
      ).toHaveAttribute('href', '/api/workspace?asset=one')
      await expect(
        media
          .getByRole('region', { name: 'Product gallery' })
          .getByRole('link', { name: 'Open image' }),
      ).toHaveCount(2)
      await media
        .getByRole('button', { name: 'Duplicate mockup', exact: true })
        .first()
        .click()
      await expect(
        page
          .getByRole('dialog')
          .last()
          .getByRole('heading', { name: 'Product mockup' }),
      ).toBeVisible()
      await page.keyboard.press('Escape')
      await media
        .getByRole('button', { name: 'Edit mockup', exact: true })
        .first()
        .click()
      await expect(
        page
          .getByRole('dialog')
          .last()
          .getByRole('heading', { name: /mockup/i }),
      ).toBeVisible()
      await page.keyboard.press('Escape')
      w.settings[0].categoryTaxMappings = { non_food: ['review-tax'] }
      w.settings[0].taxRates = [
        {
          id: 'review-tax',
          name: 'Fixture tax',
          jurisdiction: 'Fixture',
          ratePercent: 5,
          behavior: 'exclusive',
          active: true,
        },
      ]
      w.products.at(-1)!.imageAssetId = undefined
      w.graphic_assets = []
      await page.reload()
      await expect(dialog.locator('.cost-card')).toHaveCount(10)
      await expect(dialog.getByText('Tax setup needs attention')).toHaveCount(0)
      await expect(media.locator('img')).toHaveCount(0)
      await expect(media.getByText('No product image yet')).toBeVisible()
      expect(
        await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true)
      await dialog.screenshot({
        path: `/tmp/handmade-details-empty-${width}-${mode}.png`,
      })
      await dialog.getByRole('button', { name: 'More product actions' }).click()
      await expect(
        page.getByRole('menuitem', { name: 'Record sale' }),
      ).toBeVisible()
      await page.keyboard.press('Escape')
      await dialog
        .getByRole('button', { name: 'Edit product', exact: true })
        .click()
      await expect(page).toHaveURL(/edit=product/)
    })
  }
}
