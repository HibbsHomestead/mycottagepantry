import { test, expect, type Locator, type Page } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { demoData } from '../src/lib/demo'
import {
  money,
  productCosting,
  profitability,
  type Item,
} from '../src/lib/domain'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

const output = 'docs/reviews/kit-details'
// Named presentation fixtures, not copies of private customer records or photos.
const regularName = 'Holiday Dressin’ Rolls – 9ct.'
const kitName = "Gather 'Round"
async function setup(
  page: Page,
  options: { missingCategory?: boolean; count?: number } = {},
) {
  await mkdir(output, { recursive: true })
  await installWorkspaceFixture(page)
  const workspace = demoData()
  const regular = workspace.products[0]
  Object.assign(regular, {
    name: regularName,
    workflow: 'food',
    unitsPerPackage: 9,
    sellingUnit: '9ct tray',
    contentUnit: 'rolls',
    imageAssetId: 'test-photo',
  })
  workspace.graphic_assets = [
    {
      id: 'test-photo',
      name: 'Presentation test image',
      fileUrl: '/kit-test-photo.svg',
    },
  ]
  await page.route('**/kit-test-photo.svg', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="720" height="480"><rect width="720" height="480" fill="#eee3cf"/><g fill="#b67d42" stroke="#9a6433" stroke-width="4"><ellipse cx="210" cy="140" rx="65" ry="42"/><ellipse cx="360" cy="140" rx="65" ry="42"/><ellipse cx="510" cy="140" rx="65" ry="42"/><ellipse cx="210" cy="240" rx="65" ry="42"/><ellipse cx="360" cy="240" rx="65" ry="42"/><ellipse cx="510" cy="240" rx="65" ry="42"/><ellipse cx="210" cy="340" rx="65" ry="42"/><ellipse cx="360" cy="340" rx="65" ry="42"/><ellipse cx="510" cy="340" rx="65" ry="42"/></g></svg>',
    }),
  )
  const kit: Item = {
    id: 'gather-round',
    name: kitName,
    workflow: 'kit',
    status: 'active',
    price: 42,
    assemblyMinutes: 12,
    assemblyRate: 18,
    imageAssetId: 'test-photo',
    kitComponents: [
      { productId: regular.id, quantity: 2, basis: 'package' },
      { productId: workspace.products[1].id, quantity: 1, basis: 'package' },
    ],
    packagingLines: [{ ingredientId: 'bags', quantity: 1, unit: 'each' }],
  }
  if (options.missingCategory) kit.taxSource = 'category'
  for (let i = 2; i < (options.count || 2); i++) {
    const component = {
      ...regular,
      id: 'extra-' + i,
      name: `Additional included product ${i} with a long readable name`,
    }
    workspace.products.push(component)
    kit.kitComponents.push({
      productId: component.id,
      quantity: 1,
      basis: 'package',
    })
  }
  workspace.products.push(kit)
  const writes: Item[] = []
  const stockBefore = JSON.stringify({
    ingredients: workspace.ingredients,
    quantities: workspace.products.map((p) => [p.id, p.quantity]),
    ledger: workspace.ledger,
    batches: workspace.batches,
    sales: workspace.sales,
  })
  await page.route('**/api/workspace*', (route) => {
    if (route.request().method() === 'POST') {
      const payload = route.request().postDataJSON()
      writes.push(payload)
      expect(payload.action).toBe('save')
      expect(payload.table).toBe('products')
      expect(payload.data.workflow).toBe('kit')
      const index = workspace.products.findIndex(
        (p) => p.id === payload.data.id,
      )
      if (index < 0) workspace.products.push(payload.data)
      else workspace.products[index] = payload.data
    }
    return route.fulfill({ json: { workspace, role: 'Owner', demo: false } })
  })
  await page.goto(workspaceFixtureUrl('Products'), { waitUntil: 'networkidle' })
  return {
    workspace,
    regular,
    kit,
    writes,
    assertStock() {
      expect(
        JSON.stringify({
          ingredients: workspace.ingredients,
          quantities: workspace.products
            .filter((p) => p.id !== 'new-kit')
            .map((p) => [p.id, p.quantity]),
          ledger: workspace.ledger,
          batches: workspace.batches,
          sales: workspace.sales,
        }),
      ).toBe(stockBefore)
    },
  }
}
const card = (dialog: Locator, label: string) =>
  dialog
    .locator('.cost-card')
    .filter({ has: dialog.page().getByText(label, { exact: true }) })
    .locator('strong')
