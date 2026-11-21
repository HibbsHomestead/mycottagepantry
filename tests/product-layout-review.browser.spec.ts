import { test, expect, type Page } from '@playwright/test'
import { demoData } from '../src/lib/demo'
import { blankLabel } from '../src/lib/label-studio'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

const baseline = false
const phase = baseline ? 'before' : 'after'
async function setup(page: Page, role = 'Owner') {
  await installWorkspaceFixture(page)
  const workspace = demoData()
  workspace.products[0].imageAssetId = 'layout-photo'
  workspace.graphic_assets = [
    {
      id: 'layout-photo',
      name: 'Isolated product photo',
      fileUrl: '/artwork/cranberry-orange.png',
    },
    {
      id: 'layout-mockup',
      name: 'Saved layout mockup',
      category: 'product-mockup',
      productId: workspace.products[0].id,
      fileUrl: '/artwork/cranberry-orange.png?fixture=1',
    },
  ]
  workspace.label_templates = [
    {
      ...blankLabel(),
      id: 'layout-label',
      name: 'Isolated linked label',
      productId: workspace.products[0].id,
      source: { kind: 'product', id: workspace.products[0].id },
    },
  ]
  workspace.products.push(
    ...['resale', 'handmade', 'kit'].map((workflow, index) => ({
      id: `layout-${workflow}`,
      name:
        index === 1
          ? 'Handmade lavender and rosemary gift collection with cotton wrap'
          : index === 2
            ? 'Garden morning breakfast gift kit'
            : 'Sparkling botanical drink — sealed 15-pack sold intact',
      workflow,
      price: 18,
      cost: 6,
      quantity: 5,
      stockCostKnown: true,
      taxStatus: 'exempt',
    })),
  )
  let writes = 0
  await page.route('**/api/workspace*', (route) => {
    if (
      route.request().method() === 'POST' &&
      route.request().postDataJSON()?.table !== 'settings'
    )
      writes++
    return route.fulfill({ json: { workspace, role, demo: false } })
  })
  // All ancillary APIs are isolated too; no customer records or remote DB access.
  await page.route('**/api/product-categories*', (route) =>
    route.fulfill({ json: { categories: [], rates: [], mappings: {} } }),
  )
  return { workspace, writes: () => writes }
}

for (const zoom of [1, 0.6])
  test(`product before/after at ${zoom * 100}% equivalent zoom`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: {
        width: Math.round(1600 / zoom),
        height: Math.round(1000 / zoom),
      },
      deviceScaleFactor: zoom,
    })
    const page = await context.newPage()
    const fixture = await setup(page)
    await page.goto(workspaceFixtureUrl('Products/All Products'))
    await page.getByRole('button', { name: 'Table', exact: true }).click()
    const table = page.getByRole('region', { name: 'Products table' })
    if (!baseline) {
      expect(
        await table
          .locator('tbody tr')
          .first()
          .locator('td')
          .nth(1)
          .evaluate((el) => el.getBoundingClientRect().width),
      ).toBeGreaterThanOrEqual(280)
      const slots = await table
        .locator('tbody .item-record-actions')
        .evaluateAll((groups) =>
          groups.map((group) =>
            Array.from(group.children).map(
              (el) => el.getBoundingClientRect().x,
            ),
          ),
        )
      for (const row of slots) expect(row).toEqual(slots[0])
      await expect(table.locator('tbody tr')).toHaveCount(6)
    }
    await page.screenshot({
      path: `docs/reviews/product-layout/${phase}-table-1600-${zoom * 100}.png`,
    })
    await table
      .getByRole('button', {
        name: `View details for ${fixture.workspace.products[0].name}`,
        exact: true,
      })
      .click()
    const dialog = page.getByRole('dialog').first()
    await expect(dialog).toBeVisible()
    if (!baseline) {
      await expect(
        dialog
          .locator('.product-detail-media')
          .getByRole('button', { name: 'Create mockup', exact: true }),
      ).toBeVisible()
      await expect(
        dialog
          .locator('.product-detail-lower')
          .getByRole('heading', { name: 'Labels', exact: true }),
      ).toBeVisible()
      expect(
        await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      ).toBe(true)
    }
    await page.screenshot({
      path: `docs/reviews/product-layout/${phase}-details-1600-${zoom * 100}.png`,
    })
    expect(fixture.writes()).toBe(0)
    await context.close()
  })

