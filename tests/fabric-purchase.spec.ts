import { test, expect, type Page } from '@playwright/test'
import { demoData } from '../src/lib/demo'
import type { Item } from '../src/lib/domain'
import { handleAddItem } from '../netlify/lib/add-item-handler'
import { handleFabric } from '../netlify/lib/fabric-handler'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})

async function fixture(page: Page) {
  await installWorkspaceFixture(page)
  await page.route('**/app-version.json*', (r) =>
    r.fulfill({ json: { version: 'fabric-purchase-test' } }),
  )
  const workspace = demoData()
  workspace.journals = []
  for (const item of workspace.ingredients) delete item.expires
  const existing: Item = {
    id: 'legacy-cotton',
    name: 'Legacy cotton',
    usedAs: 'material',
    materialType: 'fabric',
    fabricTracking: 'length',
    pieceMode: 'aggregate',
    fabricWidth: 44,
    widthUnit: 'in',
    unit: 'yd',
    storageUnit: 'yd',
    purchaseUnit: 'yd',
    purchaseQuantity: 4,
    packagePrice: 11.96,
    quantity: 4,
    cost: 2.99,
    currentCost: 2.99,
    threshold: 0,
    expires: '2020-01-01',
  }
  workspace.ingredients.push(existing)
  workspace.ingredients.push({
    ...existing,
    id: 'today-fabric',
    name: 'Fabric with historical date',
    expires: new Date().toISOString().slice(0, 10),
  })
  workspace.ingredients.push({
    id: 'today-ingredient',
    name: 'Ingredient expiring today',
    usedAs: 'ingredient',
    categoryId: 'flour-grains',
    category: 'Flour & grains',
    unit: 'g',
    storageUnit: 'g',
    quantity: 4,
    cost: 1,
    currentCost: 1,
    threshold: 0,
    expires: new Date().toISOString().slice(0, 10),
  })
  const writes: { action: string; table: string; data: Item }[] = []
  const ctx = {
    state: workspace,
    today: '2026-11-13',
    actor: 'owner',
    audit: async () => {},
    save: async (table: string, item: Item) => {
      const rows = (workspace[table] ||= [])
      const index = rows.findIndex((r) => r.id === item.id)
      if (index < 0) rows.push(structuredClone(item))
      else rows[index] = structuredClone(item)
    },
  }
  await page.route('**/api/workspace*', async (route) => {
    try {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON()
        writes.push(body)
        if (!(await handleAddItem(body.action, body.table, body.data, ctx)))
          await handleFabric(body.action, body.table, body.data, ctx)
      }
      await route.fulfill({ json: { workspace, role: 'Owner', demo: false } })
    } catch (error) {
      await route.fulfill({
        status: 400,
        json: { error: (error as Error).message },
      })
    }
  })
  return { workspace, writes }
}

async function addFabric(page: Page, name = 'Cotton fabric example') {
  await page
    .getByRole('button', { name: 'Add Item', exact: true })
    .first()
    .click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Item Type', { exact: true }).selectOption('material')
  await dialog.getByLabel('Material Subtype').selectOption('fabric')
  await dialog.getByLabel('Item name', { exact: true }).fill(name)
  await dialog.getByRole('tab', { name: 'Fabric', exact: true }).click()
  await dialog.getByLabel('Fabric width', { exact: true }).fill('44')
  await dialog
    .getByRole('tab', { name: 'Purchase & Stock', exact: true })
    .click()
  return dialog
}

