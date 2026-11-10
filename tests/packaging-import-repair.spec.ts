import { test, expect, type Page } from '@playwright/test'
import { demoData } from '../src/lib/demo'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'
import { fileURLToPath } from 'node:url'

async function setup(page: Page, optional = false) {
  await installWorkspaceFixture(page)
  const workspace = demoData()
  workspace.graphic_assets = [
    { id: 'photo', name: 'Package photo', fileUrl: '/test-package.svg' },
  ]
  const item = workspace.ingredients.find(
    (i) => i.categoryId === 'packaging' || i.category === 'Packaging',
  )!
  item.imageAssetId = 'photo'
  if (optional) workspace.settings[0].packagePhotoExtractionAllowed = true
  const writes: unknown[] = []
  const control = { failure: false }
  await page.route('**/test-package.svg', (r) =>
    r.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120"><rect width="240" height="120" fill="#ece7cc"/><text x="120" y="65" text-anchor="middle" fill="#615744">PACKAGE PHOTO</text></svg>',
    }),
  )
  await page.route('https://fixture.example/package.svg', (r) =>
    r.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120"><rect width="240" height="120" fill="#ece7cc"/></svg>',
    }),
  )
  await page.route('**/api/workspace*', async (r) => {
    const url = r.request().url()
    if (url.includes('upload=1') || url.includes('productImage')) {
      const asset = {
        id: url.includes('upload=1') ? 'uploaded' : 'imported',
        name: 'New package photo',
        fileUrl: '/test-package.svg',
      }
      workspace.graphic_assets.push(asset)
      return r.fulfill({ json: { asset, workspace } })
    }
    if (url.includes('productImport'))
      return r.fulfill(
        control.failure
          ? {
              status: 400,
              headers: { 'retry-after': '0' },
              json: {
                error: 'Product page unavailable (HTTP 503).',
                diagnostics: {
                  requestId: 'synthetic-503',
                  requestedAt: '2026-11-10T04:53:48.564Z',
                  requestedUrl: 'https://www.amazon.com/dp/B0G4WLFMWV',
                  normalizedUrl: 'https://www.amazon.com/dp/B0G4WLFMWV',
                  stage: 'fetch',
                  source: 'retailer',
                  hops: [
                    {
                      url: 'https://www.amazon.com/dp/B0G4WLFMWV',
                      at: '2026-11-10T04:53:48.564Z',
                      status: 503,
                      headers: { 'content-type': 'text/html' },
                      bodySummary: 'Error document; not parsed.',
                      attempt: 3,
                    },
                  ],
                },
              },
            }
          : {
              json: {
                products: [
                  {
                    title: 'Selected package of 50 pans',
                    fields: {
                      name: 'Selected package of 50 pans',
                      brand: 'Source brand',
                      purchaseQuantity: 50,
                      purchaseUnit: 'each',
                      packagePrice: 33.99,
                      currency: 'USD',
                      retailerSku: 'B0G4WLFMWV',
                    },
                    sourceUrl: 'https://www.amazon.com/dp/B0G4WLFMWV',
                    imageUrl: 'https://fixture.example/package.svg',
                    checkedAt: '2026-11-10T05:03:36.776Z',
                    conditions: [],
                    warnings: [],
                  },
                ],
              },
            },
      )
    if (url.includes('productVendors'))
      return r.fulfill({ json: { vendors: workspace.vendors } })
    if (r.request().method() === 'POST') writes.push(r.request().postDataJSON())
    return r.fulfill({ json: { workspace, role: 'Owner', demo: false } })
  })
  await page.goto(workspaceFixtureUrl('Inventory/Packaging'), {
    waitUntil: 'domcontentloaded',
  })
  return { workspace, item, writes, control }
}

