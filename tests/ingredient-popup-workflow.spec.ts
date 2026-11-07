import { test, expect, type Page } from '@playwright/test'
import { demoData } from '../src/lib/demo'
import type { Item } from '../src/lib/domain'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

// Synthetic API boundary; these tests never read or write customer records.
async function fixture(page: Page) {
  await installWorkspaceFixture(page)
  const workspace = demoData()
  workspace.graphic_assets ||= []
  const yeast = workspace.ingredients.find((i) => i.id === 'yeast')!
  yeast.name = 'Instant Dry Yeast'
  const writes: { action: string; table: string; data: Item }[] = []
  let failImport = false
  const imported = {
    title: 'Supplier yeast listing',
    fields: {
      name: 'Supplier yeast',
      brand: 'Supplier brand',
      subingredients:
        'Yeast (Saccharomyces cerevisiae), emulsifier (sorbitan monostearate)',
      sourceContains: 'Contains wheat.',
      sourceMayContain: 'May contain milk.',
      notes: 'Supplier label and package information. '.repeat(140),
    },
    imageUrl: '',
    sourceUrl: 'https://example.org/yeast',
    checkedAt: '2026-11-06T12:00:00Z',
    warnings: [],
    conditions: [],
  }
  await page.route('**/api/workspace*', async (route) => {
    const request = route.request()
    if (request.url().includes('productImport')) {
      // Give the loading state time to render without changing the draft.
      await new Promise((resolve) => setTimeout(resolve, 150))
      return failImport
        ? route.fulfill({
            status: 503,
            json: {
              error: 'Retailer unavailable. Try pasted text or manual entry.',
            },
          })
        : route.fulfill({ json: { products: [imported] } })
    }
    if (request.url().includes('upload=1')) {
      const asset = {
        id: 'uploaded-photo',
        name: 'Uploaded photo',
        fileUrl: '/fixture-photo.svg',
      }
      workspace.graphic_assets.push(asset)
      return route.fulfill({ json: { workspace, asset } })
    }
    if (request.method() === 'POST') {
      const body = request.postDataJSON()
      writes.push(body)
      if (body.action === 'save' && body.table === 'ingredients')
        workspace.ingredients.push({
          ...body.data,
          quantity: 0,
          cost: 0,
          currentCost: 0,
          needsCostSetup: true,
        })
      if (body.action === 'ingredientUpdate') Object.assign(yeast, body.data)
    }
    return route.fulfill({ json: { workspace, role: 'Owner', demo: false } })
  })
  await page.route('**/fixture-photo.svg', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="120"><rect width="80" height="120" fill="#e9e4d5"/></svg>',
    }),
  )
  return {
    workspace,
    yeast,
    writes,
    imported,
    fail: (value: boolean) => {
      failImport = value
    },
  }
}

