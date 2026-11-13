import { test, expect } from '@playwright/test'
import { demoData } from '../src/lib/demo'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'
for (const width of [390, 820, 1440])
  test(`product and assembly review stays bounded at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await installWorkspaceFixture(page)
    const workspace = demoData()
    workspace.recipes.find(
      (r) => r.id === workspace.products[0].recipeId,
    )!.yieldUnit = 'each'
    workspace.products.push({
      id: 'test-kit',
      name: 'Market bread kit',
      workflow: 'kit',
      status: 'active',
      quantity: 0,
      cost: 0,
      price: 99,
      assemblyMinutes: 5,
      assemblyRate: 12,
      kitComponents: [
        { productId: workspace.products[0].id, quantity: 2, basis: 'package' },
      ],
      packagingLines: [],
    })
    let writes = 0
    await page.route('**/api/workspace', (r) => {
      if (r.request().method() !== 'GET') writes++
      return r.fulfill({ json: { workspace, role: 'Owner', demo: false } })
    })
    await page.goto(workspaceFixtureUrl('Dashboard'))
    await page
      .getByRole('button', { name: 'Start production', exact: true })
      .first()
      .click()
    const dialog = page.getByRole('dialog')
    await expect(
      dialog.getByRole('heading', { name: 'Start production' }),
    ).toBeVisible()
    await dialog
      .getByRole('combobox', { name: 'Product', exact: true })
      .selectOption(workspace.products[0].id)
    await dialog
      .getByRole('spinbutton', {
        name: 'Recipe output per selling package',
        exact: true,
      })
      .fill('1')
    await dialog
      .getByRole('combobox', { name: 'Output unit', exact: true })
      .selectOption('each')
    await dialog.getByRole('checkbox').check()
    await dialog.getByRole('button', { name: 'Review requirements' }).click()
    await expect(
      dialog.getByRole('heading', { name: 'Production requirements' }),
    ).toBeVisible()
    await dialog
      .getByRole('combobox', { name: 'Product', exact: true })
      .selectOption('test-kit')
    await dialog.getByRole('button', { name: 'Review requirements' }).click()
    await expect(
      dialog.getByText(
        'Uses existing finished stock. Component manufacturing is separate.',
      ),
    ).toBeVisible()
    await expect(
      dialog.getByRole('cell', { name: /Shortage/ }).first(),
    ).toBeVisible()
    for (let i = 0; i < 2; i++) {
      const bounds = (await dialog.boundingBox())!
      expect(bounds.x).toBeGreaterThanOrEqual(0)
      expect(bounds.y).toBeGreaterThanOrEqual(0)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1)
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(901)
      for (const control of await dialog
        .locator('button:visible,input:visible,select:visible')
        .all()) {
        await control.scrollIntoViewIfNeeded()
        const b = (await control.boundingBox())!
        expect(b.y).toBeGreaterThanOrEqual(0)
        expect(b.y + b.height).toBeLessThanOrEqual(901)
      }
    }
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    await page
      .getByRole('button', { name: 'Start production', exact: true })
      .first()
      .click()
    await expect(page.getByRole('dialog')).toBeVisible()
    expect(writes).toBe(0)
  })

test('all production entry points use the shared product workflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await installWorkspaceFixture(page)
  const workspace = demoData()
  workspace.recipes.find(
    (r) => r.id === workspace.products[0].recipeId,
  )!.yieldUnit = 'each'
  const kit = {
    id: 'entry-kit',
    name: 'Market kit',
    workflow: 'kit',
    status: 'active',
    quantity: 0,
    cost: 0,
    price: 30,
    assemblyMinutes: 2,
    assemblyRate: 12,
    kitComponents: [
      { productId: workspace.products[0].id, quantity: 1, basis: 'package' },
    ],
    packagingLines: [],
  }
  workspace.products.push(kit)
  await page.route('**/api/workspace*', (r) =>
    r.fulfill({ json: { workspace, role: 'Owner', demo: false } }),
  )
  await page.goto(workspaceFixtureUrl('Dashboard'))
  await page.getByRole('button', { name: 'Quick Add', exact: true }).click()
  await page
    .getByRole('menuitem', { name: 'Start production', exact: true })
    .click()
  await expect(
    page
      .getByRole('dialog')
      .getByRole('combobox', { name: 'Product', exact: true }),
  ).toHaveValue('')
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Close', exact: true })
    .click()
  await page.goto(workspaceFixtureUrl('Production/Overview'))
  await page
    .getByRole('button', { name: 'Start production', exact: true })
    .first()
    .click()
  await expect(
    page
      .getByRole('dialog')
      .getByRole('combobox', { name: 'Product', exact: true }),
  ).toBeVisible()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Close', exact: true })
    .click()
  await page.goto(workspaceFixtureUrl('Products/All Products'))
  await page
    .getByRole('article', { name: workspace.products[0].name, exact: true })
    .getByRole('button', { name: 'View details', exact: true })
    .click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Produce', exact: true })
    .click()
  await expect(
    page
      .getByRole('dialog')
      .getByRole('combobox', { name: 'Product', exact: true }),
  ).toHaveValue(workspace.products[0].id)
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Close', exact: true })
    .click()
  await page
    .getByRole('article', { name: kit.name, exact: true })
    .getByRole('button', { name: kit.name, exact: true })
    .click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Assemble', exact: true })
    .click()
  await expect(
    page
      .getByRole('dialog')
      .getByRole('combobox', { name: 'Product', exact: true }),
  ).toHaveValue(kit.id)
  await expect(
    page
      .getByRole('dialog')
      .getByRole('spinbutton', { name: 'Kits to assemble', exact: true }),
  ).toBeVisible()
})

test('confirmed plan stays open for actual-output review and final production', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await installWorkspaceFixture(page)
  const workspace = demoData()
  workspace.recipes.find(
    (r) => r.id === workspace.products[0].recipeId,
  )!.yieldUnit = 'each'
  const { productionDefinition } = await import('../src/lib/production')
  await page.route('**/api/workspace*', async (r) => {
    if (r.request().method() === 'POST') {
      const body = r.request().postDataJSON()
      expect(body.action).toBe('productionSave')
      const product = workspace.products.find(
        (p) => p.id === body.data.productId,
      )!
      workspace.batches.push({
        ...body.data,
        name: product.name,
        status: 'scheduled',
        productionVersion: 1,
        recipeId: product.recipeId,
        definition: productionDefinition(product, workspace, body.data.mapping),
      })
    }
    return r.fulfill({ json: { workspace, role: 'Owner', demo: false } })
  })
  await page.goto(workspaceFixtureUrl('Dashboard'))
  await page
    .getByRole('button', { name: 'Start production', exact: true })
    .first()
    .click()
  const dialog = page.getByRole('dialog')
  await dialog
    .getByRole('combobox', { name: 'Product', exact: true })
    .selectOption(workspace.products[0].id)
  await dialog
    .getByRole('spinbutton', {
      name: 'Recipe output per selling package',
      exact: true,
    })
    .fill('1')
  await dialog
    .getByRole('combobox', { name: 'Output unit', exact: true })
    .selectOption('each')
  await dialog.getByRole('checkbox').check()
  await dialog
    .getByRole('button', { name: 'Review requirements', exact: true })
    .click()
  await dialog
    .getByRole('button', { name: 'Confirm plan', exact: true })
    .click()
  await expect(
    dialog.getByRole('spinbutton', {
      name: 'Actual usable output (packages)',
      exact: true,
    }),
  ).toBeVisible()
  await expect(
    dialog.getByRole('button', { name: 'Confirm production', exact: true }),
  ).toBeVisible()
  await expect(
    dialog.getByRole('combobox', { name: 'Product', exact: true }),
  ).toBeDisabled()
})