async function geometry(dialog: Locator) {
  await dialog.evaluate((el) =>
    Promise.all(
      el
        .getAnimations({ subtree: true })
        .map((a) => a.finished.catch(() => {})),
    ),
  )
  return dialog.evaluate((panel) => {
    const rect = panel.getBoundingClientRect()
    const style = (selector: string) => {
      const el = panel.querySelector(selector)!
      const css = getComputedStyle(el),
        box = el.getBoundingClientRect()
      return {
        x: box.x - rect.x,
        width: box.width,
        height: box.height,
        top: box.top - rect.top,
        font: css.font,
        padding: css.padding,
        radius: css.borderRadius,
        background: css.backgroundColor,
      }
    }
    return {
      width: rect.width,
      height: rect.height,
      columns: getComputedStyle(panel.querySelector('.product-detail-layout')!)
        .gridTemplateColumns,
      title: style('[data-slot="dialog-title"]'),
      photo: style('.product-detail-photo'),
      costCard: style('.detail-stats .cost-card'),
      button: style('.product-detail-actions .btn'),
      overflow: panel.scrollWidth - panel.clientWidth,
    }
  })
}
for (const width of [1440, 768, 390]) {
  test(`shared product/kit details, linked return, edit/save refresh and stock at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 950 })
    const { workspace, kit, writes, assertStock } = await setup(page)
    await page
      .getByRole('article', { name: regularName, exact: true })
      .getByRole('button', { name: 'View details', exact: true })
      .click()
    const dialog = page.getByRole('dialog')
    await expect(
      dialog.getByRole('heading', { name: regularName, exact: true }),
    ).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    const reference = await geometry(dialog)
    await page.screenshot({
      path: `${output}/regular-product-${width}.png`,
      animations: 'disabled',
    })
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    await page
      .getByRole('article', { name: kitName, exact: true })
      .getByRole('button', { name: kitName, exact: true })
      .click()
    await expect(
      dialog.getByRole('heading', { name: kitName, exact: true }),
    ).toBeVisible()
    await expect(dialog.getByRole('tab')).toHaveCount(0)
    const actual = await geometry(dialog)
    expect(actual.width).toBe(reference.width)
    expect(actual.height).toBe(reference.height)
    expect(actual.columns).toBe(reference.columns)
    expect(actual.photo.width).toBe(reference.photo.width)
    expect(actual.photo.height).toBe(reference.photo.height)
    expect(actual.photo.x).toBe(reference.photo.x)
    for (const key of ['font', 'padding', 'radius', 'background'] as const) {
      expect(actual.costCard[key]).toBe(reference.costCard[key])
      expect(actual.button[key]).toBe(reference.button[key])
    }
    expect(actual.title.font).toBe(reference.title.font)
    expect(actual.overflow).toBeLessThanOrEqual(1)
    expect(
      actual.photo.top - actual.title.top - actual.title.height,
    ).toBeCloseTo(
      reference.photo.top - reference.title.top - reference.title.height,
      0,
    )
    await expect(dialog.locator('img')).toHaveCSS('object-fit', 'contain')
    const costing = productCosting(kit, workspace),
      pricing = profitability(kit, costing.perPackage, workspace.settings[0])
    await expect(card(dialog, 'Total cost per kit')).toHaveText(
      money(costing.perPackage),
    )
    await expect(card(dialog, 'Profit per kit')).toHaveText(
      money(pricing.profit),
    )
    await expect(card(dialog, 'Margin')).toHaveText(
      `${pricing.margin.toFixed(2)}%`,
    )
    const included = dialog.getByRole('region', {
      name: 'Included products',
      exact: true,
    })
    await expect(included.getByRole('listitem')).toHaveCount(2)
    await expect(included).toContainText('2 whole selling packages')
    await expect(included).toContainText('9 rolls per package')
    await expect(included).toContainText('Selling unit: 9ct tray')
    await expect(
      dialog.getByText('Connected recipe:', { exact: false }),
    ).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: /label/i })).toHaveCount(0)
    expect(writes).toHaveLength(0)
    await page.screenshot({
      path: `${output}/kit-details-${width}.png`,
      animations: 'disabled',
    })
    if (width < 640) {
      await dialog
        .locator('.product-detail-information')
        .scrollIntoViewIfNeeded()
      await page.screenshot({
        path: `${output}/kit-costs-${width}-scrolled.png`,
        animations: 'disabled',
      })
    }
    await writeFile(
      `${output}/geometry-${width}.json`,
      JSON.stringify(
        { viewport: { width, height: 950 }, reference, kit: actual },
        null,
        2,
      ),
    )
    await included
      .getByRole('button', { name: regularName, exact: true })
      .click()
    await expect(
      dialog.getByRole('heading', { name: regularName, exact: true }),
    ).toBeVisible()
    await dialog
      .getByRole('button', { name: `Back to ${kitName}`, exact: true })
      .click()
    await expect(
      dialog.getByRole('heading', { name: kitName, exact: true }),
    ).toBeVisible()
    await included
      .getByRole('button', { name: regularName, exact: true })
      .click()
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(
      dialog.getByRole('heading', { name: kitName, exact: true }),
    ).toBeVisible()
    await dialog.getByText('How this is calculated', { exact: true }).click()
    await expect(
      dialog.getByText(/Additional assembly: 12 minutes/),
    ).toBeVisible()
    await dialog.getByRole('button', { name: 'Edit kit', exact: true }).click()
    await expect(
      page.getByRole('tab', { name: 'Contents & details', exact: true }),
    ).toBeVisible()
    await expect(page.getByLabel('Whole selling packages').first()).toHaveValue(
      '2',
    )
    await page
      .getByRole('tab', { name: 'Packaging & cost', exact: true })
      .click()
    await page.getByLabel('Kit selling price').fill('48.25')
    await page.getByLabel('Additional assembly minutes').fill('18')
    await page.getByRole('tab', { name: 'Photo', exact: true }).click()
    await page
      .getByRole('tab', { name: 'Packaging & cost', exact: true })
      .click()
    await expect(page.getByLabel('Kit selling price')).toHaveValue('48.25')
    await page.getByRole('button', { name: 'Save kit', exact: true }).click()
    await expect(
      dialog.getByRole('heading', { name: kitName, exact: true }),
    ).toBeVisible()
    await expect(card(dialog, 'Selling price')).toHaveText('$48.25')
    await expect(card(dialog, 'Total cost per kit')).toHaveText(
      money(
        productCosting(
          workspace.products.find((p) => p.id === kit.id)!,
          workspace,
        ).perPackage,
      ),
    )
    expect(writes).toHaveLength(1)
    await dialog.getByRole('button', { name: 'Edit kit', exact: true }).click()
    await page.getByLabel('Kit name', { exact: true }).fill('Unsaved name')
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(
      dialog.getByRole('heading', { name: kitName, exact: true }),
    ).toBeVisible()
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(
      page.getByRole('article', { name: kitName, exact: true }),
    ).toContainText('$48.25 / kit')
    assertStock()
  })

  test(`Kits tab, search, type filters, hash refresh and Create kit at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 950 })
    const { writes } = await setup(page)
    await page
      .locator('.section-tabs')
      .getByRole('link', { name: 'Kits', exact: true })
      .click()
    await expect(page).toHaveURL(/#Products\/Kits$/)
    await expect(page.getByRole('article')).toHaveCount(1)
    await expect(page.getByRole('article')).toContainText('Kit · active')
    await page
      .getByLabel('Search products', { exact: true })
      .fill('nonmatching')
    await expect(page.getByRole('article')).toHaveCount(0)
    await page.getByLabel('Search products', { exact: true }).fill('gather')
    await expect(page.getByRole('article')).toHaveCount(1)
    await page.reload({ waitUntil: 'networkidle' })
    await expect(
      page.locator('.section-tabs a[aria-current="page"]'),
    ).toHaveText('Kits')
    await expect(
      page.getByRole('button', { name: 'Create kit', exact: true }),
    ).toHaveCount(1)
    await page.getByLabel('Search products', { exact: true }).fill('')
    await page.screenshot({
      path: `${output}/kits-tab-${width}.png`,
      animations: 'disabled',
    })
    await page.getByRole('button', { name: 'Create kit', exact: true }).click()
    await page
      .getByLabel('Kit name', { exact: true })
      .fill('Presentation test kit')
    await page.getByLabel('Add existing product').selectOption('loaf')
    await page
      .getByRole('tab', { name: 'Packaging & cost', exact: true })
      .click()
    await page.getByLabel('Kit selling price').fill('12')
    await page.getByRole('button', { name: 'Save kit', exact: true }).click()
    await expect(
      page
        .getByRole('dialog')
        .getByRole('heading', { name: 'Presentation test kit', exact: true }),
    ).toBeVisible()
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Close', exact: true })
      .click()
    await expect(page.getByRole('article')).toHaveCount(2)
    for (const tab of ['Food', 'Handmade', 'Resale']) {
      await page
        .locator('.section-tabs')
        .getByRole('link', { name: tab, exact: true })
        .click()
      await expect(
        page.getByRole('article', { name: kitName, exact: true }),
      ).toHaveCount(0)
    }
    await page
      .locator('.section-tabs')
      .getByRole('link', { name: 'All Products', exact: true })
      .click()
    await expect(
      page.getByRole('article', { name: kitName, exact: true }),
    ).toHaveCount(1)
    expect(writes).toHaveLength(1)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1)
  })
}

