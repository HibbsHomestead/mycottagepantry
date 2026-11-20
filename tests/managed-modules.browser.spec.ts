import { test, expect, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { demoData } from '../src/lib/demo'
import { sectionCategories, pantrySectionCategories } from '../src/lib/section-categories'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

async function fixture(page: Page) {
  await installWorkspaceFixture(page)
  page.on('pageerror', (error) =>
    console.log('Fixture browser error:', error.message),
  )
  const w = demoData()
  w.settings[0].pantryCategories = [
    {
      id: 'isolated-current',
      name: 'Fixture managed category',
      scope: 'food-ingredients',
      active: true,
    },
  ]
  w.settings[0].productCategories = [
    {
      id: 'resale-current',
      name: 'Fixture resale category',
      scope: 'resale-products',
      active: true,
    },
    {
      id: 'craft-current',
      name: 'Fixture craft category',
      scope: 'handmade-products',
      active: true,
    },
  ]
  w.ingredients[0] = {
    ...w.ingredients[0],
    sectionCategoryId: 'isolated-current',
    categoryId: 'isolated-current',
    category: 'Fixture managed category',
    usedAs: 'ingredient',
  }
  w.products.push({
    id: 'resale-fixture',
    name: 'Fixture resale item',
    workflow: 'resale',
    quantity: 3,
    cost: 4,
    price: 8,
    stockCostKnown: true,
    sellUnit: 'item',
    productCategoryId: 'resale-current',
  })
  w.products.push({
    id: 'craft-fixture',
    name: 'Fixture handmade item',
    workflow: 'handmade',
    quantity: 0,
    price: 12,
    productCategoryId: 'craft-current',
  })
  let fail = false
  let revision = 1
  let selectedId: string | undefined
  await page.route('**/api/workspace*', async (route) => {
    const req = route.request()
    if (/pantryCategories|productCategories/.test(req.url())) {
      if (req.method() === 'POST') {
        const body = req.postDataJSON()
        if (body.operation === 'saveCategory') {
          const category = {
            ...body.category,
            id: body.category.id || 'created-isolated-category',
          }
          selectedId = category.id
          w.settings[0].pantryCategories = [
            ...w.settings[0].pantryCategories.filter(
              (c: { id: string }) => c.id !== category.id,
            ),
            category,
          ]
          revision++
        }
      }
      return route.fulfill({
        status: fail ? 503 : 200,
        json: {
          categories: req.url().includes('pantryCategories')
            ? pantrySectionCategories(w)
            : w.settings[0].productCategories,
          revision,
          selectedId,
        },
      })
    }
    if (req.method() === 'POST') {
      const body = req.postDataJSON()
      if (body.action === 'save' && body.table === 'ingredients')
        w.ingredients.push({
          ...body.data,
          quantity: 0,
          cost: 0,
          currentCost: 0,
          needsCostSetup: true,
          allergens: [],
          conversions: [],
        })
    }
    return route.fulfill({
      json: { workspace: w, role: 'Owner', demo: false },
    })
  })
  return {
    w,
    fail: (v: boolean) => {
      fail = v
    },
  }
}
for (const width of [1440, 768, 390]) {
  test(`managed Add categories and dedicated modules at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 950 })
    const { w } = await fixture(page)
    await page.goto(workspaceFixtureUrl('Inventory/Ingredients'))
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.getByRole('button', { name: 'Add item', exact: true }).click()
    const dialog = page.getByRole('dialog')
    const category = dialog.getByRole('combobox', {
      name: 'Category',
      exact: true,
    })
    await expect(category).toBeEnabled()
    expect(await category.locator('option').allTextContents()).toEqual([
      'Uncategorized',
      ...sectionCategories(w, 'food-ingredients')
        .filter((c) => c.active !== false)
        .map((c) => c.name),
    ])
    await category.selectOption('isolated-current')
    await dialog
      .getByLabel('Item name', { exact: true })
      .fill('Unsaved fixture name')
    await dialog.getByLabel('Item Type', { exact: true }).selectOption('resale')
    await expect(category).toBeEnabled()
    await expect(category.locator('option')).toHaveText([
      'Uncategorized',
      'Fixture resale category',
    ])
    await expect(category).toHaveValue('')
    await dialog
      .getByLabel('Item Type', { exact: true })
      .selectOption('ingredient')
    await expect(category).toHaveValue('isolated-current')
    await expect(dialog.getByLabel('Item name', { exact: true })).toHaveValue(
      'Unsaved fixture name',
    )
    await category.scrollIntoViewIfNeeded()
    await mkdir('docs/reviews/managed-modules', { recursive: true })
    await page.screenshot({
      path: `docs/reviews/managed-modules/add-ingredient-${width}.png`,
      fullPage: false,
    })
    page.on('dialog', (d) => d.accept())
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.goto(workspaceFixtureUrl('Resale/Items & Stock'))
    await expect(
      page.getByRole('navigation', { name: 'Resale sections' }),
    ).toBeVisible()
    await expect(
      page.getByRole('article', { name: 'Fixture resale item', exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('article', { name: 'Fixture handmade item', exact: true }),
    ).toHaveCount(0)
    await page.screenshot({
      path: `docs/reviews/managed-modules/resale-${width}.png`,
      fullPage: true,
    })
    await page
      .getByRole('group', { name: 'resale display' })
      .getByRole('button', { name: 'Table', exact: true })
      .click()
    await expect(
      page.getByRole('table').getByText('Fixture resale item', { exact: true }),
    ).toBeVisible()
    await page
      .getByRole('textbox', { name: 'Search resale items' })
      .fill('no fixture matches')
    await expect(page.getByText('0 of 1 items', { exact: true })).toBeVisible()
    await page.goto(workspaceFixtureUrl('Handmade/Materials & Supplies'))
    await expect(
      page.getByRole('navigation', { name: 'Handmade sections' }),
    ).toBeVisible()
    await page.screenshot({
      path: `docs/reviews/managed-modules/handmade-${width}.png`,
      fullPage: true,
    })
    for (const section of [
      'Products/All Products',
      'Production/Recipes & Designs',
    ]) {
      await page.goto(workspaceFixtureUrl(section))
      await page
        .locator('.item-record-actions')
        .first()
        .scrollIntoViewIfNeeded()
      const labels = page
        .locator('.item-record-actions')
        .first()
        .locator('.responsive-action-label')
      if (width > 1023) await expect(labels.first()).toBeVisible()
      else await expect(labels.first()).toBeHidden()
      await page.screenshot({
        path: `docs/reviews/managed-modules/${section.startsWith('Products') ? 'products' : 'recipes'}-actions-${width}.png`,
        fullPage: false,
      })
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
  })
}
test('category failure preserves draft and retry loads renamed managed names', async ({
  page,
}) => {
  const f = await fixture(page)
  f.fail(true)
  await page.goto(workspaceFixtureUrl('Inventory/Ingredients'))
  await page.getByRole('button', { name: 'Add item', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('alert')).toContainText(
    'Could not load current categories',
  )
  const category = dialog.getByRole('combobox', {
    name: 'Category',
    exact: true,
  })
  await expect(category).toBeDisabled()
  await expect(category.locator('option')).toHaveText(['Uncategorized'])
  await dialog
    .getByLabel('Item name', { exact: true })
    .fill('Preserved during retry')
  f.w.settings[0].pantryCategories[0].name = 'Renamed fixture managed category'
  f.fail(false)
  await dialog.getByRole('button', { name: 'Retry categories' }).click()
  await expect(category).toBeEnabled()
  await expect(
    category.locator('option', { hasText: 'Renamed fixture managed category' }),
  ).toHaveCount(1)
  await expect(dialog.getByLabel('Item name', { exact: true })).toHaveValue(
    'Preserved during retry',
  )
})

test('category management creation and rename are visible in Add, Save and Edit', async ({
  page,
}) => {
  await fixture(page)
  await page.goto(workspaceFixtureUrl('Inventory/Ingredients'))
  await page
    .getByRole('button', { name: 'Category actions', exact: true })
    .click()
  await page
    .getByRole('menuitem', { name: 'Add category', exact: true })
    .click()
  let dialog = page.getByRole('dialog')
  await dialog
    .getByLabel('Category name', { exact: true })
    .fill('Created isolated category')
  await dialog
    .getByRole('button', { name: 'Save category', exact: true })
    .click()
  await expect(dialog).toHaveCount(0)
  await page
    .getByRole('button', { name: 'Category actions', exact: true })
    .click()
  await page
    .getByRole('menuitem', { name: 'Manage categories', exact: true })
    .click()
  dialog = page.getByRole('dialog')
  await dialog
    .getByRole('button', {
      name: 'Edit Created isolated category',
      exact: true,
    })
    .click()
  await dialog
    .getByLabel('Category name', { exact: true })
    .fill('Renamed isolated category')
  await dialog
    .getByRole('button', { name: 'Save category', exact: true })
    .click()
  await dialog.getByRole('button', { name: 'Done', exact: true }).click()
  await page.getByRole('button', { name: 'Add item', exact: true }).click()
  dialog = page.getByRole('dialog')
  const category = dialog.getByRole('combobox', {
    name: 'Category',
    exact: true,
  })
  await expect(category).toBeEnabled()
  await category.selectOption('created-isolated-category')
  await expect(category.locator('option:checked')).toHaveText(
    'Renamed isolated category',
  )
  await dialog
    .getByLabel('Item name', { exact: true })
    .fill('Saved isolated category item')
  await dialog.getByRole('button', { name: 'Save item', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await page
    .getByRole('button', {
      name: 'Edit Saved isolated category item',
      exact: true,
    })
    .click()
  dialog = page.getByRole('dialog')
  await expect(
    dialog.getByRole('combobox', { name: 'Category', exact: true }),
  ).toHaveValue('created-isolated-category')
  await expect(
    dialog
      .getByRole('combobox', { name: 'Category', exact: true })
      .locator('option:checked'),
  ).toHaveText('Renamed isolated category')
})

for (const source of ['url', 'catalog'] as const) {
  test(`${source} populated Add preserves managed category and photo through refresh`, async ({
    page,
  }) => {
    const f = await fixture(page)
    f.w.graphic_assets = [
      {
        id: 'fixture-photo',
        name: 'Fixture pantry photo',
        fileUrl: '/fixture.png',
        originalName: 'Fixture pantry photo',
      },
    ]
    if (source === 'url') {
      await page.route('**/api/workspace?productImport*', (route) =>
        route.fulfill({
          json: {
            products: [
              {
                title: 'Isolated supplier item',
                imageUrl: '',
                fields: {
                  name: 'URL populated fixture',
                  brand: 'Fixture brand',
                  subingredients: 'Fixture supplier statement',
                },
                sourceUrl: 'https://example.org/fixture',
                checkedAt: '2026-11-20T00:00:00Z',
                warnings: [],
                conditions: [],
              },
            ],
          },
        }),
      )
    } else {
      await page.route('**/api/workspace?catalog*', (route) =>
        route.fulfill({
          json: {
            version: 1,
            results: [
              {
                id: 'catalog-fixture',
                revisionId: 'catalog-fixture-1',
                kind: 'ingredient',
                entryType: 'branded',
                fields: {
                  name: 'Catalog populated fixture',
                  brand: 'Fixture catalog brand',
                },
                status: 'active',
                reviewScope: 'Isolated catalog fixture',
                reviewedAt: '2026-11-20',
                sources: [],
              },
            ],
          },
        }),
      )
    }
    await page.goto(workspaceFixtureUrl('Inventory/Ingredients'))
    await page.getByRole('button', { name: 'Add item', exact: true }).click()
    const dialog = page.getByRole('dialog')
    const category = dialog.getByRole('combobox', {
      name: 'Category',
      exact: true,
    })
    await expect(category).toBeEnabled()
    await category.selectOption('isolated-current')
    await dialog
      .getByRole('button', { name: 'Photo options', exact: true })
      .click()
    await page.getByRole('menuitemradio').first().click()
    await expect(
      dialog.getByRole('button', { name: 'Remove photo', exact: true }),
    ).toBeVisible()
    if (source === 'url') {
      await dialog
        .getByLabel('Product URL', { exact: true })
        .fill('https://example.org/fixture')
      await dialog
        .getByRole('button', { name: 'Import details', exact: true })
        .click()
      await expect(dialog.getByLabel('Item name', { exact: true })).toHaveValue(
        'URL populated fixture',
      )
    } else {
      await dialog
        .getByLabel(/^(Catalog|Search catalog by name or brand)$/)
        .fill('Fixture')
      await dialog
        .getByRole('button', { name: /^(Search|Search catalog)$/ })
        .click()
      await dialog
        .getByRole('button', { name: 'Review for my ingredients', exact: true })
        .click()
      await dialog
        .getByRole('button', { name: 'Apply selected values', exact: true })
        .click()
      await expect(dialog.getByLabel('Item name', { exact: true })).toHaveValue(
        'Catalog populated fixture',
      )
    }
    await expect(category).toHaveValue('isolated-current')
    f.w.settings[0].pantryCategories[0].name = 'Refreshed fixture category'
    await dialog
      .getByRole('button', { name: 'Refresh categories', exact: true })
      .click()
    await expect(category).toBeEnabled()
    await expect(category.locator('option:checked')).toHaveText(
      'Refreshed fixture category',
    )
    await expect(
      dialog.getByRole('button', { name: 'Remove photo', exact: true }),
    ).toBeVisible()
    await expect(dialog.getByLabel('Item name', { exact: true })).toHaveValue(
      source === 'url' ? 'URL populated fixture' : 'Catalog populated fixture',
    )
  })
}

test('shared Delete action shows the exact resale item, blocks linked stock and cancels safely', async ({
  page,
}) => {
  await fixture(page)
  let deletionWrites = 0
  await page.route('**/api/workspace', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    const body = route.request().postDataJSON()
    if (body.action === 'itemDeleteCheck')
      return route.fulfill({
        json: {
          item: { id: body.data.id, name: body.data.expectedName },
          blockers: ['Isolated receipt history and stock must be preserved.'],
          canArchive: false,
        },
      })
    if (body.action === 'itemDelete') deletionWrites++
    return route.fallback()
  })
  await page.goto(workspaceFixtureUrl('Resale/Items & Stock'))
  await page
    .getByRole('button', { name: 'Delete Fixture resale item', exact: true })
    .click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('Fixture resale item')
  await expect(dialog).toContainText(
    'Isolated receipt history and stock must be preserved.',
  )
  await expect(
    dialog.getByRole('button', { name: 'Delete', exact: true }),
  ).toBeDisabled()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(
    page.getByRole('article', { name: 'Fixture resale item', exact: true }),
  ).toBeVisible()
  expect(deletionWrites).toBe(0)
})
