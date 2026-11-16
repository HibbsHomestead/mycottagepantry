import { test, expect } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import type { Item } from '../src/lib/domain'
import { demoData } from '../src/lib/demo'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'
import { productionDefinition } from '../src/lib/production'
const dir = 'docs/reviews/responsive-production'

test('available workspace widths, sparse results and resizing state', async ({
  page,
}) => {
  await mkdir(dir, { recursive: true })
  await installWorkspaceFixture(page)
  const workspace = demoData()
  const seed = workspace.ingredients[0]
  workspace.ingredients = Array.from({ length: 30 }, (_, i) => ({
    ...seed,
    id: `width-item-${i}`,
    name: `Responsive ${i} · Long bakery ingredient name with package sizes and descriptive values`,
    quantity: 1234567.89,
    cost: 1.23,
  }))
  let requests = 0
  await page.route('**/api/workspace*', (r) => {
    requests++
    return r.fulfill({ json: { workspace, role: 'Owner', demo: false } })
  })
  const rows: unknown[] = []
  await page.goto(workspaceFixtureUrl('Inventory/Ingredients'))
  const grid = page.locator('.pantry-card-grid').first()
  await expect(grid).toBeVisible()
  for (const width of [1366, 1440, 1920, 2560, 390]) {
    await page.setViewportSize({ width, height: 1100 })
    await page.waitForTimeout(150)
    const metrics = await grid.evaluate((el) => ({
      columns: getComputedStyle(el).gridTemplateColumns.split(' ').length,
      gridWidth: el.getBoundingClientRect().width,
      overflow: document.documentElement.scrollWidth > innerWidth,
    }))
    expect(metrics.overflow).toBe(false)
    rows.push({ viewport: width, ...metrics })
    await page.screenshot({
      path: `${dir}/inventory-${width}.png`,
      fullPage: false,
    })
    if (width > 1000)
      for (const [scenario, content] of [
        [
          'collapsed sidebar',
          '.sidebar {width:80px !important} .main-shell {margin-left:80px !important}',
        ],
        [
          'internal menu absent',
          '.internal-section-nav {display:none !important} .section-workspace {grid-template-columns:minmax(0,1fr) !important}',
        ],
        [
          'collapsed sidebar and internal menu absent',
          '.sidebar {width:80px !important} .main-shell {margin-left:80px !important} .internal-section-nav {display:none !important} .section-workspace {grid-template-columns:minmax(0,1fr) !important}',
        ],
      ]) {
        const style = await page.addStyleTag({ content })
        rows.push({
          viewport: width,
          scenario: `simulated ${scenario}`,
          columns: await grid.evaluate(
            (el) => getComputedStyle(el).gridTemplateColumns.split(' ').length,
          ),
        })
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true)
        await style.evaluate((el) => el.parentNode?.removeChild(el))
      }
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  const search = page.getByPlaceholder(/search/i).first()
  await search.fill('Responsive 1 ·')
  const count = await grid.locator('.pantry-card').count()
  expect(count).toBe(1)
  const beforeRequests = requests
  await page.setViewportSize({ width: 2560, height: 1000 })
  await expect(search).toHaveValue('Responsive 1 ·')
  expect(await grid.locator('.pantry-card').count()).toBe(1)
  expect(
    await grid
      .locator('.pantry-card')
      .first()
      .evaluate((e) => e.getBoundingClientRect().width),
  ).toBeLessThanOrEqual(416)
  expect(requests).toBe(beforeRequests)
  await page.screenshot({ path: `${dir}/one-item-2560.png` })
  await search.fill('Responsive')
  const collapsed = await page.addStyleTag({
    content:
      '.sidebar {width:80px !important} .main-shell {margin-left:80px !important}',
  })
  rows.push({
    scenario: 'simulated collapsed main sidebar',
    viewport: 2560,
    columns: await grid.evaluate(
      (el) => getComputedStyle(el).gridTemplateColumns.split(' ').length,
    ),
  })
  const noMenu = await page.addStyleTag({
    content:
      '.internal-section-nav {display:none !important} .section-workspace {grid-template-columns:minmax(0,1fr) !important}',
  })
  rows.push({
    scenario: 'simulated collapsed main sidebar, internal menu absent',
    viewport: 2560,
    columns: await grid.evaluate(
      (el) => getComputedStyle(el).gridTemplateColumns.split(' ').length,
    ),
  })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  await noMenu.evaluate((el) => el.parentNode?.removeChild(el))
  await collapsed.evaluate((el) => el.parentNode?.removeChild(el))

  for (const width of [683, 720, 960, 1280]) {
    await page.setViewportSize({ width, height: 550 })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    rows.push({
      zoom: '200% equivalent reflow',
      effectiveViewport: width,
      columns: await grid.evaluate(
        (el) => getComputedStyle(el).gridTemplateColumns.split(' ').length,
      ),
    })
  }

  workspace.ingredients = workspace.ingredients.slice(0, 2)
  await page.setViewportSize({ width: 2560, height: 1000 })
  await page.reload()
  await expect(grid.locator('.pantry-card')).toHaveCount(2)
  await page.screenshot({ path: `${dir}/two-items-2560.png` })
  await writeFile(
    `${dir}/grid-measurements.json`,
    JSON.stringify(rows, null, 2),
  )
})