for (const width of [390, 768, 1440]) {
  test(`one-yard basis saves and reopens at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    const { workspace, writes } = await fixture(page)
    await page.goto(workspaceFixtureUrl('Inventory/Craft Materials'))
    const dialog = await addFabric(page)
    await dialog.getByLabel('Purchase unit', { exact: true }).selectOption('yd')
    await expect(
      dialog.getByText('Purchase quantity: 1 yd.', { exact: true }),
    ).toBeVisible()
    await expect(
      dialog.getByLabel('Amount in each package', { exact: true }),
    ).toHaveCount(0)
    await dialog.getByLabel('Cost per yd', { exact: true }).fill('2.99')
    await dialog.getByLabel('Add what I already have on hand').check()
    await dialog.getByLabel('Opening count', { exact: true }).fill('4')
    await dialog
      .getByLabel('Lot (optional)', { exact: true })
      .fill('COTTON-LOT')
    await expect(dialog.getByLabel('Inventory as of')).toBeVisible()
    await expect(dialog.getByLabel('Expiry (optional)')).toHaveCount(0)
    await expect(dialog).toContainText('Suggested opening stock value: $11.96')
    await dialog.getByRole('tab', { name: 'More', exact: true }).click()
    await dialog
      .getByRole('tab', { name: 'Purchase & Stock', exact: true })
      .click()
    await expect(
      dialog.getByLabel('Opening count', { exact: true }),
    ).toHaveValue('4')
    await expect(dialog.getByLabel('Cost per yd', { exact: true })).toHaveValue(
      '2.99',
    )
    expect(writes).toHaveLength(0)
    const cost = dialog.getByLabel('Cost per yd', { exact: true })
    await cost.focus()
    await expect(cost).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(dialog.getByLabel('Stock unit', { exact: true })).toBeFocused()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1)
    await dialog.screenshot({
      path: `docs/reviews/fabric-purchase/after-${width}.png`,
    })
    await dialog.getByLabel('Inventory as of').scrollIntoViewIfNeeded()
    await dialog.screenshot({
      path: `docs/reviews/fabric-purchase/opening-stock-${width}.png`,
    })
    await dialog.getByRole('button', { name: 'Save item', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    const saved = workspace.ingredients.find(
      (i) => i.name === 'Cotton fabric example',
    )!
    expect(saved).toMatchObject({
      purchaseUnit: 'yd',
      unit: 'yd',
      amountPerPackage: 1,
      purchaseQuantity: 1,
      packagePrice: 2.99,
      quantity: 4,
      cost: 2.99,
      lot: 'COTTON-LOT',
    })
    expect(
      workspace.ledger.find((l) => l.ingredientId === saved.id),
    ).toMatchObject({ amount: 11.96, openingCount: 4 })
    await page.reload()
    const card = page.getByRole('article', {
      name: 'Cotton fabric example',
      exact: true,
    })
    await expect(card).toContainText('$11.96')
    await card
      .getByRole('button', { name: 'Edit Material', exact: true })
      .click()
    await expect(dialog.getByLabel('Cost per yd', { exact: true })).toHaveValue(
      '2.99',
    )
    await expect(
      dialog.getByText('Purchase quantity: 1 yd.', { exact: true }),
    ).toBeVisible()
    await expect(dialog.getByLabel('Stock unit', { exact: true })).toHaveValue(
      'yd',
    )
    await expect(dialog.getByLabel(/expir/i)).toHaveCount(0)
    await dialog
      .getByText('Purchase quantity: 1 yd.', { exact: true })
      .scrollIntoViewIfNeeded()
    await dialog.screenshot({
      path: `docs/reviews/fabric-purchase/reopened-${width}.png`,
    })
  })
}

test('fractional yardage and package switches require reviewed prices with no stale value', async ({
  page,
}) => {
  const { workspace } = await fixture(page)
  await page.goto(workspaceFixtureUrl('Inventory/Craft Materials'))
  const dialog = await addFabric(page, 'Fractional cotton')
  await dialog.getByLabel('Purchase unit', { exact: true }).selectOption('roll')
  await dialog.getByLabel('Amount in each package', { exact: true }).fill('10')
  await dialog.getByLabel('Cost per package', { exact: true }).fill('29.90')
  await dialog.getByLabel('Add what I already have on hand').check()
  await dialog.getByLabel('Opening count', { exact: true }).fill('4')
  await expect(dialog).toContainText('Suggested opening stock value: $11.96')
  await dialog.getByLabel('Purchase unit', { exact: true }).selectOption('yd')
  await expect(dialog.getByLabel('Cost per yd', { exact: true })).toBeEmpty()
  await expect(dialog).toContainText('previous price has not been carried over')
  await expect(dialog).toContainText(
    'Suggested opening stock value: Not available',
  )
  await dialog.getByRole('button', { name: 'Save item', exact: true }).click()
  await expect(dialog).toBeVisible()
  expect(
    workspace.ingredients.some((i) => i.name === 'Fractional cotton'),
  ).toBe(false)
  await dialog.getByLabel('Cost per yd', { exact: true }).fill('2.99')
  await dialog.getByLabel('Opening count', { exact: true }).fill('0.25')
  await expect(dialog).toContainText('You’re adding 0.25 yd to stock.')
  await expect(dialog).toContainText('Suggested opening stock value: $0.75')
  await dialog.getByLabel('Purchase unit', { exact: true }).selectOption('bolt')
  await expect(
    dialog.getByLabel('Amount in each package', { exact: true }),
  ).toBeEmpty()
  await expect(
    dialog.getByLabel('Cost per package', { exact: true }),
  ).toBeEmpty()
  await dialog.getByLabel('Amount in each package', { exact: true }).fill('10')
  await dialog.getByLabel('Cost per package', { exact: true }).fill('29.90')
  await expect(dialog).toContainText('Suggested opening stock value: $0.75')
  await dialog.getByRole('button', { name: 'Save item', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  expect(
    workspace.ingredients.find((i) => i.name === 'Fractional cotton'),
  ).toMatchObject({
    purchaseUnit: 'bolt',
    amountPerPackage: 10,
    packagePrice: 29.9,
    quantity: 0.25,
  })
})

test('legacy reference review preserves history and cancel preserves the saved record', async ({
  page,
}) => {
  const { workspace } = await fixture(page)
  await page.goto(workspaceFixtureUrl('Inventory/Craft Materials'))
  const original = structuredClone(
    workspace.ingredients.find((i) => i.id === 'legacy-cotton'),
  )
  const card = page.getByRole('article', { name: 'Legacy cotton', exact: true })
  await expect(card).toContainText('In stock')
  await card.getByRole('button', { name: 'Edit Material', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('Review this saved purchase basis')
  await dialog
    .getByRole('button', { name: 'Review purchase details', exact: true })
    .scrollIntoViewIfNeeded()
  await dialog.screenshot({
    path: 'docs/reviews/fabric-purchase/legacy-review.png',
  })
  await dialog
    .getByRole('button', { name: 'Review purchase details', exact: true })
    .click()
  await dialog.getByLabel('Cost per yd', { exact: true }).fill('2.99')
  page.once('dialog', (d) => d.accept())
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  expect(workspace.ingredients.find((i) => i.id === 'legacy-cotton')).toEqual(
    original,
  )
  await card.getByRole('button', { name: 'Edit Material', exact: true }).click()
  await dialog
    .getByRole('button', { name: 'Review purchase details', exact: true })
    .click()
  await dialog.getByLabel('Cost per yd', { exact: true }).fill('2.99')
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  const saved = workspace.ingredients.find((i) => i.id === 'legacy-cotton')!
  expect(saved).toMatchObject({
    purchaseQuantity: 1,
    amountPerPackage: 1,
    packagePrice: 2.99,
    quantity: 4,
    cost: 2.99,
    expires: '2020-01-01',
  })
  expect(saved.costReferenceHistory[0]).toMatchObject({
    purchaseQuantity: 4,
    packagePrice: 11.96,
  })
})

test('fabric is absent from expiry filters and alerts while ingredients keep expiry controls', async ({
  page,
}) => {
  await fixture(page)
  await page.goto(workspaceFixtureUrl('Inventory/All Items'))
  await page.getByRole('button', { name: /Expiring soon/ }).click()
  await expect(
    page.getByRole('article', {
      name: 'Ingredient expiring today',
      exact: true,
    }),
  ).toBeVisible()
  await expect(
    page.getByRole('article', {
      name: 'Fabric with historical date',
      exact: true,
    }),
  ).toHaveCount(0)
  await expect(
    page.getByRole('article', { name: 'Legacy cotton', exact: true }),
  ).toHaveCount(0)
  await page
    .getByRole('button', { name: 'Add Item', exact: true })
    .first()
    .click()
  const dialog = page.getByRole('dialog')
  await dialog
    .getByLabel('Item Type', { exact: true })
    .selectOption('ingredient')
  await dialog
    .getByRole('tab', { name: 'Purchase & Stock', exact: true })
    .click()
  await dialog.getByLabel('Add what I already have on hand').check()
  await expect(
    dialog.getByLabel('Expiry (optional)', { exact: true }),
  ).toBeVisible()
  await expect(
    dialog.getByLabel('Inventory as of', { exact: true }),
  ).toBeVisible()
})

test('fabric receipts keep yard price separate from received yards and clear prices when switching to rolls', async ({
  page,
}) => {
  const { workspace } = await fixture(page)
  await page.goto(workspaceFixtureUrl('Inventory/Craft Materials'))
  await page
    .getByRole('button', { name: 'Actions for Legacy cotton', exact: true })
    .click()
  await page
    .getByRole('menuitem', { name: 'Receive stock', exact: true })
    .click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel(/expir/i)).toHaveCount(0)
  await expect(
    dialog.getByLabel('Lot (optional)', { exact: true }),
  ).toBeVisible()
  await dialog
    .getByLabel('Quantity received (decimals or fractions)')
    .fill('1/4')
  await dialog.getByLabel('Cost per yd', { exact: true }).fill('2.99')
  await expect(dialog).toContainText('0.25 yd added')
  await dialog.getByLabel('Unit', { exact: true }).selectOption('roll')
  await expect(
    dialog.getByLabel('Total acquisition cost', { exact: true }),
  ).toBeEmpty()
  await expect(dialog).toContainText('previous price has not been carried over')
  await dialog.getByLabel('Quantity received (decimals or fractions)').fill('1')
  await dialog.getByLabel('Usable length per bolt / roll').fill('10')
  await dialog.getByLabel('I confirmed the usable length').check()
  await dialog
    .getByLabel('Total acquisition cost', { exact: true })
    .fill('29.90')
  await expect(dialog).toContainText('10 yd added')
  await dialog.getByLabel('Unit', { exact: true }).selectOption('yd')
  await expect(dialog.getByLabel('Cost per yd', { exact: true })).toBeEmpty()
  await dialog
    .getByLabel('Quantity received (decimals or fractions)')
    .fill('1/4')
  await dialog.getByLabel('Cost per yd', { exact: true }).fill('2.99')
  await dialog.getByLabel('Lot (optional)', { exact: true }).fill('NEW-LOT')
  await dialog.screenshot({
    path: 'docs/reviews/fabric-purchase/receive-fabric.png',
  })
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  expect(
    workspace.ingredients.find((i) => i.id === 'legacy-cotton')?.quantity,
  ).toBe(4.25)
  expect(workspace.ledger.find((l) => l.lot === 'NEW-LOT')).toMatchObject({
    quantity: 0.25,
    amount: 0.7475,
    purchaseQuantity: 0.25,
    purchaseUnit: 'yd',
  })
})

test('receipt inventory matching hides fabric expiry and restores it for an ingredient', async ({
  page,
}) => {
  const { workspace } = await fixture(page)
  workspace.receipt_extractions = [
    {
      id: 'fabric-review',
      name: 'Fabric receipt review',
      vendor: 'Fabric supplier',
      status: 'draft',
      extractionStatus: 'manual',
      date: '2026-11-13',
      receivedDate: '2026-11-13',
      arithmeticVersion: 2,
      taxTreatment: 'exclusive',
      tax: 0,
      lines: [
        {
          description: 'Cotton yards',
          decision: 'inventory',
          amountMode: 'direct',
          enteredAmount: 2.99,
          amount: 2.99,
          itemId: 'legacy-cotton',
          itemTable: 'ingredients',
          quantity: 1,
          unit: 'yd',
          stockQuantityConfirmed: true,
          lot: 'REVIEW-LOT',
        },
      ],
    },
  ]
  await page.goto(workspaceFixtureUrl('Finances/Receipt inbox'))
  await page.getByRole('button', { name: /Fabric supplier/ }).click()
  const review = page.getByRole('dialog', {
    name: 'Review receipt',
    exact: true,
  })
  await review.getByRole('button', { name: /Cotton yards.*Edit/ }).click()
  await expect(
    review.getByLabel('Lot (optional)', { exact: true }),
  ).toBeVisible()
  await expect(
    review.getByLabel('Expiration (optional)', { exact: true }),
  ).toHaveCount(0)
  await review
    .getByRole('combobox', { name: /Match inventory item/ })
    .selectOption('ingredients:today-ingredient')
  await expect(
    review.getByLabel('Expiration (optional)', { exact: true }),
  ).toBeVisible()
  await expect(
    review.getByLabel('Lot (optional)', { exact: true }),
  ).toHaveValue('REVIEW-LOT')
  await review
    .getByRole('combobox', { name: /Match inventory item/ })
    .selectOption('new')
  const create = page.getByRole('dialog', { name: 'Add Item', exact: true })
  await create.getByLabel('Item Type', { exact: true }).selectOption('material')
  await create.getByLabel('Material Subtype').selectOption('fabric')
  await create.getByRole('tab', { name: 'Fabric', exact: true }).click()
  await create.getByLabel('Fabric width', { exact: true }).fill('44')
  await create
    .getByRole('tab', { name: 'Purchase & Stock', exact: true })
    .click()
  await create.getByLabel('Purchase unit', { exact: true }).selectOption('yd')
  await create.getByLabel('Cost per yd', { exact: true }).fill('2.99')
  await expect(create.getByLabel('Opening count', { exact: true })).toHaveCount(
    0,
  )
  await expect(
    create.getByText('Purchase quantity: 1 yd.', { exact: true }),
  ).toBeVisible()
  await create.getByRole('button', { name: 'Save item', exact: true }).click()
  await expect(create).toHaveCount(0)
  expect(
    workspace.ingredients.find((i) => i.name === 'Cotton yards'),
  ).toMatchObject({
    purchaseUnit: 'yd',
    amountPerPackage: 1,
    purchaseQuantity: 1,
    packagePrice: 2.99,
    quantity: 0,
  })
  expect(
    workspace.ledger.some(
      (l) =>
        l.ingredientId ===
        workspace.ingredients.find((i) => i.name === 'Cotton yards')?.id,
    ),
  ).toBe(false)
})
