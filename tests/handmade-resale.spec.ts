import { test, expect } from '@playwright/test'
import type { Item } from '../src/lib/domain'
import { demoData } from '../src/lib/demo'
import {
  sectionTabs,
  destination,
  destinationHash,
} from '../src/lib/workspace-navigation'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

async function fixture(page: import('@playwright/test').Page) {
  await installWorkspaceFixture(page)
  const workspace = demoData()
  workspace.ingredients.push({
    id: 'cotton',
    name: 'Cotton fabric',
    usedAs: 'material',
    categoryId: 'craft-materials',
    category: 'Craft materials',
    unit: 'm',
    storageUnit: 'm',
    quantity: 8,
    cost: 4,
    currentCost: 4,
    threshold: 2,
  })
  workspace.recipes.push({
    id: 'blanket-design',
    name: 'Small blanket design',
    workflow: 'handmade',
    yield: 2,
    yieldUnit: 'each',
    laborMinutes: 30,
    laborRate: 12,
    overhead: 2,
    lines: [{ ingredientId: 'cotton', quantity: 2, unit: 'm' }],
  })
  workspace.products.push({
    id: 'blanket',
    name: 'Small blue blanket',
    workflow: 'handmade',
    recipeId: 'blanket-design',
    unitsPerPackage: 1,
    price: 30,
    quantity: 2,
    cost: 8,
    stockCostKnown: true,
    threshold: 1,
    sku: 'BLUE-S',
    variant: 'Small / blue',
  })
  workspace.products.push({
    id: 'jam-resale',
    name: 'Purchased strawberry jam',
    workflow: 'resale',
    unitsPerPackage: 1,
    price: 8,
    quantity: 24,
    cost: 3,
    stockCostKnown: true,
    threshold: 4,
  })
  workspace.batches.push({
    id: 'blanket-run',
    name: 'Small blue blanket run',
    recipeId: 'blanket-design',
    productId: 'blanket',
    count: 1,
    yield: 2,
    date: '2026-11-03',
    status: 'scheduled',
  })
  const writes: { action: string; table: string; data: Item }[] = []
  await page.route('**/api/workspace*', async (route) => {
    if (route.request().url().includes('productCategories=1'))
      return route.fulfill({
        json: {
          categories: [],
          mappings: {},
          rates: [],
          products: workspace.products,
          revision: 1,
        },
      })
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON()
      writes.push(body)
      if (body.action === 'save') {
        const rows = workspace[body.table]
        const index = rows.findIndex((r) => r.id === body.data.id)
        if (index >= 0) rows[index] = { ...rows[index], ...body.data }
        else rows.push(body.data)
      }
    }
    return route.fulfill({ json: { workspace, role: 'Owner', demo: true } })
  })
  return { workspace, writes }
}
for (const width of [1440, 768, 390, 320]) {
  test(`all canonical tabs and legacy routes fit with one primary navigation at ${width}`, async ({
    page,
  }) => {
    test.setTimeout(180000)
    await page.setViewportSize({ width, height: 1000 })
    await fixture(page)
    for (const [section, tabs] of Object.entries(sectionTabs)) {
      for (const tab of tabs.length ? tabs : ['']) {
        const hash = destinationHash(destination(section, tab))
        await page.goto(workspaceFixtureUrl(section).split('#')[0] + hash)
        await expect(page.locator('.breadcrumb strong')).toHaveText(section)
        await expect(page.locator('.app-shell')).toBeVisible()
        if (tabs.length && !['Labels', 'Settings'].includes(section)) {
          const active = page.locator('.section-tabs a[aria-current="page"]')
          await expect(active).toHaveText(tab)
          await expect
            .poll(async () => {
              const selected = await active.boundingBox()
              const navigation = await page
                .locator('.section-tabs')
                .boundingBox()
              return !!(
                selected &&
                navigation &&
                selected.x >= navigation.x - 1 &&
                selected.x + selected.width <=
                  navigation.x + navigation.width + 1
              )
            })
            .toBe(true)
        }
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth - innerWidth,
          ),
          `${section}/${tab}`,
        ).toBeLessThanOrEqual(1)
        if (width >= 1024)
          await expect(
            page
              .getByRole('navigation', {
                name: 'Primary navigation',
                exact: true,
              })
              .getByRole('link'),
          ).toHaveCount(9)
      }
    }
    if ([1440, 390].includes(width)) {
      await page.goto(workspaceFixtureUrl('Inventory/Finished Goods'))
      await expect(
        page.getByRole('heading', { name: 'Small blue blanket', exact: true }),
      ).toBeVisible()
      await page.screenshot({
        path: `docs/previews/handmade-resale-${width}.webp`,
        fullPage: true,
        animations: 'disabled',
      })
    }
    await page.goto(workspaceFixtureUrl('Pantry/Inventory ledger'))
    await expect(page).toHaveURL(/#Inventory\/Movements$/)
    await expect(page.locator('.breadcrumb strong')).toHaveText('Inventory')
    await page.goto(workspaceFixtureUrl('Production/Label Studio'))
    await expect(page).toHaveURL(/#Labels\/Templates$/)
  })
}
test('browser history, filters, new product/design save-reopen, mobile navigation and unsaved guards', async ({
  page,
}) => {
  const { writes } = await fixture(page)
  await page.goto(workspaceFixtureUrl('Products/Handmade'))
  await page
    .getByRole('button', { name: 'Create food product', exact: true })
    .click()
  await expect(
    page.getByRole('dialog').getByText('Connected recipe', { exact: true }),
  ).toBeVisible()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Cancel', exact: true })
    .click()
  await page.getByRole('textbox', { name: 'Search products' }).fill('blue')
  await expect(page).toHaveURL(/search=blue/)
  await page
    .getByRole('navigation', { name: 'Products tabs' })
    .getByRole('link', { name: 'Resale', exact: true })
    .click()
  await expect(
    page.getByRole('article', { name: 'Purchased strawberry jam' }),
  ).toBeVisible()
  await page.goBack()
  await expect(
    page.getByRole('textbox', { name: 'Search products' }),
  ).toHaveValue('blue')
  await page.goForward()
  await expect(page).toHaveURL(/Products\/Resale$/)
  await page
    .getByRole('button', { name: 'Create resale product', exact: true })
    .click()
  const dialog = page.getByRole('dialog')
  await dialog
    .getByLabel('Product name', { exact: true })
    .fill('Purchased tea towels')
  await dialog.getByLabel('Selling price', { exact: true }).fill('12')
  await dialog.getByLabel('SKU', { exact: true }).fill('TOWEL-GREEN')
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  const saved = page.getByRole('article', { name: 'Purchased tea towels' })
  await expect(saved).toBeVisible()
  await saved.getByRole('button', { name: 'Edit pricing' }).click()
  await expect(dialog.getByLabel('SKU', { exact: true })).toHaveValue(
    'TOWEL-GREEN',
  )
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(
    writes.filter(
      (w) => w.table === 'products' && w.data.name === 'Purchased tea towels',
    ),
  ).toHaveLength(1)
  await page
    .getByRole('navigation', { name: 'Primary navigation', exact: true })
    .getByRole('link', { name: 'Production', exact: true })
    .click()
  await page
    .getByRole('navigation', { name: 'Production tabs' })
    .getByRole('link', { name: 'Recipes & Designs', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Create handmade design', exact: true })
    .click()
  await dialog
    .getByLabel('Design name', { exact: true })
    .fill('Tea towel design')
  await dialog.getByRole('button', { name: 'Add material line' }).click()
  await dialog.getByLabel('Material 1', { exact: true }).selectOption('cotton')
  await dialog.getByLabel('Quantity 1', { exact: true }).fill('0.5')
  await expect(
    dialog.getByText('Estimated cost per good item:', { exact: false }),
  ).toBeVisible()
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(
    page.getByText('Tea towel design', { exact: true }),
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Create handmade design', exact: true })
    .click()
  await dialog.getByLabel('Design name', { exact: true }).fill('Unsaved design')
  page.once('dialog', (prompt) => prompt.dismiss())
  await page.goBack()
  await expect(page).toHaveURL(/#Production\/Recipes%20%26%20Designs$/)
  await expect(dialog.getByLabel('Design name', { exact: true })).toHaveValue(
    'Unsaved design',
  )
  page.once('dialog', (prompt) => prompt.dismiss())
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).toBeVisible()
  page.once('dialog', (prompt) => prompt.accept())
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await page
    .getByRole('button', { name: 'Open navigation', exact: true })
    .click()
  await page
    .getByRole('navigation', { name: 'Primary navigation', exact: true })
    .getByRole('link', { name: 'Inventory', exact: true })
    .click()
  await expect(page.locator('.sidebar')).not.toHaveClass(/is-open/)
  await page
    .getByRole('navigation', { name: 'Inventory tabs' })
    .getByRole('link', { name: 'Craft Materials', exact: true })
    .click()
  await expect(
    page.getByRole('article', { name: 'Cotton fabric', exact: true }),
  ).toBeVisible()
})
test('resale receipt and handmade completion editors send explicit quantities, waste and stable operation IDs', async ({
  page,
}) => {
  const { writes } = await fixture(page)
  await page.goto(workspaceFixtureUrl('Inventory/Finished Goods'))
  await page
    .getByRole('button', { name: 'Receive stock', exact: true })
    .last()
    .click()
  const dialog = page.getByRole('dialog')
  await expect(
    dialog.getByLabel('Total acquisition cost', { exact: true }),
  ).toHaveValue('') // number input starts deliberately empty
  await dialog
    .getByLabel('Purchase quantity (packs/cases)', { exact: true })
    .fill('2')
  await dialog.getByLabel('Purchase unit', { exact: true }).selectOption('case')
  await dialog.getByLabel('Items per purchase unit', { exact: true }).fill('12')
  await dialog.getByLabel('Total acquisition cost', { exact: true }).fill('72')
  await dialog
    .getByLabel('Movement reason', { exact: true })
    .fill('Two cases purchased')
  await expect(
    dialog.getByText('Receipt: 24 sellable items', { exact: false }),
  ).toBeVisible()
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  const receipt = writes.find((w) => w.action === 'receive')!
  expect(receipt.table).toBe('products')
  expect(receipt.data.operationId).toBeTruthy()
  await page.goto(workspaceFixtureUrl('Production/Production Runs'))
  await page
    .getByRole('button', { name: 'Complete production', exact: true })
    .click()
  await dialog.getByLabel('Completed sellable items', { exact: true }).fill('2')
  await dialog
    .getByLabel('Additional material waste (m)', { exact: true })
    .fill('0.1')
  await dialog
    .getByLabel('Waste / adjustment explanation', { exact: true })
    .fill('Trimming')
  await dialog
    .getByRole('button', { name: 'Complete production', exact: true })
    .click()
  expect(
    writes.find((w) => w.action === 'complete')!.data.materialWaste,
  ).toEqual({ cotton: '0.1' })
})