test('multi-product draft, material summary, saved review and finalized details', async ({
  page,
}) => {
  await mkdir(dir, { recursive: true })
  await page.setViewportSize({ width: 1440, height: 1100 })
  await installWorkspaceFixture(page)
  const workspace = demoData()
  const product = workspace.products[0]
  const recipe = workspace.recipes.find((r) => r.id === product.recipeId)!
  recipe.yieldUnit = 'each'
  workspace.products.push({
    ...product,
    id: 'second-food',
    name: 'Market cookie box',
  })
  const mapping = { quantity: 1, unit: 'each', verified: true }
  const lines = [product, workspace.products.at(-1)!].map((p, i) => ({
    id: `product-line-${i}`,
    name: p.name,
    productId: p.id,
    quantity: 2,
    output: 2,
    waste: 0,
    mapping,
    definition: productionDefinition(p, workspace, {
      id: '',
      name: '',
      ...mapping,
    }),
    usage: {},
    materialWaste: {},
  }))
  // Generous synthetic stock; browser verification never posts to a business.
  workspace.ingredients.forEach((i) => {
    i.quantity = 100000
    i.needsCostSetup = false
    i.cost = Number(i.cost || 0.1)
  })
  const run: Item = {
    id: 'multi-browser-run',
    name: 'Morning market production',
    productionVersion: 2,
    revision: 1,
    status: 'draft',
    date: '2026-11-16',
    lines,
    quantity: 4,
  }
  workspace.batches.push(run)
  await page.route('**/api/workspace*', (r) => {
    if (r.request().method() === 'POST') {
      const body = r.request().postDataJSON()
      if (body.action === 'productionSave')
        Object.assign(run, body.data, {
          productionVersion: 2,
          revision: run.revision + 1,
        })
      if (body.action === 'productionComplete')
        Object.assign(run, {
          status: 'completed',
          revision: run.revision + 1,
          completedAt: '2026-11-16T04:00:00Z',
          finalizedBy: 'Fixture owner',
          historicalCost: 24,
          lines: run.lines.map((l: Item) => ({
            ...l,
            actualYield: l.output,
            historicalCost: 12,
            usage: [],
            costSnapshot: { labor: 2, overhead: 1 },
          })),
        })
    }
    return r.fulfill({ json: { workspace, role: 'Owner', demo: false } })
  })
  await page.goto(workspaceFixtureUrl('Production/Batch runs'))
  await page.getByRole('button', { name: 'Review draft', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(
    dialog.getByRole('combobox', { name: 'Product', exact: true }),
  ).toHaveCount(2)

  await dialog
    .getByRole('spinbutton', {
      name: 'Planned selling packages / finished units',
      exact: true,
    })
    .first()
    .fill('3')
  await dialog.getByRole('button', { name: 'Save draft', exact: true }).click()
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'Review draft', exact: true }).click()
  await expect(
    dialog
      .getByRole('spinbutton', {
        name: 'Planned selling packages / finished units',
        exact: true,
      })
      .first(),
  ).toHaveValue('3')
  await dialog.getByRole('button', { name: 'Add product', exact: true }).click()
  await expect(
    dialog.getByRole('combobox', { name: 'Product', exact: true }),
  ).toHaveCount(3)
  await dialog
    .getByRole('button', { name: 'Remove product', exact: true })
    .last()
    .click()
  await dialog.getByRole('button', { name: 'Save draft', exact: true }).click()
  await dialog.evaluate((el) => {
    el.scrollTop = 0
  })
  await page.screenshot({ path: `${dir}/multi-product-draft.png` })
  await dialog
    .getByRole('heading', { name: 'Combined material requirements' })
    .scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${dir}/combined-materials.png` })

  await page.setViewportSize({ width: 390, height: 844 })
  await dialog
    .locator('.production-product-line summary')
    .filter({ hasText: 'Output, waste and notes' })
    .first()
    .click()
  for (const control of await dialog
    .locator('input:visible, select:visible, textarea:visible, button:visible')
    .all()) {
    await control.scrollIntoViewIfNeeded()
    const b = (await control.boundingBox())!
    expect(b.x).toBeGreaterThanOrEqual(0)
    expect(b.x + b.width).toBeLessThanOrEqual(391)
  }
  expect(
    await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBe(true)
  await page.screenshot({ path: `${dir}/draft-mobile.png` })
  await page.setViewportSize({ width: 1440, height: 1100 })
  await dialog
    .getByRole('button', { name: 'Review finalization', exact: true })
    .click()
  await dialog
    .getByRole('heading', { name: 'Finalization review' })
    .scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${dir}/finalization-review.png` })
  await dialog
    .getByRole('button', { name: 'Finalize run', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'View run', exact: true })
    .last()
    .click()
  await expect(
    page.getByRole('dialog').getByText(/Actual run cost/),
  ).toBeVisible()
  await page.screenshot({ path: `${dir}/finalized-run.png` })
})