if (!baseline) {
  for (const [width, height] of [
    [1280, 800],
    [1024, 768],
    [768, 700],
    [390, 600],
    [1024, 480],
  ])
    test(`readable table and details ${width}x${height}`, async ({ page }) => {
      const fixture = await setup(page, width === 1024 ? 'Baker' : 'Owner')
      await page.setViewportSize({ width, height })
      await page.goto(workspaceFixtureUrl('Products/All Products'))
      await page.getByRole('button', { name: 'Table', exact: true }).click()
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
      ).toBe(true)
      const table = page.getByRole('region', { name: 'Products table' })
      expect(
        await table.evaluate((el) => el.scrollWidth > el.clientWidth),
      ).toBe(true)
      const groups = await table
        .locator('.item-record-actions')
        .evaluateAll((els) =>
          els.map((el) => ({
            height: el.getBoundingClientRect().height,
            y: Array.from(el.children).map((e) => e.getBoundingClientRect().y),
          })),
        )
      for (const group of groups)
        expect(Math.max(...group.y) - Math.min(...group.y)).toBeLessThan(2)
      await table
        .getByRole('button', {
          name: `View details for ${fixture.workspace.products[1].name}`,
          exact: true,
        })
        .click()
      const dialog = page.getByRole('dialog').first()
      await expect(dialog.locator('.product-detail-media')).toBeVisible()
      expect(
        await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      ).toBe(true)
      await dialog
        .getByRole('button', { name: 'Close', exact: true })
        .last()
        .scrollIntoViewIfNeeded()
      await page.screenshot({
        path: `docs/reviews/product-layout/after-details-${width}x${height}.png`,
      })
      expect(fixture.writes()).toBe(0)
    })
  for (const width of [1600, 390])
    test(`trade navigation states ${width}`, async ({ page }) => {
      await setup(page)
      await page.setViewportSize({ width, height: 1000 })
      for (const tab of ['All Products', 'Handmade', 'Resale']) {
        await page.goto(workspaceFixtureUrl(`Products/${tab}`))
        if (width < 1000)
          await page.getByRole('button', { name: /Products ·/ }).click()
        const nav = page.getByRole('navigation', { name: 'Products sections' })
        for (const item of ['Handmade', 'Resale'])
          expect(
            await nav
              .getByRole('link', { name: item, exact: true })
              .getAttribute('aria-current'),
          ).toBe(tab === item ? 'page' : null)
        await page.screenshot({
          path: `docs/reviews/product-layout/nav-submenu-${width}-${tab.replaceAll(' ', '-')}.png`,
        })
      }
      for (const name of ['Products', 'Handmade', 'Resale']) {
        await page.goto(
          workspaceFixtureUrl(
            name === 'Products' ? 'Products/All Products' : name,
          ),
        )
        if (width < 1000)
          await page
            .getByRole('button', { name: 'Open navigation', exact: true })
            .click()
        const nav = page.getByRole('navigation', {
          name: 'Primary navigation',
          exact: true,
        })
        const item = nav.getByRole('link', { name: 'Handmade', exact: true })
        await expect(item).toBeInViewport()
        await item.scrollIntoViewIfNeeded()
        const before = await item.boundingBox()
        if (name === 'Products') {
          await item.hover()
          await page.screenshot({
            path: `docs/reviews/product-layout/nav-hover-${width}.png`,
          })
          await item.focus()
          await page.screenshot({
            path: `docs/reviews/product-layout/nav-focus-${width}.png`,
          })
          expect(await item.boundingBox()).toEqual(before)
        }
        if (name !== 'Products')
          await expect(nav.getByRole('link', { name, exact: true })).toHaveCSS(
            'color',
            'rgb(255, 255, 255)',
          )
        await page.screenshot({
          path: `docs/reviews/product-layout/nav-sidebar-${width}-${name}.png`,
        })
      }
    })
}

