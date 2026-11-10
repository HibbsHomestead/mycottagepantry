import { test, expect } from '@playwright/test'
import { demoData } from '../src/lib/demo'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'
import { mkdir } from 'node:fs/promises'

for (const width of [1440, 390])
  test(`kit details, navigation and save ${width}`, async ({ page }) => {
    await mkdir('docs/reviews/kit-details', { recursive: true })
    await page.setViewportSize({ width, height: 950 })
    await installWorkspaceFixture(page)
    const workspace = demoData()
    // Synthetic fixtures: the requested private records are not available locally.
    const component = workspace.products[0]
    component.name = 'Holiday Dressin’ Rolls – 9ct.'
    component.unitsPerPackage = 9
    component.contentUnit = 'rolls'
    const kit = {
      id: 'kit-review',
      name: "Gather 'Round",
      workflow: 'kit',
      taxSource: 'category',
      status: 'draft',
      kitComponents: [
        { productId: component.id, quantity: 2, basis: 'package' },
      ],
      packagingLines: [],
      assemblyMinutes: 12,
      assemblyRate: 18,
      price: 45,
    }
    workspace.products.push(kit)
    const stock = JSON.stringify(workspace.ledger)
    let writes = 0
    await page.route('**/api/workspace*', (route) => {
      if (route.request().method() === 'POST') {
        writes++
        const body = route.request().postDataJSON()
        expect(body.action).toBe('save')
        expect(body.table).toBe('products')
        Object.assign(kit, body.data)
      }
      return route.fulfill({ json: { workspace, role: 'Owner', demo: false } })
    })
    await page.goto(workspaceFixtureUrl('Products/All Products'))
    await page
      .getByRole('button', { name: component.name, exact: true })
      .first()
      .click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.locator('.product-detail-photo')).toBeVisible()
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await dialog.screenshot({ animations: 'disabled' })
    const reference = await dialog
      .locator('.product-detail-photo')
      .boundingBox()
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({
      animations: 'disabled',
      path: `docs/reviews/kit-details/product-${width}.png`,
    })
    await page.keyboard.press('Escape')
    await page.getByRole('link', { name: 'Kits', exact: true }).click()
    await expect(page.getByRole('article')).toHaveCount(1)
    await page.getByLabel('Search products').fill('missing')
    await expect(page.getByRole('article')).toHaveCount(0)
    await page.getByLabel('Search products').fill('Gather')
    await page.getByRole('button', { name: kit.name, exact: true }).click()
    await expect(
      dialog.getByRole('button', { name: 'Edit kit', exact: true }),
    ).toBeVisible()
    await expect(
      dialog.getByText('Product category not configured.', { exact: false }),
    ).toBeVisible()
    await expect(
      dialog.getByRole('region', { name: 'Included products' }),
    ).toContainText('2 selling packages')
    await expect(
      dialog.getByRole('region', { name: 'Included products' }),
    ).toContainText('9 rolls per package')
    await expect(
      dialog.getByText('Connected recipe:', { exact: false }),
    ).toHaveCount(0)
    await dialog.screenshot({ animations: 'disabled' })
    const photo = await dialog.locator('.product-detail-photo').boundingBox()
    expect(photo!.width).toBeCloseTo(reference!.width, 0)
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({
      animations: 'disabled',
      path: `docs/reviews/kit-details/kit-${width}.png`,
    })
    const contents = dialog.getByRole('region', { name: 'Included products' })
    expect(
      await contents.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true)
    await dialog.getByText('How this is calculated', { exact: true }).click()
    await dialog.locator('.calculation-box').scrollIntoViewIfNeeded()
    await page.screenshot({
      animations: 'disabled',
      path: `docs/reviews/kit-details/calculation-${width}.png`,
    })
    expect(writes).toBe(0)
    await dialog
      .getByRole('button', { name: component.name, exact: true })
      .click()
    await dialog.getByRole('button', { name: 'Back to kit' }).click()
    await dialog.getByRole('button', { name: 'Edit kit', exact: true }).click()
    await page.getByRole('tab', { name: 'Packaging & cost' }).click()
    await page.getByLabel('Kit selling price').fill('49')
    await page.getByRole('button', { name: 'Save kit', exact: true }).click()
    await expect(
      dialog.locator('.cost-card').filter({ hasText: 'Selling price' }).first(),
    ).toContainText('$49.00')
    expect(writes).toBe(1)
    expect(JSON.stringify(workspace.ledger)).toBe(stock)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.keyboard.press('Escape')
    await page
      .getByRole('button', { name: 'Create kit', exact: true })
      .first()
      .click()
    await expect(page.getByLabel('Kit name', { exact: true })).toBeVisible()
  })
