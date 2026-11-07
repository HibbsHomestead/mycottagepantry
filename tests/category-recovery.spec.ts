import { expect, test } from '@playwright/test'
import { demoData } from '../src/lib/demo'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

for (const width of [1440, 390]) {
  test(`category retry preserves edits and tax settings; creation survives reopening (${width})`, async ({
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
        jurisdiction: 'Test jurisdiction',
        ratePercent: 5,
        behavior: 'exclusive',
      },
    ]
    business.categoryTaxMappings = { food: ['state'], non_food: [] }
    business.categoryConfigRevision = 1
    workspace.products[0].productCategoryId = 'bread'
    const originalTaxes = JSON.stringify({
      rates: business.taxRates,
      mappings: business.categoryTaxMappings,
    })
    let failLoad = true
    let failSave = true
    let categoryGets = 0
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.route('**/api/workspace*', async (route) => {
      const request = route.request()
      if (!request.url().includes('productCategories'))
        return route.fulfill({
          json: { workspace, role: 'Owner', demo: false },
        })
      if (request.method() === 'GET') {
        categoryGets++
        if (failLoad)
          return route.fulfill({
            status: 503,
            json: {
              error: 'Simulated service failure',
              code: 'WORKSPACE_REQUEST_FAILED',
            },
          })
      } else {
        if (failSave)
          return route.fulfill({
            status: 400,
            json: {
              error: 'Simulated save failure',
              code: 'WORKSPACE_REQUEST_FAILED',
            },
          })
        const payload = request.postDataJSON()
        expect(payload.operation).toBe('saveCategory')
        expect(payload.expectedRevision).toBe(business.categoryConfigRevision)
        business.productCategories.push({ ...payload.category, id: 'gifts' })
        business.categoryConfigRevision++
      }
      return route.fulfill({
        json: {
          categories: business.productCategories,
          products: workspace.products,
          rates: business.taxRates,
          mappings: business.categoryTaxMappings,
          revision: business.categoryConfigRevision,
          selectedId: 'gifts',
        },
      })
    })
    await page.goto(workspaceFixtureUrl('Products/Categories'))
    const manager = page.getByRole('region', {
      name: 'Product Categories',
      exact: true,
    })
    const add = manager.getByRole('button', {
      name: 'Add Category',
      exact: true,
    })
    await expect(manager.getByRole('alert')).toContainText('HTTP 503')
    await expect(add).toBeDisabled()
    await expect(
      manager.getByText('No product categories yet', { exact: true }),
    ).toHaveCount(0)
    failLoad = false
    await manager.getByRole('button', { name: 'Retry category list' }).click()
    await expect(add).toBeEnabled()
    await expect(manager.getByRole('alert')).toHaveCount(0)
    await manager
      .getByText('Tax Settings · Food / Non-food mappings', { exact: true })
      .click()
    const tax = manager.getByRole('region', {
      name: 'Category-based tax settings',
    })
    await tax
      .getByRole('combobox', {
        name: 'Non-food configured tax treatment',
        exact: true,
      })
      .selectOption('state')
    await add.click()
    await manager
      .getByLabel('Category name', { exact: true })
      .fill('Gift boxes')
    await manager
      .getByRole('combobox', { name: 'Classification', exact: true })
      .selectOption('non_food')
    await manager
      .getByRole('button', { name: 'Save category', exact: true })
      .click()
    await expect(manager.getByRole('alert')).toContainText(
      'Simulated save failure',
    )
    failLoad = true
    await manager.getByRole('button', { name: 'Retry category list' }).click()
    await expect(manager.getByRole('alert')).toContainText('HTTP 503')
    await expect(
      manager.getByLabel('Category name', { exact: true }),
    ).toHaveValue('Gift boxes')
    await expect(
      tax.getByRole('button', { name: 'Remove Configured state treatment' }),
    ).toHaveCount(2)
    await expect(
      manager.getByRole('heading', { name: 'Bread', exact: true }),
    ).toBeVisible()
    await expect(add).toBeDisabled()
    await page.screenshot({
      path: `docs/previews/category-recovery-failure-${width}.png`,
      fullPage: true,
    })
    failLoad = false
    await manager.getByRole('button', { name: 'Retry category list' }).click()
    await expect(manager.getByRole('alert')).toHaveCount(0)
    await expect(
      manager.getByLabel('Category name', { exact: true }),
    ).toHaveValue('Gift boxes')
    await expect(
      tax.getByRole('button', { name: 'Remove Configured state treatment' }),
    ).toHaveCount(2)
    failSave = false
    await manager
      .getByRole('button', { name: 'Save category', exact: true })
      .click()
    await expect(
      manager.getByRole('heading', { name: 'Gift boxes', exact: true }),
    ).toBeVisible()
    expect(categoryGets).toBe(4)
    expect(
      JSON.stringify({
        rates: business.taxRates,
        mappings: business.categoryTaxMappings,
      }),
    ).toBe(originalTaxes)
    expect(workspace.products[0].productCategoryId).toBe('bread')
    await page.goto(workspaceFixtureUrl('Dashboard'))
    await page.goto(workspaceFixtureUrl('Products/Categories'))
    await expect(
      manager.getByRole('heading', { name: 'Gift boxes', exact: true }),
    ).toBeVisible()
    await page.screenshot({
      path: `docs/previews/category-recovery-success-${width}.png`,
      fullPage: true,
    })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1)
    expect(pageErrors).toEqual([])
  })
}
