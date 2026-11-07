import { test, expect } from '@playwright/test'
import { demoData } from '../src/lib/demo'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

// Render the real popups with synthetic responses; never writes customer data.
for (const width of [1440, 390, 320]) {
  test(`ingredient photo keeps its size above all recipe links at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await installWorkspaceFixture(page)
    const workspace = demoData()
    const ingredient = workspace.ingredients.find(
      (item) => item.id === 'yeast',
    )!
    ingredient.imageAssetId = 'portrait-photo'
    workspace.graphic_assets = [
      {
        id: 'portrait-photo',
        name: 'Package photo',
        fileUrl: 'https://fixture.example/package.svg',
      },
    ]
    const recipes = Array.from({ length: 12 }, (_, index) => ({
      ...workspace.recipes[0],
      id: `usage-${index}`,
      name: `Bread recipe ${index + 1}`,
      lines: [{ ingredientId: ingredient.id, quantity: 2, unit: 'g' }],
    }))
    workspace.recipes = recipes
    let writes = 0
    await page.route('https://fixture.example/**', (route) =>
      route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="220"><rect width="100" height="220" rx="8" fill="#ece7cc"/><text x="50" y="90" text-anchor="middle" fill="#615744">YEAST</text></svg>',
      }),
    )
    await page.route('**/api/workspace*', (route) => {
      if (route.request().method() === 'POST') writes++
      return route.fulfill({ json: { workspace, role: 'Owner', demo: false } })
    })
    await page.goto(workspaceFixtureUrl('Inventory/Ingredients'))
    await page.getByRole('textbox', { name: 'Search pantry' }).fill('yeast')
    await page
      .getByRole('button', { name: 'View details', exact: true })
      .click()
    const modal = page.getByRole('dialog')
    const usage = modal.getByRole('region', { name: 'Recipe usage' })
    await expect(usage.getByRole('button')).toHaveCount(recipes.length)
    await modal.evaluate((el) =>
      Promise.all(
        el
          .getAnimations({ subtree: true })
          .map((animation) => animation.finished.catch(() => {})),
      ),
    )
    const geometry = await modal.evaluate((el) => {
      const media = el.querySelector('.ingredient-detail-media')!
      const photo = media.querySelector('.product-detail-photo')!
      const usage = media.querySelector('section')!
      const rect = photo.getBoundingClientRect()
      const usageRect = usage.getBoundingClientRect()
      const infoRect = el
        .querySelector('.product-detail-information')!
        .getBoundingClientRect()
      // Measure the original shared photo layout with the same CSS and content width.
      media.before(photo)
      media.remove()
      const original = photo.getBoundingClientRect()
      photo.after(media)
      media.prepend(photo)
      return {
        width: rect.width,
        height: rect.height,
        originalWidth: original.width,
        originalHeight: original.height,
        photoTop: rect.top,
        photoBottom: rect.bottom,
        photoLeft: rect.left,
        usageTop: usageRect.top,
        usageLeft: usageRect.left,
        infoTop: infoRect.top,
        infoLeft: infoRect.left,
        fit: getComputedStyle(photo.querySelector('img')!).objectFit,
        overflow: el.scrollWidth - el.clientWidth,
      }
    })
    expect(geometry.width).toBeCloseTo(geometry.originalWidth, 3)
    expect(geometry.height).toBeCloseTo(geometry.originalHeight, 3)
    expect(geometry.usageTop - geometry.photoBottom).toBeCloseTo(16, 1)
    expect(geometry.usageLeft).toBe(geometry.photoLeft)
    expect(geometry.fit).toBe('contain')
    expect(geometry.overflow).toBeLessThanOrEqual(1)
    if (width > 640) {
      expect(geometry.photoLeft).toBeGreaterThan(geometry.infoLeft)
      expect(geometry.photoTop).toBeCloseTo(geometry.infoTop, 1)
    } else {
      expect(geometry.infoTop).toBeGreaterThan(geometry.usageTop)
    }
    await page.screenshot({
      path: `docs/previews/ingredient-placement-${width}.png`,
      animations: 'disabled',
    })
    await usage
      .getByRole('button', { name: recipes.at(-1)!.name, exact: true })
      .click()
    await expect(
      page
        .getByRole('dialog')
        .getByRole('heading', { name: recipes.at(-1)!.name, exact: true }),
    ).toBeVisible()
    expect(writes).toBe(0)
  })

  test(`compact import checklist preserves conflicts, full text and the shared draft at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await installWorkspaceFixture(page)
    const workspace = demoData()
    const statement =
      'Wheat flour (wheat, malted barley flour), enriched with niacin, iron and folic acid. '.repeat(
        12,
      )
    const product = {
      title: 'Instant Dry Yeast',
      imageUrl: '',
      sourceUrl: 'https://example.org/yeast',
      checkedAt: '2026-11-07T00:00:00Z',
      warnings: [],
      conditions: [],
      fields: {
        name: 'Instant Dry Yeast',
        brand: 'Source brand',
        packagePrice: 6.98,
        currency: 'USD',
        purchaseQuantity: 1,
        purchaseUnit: 'lb',
        subingredients: statement,
        sourceContains: 'Contains wheat.',
        sourceMayContain: 'Made in a facility that also handles milk and soy.',
      },
    }
    let writes = 0
    await page.route('**/api/workspace*', (route) => {
      if (route.request().url().includes('productImport'))
        return route.fulfill({ json: { products: [product] } })
      if (route.request().method() === 'POST') writes++
      return route.fulfill({ json: { workspace, role: 'Owner', demo: false } })
    })
    await page.goto(workspaceFixtureUrl('Inventory/Ingredients'))
    await page.getByRole('button', { name: 'Add Item', exact: true }).click()
    const modal = page.getByRole('dialog')
    await expect(
      modal.getByRole('group', { name: 'Entry method' }),
    ).toHaveCount(0)
    await expect(modal.getByLabel('Product URL', { exact: true })).toBeVisible()
    await expect(modal.getByLabel('Scan or enter barcode')).toBeVisible()
    await expect(modal.getByLabel('Item name', { exact: true })).toBeVisible()
    const entryOrder = await modal.evaluate((el) => {
      const fields = Array.from(
        el.querySelectorAll('[data-item-tab="details"] input'),
      )
      const url = fields.findIndex(
        (field) => field.getAttribute('inputmode') === 'url',
      )
      const barcode = fields.findIndex((field) =>
        field.closest('.barcode-entry-row'),
      )
      const name = fields.findIndex((field) =>
        field.hasAttribute('data-item-name'),
      )
      return { url, barcode, name, overflow: el.scrollWidth - el.clientWidth }
    })
    expect(entryOrder.barcode).toBeGreaterThan(entryOrder.url)
    expect(entryOrder.name).toBeGreaterThan(entryOrder.barcode)
    expect(entryOrder.overflow).toBeLessThanOrEqual(1)
    await page.screenshot({
      path: test.info().outputPath(`ingredient-unified-entry-${width}.png`),
      animations: 'disabled',
    })
    const originalDialog = await modal.elementHandle()
    const originalUrl = page.url()
    await modal.getByLabel('Item name', { exact: true }).fill('Manual name')
    await modal.getByLabel('Brand', { exact: true }).fill('Manual brand')
    await modal
      .getByLabel('Product URL', { exact: true })
      .fill(product.sourceUrl)
    await modal
      .getByRole('button', { name: 'Import details', exact: true })
      .click()
    const list = modal.getByRole('list', { name: 'Imported values' })
    await expect(list).toBeVisible()
    await expect(
      list.getByRole('checkbox', { name: 'Name', exact: true }),
    ).not.toBeChecked()
    await expect(
      list.getByRole('checkbox', { name: 'Brand', exact: true }),
    ).not.toBeChecked()
    await expect(
      list.getByRole('checkbox', {
        name: 'Source ingredient statement',
        exact: true,
      }),
    ).toBeChecked()
    await expect(list).toContainText('Current: Manual name')
    await expect(list).toContainText('Package price: $6.98')
    await modal
      .locator('.product-import-selection')
      .evaluate((el) => el.scrollIntoView({ block: 'start' }))
    await page.screenshot({
      path: test.info().outputPath(`ingredient-unified-review-${width}.png`),
      animations: 'disabled',
    })
    const wording = list.getByRole('listitem').filter({
      has: page.getByRole('checkbox', {
        name: 'Source ingredient statement',
        exact: true,
      }),
    })
    await wording
      .getByRole('button', { name: 'Show full text', exact: true })
      .click()
    await expect(wording).toContainText(statement.trim())
    await wording.locator('summary').click()
    const textarea = wording.getByRole('textbox')
    await expect(textarea).toBeVisible()
    const textSize = await textarea.evaluate((el) => ({
      client: el.clientHeight,
      scroll: el.scrollHeight,
    }))
    expect(textSize.scroll).toBeLessThanOrEqual(textSize.client + 1)
    await wording.locator('summary').click()
    const layout = await list.evaluate((el) => ({
      overflow: el.scrollWidth - el.clientWidth,
      rows: Array.from(el.children).map((row) => {
        const css = getComputedStyle(row)
        return {
          border: css.borderLeftWidth,
          radius: css.borderRadius,
          checkboxHeight: row.querySelector('input')!.getBoundingClientRect()
            .height,
        }
      }),
      scrollPanels: Array.from(el.querySelectorAll('*')).filter((node) => {
        const css = getComputedStyle(node)
        return (
          node.clientHeight > 0 &&
          node.scrollHeight > node.clientHeight + 1 &&
          /auto|scroll/.test(css.overflowY)
        )
      }).length,
    }))
    expect(layout.overflow).toBeLessThanOrEqual(1)
    expect(layout.scrollPanels).toBe(0)
    expect(
      layout.rows.every(
        (row) =>
          row.border === '0px' &&
          row.radius === '0px' &&
          row.checkboxHeight === 18,
      ),
    ).toBe(true)
    await modal
      .getByRole('button', { name: 'Clear selection', exact: true })
      .click()
    await expect(
      modal.getByRole('button', { name: 'Apply selected values' }),
    ).toBeDisabled()
    await modal.getByRole('button', { name: 'Select all', exact: true }).click()
    await expect(
      list.getByRole('checkbox', { name: 'Name', exact: true }),
    ).toBeChecked()
    await modal
      .getByRole('button', { name: 'Clear selection', exact: true })
      .click()
    await list.getByRole('checkbox', { name: 'Brand', exact: true }).check()
    await modal.getByRole('button', { name: 'Apply selected values' }).click()
    await expect(modal.getByLabel('Item name', { exact: true })).toHaveValue(
      'Manual name',
    )
    await expect(modal.getByLabel('Brand', { exact: true })).toHaveValue(
      'Source brand',
    )
    await modal
      .getByLabel('Brand', { exact: true })
      .fill('Manually edited brand')
    await modal.getByLabel('Scan or enter barcode').fill('000000123456')
    await modal
      .getByRole('button', { name: 'Search this Oven', exact: true })
      .click()
    await expect(modal.getByText(/Product lookup unavailable/)).toBeVisible()
    await expect(modal.getByLabel('Brand', { exact: true })).toHaveValue(
      'Manually edited brand',
    )
    expect(page.url()).toBe(originalUrl)
    expect(
      await modal.evaluate((el, original) => el === original, originalDialog),
    ).toBe(true)
    await modal
      .getByRole('tab', { name: 'Ingredients & allergens', exact: true })
      .click()
    await expect(
      modal.getByLabel('Subingredients', { exact: true }),
    ).toHaveValue(statement)
    await expect(
      modal.getByLabel('Source Contains statement', { exact: true }),
    ).toHaveValue('Contains wheat.')
    await expect(
      modal.getByLabel('May contain / facility statement', { exact: true }),
    ).toHaveValue(product.fields.sourceMayContain)
    await modal.getByRole('tab', { name: 'Details', exact: true }).click()
    await expect(modal.getByLabel('Brand', { exact: true })).toHaveValue(
      'Manually edited brand',
    )
    await expect(modal.getByLabel('Product URL', { exact: true })).toHaveValue(
      product.sourceUrl,
    )
    await expect(modal.getByLabel('Scan or enter barcode')).toHaveValue(
      '000000123456',
    )
    expect(writes).toBe(0)
  })
}
