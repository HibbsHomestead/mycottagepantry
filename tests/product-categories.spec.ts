import type { ProductCategory } from '../src/lib/product-categories'
import { test, expect } from '@playwright/test'
import { demoData } from '../src/lib/demo'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'
for (const width of [1440, 390]) {
  test(`product categories preserve drafts, save selections, rename and central mappings (${width})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await installWorkspaceFixture(page)
    const workspace = demoData()
    const business = workspace.settings[0]
    business.productCategories = [
      { id: 'bread', name: 'Bread', classification: 'food' },
    ]
    business.taxRates = [
      {
        id: 'state',
        name: 'Configured state treatment',
        jurisdiction: 'Test',
        ratePercent: 5,
        behavior: 'exclusive',
        active: true,
      },
    ]
    business.categoryTaxMappings = { food: ['state'], non_food: [] }
    business.categoryConfigRevision = 1
    workspace.products[0].productCategoryId = 'bread'
    workspace.products[0].taxStatus = 'exempt'
    const productId = workspace.products[0].id
    let failCategories = true,
      failSave = true
    await page.route('**/api/workspace*', async (route) => {
      const req = route.request()
      if (req.url().includes('productCategories')) {
        if (failCategories)
          return route.fulfill({ status: 503, json: { error: 'Test offline' } })
        let selectedId: string | undefined
        if (req.method() === 'POST') {
          const payload = req.postDataJSON()
          if (payload.operation === 'saveCategory') {
            selectedId = payload.category.id || 'gifts'
            const category = { ...payload.category, id: selectedId }
            const existing = business.productCategories.findIndex(
              (c: ProductCategory) => c.id === selectedId,
            )
            if (existing < 0) business.productCategories.push(category)
            else business.productCategories[existing] = category
          } else {
            business.categoryTaxMappings = payload.mappings
          }
          business.categoryConfigRevision++
        }
        return route.fulfill({
          json: {
            categories: business.productCategories,
            mappings: business.categoryTaxMappings,
            rates: business.taxRates,
            revision: business.categoryConfigRevision,
            products: workspace.products,
            selectedId,
          },
        })
      }
      if (req.method() === 'POST') {
        const payload = req.postDataJSON()
        if (payload.action === 'save' && payload.table === 'products') {
          if (failSave)
            return route.fulfill({
              status: 503,
              json: { error: 'Test save failure' },
            })
          const previous = workspace.products.find(
            (p) => p.id === payload.data.id,
          )!
          Object.assign(previous, payload.data)
        }
      }
      return route.fulfill({ json: { workspace, role: 'Owner', demo: false } })
    })
    await page.goto(workspaceFixtureUrl('Products & Pricing'), {
      waitUntil: 'networkidle',
    })
    const first = page.getByRole('article').first()
    await first.getByRole('button', { name: /Actions for/ }).click()
    await page.getByRole('menuitem', { name: 'Edit pricing' }).click()
    const dialog = page.getByRole('dialog')
    await expect(
      dialog.getByText(/Could not load product categories/),
    ).toBeVisible()
    await dialog
      .getByLabel('Product name', { exact: true })
      .fill('Edited product draft')
    failCategories = false
    await dialog.getByRole('button', { name: 'Retry category list' }).click()
    await expect(
      dialog.getByRole('combobox', { name: 'Product category', exact: true }),
    ).toHaveValue('bread')
    await dialog
      .getByRole('button', { name: 'Add category', exact: true })
      .click()
    await dialog.getByLabel('Category name', { exact: true }).fill('Gift boxes')
    await dialog
      .getByRole('combobox', { name: 'Classification', exact: true })
      .selectOption('non_food')
    await dialog
      .getByRole('button', { name: 'Save category', exact: true })
      .click()
    await expect(
      dialog.getByRole('combobox', { name: 'Product category', exact: true }),
    ).toHaveValue('gifts')
    await expect(
      dialog.getByLabel('Product name', { exact: true }),
    ).toHaveValue('Edited product draft')
    await expect(
      dialog.getByText(/Existing assignment preserved: Tax exempt/).first(),
    ).toBeVisible()
    await dialog
      .getByRole('button', { name: 'Save product', exact: true })
      .click()
    await expect(
      dialog.getByText('Test save failure', { exact: true }),
    ).toBeVisible()
    await expect(
      dialog.getByRole('combobox', { name: 'Product category', exact: true }),
    ).toHaveValue('gifts')
    failSave = false
    await dialog
      .getByRole('button', { name: 'Save product', exact: true })
      .click()
    await expect(dialog).toHaveCount(0)
    await page.reload({ waitUntil: 'networkidle' })
    await page
      .getByRole('article')
      .first()
      .getByRole('button', { name: /Actions for/ })
      .click()
    await page.getByRole('menuitem', { name: 'Edit pricing' }).click()
    await expect(
      dialog.getByRole('combobox', { name: 'Product category', exact: true }),
    ).toHaveValue('gifts')
    await dialog
      .getByRole('button', { name: 'Manage categories', exact: true })
      .click()
    await dialog
      .getByRole('button', { name: 'Edit Gift boxes', exact: true })
      .click()
    await dialog
      .getByLabel('Category name', { exact: true })
      .fill('Market gifts')
    await dialog
      .getByRole('button', { name: 'Save category', exact: true })
      .click()
    await expect(
      dialog.getByRole('combobox', { name: 'Product category', exact: true }),
    ).toHaveValue('gifts')
    await expect(
      dialog.getByRole('option', { name: 'Market gifts · Non-food' }),
    ).toHaveCount(1)
    await page.screenshot({
      path: `/tmp/product-categories-${width}.png`,
      fullPage: true,
    })
    const overflow = await dialog.evaluate(
      (el) => el.scrollWidth - el.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(1)
    await dialog
      .getByRole('button', { name: 'Save product', exact: true })
      .click()
    expect(workspace.products.find((p) => p.id === productId)?.taxStatus).toBe(
      'exempt',
    )
    await page.goto(workspaceFixtureUrl('Settings/Taxes'), {
      waitUntil: 'networkidle',
    })
    const tax = page.getByRole('region', {
      name: 'Category-based tax settings',
    })
    await tax
      .getByRole('combobox', {
        name: 'Non-food configured tax treatment',
        exact: true,
      })
      .selectOption('state')
    await expect(
      tax.getByRole('button', { name: 'Save category tax mappings' }),
    ).toBeDisabled()
    await tax
      .getByRole('checkbox', {
        name: /Confirm mapping changes for 1 linked products/,
      })
      .check()
    await tax
      .getByRole('button', { name: 'Save category tax mappings' })
      .click()
    await expect(tax.getByText('Category tax mappings saved.')).toBeVisible()
    await page.reload({ waitUntil: 'networkidle' })
    await expect(
      page
        .getByRole('region', { name: 'Category-based tax settings' })
        .getByRole('button', { name: 'Remove Configured state treatment' }),
    ).toHaveCount(2)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1)
  })
}