for (const width of [1440, 390]) {
  test(`ingredient URL import keeps the Add popup and shared draft at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    const f = await fixture(page)
    await page.goto(workspaceFixtureUrl('Inventory/Ingredients'))
    const search = page.getByRole('textbox', { name: 'Search pantry' })
    await search.fill('yeast')
    await expect(page).toHaveURL(/search=yeast/)
    const originalUrl = page.url()
    const originalScroll = await page.evaluate(() => scrollY)
    await page.getByRole('button', { name: 'Add Item', exact: true }).click()
    const modal = page.getByRole('dialog')
    const originalModal = await modal.elementHandle()
    await modal.getByLabel('Item name', { exact: true }).fill('My yeast draft')
    await modal.getByLabel('Upload photo', { exact: true }).setInputFiles({
      name: 'photo.png',
      mimeType: 'image/png',
      buffer: Buffer.from('fixture image'),
    })
    await expect(
      modal.getByRole('combobox', { name: 'Photo', exact: true }),
    ).toHaveValue('uploaded-photo')
    await modal.getByRole('tab', { name: 'Ingredients & allergens' }).click()
    await modal
      .getByLabel('Ingredient statement', { exact: true })
      .fill('Manually verified yeast')
    await modal.getByLabel('Wheat', { exact: true }).check()
    await modal.getByRole('tab', { name: 'Details', exact: true }).click()
    await modal.getByRole('button', { name: 'URL', exact: true }).click()
    await modal
      .getByLabel('Product URL', { exact: true })
      .fill(f.imported.sourceUrl)
    await modal
      .getByRole('button', { name: 'Import details', exact: true })
      .click()
    await expect(modal.getByRole('status')).toContainText(
      'Reading product details',
    )
    await expect(modal).toHaveAttribute('data-presentation', 'detail')
    await expect(
      modal.getByText('Conflicting current value — select to replace:'),
    ).toBeVisible()
    // An expanded long result used to trigger the full-page presentation.
    await modal.getByText('Expand/Edit description', { exact: true }).click()
    await expect(modal).not.toHaveClass(/add-item-page/)
    expect(
      await modal.evaluate((el, original) => el === original, originalModal),
    ).toBe(true)
    expect(
      await page.evaluate(() =>
        document.body.hasAttribute('data-scroll-locked'),
      ),
    ).toBe(true)
    expect(
      await modal.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1)
    const box = (await modal.boundingBox())!
    expect(box.y).toBeGreaterThan(0)
    expect(box.y + box.height).toBeLessThan(900)
    for (const name of [
      'Brand',
      'Source ingredient statement',
      'Source Contains statement',
      'Source May contain statement',
    ])
      await modal.getByRole('checkbox', { name, exact: true }).check()
    await modal
      .getByRole('button', { name: 'Apply selected fields', exact: true })
      .click()
    expect(f.writes).toHaveLength(0)
    await expect(
      modal.getByRole('tab', { name: 'Details', exact: true }),
    ).toHaveAttribute('aria-selected', 'true')
    await expect(modal.getByLabel('Item Type', { exact: true })).toHaveValue(
      'ingredient',
    )
    await expect(modal.getByLabel('Item name', { exact: true })).toHaveValue(
      'My yeast draft',
    )
    await expect(
      modal.getByRole('combobox', { name: 'Photo', exact: true }),
    ).toHaveValue('uploaded-photo')
    await modal.getByRole('tab', { name: 'Ingredients & allergens' }).click()
    await expect(
      modal.getByLabel('Ingredient statement', { exact: true }),
    ).toHaveValue('Manually verified yeast')
    await expect(
      modal.getByLabel('Subingredients', { exact: true }),
    ).toHaveValue(f.imported.fields.subingredients)
    await expect(
      modal.getByLabel('Source Contains statement', { exact: true }),
    ).toHaveValue('Contains wheat.')
    await expect(
      modal.getByLabel('May contain / facility statement'),
    ).toHaveValue('May contain milk.')
    await expect(modal.getByLabel('Wheat', { exact: true })).toBeChecked()
    await modal
      .getByRole('tab', { name: 'Purchase & Stock', exact: true })
      .click()
    await expect(
      modal.getByLabel('Add what I already have on hand'),
    ).not.toBeChecked()
    await modal.getByRole('tab', { name: 'Details', exact: true }).click()
    await modal
      .getByRole('button', { name: 'Save item', exact: true })
      .dblclick()
    await expect(modal).toHaveCount(0)
    expect(f.writes).toHaveLength(1)
    expect(f.writes[0]).toMatchObject({
      action: 'save',
      table: 'ingredients',
      data: {
        name: 'My yeast draft',
        usedAs: 'ingredient',
        imageAssetId: 'uploaded-photo',
        initialStock: false,
        statement: 'Manually verified yeast',
        subingredients: f.imported.fields.subingredients,
        sourceContains: 'Contains wheat.',
        sourceMayContain: 'May contain milk.',
        allergens: ['Wheat'],
      },
    })
    expect(page.url()).toBe(originalUrl)
    await expect(search).toHaveValue('yeast')
    expect(await page.evaluate(() => scrollY)).toBe(originalScroll)
    expect(page.context().pages()).toHaveLength(1)
  })

  test(`ingredient import failure, retry, edit identity and cancel stay in the popup at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    const f = await fixture(page)
    await page.goto(workspaceFixtureUrl('Inventory/Ingredients'))
    await page.getByRole('textbox', { name: 'Search pantry' }).fill('yeast')
    await expect(page).toHaveURL(/search=yeast/)
    const originalUrl = page.url()
    await page
      .getByRole('button', { name: 'View details', exact: true })
      .click()
    await page
      .getByRole('button', { name: 'Edit Ingredient', exact: true })
      .click()
    const modal = page.getByRole('dialog')
    const originalModal = await modal.elementHandle()
    await modal.getByLabel('Name', { exact: true }).fill('Edited yeast')
    f.fail(true)
    await modal
      .getByLabel('Product URL', { exact: true })
      .fill(f.imported.sourceUrl)
    await modal
      .getByRole('button', { name: 'Import details', exact: true })
      .click()
    await expect(modal.getByRole('alert')).toContainText('Retailer unavailable')
    await expect(modal.getByLabel('Name', { exact: true })).toHaveValue(
      'Edited yeast',
    )
    await expect(modal.getByLabel('Upload product screenshot')).toBeVisible()
    await modal
      .getByRole('button', { name: 'Paste product text instead' })
      .click()
    await modal.getByLabel('Product text / notes').fill('Manual package notes')
    f.fail(false)
    await modal
      .getByRole('button', { name: 'Import details', exact: true })
      .click()
    await modal.getByRole('checkbox', { name: 'Brand', exact: true }).check()
    await modal
      .getByRole('button', { name: 'Apply selected fields', exact: true })
      .click()
    expect(
      await modal.evaluate((el, original) => el === original, originalModal),
    ).toBe(true)
    await expect(modal.getByLabel('Name', { exact: true })).toHaveValue(
      'Edited yeast',
    )
    await expect(modal.getByLabel('Brand', { exact: true })).toHaveValue(
      'Supplier brand',
    )
    expect(f.writes).toHaveLength(0)
    await modal.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(
      modal.getByRole('heading', { name: 'Instant Dry Yeast', exact: true }),
    ).toBeVisible()
    expect(f.yeast.name).toBe('Instant Dry Yeast')
    await modal
      .getByRole('button', { name: 'Close ingredient details' })
      .click()
    await expect(modal).toHaveCount(0)
    expect(f.writes).toHaveLength(0)
    expect(page.url()).toBe(originalUrl)
    await expect(
      page.getByRole('textbox', { name: 'Search pantry' }),
    ).toHaveValue('yeast')
    // Reopen Edit, import, and use the original update path exactly once.
    await page
      .getByRole('button', { name: 'Edit Ingredient', exact: true })
      .click()
    await modal
      .getByLabel('Product URL', { exact: true })
      .fill(f.imported.sourceUrl)
    await modal
      .getByRole('button', { name: 'Import details', exact: true })
      .click()
    await modal.getByRole('checkbox', { name: 'Brand', exact: true }).check()
    await modal
      .getByRole('button', { name: 'Apply selected fields', exact: true })
      .click()
    await modal
      .getByRole('button', { name: 'Save changes', exact: true })
      .dblclick()
    await expect(
      modal.getByRole('heading', { name: 'Instant Dry Yeast', exact: true }),
    ).toBeVisible()
    expect(f.writes).toHaveLength(1)
    expect(f.writes[0]).toMatchObject({
      action: 'ingredientUpdate',
      table: 'ingredients',
      data: {
        id: f.yeast.id,
        name: 'Instant Dry Yeast',
        brand: 'Supplier brand',
      },
    })
  })

  test(`ingredient and existing product details share layout at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    const f = await fixture(page)
    await page.goto(workspaceFixtureUrl('Inventory/Ingredients'))
    await page.getByRole('textbox', { name: 'Search pantry' }).fill('yeast')
    await page
      .getByRole('button', { name: 'View details', exact: true })
      .click()
    const modal = page.getByRole('dialog')
    await expect(
      modal.getByRole('heading', { name: 'Instant Dry Yeast', exact: true }),
    ).toBeVisible()
    await expect(modal.locator('.detail-stats')).toContainText('Cost per oz')
    await expect(modal.locator('.detail-stats')).toContainText('On hand (oz)')
    await expect(modal.locator('nav')).toHaveCount(0)
    await expect(modal.locator('.product-detail-photo')).toBeVisible()
    const ingredientStyle = await modal.evaluate((el) => {
      const s = getComputedStyle(el)
      return {
        width: s.width,
        padding: s.padding,
        borderRadius: s.borderRadius,
      }
    })
    await page.screenshot({
      path: `docs/previews/ingredient-details-${width}.webp`,
      animations: 'disabled',
    })
    for (const title of [
      'How this is calculated',
      'Purchasing',
      'Inventory',
      'Label & ingredient details',
    ]) {
      const summary = modal
        .locator('summary')
        .filter({ hasText: new RegExp(`^${title}$`) })
      await summary.click()
      await summary.click()
    }
    expect(
      await modal.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1)
    await modal
      .getByRole('button', { name: 'Close ingredient details' })
      .click()
    await page.goto(workspaceFixtureUrl('Products'))
    await page
      .getByRole('button', { name: f.workspace.products[0].name, exact: true })
      .click()
    await expect(modal.locator('.product-detail-layout')).toBeVisible()
    const productStyle = await modal.evaluate((el) => {
      const s = getComputedStyle(el)
      return {
        width: s.width,
        padding: s.padding,
        borderRadius: s.borderRadius,
      }
    })
    expect(ingredientStyle).toEqual(productStyle)
    await page.screenshot({
      path: `docs/previews/product-details-reference-${width}.webp`,
      animations: 'disabled',
    })
    f.workspace.graphic_assets.push({
      id: 'layout-photo',
      name: 'Photo layout fixture',
      fileUrl: '/fixture-photo.svg',
    })
    f.yeast.imageAssetId = 'layout-photo'
    f.yeast.subingredients = f.imported.fields.subingredients.repeat(12)
    f.yeast.sourceContains = 'Contains wheat.'
    f.yeast.sourceMayContain = 'May contain milk.'
    await page.goto(workspaceFixtureUrl('Inventory/Ingredients'))
    await page.getByRole('textbox', { name: 'Search pantry' }).fill('yeast')
    await page
      .getByRole('button', { name: 'View details', exact: true })
      .click()
    const photo = modal.locator('.product-detail-photo img')
    await expect(photo).toHaveCSS('object-fit', 'contain')
    await expect
      .poll(() =>
        photo.evaluate((el: HTMLImageElement) => [
          el.naturalWidth,
          el.naturalHeight,
        ]),
      )
      .toEqual([80, 120])
    await modal
      .locator('summary')
      .filter({ hasText: /^Label & ingredient details$/ })
      .click()
    await expect(
      modal.getByText(`Subingredients: ${f.yeast.subingredients}`, {
        exact: true,
      }),
    ).toBeVisible()
    await expect(
      modal.getByText('Source Contains (verify package): Contains wheat.'),
    ).toBeVisible()
    await expect(
      modal.getByText('Source May contain (verify package): May contain milk.'),
    ).toBeVisible()
    expect(f.writes).toHaveLength(0)
  })
}