async function accessibleLayout(page: Page, editing: boolean, width: number) {
  const modal = page.getByRole('dialog')
  const photo = modal.locator(
    editing
      ? '.ingredient-edit-identity-photo'
      : '.packaging-details-layout > .add-item-photo',
  )
  const source = modal.locator('.product-import').first()
  const name = modal.getByRole('textbox', {
    name: editing ? 'Packaging name' : 'Item name',
    exact: true,
  })
  const photoBox = (await photo.boundingBox())!
  const sourceBox = (await source.boundingBox())!
  const nameBox = (await name.boundingBox())!
  if (width > 760) {
    expect(Math.abs(photoBox.y - sourceBox.y)).toBeLessThanOrEqual(4)
    expect(nameBox.x + nameBox.width).toBeLessThan(photoBox.x)
    expect(sourceBox.width).toBeGreaterThan(photoBox.width)
  } else {
    expect(photoBox.y).toBeGreaterThan(nameBox.y + nameBox.height)
  }
  expect(
    await modal.evaluate((el) => el.scrollWidth - el.clientWidth),
  ).toBeLessThanOrEqual(1)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    ),
  ).toBeLessThanOrEqual(1)
  expect(
    await modal.evaluate(
      (el) =>
        [el, ...el.querySelectorAll('*')].filter(
          (node) =>
            node.tagName !== 'TEXTAREA' &&
            ['auto', 'scroll'].includes(getComputedStyle(node).overflowY) &&
            node.scrollHeight > node.clientHeight + 1,
        ).length,
    ),
  ).toBeLessThanOrEqual(1)
  await expect(
    modal.getByRole('button', {
      name: editing ? 'Save packaging' : 'Save item',
      exact: true,
    }),
  ).toBeInViewport()
}