test('mockup and label child flows preserve product details', async ({
  page,
}) => {
  const fixture = await setup(page)
  await page.goto(workspaceFixtureUrl('Products/All Products'))
  await page.getByRole('button', { name: 'Table', exact: true }).click()
  await page
    .getByRole('button', {
      name: `View details for ${fixture.workspace.products[0].name}`,
      exact: true,
    })
    .click()
  const details = page.getByRole('dialog', {
    name: fixture.workspace.products[0].name,
    exact: true,
  })
  await details
    .getByRole('button', { name: 'Create mockup', exact: true })
    .click()
  const mockup = page.getByRole('dialog', {
    name: 'Product mockup',
    exact: true,
  })
  await expect(mockup).toBeVisible()
  await mockup.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(details).toBeVisible()
  await details
    .getByRole('button', { name: 'Create label', exact: true })
    .click()
  const label = page.getByRole('dialog', {
    name: 'Create product label',
    exact: true,
  })
  await expect(label).toBeVisible()
  page.once('dialog', (dialog) => dialog.accept())
  await label
    .getByRole('button', { name: 'Close label editor', exact: true })
    .click()
  await expect(details).toBeVisible()
  expect(fixture.writes()).toBe(0)
})

test('resale purchase estimate is explicit in pricing and stock', async ({
  page,
}) => {
  await setup(page)
  await page.goto(workspaceFixtureUrl('Products/All Products'))
  await page.getByRole('button', { name: 'Table', exact: true }).click()
  await page
    .getByRole('button', {
      name: 'Edit Sparkling botanical drink — sealed 15-pack sold intact',
      exact: true,
    })
    .click()
  await page.getByRole('tab', { name: 'Pricing & Stock', exact: true }).click()
  await page.getByLabel('Default purchase price per pack/case').fill('24')
  await page
    .getByLabel('Purchase pack contains this many sellable items')
    .fill('12')
  await expect(
    page.getByText('Configured estimate:', { exact: false }),
  ).toContainText('$2.00')
  await page.screenshot({
    path: 'docs/reviews/product-layout/after-resale-editor.png',
  })
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
})

test('estimated resale costs agree across table, details, cards and editor', async ({
  page,
}) => {
  const fixture = await setup(page)
  const product = fixture.workspace.products.find(
    (p) => p.id === 'layout-resale',
  )!
  Object.assign(product, {
    stockCostKnown: false,
    quantity: 0,
    purchaseDefaults: { packPrice: 24, itemsPerPack: 12, unit: 'case' },
  })
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.goto(workspaceFixtureUrl('Products/All Products'))
  const card = page.getByRole('article', { name: product.name, exact: true })
  await expect(card).toContainText('Estimated cost')
  await expect(card).toContainText('$2.00')
  await page.getByRole('button', { name: 'Table', exact: true }).click()
  const row = page
    .getByRole('row')
    .filter({
      has: page.getByRole('button', { name: product.name, exact: true }),
    })
  await expect(row.locator('td').nth(5)).toContainText('$2.00')
  await expect(row.locator('td').nth(5)).toContainText('Estimated cost')
  await page.screenshot({
    path: 'docs/reviews/product-layout/after-table-1920-100.png',
  })
  await row
    .getByRole('button', {
      name: `View details for ${product.name}`,
      exact: true,
    })
    .click()
  const dialog = page.getByRole('dialog', { name: product.name, exact: true })
  await expect(
    dialog.getByRole('region', { name: 'Resale purchase cost breakdown' }),
  ).toContainText('Estimated cost')
  await expect(
    dialog.getByRole('region', { name: 'Resale purchase cost breakdown' }),
  ).toContainText('$2.00')
  await page.screenshot({
    path: 'docs/reviews/product-layout/after-resale-details-1920-100.png',
  })
  await dialog
    .getByRole('button', { name: 'Edit Product', exact: true })
    .click()
  await page.getByRole('tab', { name: 'Pricing & Stock', exact: true }).click()
  await expect(
    page.getByRole('complementary', { name: 'Cost and margin' }),
  ).toContainText('Estimated cost')
  await expect(
    page.getByRole('complementary', { name: 'Cost and margin' }),
  ).toContainText('$2.00')
  expect(fixture.writes()).toBe(0)
})