test('Products, Recipes and Handmade share automatic list grids', async ({
  page,
}) => {
  await installWorkspaceFixture(page)
  const workspace = demoData()
  const seed = workspace.products[0]
  workspace.products.push(
    ...Array.from({ length: 12 }, (_, n) => ({
      ...seed,
      id: `responsive-product-${n}`,
      name: `Handmade market gift ${n}`,
      workflow: 'handmade',
    })),
  )
  await page.route('**/api/workspace*', (r) =>
    r.fulfill({ json: { workspace, role: 'Owner', demo: false } }),
  )
  const results: unknown[] = []
  for (const [name, route, selector] of [
    ['products', 'Products/All Products', '.pantry-card-grid'],
    ['recipes', 'Production/Recipes & Designs', '.recipe-grid'],
    ['handmade', 'Handmade/Overview', '.pantry-card-grid'],
  ]) {
    for (const width of [1366, 1440, 1920, 2560, 390, 683, 720, 960, 1280]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.goto(workspaceFixtureUrl(route))
      const grid = page.locator(selector).first()
      await expect(grid).toBeVisible()
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
      results.push({
        page: name,
        width,
        columns: await grid.evaluate(
          (el) => getComputedStyle(el).gridTemplateColumns.split(' ').length,
        ),
      })
      if (width === 1440 || width === 390)
        await page.screenshot({ path: `${dir}/${name}-${width}.png` })
    }
  }
  await writeFile(
    `${dir}/other-list-measurements.json`,
    JSON.stringify(results, null, 2),
  )
})
