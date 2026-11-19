import { test, expect } from '@playwright/test'
import { demoData } from '../src/lib/demo'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

test('rendered product categories preserve legacy choices, section boundaries and reloads', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await installWorkspaceFixture(page)
  const w = demoData()
  const categories = [
    {
      id: 'legacy',
      name: 'Legacy shared category',
      classification: 'non_food',
    },
    {
      id: 'food',
      name: 'Food section category',
      classification: 'food',
      scope: 'food-products',
    },
    {
      id: 'craft',
      name: 'Craft section category',
      classification: 'non_food',
      scope: 'handmade-products',
    },
    {
      id: 'old',
      name: 'Archived category',
      classification: 'food',
      active: false,
    },
  ]
  w.settings[0].productCategories = categories
  let mode = 'loading'
  let selectedId: string | undefined
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/workspace*', async (route) => {
    if (route.request().url().includes('productCategories')) {
      if (mode === 'loading') await gate
      if (route.request().method() === 'POST') {
        const input = route.request().postDataJSON()
        expect(input.operation).toBe('saveCategory')
        selectedId = 'new-craft'
        categories.push({ ...input.category, id: selectedId })
      }
      if (mode === 'error')
        return route.fulfill({
          status: 503,
          json: { error: 'Categories temporarily unavailable' },
        })
      return route.fulfill({
        json: {
          categories: mode === 'empty' ? [] : categories,
          products: w.products,
          revision: 1,
          selectedId,
          mappings: {},
          rates: [],
        },
      })
    }
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON()
      if (body.action === 'save' && body.table === 'products') {
        body.data.id ||= 'isolated-product'
        const index = w.products.findIndex((p) => p.id === body.data.id)
        if (index < 0) w.products.push(body.data)
        else w.products[index] = body.data
      }
    }
    return route.fulfill({
      json: { workspace: w, role: 'Owner', demo: false },
    })
  })
  await page.goto(workspaceFixtureUrl('Products/Food'))
  await page
    .getByRole('button', { name: /Create food product/ })
    .first()
    .click()
  const combo = page.getByRole('combobox', {
    name: 'Product category',
    exact: true,
  })
  await expect(
    page.getByRole('status').filter({ hasText: 'Loading product categories' }),
  ).toBeVisible()
  await expect(combo).toBeDisabled()
  mode = 'ready'
  release()
  await expect(combo).toBeEnabled()
  await combo.click()
  await expect(
    page.getByRole('option', {
      name: 'Legacy shared category · Non-food',
      exact: true,
    }),
  ).toBeVisible()
  await expect(
    page.getByRole('option', {
      name: 'Food section category · Food',
      exact: true,
    }),
  ).toBeVisible()
  await expect(
    page.getByRole('option', { name: /Craft section|Archived category/ }),
  ).toHaveCount(0)
  await page
    .getByRole('option', {
      name: 'Legacy shared category · Non-food',
      exact: true,
    })
    .click()
  await page
    .getByLabel('Product name', { exact: true })
    .fill('Isolated category loaf')
  await page
    .getByRole('button', { name: /Create Product/i, exact: true })
    .click()
  await expect
    .poll(
      () =>
        w.products.find((p) => p.name === 'Isolated category loaf')
          ?.productCategoryId,
    )
    .toBe('legacy')
  await page.reload()
  await page
    .getByText('Isolated category loaf', { exact: true })
    .first()
    .click()
  await page.getByRole('button', { name: /Edit product/i, exact: true }).click()
  await expect(combo).toHaveValue('Legacy shared category · Non-food')
  await combo.click()
  await page
    .getByRole('option', { name: 'Food section category · Food', exact: true })
    .click()
  await page.getByRole('button', { name: /Save changes/i, exact: true }).click()
  await expect
    .poll(
      () =>
        w.products.find((p) => p.name === 'Isolated category loaf')
          ?.productCategoryId,
    )
    .toBe('food')
  await page.reload()
  await page
    .getByText('Isolated category loaf', { exact: true })
    .first()
    .click()
  await page.getByRole('button', { name: /Edit product/i, exact: true }).click()
  await expect(combo).toHaveValue('Food section category · Food')
  await combo.scrollIntoViewIfNeeded()
  await combo.click()
  await page.screenshot({
    path: '.netlify/screenshots/product-categories-edit.png',
  })
  await combo.press('Escape')

  // Unavailable and inactive assignments stay explicit and retain the same ID.
  categories.find((c) => c.id === 'food')!.active = false
  await page.reload()
  await page
    .getByText('Isolated category loaf', { exact: true })
    .first()
    .click()
  await page.getByRole('button', { name: /Edit product/i, exact: true }).click()
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'Your saved category is inactive' }),
  ).toBeVisible()
  categories.splice(
    categories.findIndex((c) => c.id === 'food'),
    1,
  )
  await page.reload()
  await page
    .getByText('Isolated category loaf', { exact: true })
    .first()
    .click()
  await page.getByRole('button', { name: /Edit product/i, exact: true }).click()
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'Your saved category is unavailable' }),
  ).toBeVisible()
  expect(
    w.products.find((p) => p.name === 'Isolated category loaf')
      ?.productCategoryId,
  ).toBe('food')
  mode = 'empty'
  await page.reload()
  await page
    .getByRole('button', { name: /Create food product/ })
    .first()
    .click()
  await expect(
    page.getByText('No active product categories configured for this section.'),
  ).toBeVisible()
  mode = 'error'
  await page.reload()
  await page
    .getByRole('button', { name: /Create food product/ })
    .first()
    .click()
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'Could not load product categories' }),
  ).toBeVisible()
  await expect(
    page.getByText('No active product categories configured for this section.'),
  ).toHaveCount(0)
  await expect(combo).toBeDisabled()
  mode = 'ready'
  await page
    .getByRole('button', { name: 'Retry category list', exact: true })
    .click()
  await expect(combo).toBeEnabled()
  await page.goto(workspaceFixtureUrl('Handmade/Products'))
  await page
    .getByRole('button', { name: 'Create handmade product', exact: true })
    .click()
  await expect(combo).toBeEnabled()
  await combo.click()
  await expect(
    page.getByRole('option', {
      name: 'Craft section category · Non-food',
      exact: true,
    }),
  ).toBeVisible()
  await expect(
    page.getByRole('option', {
      name: 'Legacy shared category · Non-food',
      exact: true,
    }),
  ).toBeVisible()
  await page
    .getByRole('option', {
      name: 'Craft section category · Non-food',
      exact: true,
    })
    .click()
  await expect(combo).toHaveValue('Craft section category · Non-food')

  await page.getByRole('button', { name: 'Add category', exact: true }).click()
  await page
    .getByLabel('Category name', { exact: true })
    .fill('New isolated craft group')
  await page
    .getByLabel('Classification', { exact: true })
    .selectOption('non_food')
  await page.getByRole('button', { name: 'Save category', exact: true }).click()
  await expect(combo).toHaveValue('New isolated craft group · Non-food')
  await page.goto(workspaceFixtureUrl('Settings/Taxes'))
  await page.getByRole('button', { name: 'Add tax rate', exact: true }).click()
  await page.locator('.tax-rate-editor summary').last().click()
  await page
    .getByRole('combobox', { name: 'Applies to', exact: true })
    .last()
    .selectOption('classification')
  const classification = page.getByRole('combobox', {
    name: 'Classification',
    exact: true,
  })
  await classification.selectOption('non_food')
  await expect(classification).toHaveValue('non_food')
  await expect(
    classification.getByRole('option', { name: 'Non-food', exact: true }),
  ).toHaveCount(1)
  await expect(
    classification.getByRole('option', {
      name: 'New isolated craft group',
      exact: true,
    }),
  ).toHaveCount(0)

  // A different business response replaces the available list completely.
  categories.splice(0, categories.length, {
    id: 'business-b-category',
    name: 'Other business category',
    classification: 'food',
    scope: 'food-products',
  })
  w.settings[0] = {
    ...w.settings[0],
    id: 'business-b',
    name: 'Isolated second business',
    productCategories: categories,
  }
  w.products = []
  await page.goto(workspaceFixtureUrl('Products/Food'))
  await page
    .getByRole('button', { name: /Create food product/ })
    .first()
    .click()
  await expect(combo).toBeEnabled()
  await combo.click()
  await expect(
    page.getByRole('option', {
      name: 'Other business category · Food',
      exact: true,
    }),
  ).toBeVisible()
  await expect(
    page.getByRole('option', {
      name: /Legacy shared category|Craft section category|New isolated craft group/,
    }),
  ).toHaveCount(0)
})
