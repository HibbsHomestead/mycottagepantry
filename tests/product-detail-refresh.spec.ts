import { test, expect } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { demoData } from '../src/lib/demo'
import { blankLabel } from '../src/lib/label-studio'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'
const phase = process.env.DETAIL_PHASE || 'after'
for (const [width, height] of [
  [1366, 768],
  [1440, 900],
  [2560, 1200],
  [390, 844],
  [960, 540],
]) {
  test(`detail refresh ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    await installWorkspaceFixture(page)
    const workspace = demoData()
    const p = workspace.products[0]
    p.imageAssetId = 'transparent'
    workspace.graphic_assets = [
      {
        id: 'transparent',
        name: 'Transparent product',
        fileUrl: '/fixture-photo.svg',
      },
    ]
    workspace.label_templates = Array.from({ length: 2 }, (_, i) => ({
      ...blankLabel(),
      id: `label-${i}`,
      name: `${p.name} · ${i ? 'Market' : 'Kitchen'}`,
      workflowVersion: 1,
      recordKind: 'label',
      revision: 1,
      productId: p.id,
      source: { kind: 'product', id: p.id },
    }))
    await page.route('**/fixture-photo.svg', (r) =>
      r.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><ellipse cx="200" cy="170" rx="145" ry="85" fill="#bb884f"/><path d="M140 110l-20 65m90-80l-20 70m90-50l-20 65" stroke="#f5d9a5" stroke-width="14" stroke-linecap="round"/></svg>',
      }),
    )
    await page.route('**/api/workspace*', (r) =>
      r.fulfill({ json: { workspace, role: 'Owner', demo: false } }),
    )
    await page.goto(workspaceFixtureUrl('Products/Food'))
    const card = page.getByRole('article', { name: p.name, exact: true })
    await expect(card).toBeVisible()
    const dir = 'docs/reviews/product-refresh'
    mkdirSync(dir, { recursive: true })
    await page.screenshot({ path: `${dir}/${phase}-cards-${width}.png` })
    await card
      .getByRole('button', { name: 'View details', exact: true })
      .click()
    const dialog = page.getByRole('dialog', { name: p.name, exact: true })
    await expect(
      dialog.getByRole('heading', { name: 'Labels', exact: true }),
    ).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: `${dir}/${phase}-${width}.png` })
    const geometry = await dialog.evaluate((el) => ({
      width: el.clientWidth,
      height: el.clientHeight,
      scroll: el.scrollHeight - el.clientHeight,
      overflowX: el.scrollWidth - el.clientWidth,
      nested: [...el.querySelectorAll('*')].filter(
        (x) =>
          /(auto|scroll)/.test(getComputedStyle(x).overflowY) &&
          x.scrollHeight > x.clientHeight + 1,
      ).length,
    }))
    writeFileSync(
      `${dir}/${phase}-${width}.json`,
      JSON.stringify(geometry, null, 2),
    )
    expect(geometry.overflowX).toBeLessThanOrEqual(1)
    expect(geometry.nested).toBe(0)
    await expect(
      dialog.getByRole('button', { name: 'Preview/Print' }),
    ).toHaveCount(2)
    if (phase === 'after') {
      await dialog.getByText('How this is calculated', { exact: true }).click()
      await dialog
        .getByText(
          'Period operating expenses and processing fees also affect net profit.',
          { exact: false },
        )
        .scrollIntoViewIfNeeded()
      await page.screenshot({ path: `${dir}/expanded-${width}.png` })
      await dialog
        .getByRole('button', { name: 'Close', exact: true })
        .first()
        .click()
      await expect(dialog).not.toBeVisible()
    }
    await page.unrouteAll({ behavior: 'ignoreErrors' })
  })
}

for (const scenario of [
  'many-labels',
  'no-image',
  'resale',
  'kit',
  'handmade',
  'taxed-food',
  'taxed-food-laptop',
]) {
  test(`detail scenario ${scenario}`, async ({ page }) => {
    await page.setViewportSize(
      scenario.endsWith('laptop')
        ? { width: 1366, height: 768 }
        : { width: 1440, height: 900 },
    )
    await installWorkspaceFixture(page)
    const workspace = demoData(),
      p = workspace.products[0]
    if (['resale', 'kit', 'handmade'].includes(scenario)) p.workflow = scenario
    if (scenario.startsWith('taxed-food')) {
      workspace.settings[0].taxRates = [
        {
          id: 'tax',
          name: 'Sales tax',
          jurisdiction: 'Fixture jurisdiction',
          ratePercent: 5.1,
          behavior: 'exclusive',
          active: true,
        },
      ]
      p.taxRateIds = ['tax']
    }
    if (scenario === 'many-labels') {
      p.name =
        'Homestyle White Bread with Rosemary, Roasted Garlic and a Very Long Seasonal Market Description'
      workspace.label_templates = Array.from({ length: 16 }, (_, i) => ({
        ...blankLabel(),
        id: `long-${i}`,
        name: `Market label ${i + 1} · ${'Long seasonal name '.repeat(8)}`,
        workflowVersion: 1,
        recordKind: 'label',
        revision: 1,
        productId: p.id,
        source: { kind: 'product', id: p.id },
      }))
    }
    await page.route('**/api/workspace*', (r) =>
      r.fulfill({ json: { workspace, role: 'Owner', demo: false } }),
    )
    await page.goto(workspaceFixtureUrl('Products/All Products'))
    await page
      .getByRole('article', { name: p.name, exact: true })
      .getByRole('button', { name: 'View details', exact: true })
      .click()
    const dialog = page.getByRole('dialog', { name: p.name, exact: true })
    await expect(dialog).toBeVisible()
    const metrics = await dialog.evaluate((el) => ({
      width: el.clientWidth,
      height: el.clientHeight,
      scroll: el.scrollHeight - el.clientHeight,
    }))
    writeFileSync(
      `docs/reviews/product-refresh/${scenario}.json`,
      JSON.stringify(metrics, null, 2),
    )
    await page.screenshot({
      path: `docs/reviews/product-refresh/${scenario}.png`,
    })
    for (const control of await dialog.getByRole('button').all()) {
      await control.scrollIntoViewIfNeeded()
      await expect(control).toBeInViewport()
    }
    expect(
      await dialog.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1)
    await page.screenshot({
      path: `docs/reviews/product-refresh/${scenario}-end.png`,
    })
    await dialog
      .getByRole('button', { name: 'Close', exact: true })
      .first()
      .click()
    await expect(dialog).not.toBeVisible()
    await page.unrouteAll({ behavior: 'ignoreErrors' })
  })
}

test('canonical recipe dropdown', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installWorkspaceFixture(page)
  const workspace = demoData()
  await page.route('**/api/workspace*', (r) =>
    r.fulfill({ json: { workspace, role: 'Owner', demo: false } }),
  )
  await page.goto(workspaceFixtureUrl('Production/Recipes & Designs'))
  await page.getByRole('button', { name: 'Create recipe', exact: true }).click()
  const select = page.getByRole('combobox', { name: 'Category', exact: true })
  await expect(select).toBeVisible()
  await expect(select.locator('option')).not.toHaveCount(0)
  const names = await select.locator('option').allTextContents()
  for (const name of [
    'Breads & Rolls',
    'Cakes & Cupcakes',
    'Preps, Fillings & Toppings',
    'Frostings, Icings & Glazes',
  ])
    expect(names.filter((n) => n === name)).toHaveLength(1)
  for (const name of ['Breads', 'Cakes', 'Fillings', 'Preps & fillings'])
    expect(names).not.toContain(name)
  await select.selectOption({ label: 'Preps, Fillings & Toppings' })
  await select.focus()
  await page.screenshot({
    path: 'docs/reviews/product-refresh/categories-dropdown.png',
  })
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})

test('product workflows retain a return to the originating product', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installWorkspaceFixture(page)
  const workspace = demoData(),
    product = workspace.products[0]
  workspace.label_templates = [
    {
      ...blankLabel(),
      id: 'context-label',
      name: 'Kitchen label',
      workflowVersion: 1,
      recordKind: 'label',
      revision: 1,
      productId: product.id,
      source: { kind: 'product', id: product.id },
    },
  ]
  let writes = 0
  await page.route('**/api/workspace*', (r) => {
    if (r.request().method() !== 'GET') writes++
    return r.fulfill({ json: { workspace, role: 'Owner', demo: false } })
  })
  await page.goto(workspaceFixtureUrl('Products/Food'))
  await page
    .getByRole('article', { name: product.name, exact: true })
    .getByRole('button', { name: 'View details', exact: true })
    .click()
  const detail = page.getByRole('dialog', { name: product.name, exact: true })
  await detail
    .getByRole('button', { name: 'Edit Product', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Back to product details', exact: true })
    .click()
  await expect(detail).toBeVisible()
  await detail.getByRole('button', { name: 'Open recipe', exact: true }).click()
  await page
    .getByRole('button', { name: 'Back to product details', exact: true })
    .click()
  await expect(detail).toBeVisible()
  await detail.getByRole('button', { name: 'Edit', exact: true }).click()
  await expect(page.getByLabel('Label name', { exact: true })).toHaveValue(
    'Kitchen label',
  )
  await page
    .getByRole('button', { name: 'Back to product details', exact: true })
    .click()
  await expect(detail).toBeVisible()
  expect(writes).toBe(0)
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})
