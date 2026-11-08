import { test, expect } from '@playwright/test'
import { demoData } from '../src/lib/demo'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

for (const width of [1440, 390]) {
  test(`lookup panel rendered states at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    await installWorkspaceFixture(page)
    const workspace = demoData()
    workspace.settings[0].packagePhotoExtractionAllowed = true
    const item = workspace.ingredients.find((i) => i.id === 'sugar')!
    Object.assign(item, {
      name: 'Applesauce',
      unit: 'each',
      storageUnit: 'each',
      recipeUnit: 'each',
      quantity: 0,
      cost: 2,
      currentCost: 2,
      purchaseQuantity: 1,
      purchaseUnit: 'each',
      packagePrice: 2,
      conversions: [],
    })
    workspace.ledger = workspace.ledger.filter(
      (l) => l.ingredientId !== item.id,
    )
    let failed = true
    const writes: unknown[] = []
    await page.route('**/api/workspace*', (route) => {
      if (route.request().url().includes('productImport'))
        return route.fulfill(
          failed
            ? {
                status: 503,
                json: {
                  error: 'Upstream page request failed.',
                  code: 'PRODUCT_IMPORT_FAILED',
                  diagnostics: {
                    source: 'retailer',
                    stage: 'fetch',
                    requestedAt: '2026-11-08T03:00:00Z',
                    requestId: 'fixture-reference',
                    requestedUrl: 'https://example.org/applesauce',
                    hops: [
                      {
                        url: 'https://example.org/applesauce?token=private-test-value',
                        at: '2026-11-08T03:00:00Z',
                        status: 503,
                        headers: { 'content-type': 'text/html' },
                        bodySummary: 'Upstream service unavailable.',
                      },
                    ],
                  },
                },
              }
            : {
                json: {
                  products: [
                    {
                      title: 'Applesauce',
                      fields: { brand: 'Orchard' },
                      imageUrl: '',
                      sourceUrl: 'https://example.org/applesauce',
                      checkedAt: '2026-11-08T03:00:00Z',
                      conditions: [],
                      warnings: [],
                    },
                  ],
                },
              },
        )
      if (route.request().url().includes('catalog=1'))
        return route.fulfill({
          status: 503,
          json: { error: 'Unavailable', code: 'WORKSPACE_REQUEST_FAILED' },
        })
      if (route.request().method() === 'POST')
        writes.push(route.request().postDataJSON())
      return route.fulfill({
        json: { workspace, role: 'Owner', demo: false },
      })
    })
    await page.goto(workspaceFixtureUrl('Inventory/Ingredients'))
    await page
      .getByRole('textbox', { name: 'Search pantry' })
      .fill('Applesauce')
    await page
      .getByRole('button', { name: 'View details', exact: true })
      .click()
    const editor = page.getByRole('dialog')
    await editor
      .getByRole('button', { name: 'Edit Ingredient', exact: true })
      .click()
    const phase = process.env.CAPTURE_PHASE || 'after'
    const panel = editor.locator('.ingredient-import-tools')
    const capture = async (state: string) => {
      await editor.locator('.ingredient-detail-body').evaluate((el) => {
        el.scrollTop = 0
      })
      await page.screenshot({
        path: `docs/previews/lookup-${phase}-${state}-${width}.png`,
        animations: 'disabled',
      })
    }
    await capture('normal')
    const height = await panel.evaluate(
      (el) => el.getBoundingClientRect().height,
    )
    await test.info().attach('panel-height', {
      body: JSON.stringify({ phase, width, height }),
      contentType: 'application/json',
    })
    await editor.getByLabel('Name', { exact: true }).fill('Applesauce draft')
    await editor
      .getByLabel('Product URL', { exact: true })
      .fill('https://example.org/applesauce')
    await editor
      .getByRole('button', { name: 'Import details', exact: true })
      .click()
    await expect(panel.getByRole('alert')).toBeVisible()
    await capture('error-collapsed')
    const disclosure = panel.locator('summary').filter({
      hasText: phase === 'before' ? 'Technical details' : 'Error details',
    })
    await disclosure.click()
    await capture('error-expanded')
    if (phase === 'before') return
    await expect(panel).not.toContainText('private-test-value')
    await expect(panel).toContainText('PRODUCT_IMPORT_FAILED')
    expect(
      await panel
        .locator('summary')
        .filter({ hasText: 'Error details' })
        .count(),
    ).toBe(1)
    await expect(editor.getByLabel('Name', { exact: true })).toHaveValue(
      'Applesauce draft',
    )
    await expect(editor.getByLabel('Product URL', { exact: true })).toHaveValue(
      'https://example.org/applesauce',
    )
    expect(writes).toHaveLength(0)
    expect(
      await editor.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1)
    const urlInput = editor.getByLabel('Product URL', { exact: true })
    const barcodeInput = panel.getByRole('textbox', {
      name: 'Barcode',
      exact: true,
    })
    const catalogInput = panel.getByRole('textbox', {
      name: 'Catalog',
      exact: true,
    })
    await barcodeInput.fill('012345678905')
    await catalogInput.fill('Orchard applesauce')
    // The original action remains available after repeated failures.
    for (let retry = 0; retry < 3; retry++) {
      await editor
        .getByRole('button', { name: 'Import details', exact: true })
        .click()
      await expect(panel.getByRole('alert')).toHaveText('Import failed.')
    }
    await expect(barcodeInput).toHaveValue('012345678905')
    await expect(catalogInput).toHaveValue('Orchard applesauce')
    await urlInput.fill('invalid-url')
    await editor
      .getByRole('button', { name: 'Import details', exact: true })
      .click()
    await expect(panel.getByRole('alert')).toHaveText(
      'Enter a valid product URL.',
    )
    await urlInput.fill('https://example.org/applesauce')
    await expect(panel.getByRole('alert')).toHaveCount(0)
    const sizes = await panel
      .locator(
        '.product-link-entry input, .product-link-entry > button, .catalog-lookup input, .catalog-lookup button',
      )
      .evaluateAll((elements) =>
        elements.map((el) => el.getBoundingClientRect().height),
      )
    expect(sizes.every((height) => height === 36)).toBe(true)
    const nestedScrolls = await panel.evaluate(
      (el) =>
        [...el.querySelectorAll('*')].filter(
          (child) =>
            ['auto', 'scroll'].includes(getComputedStyle(child).overflowY) &&
            child.scrollHeight > child.clientHeight + 1,
        ).length,
    )
    expect(nestedScrolls).toBe(0)
    failed = false
    await editor
      .getByRole('button', { name: 'Import details', exact: true })
      .click()
    await expect(panel.getByRole('alert')).toHaveCount(0)
    await expect(editor.getByLabel('Name', { exact: true })).toHaveValue(
      'Applesauce draft',
    )
    expect(writes).toHaveLength(0)
    await panel.getByRole('button', { name: 'Look up', exact: true }).click()
    await expect(panel.getByRole('alert')).toHaveText('Barcode lookup failed.')
    await panel.getByRole('button', { name: 'Search', exact: true }).click()
    await expect(panel.getByRole('alert')).toHaveText('Catalog search failed.')
    expect(
      await panel
        .locator('summary')
        .filter({ hasText: 'Error details' })
        .count(),
    ).toBe(1)
    await expect(barcodeInput).toHaveValue('012345678905')
    await expect(catalogInput).toHaveValue('Orchard applesauce')
    await expect(urlInput).toHaveValue('https://example.org/applesauce')
    await panel
      .locator('summary')
      .filter({ hasText: 'Paste product text' })
      .click()
    await panel
      .getByRole('textbox', { name: 'Product text / notes', exact: true })
      .fill('Keep these package notes in my unsaved draft.')
    await panel
      .locator('summary')
      .filter({ hasText: 'Paste product text' })
      .click()
    await panel
      .locator('summary')
      .filter({ hasText: 'Paste product text' })
      .click()
    await expect(
      panel.getByRole('textbox', { name: 'Product text / notes', exact: true }),
    ).toHaveValue('Keep these package notes in my unsaved draft.')
    expect(writes).toHaveLength(0)
  })
}
