import { expect, test, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { demoData } from '../src/lib/demo'
import { itemDeletionBlockers } from '../src/lib/item-deletion'
import { productSortOptions, sortProducts } from '../src/lib/product-list'
import type { Item } from '../src/lib/domain'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

async function fixture(page: Page) {
  await installWorkspaceFixture(page)
  const w = demoData()
  const base: Item = {
    id: 'base',
    name: 'Base',
    workflow: 'resale',
    quantity: 0,
    cost: 2,
    stockCostKnown: true,
    price: 9,
    taxStatus: 'exempt',
    status: 'active',
  }
  w.products = [
    { ...base, id: 'maple', name: 'Maple', price: 100 },
    { ...base, id: 'birch', name: 'Birch', price: 9 },
    {
      ...base,
      id: 'missing',
      name: 'Alder incomplete',
      workflow: 'food',
      cost: undefined,
      price: null,
    },
    {
      ...base,
      id: 'handmade',
      name: 'Cedar handmade',
      workflow: 'handmade',
      recipeId: '',
      bom: {
        lines: [],
        output: 1,
        laborMinutes: 0,
        laborRate: 0,
        overhead: 0,
        scrapPercent: 0,
      },
    },
    {
      ...base,
      id: 'kit',
      name: 'Elm kit',
      workflow: 'kit',
      components: [{ productId: 'birch', quantity: 1 }],
      packagingLines: [],
      assemblyMinutes: 0,
      assemblyRate: 0,
    },
  ]
  w.ingredients.push({
    ...w.ingredients[0],
    id: 'unused-ingredient',
    name: 'Unused safflower',
    quantity: 0,
    threshold: 0,
  })
  w.recipes.push({
    ...w.recipes[0],
    id: 'unused-recipe',
    name: 'Unused test prep',
  })
  w.settings[0].productCategories = [
    {
      id: 'test-category',
      name: 'Fixture category',
      active: true,
      scope: 'resale-products',
      classification: 'non_food',
    },
  ]
  w.products[0].productCategoryId = 'test-category'
  const deletes: string[] = []
  let failNext = false
  await page.route('**/api/workspace*', async (route) => {
    if (route.request().url().includes('Categories'))
      return route.fulfill({
        json: {
          categories: w.settings[0].productCategories,
          products: w.products,
          recipes: w.recipes,
          revision: 1,
          mappings: {},
          rates: [],
        },
      })
    if (route.request().method() === 'POST') {
      const { action, table, data } = route.request().postDataJSON()
      if (action === 'ingredientUpdate') {
        const row = w.ingredients.find((item) => item.id === data.id)!
        Object.assign(row, data)
      }
      if (action === 'pantryView')
        w.settings[0][
          data.page === 'products'
            ? 'currentProductsView'
            : data.page === 'recipes'
              ? 'currentRecipesView'
              : 'currentPantryView'
        ] = data.view
      if (action === 'itemDeleteCheck') {
        const item = w[table].find((r: Item) => r.id === data.id)!
        return route.fulfill({
          json: { item, blockers: itemDeletionBlockers(w, table, item) },
        })
      }
      if (action === 'itemDelete') {
        deletes.push(data.id)
        await new Promise((resolve) => setTimeout(resolve, 150))
        if (failNext) {
          failNext = false
          return route.fulfill({
            status: 409,
            json: { error: 'A linked order was added. Review dependencies.' },
          })
        }
        w[table] = w[table].filter((r: Item) => r.id !== data.id)
      }
    }
    return route.fulfill({
      json: { workspace: w, role: 'Owner', demo: false },
    })
  })
  return {
    w,
    deletes,
    fail: () => {
      failNext = true
    },
  }
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true)
}
for (const width of [1440, 1280, 768, 390]) {
  test(`product summaries, all sorts, view parity and responsive actions ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 950 })
    const { w } = await fixture(page)
    await page.goto(workspaceFixtureUrl('Products/All Products'))
    const summaries = page.getByRole('group', {
      name: 'Product summaries before search and category filters',
    })
    await expect(summaries).toBeVisible()
    await expect(summaries).toContainText('Total products5')
    await expect(summaries).toContainText('Food products1')
    await expect(summaries).toContainText('Handmade products1')
    await expect(summaries).toContainText('Resale: 2Kits: 1')
    expect(
      await summaries.evaluate(
        (el) => getComputedStyle(el).gridTemplateColumns.split(' ').length,
      ),
    ).toBe(width >= 1024 ? 4 : 2)
    const toggle = page.getByRole('group', { name: 'Products display' })
    for (const [sort] of productSortOptions) {
      await page.getByLabel('Sort products', { exact: true }).selectOption(sort)
      const expected = sortProducts(w.products, w, sort).map((p) => p.name)
      await expect(page.locator('.product-card .pantry-card-title')).toHaveText(
        expected,
      )
      await toggle.getByRole('button', { name: 'Table', exact: true }).click()
      await expect(
        page.locator('.catalog-table-region tbody tr td:first-child button'),
      ).toHaveText(expected)
      await toggle.getByRole('button', { name: 'Cards', exact: true }).click()
      await expect(
        page.getByLabel('Sort products', { exact: true }),
      ).toHaveValue(sort)
    }
    await page.getByLabel('Search products', { exact: true }).fill('Maple')
    await expect(page.locator('.products-toolbar')).toContainText(
      '1 of 5 products',
    )
    await expect(summaries).toContainText('Total products5')
    await page
      .getByLabel('Filter by category', { exact: true })
      .selectOption('test-category')
    await toggle.getByRole('button', { name: 'Table', exact: true }).click()
    await expect(page.locator('.catalog-table-region tbody tr')).toHaveCount(1)
    await expect(
      page.getByLabel('Search products', { exact: true }),
    ).toHaveValue('Maple')
    await expect(page.getByLabel('Sort products', { exact: true })).toHaveValue(
      'margin-desc',
    )
    const label = page
      .getByRole('button', { name: 'Export products', exact: true })
      .locator('.responsive-action-label')
    if (width >= 1024) await expect(label).toBeVisible()
    else await expect(label).toBeHidden()
    await noOverflow(page)
    if (width === 1440 || width === 390) {
      await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, {
        timeout: 10000,
      })
      await mkdir('docs/reviews/products-item-actions', { recursive: true })
      await page.screenshot({
        path: `docs/reviews/products-item-actions/products-table-${width}.png`,
        fullPage: true,
      })
      await toggle.getByRole('button', { name: 'Cards', exact: true }).click()
      await page.getByLabel('Search products', { exact: true }).fill('')
      await page
        .getByLabel('Filter by category', { exact: true })
        .selectOption('all')
      await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, {
        timeout: 10000,
      })
      await page.screenshot({
        path: `docs/reviews/products-item-actions/products-cards-${width}.png`,
        fullPage: true,
      })
      if (width === 1440) {
        // Desktop Chromium page zoom approximation; screenshots were not available
        // to infer an exact supplied zoom factor. Normal 100% is checked above.
        const session = await page.context().newCDPSession(page)
        await session.send('Emulation.setDeviceMetricsOverride', {
          width: 1920,
          height: 1267,
          deviceScaleFactor: 0.75,
          mobile: false,
        })
        await noOverflow(page)
        await page.screenshot({
          path: 'docs/reviews/products-item-actions/products-wide-75-percent-emulation.png',
          fullPage: true,
        })
      }
    }
  })
}
for (const width of [1440, 768, 390]) {
  test(`ingredient tabs, editor labels and confirmed deletion ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    const f = await fixture(page)
    await page.goto(workspaceFixtureUrl('Inventory/Ingredients'))
    await page
      .getByRole('button', { name: 'Unused safflower', exact: true })
      .click()
    const detail = page.getByRole('dialog').filter({
      has: page.getByRole('tablist', { name: 'Ingredient detail sections' }),
    })
    await expect(
      detail.getByRole('tab', { name: 'Inventory', exact: true }),
    ).toHaveAttribute('aria-selected', 'true')
    await mkdir('docs/reviews/products-item-actions', { recursive: true })
    if (width !== 768)
      await page.screenshot({
        path: `docs/reviews/products-item-actions/ingredient-tabs-${width}.png`,
      })
    const body = detail.locator('.ingredient-detail-body')
    await expect(body).toBeVisible()
    expect(
      await detail.evaluate((el) => el.scrollHeight <= el.clientHeight + 2),
    ).toBe(true)
    expect(
      await detail.evaluate(
        (el) => el.getBoundingClientRect().width <= innerWidth,
      ),
    ).toBe(true)
    await body.evaluate((el) => {
      el.scrollTop = el.scrollHeight
    })
    if (width !== 768)
      await page.screenshot({
        path: `docs/reviews/products-item-actions/ingredient-tabs-bottom-${width}.png`,
      })
    for (const name of [
      'Purchasing',
      'How this is calculated',
      'Ingredients & Allergens',
      'Identification & notes',
      'Inventory',
    ]) {
      await detail.getByRole('tab', { name, exact: true }).click()
      await expect(detail.getByRole('tabpanel')).toBeVisible()
    }
    await detail.getByRole('tab', { name: 'Inventory', exact: true }).focus()
    await page.keyboard.press('ArrowRight')
    await expect(
      detail.getByRole('tab', { name: 'Purchasing', exact: true }),
    ).toBeFocused()
    await detail
      .getByRole('button', { name: 'Edit Ingredient', exact: true })
      .click()
    const nav = page.getByRole('tablist', {
      name: 'Ingredient editor sections',
    })
    await expect(nav).toBeVisible()
    const navLabel = nav
      .getByRole('tab', { name: 'Details & Costing', exact: true })
      .locator('.responsive-action-label')
    if (width >= 1024) await expect(navLabel).toBeVisible()
    else await expect(navLabel).toBeHidden()
    if (width !== 768)
      await page.screenshot({
        path: `docs/reviews/products-item-actions/ingredient-editor-${width}.png`,
      })
    await page
      .getByRole('button', { name: 'Delete Unused safflower', exact: true })
      .click()
    const confirm = page.getByRole('dialog', {
      name: 'Delete Unused safflower?',
    })
    await expect(confirm).toContainText('No blocking dependencies')
    await confirm.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(nav).toBeVisible()
    expect(f.deletes).toHaveLength(0)
    await page
      .getByRole('button', { name: 'Delete Unused safflower', exact: true })
      .click()
    await expect(confirm).toContainText('No blocking dependencies')
    await confirm
      .getByRole('button', { name: 'Delete', exact: true })
      .click({ clickCount: 2 })
    await expect(confirm).not.toBeVisible()
    expect(f.deletes).toEqual(['unused-ingredient'])
    await noOverflow(page)
    await page.reload()
    await page.getByRole('button', { name: 'Bread flour', exact: true }).click()
    const linked = page.getByRole('dialog').filter({
      has: page.getByRole('tablist', { name: 'Ingredient detail sections' }),
    })
    await expect(
      linked.getByRole('tab', { name: 'Inventory', exact: true }),
    ).toHaveAttribute('aria-selected', 'true')
    await linked.getByRole('button', { name: /^Delete / }).click()
    const blocked = page.getByRole('dialog', { name: /^Delete / }).last()
    await expect(
      blocked.getByRole('region', { name: 'Deletion blockers' }),
    ).toBeVisible()
    await expect(
      blocked.getByRole('button', { name: 'Delete', exact: true }),
    ).toBeDisabled()
    await blocked.getByRole('button', { name: 'Cancel', exact: true }).click()
  })
}
test('product failure preserves item; retry deletion and recipe deletion refresh both views', async ({
  page,
}) => {
  const f = await fixture(page)
  await page.goto(workspaceFixtureUrl('Products/All Products'))
  await page.getByRole('button', { name: 'Delete Maple', exact: true }).click()
  const confirmation = page.getByRole('dialog', { name: 'Delete Maple?' })
  await expect(confirmation).toContainText('No blocking dependencies')
  f.fail()
  await confirmation
    .getByRole('button', { name: 'Delete', exact: true })
    .click()
  await expect(confirmation.getByRole('alert')).toContainText('linked order')
  await confirmation
    .getByRole('button', { name: 'Cancel', exact: true })
    .click()
  await expect(
    page.getByRole('button', { name: 'Maple', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Delete Maple', exact: true }).click()
  await expect(confirmation).toContainText('No blocking dependencies')
  await confirmation
    .getByRole('button', { name: 'Delete', exact: true })
    .click()
  await expect(page.locator('.product-summaries')).toContainText(
    'Total products4',
  )
  await page.getByRole('button', { name: 'Table', exact: true }).click()
  await expect(page.locator('.catalog-table-region tbody tr')).toHaveCount(4)
  await page.goto(workspaceFixtureUrl('Production/Recipes & Designs'))
  await page
    .getByRole('button', { name: 'Delete Unused test prep', exact: true })
    .click()
  const recipeConfirm = page.getByRole('dialog', {
    name: 'Delete Unused test prep?',
  })
  await expect(recipeConfirm).toContainText('No blocking dependencies')
  await recipeConfirm
    .getByRole('button', { name: 'Delete', exact: true })
    .click()
  await expect(
    page.getByRole('button', { name: 'Delete Unused test prep', exact: true }),
  ).toHaveCount(0)
})

for (const width of [1440, 768, 390]) {
  test(`separate photos and ingredient declarations ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    const f = await fixture(page)
    const item = f.w.ingredients.find((row) => row.id === 'unused-ingredient')!
    Object.assign(item, {
      statement: 'Safflower oil',
      subingredients: 'Safflower seeds',
      sourceContains: 'Supplier contains: sesame',
      sourceMayContain: 'Shared facility: milk',
      allergens: ['Sesame'],
      reviewed: true,
      imageAssetId: 'test-photo',
    })
    f.w.graphic_assets = []
    f.w.graphic_assets.push({
      id: 'test-photo',
      name: 'Synthetic photo',
      fileUrl:
        'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="20" height="20"/%3E',
    })
    await page.goto(workspaceFixtureUrl('Inventory/Ingredients'))
    await page
      .getByRole('button', { name: 'Unused safflower', exact: true })
      .click()
    const dialog = page.getByRole('dialog').filter({
      has: page.getByRole('tablist', { name: 'Ingredient detail sections' }),
    })
    await expect(
      dialog.getByRole('tab', { name: 'Inventory', exact: true }),
    ).toHaveAttribute('aria-selected', 'true')
    await dialog
      .getByRole('tab', { name: 'Ingredients & Allergens', exact: true })
      .click()
    await expect(dialog.getByRole('tabpanel')).toContainText('Safflower seeds')
    await expect(dialog.getByRole('tabpanel')).toContainText(
      'Shared facility: milk',
    )
    await dialog
      .getByRole('button', { name: 'Edit Ingredient', exact: true })
      .click()
    const nav = page.getByRole('tablist', {
      name: 'Ingredient editor sections',
    })
    const declarations = nav.getByRole('tab', {
      name: 'Ingredients & Allergens',
      exact: true,
    })
    await declarations.click()
    const label = declarations.locator('.responsive-action-label')
    if (width >= 1024) await expect(label).toBeVisible()
    else await expect(label).toBeHidden()
    await expect(
      page.getByLabel('Ingredient statement name', { exact: true }),
    ).toHaveValue('Safflower oil')
    await expect(
      page.getByRole('textbox', {
        name: 'Source Contains statement',
        exact: true,
      }),
    ).toHaveValue('Supplier contains: sesame')
    await page
      .getByRole('textbox', { name: 'Subingredients text', exact: true })
      .fill('Updated safflower seeds')
    await page
      .getByRole('textbox', {
        name: 'Source May contain / facility statement',
        exact: true,
      })
      .fill('Updated facility: milk')
    await nav.getByRole('tab', { name: 'Photos', exact: true }).click()
    await expect(
      page.getByRole('textbox', { name: 'Subingredients text', exact: true }),
    ).toBeHidden()
    await expect(
      page.getByRole('button', { name: 'Remove photo', exact: true }),
    ).toBeVisible()
    await page
      .getByRole('button', { name: 'Remove photo', exact: true })
      .click()
    await declarations.click()
    await expect(
      page.getByRole('textbox', { name: 'Subingredients text', exact: true }),
    ).toHaveValue('Updated safflower seeds')
    await expect(
      page.getByRole('textbox', {
        name: 'Source May contain / facility statement',
        exact: true,
      }),
    ).toHaveValue('Updated facility: milk')
    await page.keyboard.press('ArrowLeft')
    await expect(
      nav.getByRole('tab', { name: 'Photos', exact: true }),
    ).toBeFocused()
    await declarations.click()
    const shell = page.getByRole('dialog', {
      name: 'Edit Ingredient',
      exact: true,
    })
    expect(
      await shell.evaluate((el) => el.scrollHeight <= el.clientHeight + 2),
    ).toBe(true)
    const middle = shell.locator('.ingredient-detail-body')
    await middle.evaluate((el) => {
      el.scrollTop = el.scrollHeight
    })
    await expect(
      page.getByRole('checkbox', {
        name: 'Supplier ingredient and allergen information reviewed',
      }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Save changes', exact: true }),
    ).toBeInViewport()
    await middle.evaluate((el) => {
      el.scrollTop = 0
    })
    await noOverflow(page)
    await page.screenshot({
      path: `docs/reviews/products-item-actions/ingredients-allergens-editor-${width}.png`,
    })
    await page
      .getByRole('button', { name: 'Save changes', exact: true })
      .click()
    await expect(nav).toBeHidden()
    expect(item.imageAssetId).toBe('')
    expect(item.subingredients).toBe('Updated safflower seeds')
    expect(item.allergens).toEqual(['Sesame'])
    await page.reload()
    await page
      .getByRole('button', { name: 'Unused safflower', exact: true })
      .click()
    await expect(
      dialog.getByRole('tab', { name: 'Inventory', exact: true }),
    ).toHaveAttribute('aria-selected', 'true')
    await dialog
      .getByRole('tab', { name: 'Ingredients & Allergens', exact: true })
      .click()
    await expect(dialog.getByRole('tabpanel')).toContainText(
      'Updated safflower seeds',
    )
    await expect(dialog.getByRole('tabpanel')).toContainText(
      'Updated facility: milk',
    )
    await dialog
      .getByRole('button', { name: 'Edit Ingredient', exact: true })
      .click()
    await nav.getByRole('tab', { name: 'Photos', exact: true }).click()
    await expect(
      page.getByRole('button', { name: 'Remove photo', exact: true }),
    ).toBeHidden()
    await noOverflow(page)
  })
}