for (const width of [1440, 768, 390]) {
  test(`packaging comparison ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await setup(page)
    await page.getByRole('button', { name: 'Add Item', exact: true }).click()
    const modal = page.getByRole('dialog')
    await expect(modal.getByLabel('Item Type', { exact: true })).toHaveValue(
      'packaging',
    )
    await modal
      .getByLabel('Item name', { exact: true })
      .fill('Owner package draft')
    await modal
      .getByRole('combobox', { name: 'Photo', exact: true })
      .selectOption('photo')
    await page.screenshot({
      path: `docs/previews/packaging-add-${process.env.PACKAGING_CAPTURE || 'after'}-${width}.png`,
    })
    page.once('dialog', (dialog) => dialog.accept())
    await modal.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page
      .getByRole('button', { name: /^Edit Packaging$/i })
      .first()
      .click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.screenshot({
      path: `docs/previews/packaging-edit-${process.env.PACKAGING_CAPTURE || 'after'}-${width}.png`,
    })
  })
}

for (const width of [1440, 768, 390])
  for (const editing of [false, true]) {
    test(`packaging ${editing ? 'Edit' : 'Add'} photos, expanded review, failure and draft state ${width}`, async ({
      page,
    }) => {
      page.setDefaultTimeout(10000)
      await page.setViewportSize({ width, height: 900 })
      const f = await setup(page, true)
      if (editing)
        await page
          .getByRole('button', { name: /^Edit Packaging$/i })
          .first()
          .click()
      else
        await page
          .getByRole('button', { name: 'Add Item', exact: true })
          .click()
      const modal = page.getByRole('dialog')
      const name = modal.getByRole('textbox', {
        name: editing ? 'Packaging name' : 'Item name',
        exact: true,
      })
      const photoSection = modal.locator(
        editing
          ? '.ingredient-edit-identity-photo'
          : '.packaging-details-layout > .add-item-photo',
      )
      const photo = photoSection.getByRole('combobox')
      if (!editing) {
        await modal
          .getByRole('tab', { name: 'Purchase & Stock', exact: true })
          .click()
        await modal
          .getByLabel('Purchase unit', { exact: true })
          .selectOption('case')
        await modal
          .getByLabel('Amount in each package', { exact: true })
          .fill('24')
        await modal
          .getByLabel('Cost per package', { exact: true })
          .fill('12.50')
        await modal.getByRole('tab', { name: 'Details', exact: true }).click()
      }
      const originalQuantity = editing
        ? await modal
            .getByLabel('# of stock units in purchasing unit', { exact: true })
            .inputValue()
        : '24'
      const originalPrice = editing
        ? await modal
            .getByLabel('Purchasing price', { exact: true })
            .inputValue()
        : '12.50'
      await name.fill('Owner package draft')
      await photo.selectOption('')
      await expect(photoSection.locator('img')).toHaveCount(0)
      await accessibleLayout(page, editing, width)
      await photo.selectOption('photo')
      await expect(photoSection.locator('img')).toBeVisible()
      await photoSection
        .locator('input[type="file"]')
        .setInputFiles(
          fileURLToPath(
            new URL('../src/test/fixtures/package-label.png', import.meta.url),
          ),
        )
      await expect(photo).toHaveValue('uploaded')
      await accessibleLayout(page, editing, width)
      await modal.locator('.catalog-contribution > summary').click()
      await modal.locator('.package-photo-import > summary').click()
      await modal
        .locator(editing ? '.product-paste-action > summary' : 'button')
        .filter({
          hasText: editing
            ? 'Paste product text'
            : 'Paste product text instead',
        })
        .first()
        .click()
      await modal
        .getByLabel('Product text / notes', { exact: true })
        .fill('Manual notes and photo survive import.')
      await modal
        .getByLabel('Product URL', { exact: true })
        .fill('https://www.amazon.com/dp/B0G4WLFMWV')
      await modal
        .getByRole('button', { name: 'Import details', exact: true })
        .click()
      await expect(
        modal.getByRole('button', { name: 'Select all', exact: true }),
      ).toBeVisible()
      await modal
        .getByRole('button', { name: 'Select all', exact: true })
        .click()
      await expect(
        modal.getByRole('checkbox', { name: /Import product photo/ }),
      ).toBeChecked()
      const approval = modal.getByRole('checkbox', {
        name: /I approve changing/,
      })
      if (await approval.count()) await expect(approval).toBeChecked()
      const brand = modal.getByRole('checkbox', { name: 'Brand', exact: true })
      await brand.uncheck()
      await expect(brand).not.toBeChecked()
      // Keep manual name/notes. Apply only a photo to demonstrate draft-only attachment.
      await modal
        .getByRole('button', { name: 'Clear selection', exact: true })
        .click()
      await modal
        .getByRole('checkbox', { name: /Import product photo/ })
        .check()
      await accessibleLayout(page, editing, width)
      await modal
        .getByRole('button', { name: 'Apply selected values', exact: true })
        .click()
      await expect(photo).toHaveValue('imported')
      await expect(name).toHaveValue('Owner package draft')
      expect(f.writes).toHaveLength(0)
      f.control.failure = true
      await modal
        .getByRole('button', { name: 'Import details', exact: true })
        .click()
      await expect(modal.getByRole('alert').first()).toContainText('preserved')
      await modal.getByRole('button', { name: 'Retry', exact: true }).click()
      await expect(modal.getByRole('alert').first()).toContainText('preserved')
      await modal
        .getByRole('button', { name: 'Enter details manually', exact: true })
        .click()
      await expect(name).toBeFocused()
      await expect(photo).toHaveValue('imported')
      await expect(
        modal.getByLabel('Product text / notes', { exact: true }),
      ).toHaveValue('Manual notes and photo survive import.')
      if (editing) {
        await modal
          .getByRole('button', { name: 'Stock & Other Details', exact: true })
          .click()
        await modal
          .getByRole('button', { name: 'Details & Costing', exact: true })
          .click()
        await expect(
          modal.getByLabel('# of stock units in purchasing unit', {
            exact: true,
          }),
        ).toHaveValue(originalQuantity)
        await expect(
          modal.getByLabel('Purchasing price', { exact: true }),
        ).toHaveValue(originalPrice)
      } else {
        await modal
          .getByRole('tab', { name: 'Purchase & Stock', exact: true })
          .click()
        await expect(
          modal.getByLabel('Purchase unit', { exact: true }),
        ).toHaveValue('case')
        await expect(
          modal.getByLabel('Amount in each package', { exact: true }),
        ).toHaveValue(originalQuantity)
        await expect(
          modal.getByLabel('Cost per package', { exact: true }),
        ).toHaveValue(originalPrice)
        for (const tab of ['More', 'Details'])
          await modal.getByRole('tab', { name: tab, exact: true }).click()
      }
      await expect(name).toHaveValue('Owner package draft')
      expect(f.writes).toHaveLength(0)
      await modal
        .locator(editing ? '.ingredient-detail-body' : '.add-item-body')
        .evaluate((el) => {
          el.scrollTop = 0
        })
      await page.screenshot({
        path: `docs/previews/packaging-${editing ? 'edit' : 'add'}-expanded-${width}.png`,
      })
      if (editing && width === 1440) {
        await modal
          .getByRole('button', { name: 'Save packaging', exact: true })
          .click()
        await expect.poll(() => f.writes.length).toBe(1)
        expect(f.writes[0]).toMatchObject({
          action: 'ingredientUpdate',
          data: {
            id: f.item.id,
            name: 'Owner package draft',
            imageAssetId: 'imported',
            quantity: f.item.quantity,
          },
        })
      }
    })
  }
