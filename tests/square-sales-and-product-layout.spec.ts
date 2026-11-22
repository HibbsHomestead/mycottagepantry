import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { demoData } from '../src/lib/demo'
import { squareSalesAction } from '../netlify/lib/square-sales-import'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'
for (const width of [1440, 900, 390]) {
  test(`Square staged flow and reversal ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 940 })
    await installWorkspaceFixture(page)
    const workspace = demoData()
    workspace.sales_imports = []
    workspace.sales_product_mappings = []
    const before = JSON.stringify({
      ingredients: workspace.ingredients,
      products: workspace.products,
      ledger: workspace.ledger,
    })
    const initial = workspace.sales.reduce((a, s) => a + s.amount, 0)
    await page.route('**/api/workspace*', async (route) => {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON()
        try {
          await squareSalesAction(body.action, body.data, {
            state: workspace,
            org: 'fixture',
            client: null,
            actor: 'Fictional test owner',
            save: async (table, item) => {
              workspace[table] ||= []
              const i = workspace[table].findIndex((r) => r.id === item.id)
              if (i < 0) workspace[table].push(structuredClone(item))
              else workspace[table][i] = structuredClone(item)
            },
            audit: async (name, detail) => {
              workspace.activity.push({ id: crypto.randomUUID(), name, detail })
            },
          })
        } catch (e) {
          return route.fulfill({
            status: 400,
            json: { error: (e as Error).message },
          })
        }
      }
      return route.fulfill({ json: { workspace, role: 'Owner', demo: true } })
    })
    await page.goto(workspaceFixtureUrl('Sales/Sales'))
    await page
      .getByRole('button', { name: 'Import sales', exact: true })
      .click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Square CSV file').setInputFiles({
      name: 'simulated-items.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        await readFile('public/demo/square-items.csv', 'utf8'),
      ),
    })
    await expect(
      dialog.getByRole('combobox', { name: 'Report type', exact: true }),
    ).toHaveValue('items')
    await dialog
      .getByRole('button', { name: 'Stage file', exact: true })
      .click()
    expect(workspace.sales.reduce((a, s) => a + s.amount, 0)).toBe(initial)
    await dialog
      .getByLabel('Cottage Pantry product')
      .first()
      .selectOption(workspace.products[0].id)
    await dialog.getByLabel('Save mapping for future imports').first().check()
    await dialog
      .getByRole('button', { name: 'Review import', exact: true })
      .click()
    await expect(
      dialog.getByText(/4 transaction groups · 5 item rows/),
    ).toBeVisible()
    await dialog.getByLabel(/I reviewed mappings/).check()
    await dialog
      .getByRole('button', { name: 'Continue to confirmation' })
      .click()
    await dialog.screenshot({
      path: `docs/reviews/square-sales/confirm-${width}.png`,
    })
    await dialog
      .getByRole('button', { name: 'Import sales', exact: true })
      .click()
    await expect(dialog).toHaveCount(0)
    expect(workspace.sales.reduce((a, s) => a + s.amount, 0)).toBe(initial + 34)
    expect(workspace.sales_product_mappings).toHaveLength(1)
    expect(
      JSON.stringify({
        ingredients: workspace.ingredients,
        products: workspace.products,
        ledger: workspace.ledger,
      }),
    ).toBe(before)
    await page.getByText(/Sales import history \(1\)/).click()
    await page.getByRole('button', { name: 'Undo import', exact: true }).click()
    await page
      .getByRole('button', { name: 'Confirm undo import', exact: true })
      .click()
    expect(workspace.sales.reduce((a, s) => a + s.amount, 0)).toBe(initial)
    expect(workspace.sales_imports[0].status).toBe('reversed')
  })
  test(`compact product pricing and moved controls ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 940 })
    await installWorkspaceFixture(page)
    const workspace = demoData()
    workspace.products[0].packagingLines = []
    workspace.products[0].packagingId = ''
    workspace.products[0].productCategoryId = 'valid-legacy'
    const categories = [
      {
        id: 'valid-legacy',
        name: 'Bakery goods',
        classification: 'food',
        active: true,
      },
    ]
    workspace.settings[0].productCategories = categories
    await page.route('**/api/workspace*', (route) =>
      route.fulfill({
        json: route.request().url().includes('productCategories')
          ? {
              categories,
              products: workspace.products,
              recipes: workspace.recipes,
              revision: 1,
              mappings: {},
              rates: [],
            }
          : { workspace, role: 'Owner', demo: false },
      }),
    )
    await page.route('**/api/product-categories*', (route) =>
      route.fulfill({
        json: {
          categories,
          rates: [],
          mappings: {},
          revision: 1,
          products: [],
          recipes: [],
        },
      }),
    )
    await page.goto(workspaceFixtureUrl('Products/Food'))
    await page
      .getByRole('button', {
        name: `Edit ${workspace.products[0].name}`,
        exact: true,
      })
      .first()
      .click()
    const dialog = page.getByRole('dialog').first()
    await expect(dialog).toBeVisible()
    const grid = dialog.locator('.product-pricing-grid')
    const labels = await grid.locator('.field > span').allTextContents()
    expect(labels).toEqual([
      'Units per package',
      'Retail price ($)',
      'Wholesale price ($)',
      'Entered prices',
      'Target margin (%)',
      'Target food cost (%)',
    ])
    const columns = await grid.evaluate(
      (el) => getComputedStyle(el).gridTemplateColumns.split(' ').length,
    )
    expect(columns).toBe(width === 1440 ? 3 : width === 900 ? 2 : 1)
    const description = dialog.locator('.product-description-field')
    const textarea = description.locator('textarea').first(),
      generate = description.getByRole('button', {
        name: 'Generate description',
        exact: true,
      })
    expect(
      await generate.evaluate(
        (el) =>
          el.compareDocumentPosition(
            el.closest('section')!.querySelector('textarea')!,
          ) & Node.DOCUMENT_POSITION_PRECEDING,
      ),
    ).toBeTruthy()
    await textarea.fill('Unsaved description remains editable.')
    await expect(
      dialog.getByText('This category needs review.', { exact: true }),
    ).toHaveCount(0)
    const unpacked = dialog.getByLabel('Sold unpackaged', { exact: true })
    await unpacked.check()
    await expect(
      dialog.getByText('No packaging used', { exact: true }),
    ).toBeVisible()
    await dialog.getByRole('button', { name: /Add packaging item/ }).click()
    await expect(unpacked).not.toBeChecked()
    await expect(dialog.locator('.packaging-editor')).toHaveCount(1)
    await unpacked.click()
    await expect(unpacked).not.toBeChecked()
    await expect(
      dialog
        .getByRole('alert')
        .filter({ hasText: 'Remove assigned packaging' }),
    ).toContainText('Remove assigned packaging')
    await expect(dialog.locator('.packaging-editor')).toHaveCount(1)
    await dialog.locator('.packaging-heading').scrollIntoViewIfNeeded()
    await dialog.screenshot({
      path: `docs/reviews/square-sales/product-${width}.png`,
    })
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true)
  })
}
