import { test, expect, type Page } from '@playwright/test'
import { demoData } from '../src/lib/demo'
import { openingStockEntry } from '../src/lib/ingredient-opening-stock'
import { updateIngredient } from '../src/lib/ingredients'
import { handleAddItem } from '../netlify/lib/add-item-handler'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

async function fixture(page: Page, history = false) {
  await installWorkspaceFixture(page)
  const workspace = demoData()
  workspace.ingredients = [
    {
      id: 'applesauce',
      name: 'Applesauce',
      usedAs: 'ingredient',
      unit: 'each',
      storageUnit: 'each',
      recipeUnit: 'each',
      quantity: history ? 3 : 0,
      cost: 2,
      currentCost: 2,
      currency: 'USD',
      purchaseQuantity: 1,
      purchaseUnit: 'each',
      packagePrice: 2,
      threshold: 0,
      conversions: [],
      updatedAt: 'original',
    },
  ]
  workspace.recipes = []
  workspace.products = []
  workspace.batches = []
  workspace.journals = []
  workspace.ledger = history
    ? [
        {
          id: 'opening-old',
          name: 'Applesauce opening stock',
          ingredientId: 'applesauce',
          type: 'opening_balance',
          quantity: 3,
          unit: 'each',
          amount: 6,
          date: '2026-11-07',
        },
      ]
    : []
  const writes: any[] = []
  const save = async (table: string, item: any) => {
    const rows = workspace[table],
      index = rows.findIndex((row) => row.id === item.id)
    if (index < 0) rows.push(item)
    else rows[index] = item
  }
  await page.route('**/api/workspace*', async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON()
      writes.push(body)
      if (body.action === 'save')
        await handleAddItem(body.action, body.table, body.data, {
          state: workspace,
          today: '2026-11-08',
          save,
          audit: async () => {},
        })
      if (body.action === 'ingredientUpdate') {
        const existing = workspace.ingredients.find(
          (i) => i.id === body.data.id,
        )!
        const opening = openingStockEntry(
          existing,
          body.data.openingStock,
          workspace.ledger,
        )
        if (!opening?.replay) {
          const item = updateIngredient(existing, body.data)
          if (opening) {
            Object.assign(item, {
              quantity: opening.item.quantity,
              cost: opening.item.cost,
              openingStockRecorded: true,
            })
            await save('ledger', opening.ledger)
            if (opening.journal) await save('journals', opening.journal)
          }
          item.updatedAt = 'saved'
          await save('ingredients', item)
        }
      }
    }
    return route.fulfill({
      json: { workspace, role: 'Owner', demo: false },
    })
  })
  return { workspace, writes }
}
async function editApplesauce(page: Page) {
  await page.goto(workspaceFixtureUrl('Inventory/Ingredients'))
  await page.getByRole('button', { name: 'View details', exact: true }).click()
  const editor = page.getByRole('dialog')
  await editor
    .getByRole('button', { name: 'Edit Ingredient', exact: true })
    .click()
  await editor
    .getByRole('button', { name: 'Stock & Other Details', exact: true })
    .click()
  return editor
}
for (const width of [1440, 390]) {
  test(`new ingredient opening stock is discoverable and saves each at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 })
    const f = await fixture(page)
    await page.goto(workspaceFixtureUrl('Inventory/Ingredients'))
    await page.getByRole('button', { name: 'Add Item', exact: true }).click()
    const editor = page.getByRole('dialog')
    await editor
      .getByLabel('Item Type', { exact: true })
      .selectOption('ingredient')
    await editor.getByLabel('Item name', { exact: true }).fill('New applesauce')
    await editor.getByRole('tab', { name: 'Purchase & Stock' }).click()
    await editor
      .getByLabel('Purchase unit', { exact: true })
      .selectOption('each')
    await editor.getByLabel('Cost per package', { exact: true }).fill('2')
    await editor.getByLabel('Stock unit', { exact: true }).selectOption('each')
    await editor.getByLabel('Amount in each package', { exact: true }).fill('1')
    await expect(
      editor.getByText('Opening stock', { exact: true }),
    ).toBeVisible()
    await editor.getByLabel('Add what I already have on hand').check()
    await editor.getByLabel('Opening count', { exact: true }).fill('3')
    await expect(editor.getByLabel('Count unit', { exact: true })).toHaveValue(
      'each',
    )
    await expect(
      editor.getByText('You’re adding 3 each to stock.', { exact: true }),
    ).toBeVisible()
    await editor.screenshot({
      animations: 'disabled',
      path: `docs/previews/opening-stock-new-${width}.png`,
    })
    expect(f.workspace.ledger).toHaveLength(0)
    await editor.getByRole('button', { name: 'Save item', exact: true }).click()
    await expect(editor).toHaveCount(0)
    const saved = f.workspace.ingredients.find(
      (i) => i.name === 'New applesauce',
    )!
    expect(saved).toMatchObject({
      quantity: 3,
      unit: 'each',
      storageUnit: 'each',
      cost: 2,
    })
    expect(
      f.workspace.ledger.filter((l) => l.ingredientId === saved.id),
    ).toMatchObject([{ quantity: 3, unit: 'each' }])
  })
  test(`existing ingredient without opening stock saves one entry at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 })
    const f = await fixture(page)
    const editor = await editApplesauce(page)
    await expect(
      editor.getByText('No opening stock recorded.', { exact: false }),
    ).toBeVisible()
    await editor.getByLabel('Enter opening stock already owned').check()
    await editor
      .getByLabel('Opening stock quantity (each)', { exact: true })
      .fill('3')
    await editor.getByLabel('Opening stock value', { exact: true }).fill('6')
    await expect(
      editor.getByLabel('Inventory unit', { exact: true }),
    ).toHaveValue('each')
    await page.screenshot({
      animations: 'disabled',
      path: `docs/previews/opening-stock-existing-none-${width}.png`,
    })
    expect(f.writes).toHaveLength(0)
    await editor
      .getByRole('button', { name: 'Save changes', exact: true })
      .click()
    await expect(
      editor.getByRole('button', { name: 'Edit Ingredient', exact: true }),
    ).toBeVisible()
    expect(
      f.writes.filter((w) => w.action === 'ingredientUpdate'),
    ).toHaveLength(1)
    expect(f.workspace.ingredients[0]).toMatchObject({
      quantity: 3,
      unit: 'each',
      cost: 2,
    })
    expect(f.workspace.ledger).toHaveLength(1)
    await editor
      .getByRole('button', { name: 'Edit Ingredient', exact: true })
      .click()
    await editor
      .getByRole('button', { name: 'Stock & Other Details', exact: true })
      .click()
    await expect(
      editor.getByText('Opening stock has been recorded.', {
        exact: false,
      }),
    ).toBeVisible()
    await expect(
      editor.getByLabel('Enter opening stock already owned'),
    ).toHaveCount(0)
  })
  test(`stock history exposes count/adjustment without a duplicate opening at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 })
    const f = await fixture(page, true)
    const editor = await editApplesauce(page)
    await expect(
      editor.getByText('Opening stock has been recorded.', {
        exact: false,
      }),
    ).toBeVisible()
    await expect(
      editor.getByLabel('Enter opening stock already owned'),
    ).toHaveCount(0)
    const action = editor.getByRole('button', {
      name: 'Stock count / adjustment',
      exact: true,
    })
    await expect(action).toBeEnabled()
    await page.screenshot({
      animations: 'disabled',
      path: `docs/previews/opening-stock-history-${width}.png`,
    })
    expect(f.writes).toHaveLength(0)
    await action.click()
    const adjustment = page.getByRole('dialog')
    await expect(
      adjustment.getByRole('combobox', {
        name: 'Adjustment method',
        exact: true,
      }),
    ).toBeVisible()
    await adjustment
      .getByRole('combobox', { name: 'Adjustment method', exact: true })
      .selectOption('total')
    await expect(
      adjustment.getByRole('spinbutton', {
        name: /^Total on hand \(each\)/,
      }),
    ).toBeVisible()
    await expect(
      adjustment.getByText(
        'Sets the entire balance to this count. It does not add the count to existing stock.',
        { exact: true },
      ),
    ).toBeVisible()
    await page.screenshot({
      animations: 'disabled',
      path: `docs/previews/opening-stock-adjustment-${width}.png`,
    })
    await adjustment
      .getByRole('button', { name: 'Cancel', exact: true })
      .click()
    expect(f.workspace.ledger).toHaveLength(1)
    expect(f.writes).toHaveLength(0)
  })
  test(`cancel opening stock creates no transaction at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 })
    const f = await fixture(page)
    const editor = await editApplesauce(page)
    await editor.getByLabel('Enter opening stock already owned').check()
    await editor
      .getByLabel('Opening stock quantity (each)', { exact: true })
      .fill('7')
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(
      editor.getByRole('button', { name: 'Edit Ingredient', exact: true }),
    ).toBeVisible()
    expect(f.writes).toHaveLength(0)
    expect(f.workspace.ledger).toHaveLength(0)
    expect(f.workspace.ingredients[0].quantity).toBe(0)
  })
}
