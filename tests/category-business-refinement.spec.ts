import { test, expect, type Page } from '@playwright/test'
import { demoData } from '../src/lib/demo'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'
import { handleProductCategories } from '../netlify/lib/product-category-handler'
import { handleRecipeCategories } from '../netlify/lib/recipe-category-handler'
import { handlePantryCategories } from '../netlify/lib/pantry-category-handler'

test.use({ actionTimeout: 15000, trace: 'retain-on-failure' })

async function fixture(page: Page, components = false) {
  await installWorkspaceFixture(page)
  const w = demoData()
  w.settings[0].name =
    'Hibbs Homestead Market & Handmade Goods — Family Kitchen and Workshop'
  w.settings[0].address =
    '1784 Meadow Lane, Building B, Workshop and Family Kitchen, Springfield'
  w.settings[0].jurisdiction = 'Test jurisdiction'
  w.settings[0].productCategories = []
  if (components)
    w.settings[0].taxRates = [
      {
        id: 'state',
        name: 'State sales tax',
        jurisdiction: 'State',
        ratePercent: 6.25,
        behavior: 'exclusive',
      },
      {
        id: 'local',
        name: 'Local sales tax',
        jurisdiction: 'County',
        ratePercent: 2,
        behavior: 'exclusive',
      },
    ]
  else {
    delete w.settings[0].taxRates
    w.settings[0].taxRate = 0
  }
  const writes: any[] = []
  await page.route('**/api/workspace*', async (route) => {
    const url = route.request().url()
    const fn = url.includes('productCategories=')
      ? handleProductCategories
      : url.includes('recipeCategories=')
        ? handleRecipeCategories
        : url.includes('pantryCategories=')
          ? handlePantryCategories
          : undefined
    if (fn) {
      try {
        const req = new Request(url, {
          method: route.request().method(),
          headers: { 'Content-Type': 'application/json' },
          ...(route.request().method() === 'POST'
            ? { body: route.request().postData()! }
            : {}),
        })
        const response = await fn(req, {
          state: w,
          role: 'Owner',
          client: { query: async () => {} },
          save: async (table, item) => {
            const index = w[table].findIndex((r) => r.id === item.id)
            if (index >= 0) w[table][index] = structuredClone(item)
            else w[table].push(structuredClone(item))
          },
        })
        return route.fulfill({
          status: response.status,
          json: await response.json(),
        })
      } catch (e) {
        return route.fulfill({
          status: 400,
          json: { error: (e as Error).message },
        })
      }
    }
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON()
      writes.push(body)
      if (body.action === 'save') {
        const i = w[body.table].findIndex((r: any) => r.id === body.data.id)
        if (i >= 0) w[body.table][i] = { ...w[body.table][i], ...body.data }
        else w[body.table].push(body.data)
      }
    }
    return route.fulfill({ json: { workspace: w, role: 'Owner', demo: true } })
  })
  await page.route('**/app-version.json*', (route) =>
    route.fulfill({ json: {} }),
  )
  return { w, writes }
}
for (const width of [1440, 390])
  test(`business layout and component preservation ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 })
    const { w, writes } = await fixture(page, true)
    const original = structuredClone(w.settings[0].taxRates)
    await page.goto(workspaceFixtureUrl('Settings/Business Profile'))
    await page
      .getByRole('button', { name: 'Edit business profile', exact: true })
      .click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('8.25%', { exact: true })).toBeVisible()
    await page.screenshot({
      path: `docs/reviews/category-business/business-after-${width}.png`,
      fullPage: false,
      animations: 'disabled',
    })
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true)
    await dialog
      .getByRole('button', { name: 'Save settings', exact: true })
      .click()
    await page.mouse.move(0, 0)
    expect(w.settings[0].taxRates).toEqual(original)
    expect(writes.at(-1).data.taxRate).toBe(0)
    await page
      .getByRole('button', { name: 'Edit business profile', exact: true })
      .click()
    await page
      .getByText('Component rates & advanced tax settings (2)', { exact: true })
      .click()
    await page
      .getByText('Local sales tax · 2% · exclusive', { exact: true })
      .click()
    await page.getByLabel('Rate (%)', { exact: true }).last().fill('2.375')
    await page.screenshot({
      path: `docs/reviews/category-business/components-${width}.png`,
      fullPage: false,
      animations: 'disabled',
    })
    await dialog
      .getByRole('button', { name: 'Save settings', exact: true })
      .click()
    await page.mouse.move(0, 0)
    await page
      .getByRole('button', { name: 'Edit business profile', exact: true })
      .click()
    await expect(dialog.getByText('8.625%', { exact: true })).toBeVisible()
    expect(w.settings[0].taxRates[1]).toEqual({
      ...original[1],
      ratePercent: 2.375,
    })
    await page.unrouteAll({ behavior: 'ignoreErrors' })
  })
test('default tax rate distinguishes unconfigured, zero and decimal across reopen', async ({
  page,
}) => {
  const { w } = await fixture(page)
  await page.goto(workspaceFixtureUrl('Settings/Business Profile'))
  const open = () =>
    page
      .getByRole('button', { name: 'Edit business profile', exact: true })
      .click()
  await open()
  await expect(
    page.getByLabel('Default sales-tax rate (%)', { exact: true }),
  ).toHaveValue('')
  await page.getByRole('button', { name: 'Save settings', exact: true }).click()
  await page.mouse.move(0, 0)
  expect(w.settings[0]).not.toHaveProperty('taxRates')
  await open()
  await page.getByLabel('Default sales-tax rate (%)', { exact: true }).fill('0')
  await page.getByRole('button', { name: 'Save settings', exact: true }).click()
  await page.mouse.move(0, 0)
  await open()
  await expect(
    page.getByLabel('Default sales-tax rate (%)', { exact: true }),
  ).toHaveValue('0')
  await page
    .getByLabel('Default sales-tax rate (%)', { exact: true })
    .fill('8.25')
  await page.getByRole('button', { name: 'Save settings', exact: true }).click()
  await page.mouse.move(0, 0)
  await open()
  await expect(
    page.getByLabel('Default sales-tax rate (%)', { exact: true }),
  ).toHaveValue('8.25')
  expect(w.settings[0].taxRates[0].ratePercent).toBe(8.25)
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})
for (const width of [1440, 390])
  test(`section categories and editor draft ${width}`, async ({ page }) => {
    test.setTimeout(120000)
    await page.setViewportSize({ width, height: 1000 })
    const { w } = await fixture(page)
    for (const [section, scope] of [
      ['Products/Food', 'food-products'],
      ['Inventory/Ingredients', 'food-ingredients'],
      ['Inventory/Packaging', 'packaging'],
      ['Recipes/Cookbook', 'recipes'],
      ['Handmade/Products & Bills of Materials', 'handmade-products'],
      ['Handmade/Materials & Supplies', 'handmade-materials'],
    ]) {
      await page.goto(workspaceFixtureUrl(section))
      await page
        .getByRole('button', { name: 'Add category', exact: true })
        .first()
        .click()
      const d = page.getByRole('dialog').last()
      await expect(d.getByLabel('Section', { exact: true })).toHaveValue(
        scope === 'food-products'
          ? 'Food products'
          : scope === 'food-ingredients'
            ? 'Food ingredients & supplies'
            : scope === 'packaging'
              ? 'Packaging'
              : scope === 'recipes'
                ? 'Recipes'
                : scope === 'handmade-products'
                  ? 'Handmade products'
                  : 'Handmade materials & supplies',
      )
      await d
        .getByLabel('Category name', { exact: true })
        .fill('Seasonal ' + scope)
      await d
        .getByLabel('Description', { exact: true })
        .fill('Items prepared for seasonal markets and customer collections.')
      if (scope.endsWith('products'))
        await d
          .getByLabel('Classification', { exact: true })
          .selectOption(scope === 'food-products' ? 'food' : 'non_food')
      await d
        .getByRole('button', { name: 'Save category', exact: true })
        .click()
      await expect(d).toHaveCount(0)
      const filter = page.getByLabel('Filter by category', { exact: true })
      if (await filter.count()) {
        await filter.selectOption({ label: 'Seasonal ' + scope })
        await filter.selectOption('all')
      }
    }
    // Add directly from a material editor; keep the unfinished name and auto-select.
    await page
      .getByRole('button', { name: 'Add material', exact: true })
      .click()
    await page
      .getByLabel('Material name', { exact: true })
      .fill('Unsaved waxed cotton')
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Add category', exact: true })
      .click()
    const add = page.getByRole('dialog').last()
    await add.getByLabel('Category name', { exact: true }).fill('Waxed fabrics')
    await add
      .getByLabel('Description', { exact: true })
      .fill('Waxed cotton and coated woven materials.')
    await add
      .getByRole('button', { name: 'Save category', exact: true })
      .click()
    await expect(page.getByLabel('Material name', { exact: true })).toHaveValue(
      'Unsaved waxed cotton',
    )
    await expect(
      page.getByRole('dialog').getByLabel('Category', { exact: true }),
    ).toHaveValue(
      w.settings[0].pantryCategories.find(
        (c: any) => c.name === 'Waxed fabrics',
      ).id,
    )
    await page.screenshot({
      path: `docs/reviews/category-business/material-editor-${width}.png`,
      fullPage: false,
      animations: 'disabled',
    })
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Close', exact: true })
      .click()
    await page
      .getByRole('button', { name: 'Manage categories', exact: true })
      .click()
    await page
      .getByRole('button', { name: 'Edit Waxed fabrics', exact: true })
      .click()
    await page
      .getByLabel('Parent category', { exact: true })
      .selectOption({ label: 'Seasonal handmade-materials' })
    await page.getByLabel('Display order', { exact: true }).fill('3')
    await page
      .getByRole('button', { name: 'Save category', exact: true })
      .click()
    await expect(
      page.getByRole('button', { name: 'Edit Waxed fabrics', exact: true }),
    ).toBeVisible()
    await page.screenshot({
      path: `docs/reviews/category-business/categories-${width}.png`,
      fullPage: false,
      animations: 'disabled',
    })
    await page.unrouteAll({ behavior: 'ignoreErrors' })
  })

for (const width of [1440, 390])
  test(`editor category creation preserves drafts across sections ${width}`, async ({
    page,
  }) => {
    test.setTimeout(120000)
    await page.setViewportSize({ width, height: 1000 })
    await fixture(page)
    page.on('dialog', (d) => d.accept())
    for (const kind of [
      'food',
      'handmade',
      'ingredient',
      'packaging',
      'recipe',
    ]) {
      const section =
        kind === 'food'
          ? 'Products/Food'
          : kind === 'handmade'
            ? 'Handmade/Products & Bills of Materials'
            : kind === 'recipe'
              ? 'Recipes'
              : kind === 'ingredient'
                ? 'Inventory/Ingredients'
                : 'Inventory/Packaging'
      await page.goto(workspaceFixtureUrl(section))
      if (kind === 'food')
        await page
          .getByRole('button', { name: 'Create food product', exact: true })
          .click()
      if (kind === 'handmade')
        await page
          .getByRole('button', { name: 'Create handmade product', exact: true })
          .click()
      if (kind === 'recipe')
        await page
          .getByRole('button', { name: 'Create recipe', exact: true })
          .click()
      if (kind === 'ingredient' || kind === 'packaging')
        await page
          .locator('.pantry-card')
          .first()
          .getByRole('button', {
            name: kind === 'ingredient' ? 'Edit Ingredient' : 'Edit Packaging',
            exact: true,
          })
          .click()
      const field = page.getByLabel(
        kind === 'food' || kind === 'handmade'
          ? 'Product name'
          : kind === 'recipe'
            ? 'Recipe name'
            : kind === 'ingredient'
              ? 'Name'
              : 'Packaging name',
        { exact: true },
      )
      await field.fill('Draft retained — ' + kind)
      await page
        .getByRole('button', { name: 'Add category', exact: true })
        .last()
        .click()
      await page
        .getByLabel('Category name', { exact: true })
        .fill('Editor category ' + kind)
      await page
        .getByLabel('Description', { exact: true })
        .last()
        .fill('Created while keeping the current editor open.')
      if (kind === 'food' || kind === 'handmade')
        await page
          .getByLabel('Classification', { exact: true })
          .selectOption(kind === 'food' ? 'food' : 'non_food')
      await page
        .getByRole('button', { name: 'Save category', exact: true })
        .click()
      await expect(field).toHaveValue('Draft retained — ' + kind)
      if (kind === 'food' || kind === 'handmade')
        await expect(
          page.getByRole('combobox', { name: 'Product category', exact: true }),
        ).toHaveValue(new RegExp('Editor category ' + kind))
      else
        await expect(
          page.getByRole('combobox', { name: 'Category', exact: true }),
        ).toHaveValue(/.+/)
      await page.screenshot({
        path: `docs/reviews/category-business/editor-${kind}-${width}.png`,
        fullPage: false,
        animations: 'disabled',
      })
    }
    await page.unrouteAll({ behavior: 'ignoreErrors' })
  })