for (const width of [1440, 390]) {
  test(`missing category retains valid costs and gives an actionable edit at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 950 })
    const { workspace, kit, writes, assertStock } = await setup(page, {
      missingCategory: true,
    })
    await page
      .getByRole('article', { name: kitName, exact: true })
      .getByRole('button', { name: kitName, exact: true })
      .click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('status')).toContainText(
      'Estimate incomplete: Product category not configured.',
    )
    await expect(dialog.getByRole('status')).toContainText(
      `${kitName}: choose an active category`,
    )
    await expect(card(dialog, 'Total cost per kit')).toHaveText(
      money(productCosting(kit, workspace).perPackage),
    )
    await expect(card(dialog, 'Selling price')).toHaveText('$42.00')
    for (const label of [
      'Profit per kit',
      'Tax per kit',
      'Customer price',
      'Revenue excluding tax',
      'Suggested selling price',
      'Margin',
    ])
      await expect(card(dialog, label)).toHaveText('Unavailable')
    await page.screenshot({
      path: `${output}/kit-incomplete-${width}.png`,
      animations: 'disabled',
    })
    await dialog
      .getByRole('status')
      .getByRole('button', { name: 'Edit kit', exact: true })
      .click()
    await expect(
      dialog.getByRole('heading', { name: `Kit · ${kitName}`, exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('combobox', { name: 'Category', exact: true }),
    ).toHaveValue('')
    await page
      .getByRole('tab', { name: 'Packaging & cost', exact: true })
      .click()
    await expect(
      dialog
        .getByText('Estimate incomplete: Product category not configured.', {
          exact: true,
        })
        .first(),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(
      dialog.getByRole('heading', { name: kitName, exact: true }),
    ).toBeVisible()
    expect(writes).toHaveLength(0)
    assertStock()
  })

  test(`long included lists grow below a fixed photo with one scrolling region at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 950 })
    const { writes, assertStock } = await setup(page, { count: 18 })
    await page
      .getByRole('article', { name: kitName, exact: true })
      .getByRole('button', { name: kitName, exact: true })
      .click()
    const dialog = page.getByRole('dialog')
    await expect(
      dialog
        .getByRole('region', { name: 'Included products', exact: true })
        .getByRole('listitem'),
    ).toHaveCount(18)
    const measurement = await dialog.evaluate((panel) => {
      const photo = panel
        .querySelector('.product-detail-photo')!
        .getBoundingClientRect()
      const list = panel
        .querySelector('.kit-included-products')!
        .getBoundingClientRect()
      return {
        photoHeight: photo.height,
        photoWidth: photo.width,
        gap: list.top - photo.bottom,
        overflows: [
          ...panel.querySelectorAll(
            '.product-detail-media, .kit-included-products, .kit-included-products *, .product-detail-actions, .product-detail-actions *',
          ),
        ].filter(
          (el) =>
            /(auto|scroll|hidden|clip)/.test(getComputedStyle(el).overflowY) &&
            el.scrollHeight > el.clientHeight + 1,
        ).length,
        horizontal: panel.scrollWidth - panel.clientWidth,
      }
    })
    expect(measurement.photoHeight).toBeLessThanOrEqual(
      width < 640 ? 280 : measurement.photoWidth,
    )
    expect(measurement.gap).toBeCloseTo(8, 0)
    expect(measurement.overflows).toBe(0)
    expect(measurement.horizontal).toBeLessThanOrEqual(1)
    await dialog
      .getByRole('button', { name: 'Edit kit', exact: true })
      .scrollIntoViewIfNeeded()
    await expect(
      dialog.getByRole('button', { name: 'Edit kit', exact: true }),
    ).toBeInViewport()
    expect(writes).toHaveLength(0)
    assertStock()
  })
}
