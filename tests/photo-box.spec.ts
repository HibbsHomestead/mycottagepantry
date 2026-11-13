import { test, expect, type Page } from '@playwright/test'
import { demoData } from '../src/lib/demo'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

async function fixture(page: Page) {
  page.on('pageerror', (error) =>
    console.error('Browser error:', error.message),
  )
  await installWorkspaceFixture(page)
  await page.route('**/app-version.json*', (r) =>
    r.fulfill({ json: { version: 'photo-box-test' } }),
  )
  const workspace = demoData()
  workspace.graphic_assets = [
    {
      id: 'saved-photo',
      name: 'Saved package photo',
      fileUrl: '/fixture-photo.jpg',
    },
    {
      id: 'imported-photo',
      name: 'Imported package photo',
      fileUrl: '/fixture-import.png',
    },
  ]
  workspace.ingredients[0].imageAssetId = 'saved-photo'
  workspace.products[0].imageAssetId = 'saved-photo'
  await page.route('**/fixture-photo.jpg', (r) =>
    r.fulfill({
      path: 'src/test/fixtures/eggs-unsplash.jpg',
      contentType: 'image/jpeg',
    }),
  )
  await page.route('**/fixture-import.png', (r) =>
    r.fulfill({
      path: 'src/test/fixtures/package-label.png',
      contentType: 'image/png',
    }),
  )
  const writes: any[] = []
  let uploads = 0
  await page.route('**/api/workspace*', (r) => {
    if (r.request().url().includes('upload=1')) {
      uploads++
      const asset = {
        id: `upload-${uploads}`,
        name: 'New package photo',
        fileUrl: '/fixture-import.png',
      }
      workspace.graphic_assets.push(asset)
      return r.fulfill({ json: { asset, workspace } })
    }
    if (r.request().method() === 'POST') {
      const body = r.request().postDataJSON()
      writes.push(body)
      if (body.action === 'save') {
        const rows = workspace[body.table as keyof typeof workspace]
        if (Array.isArray(rows)) {
          const index = rows.findIndex((row: any) => row.id === body.data.id)
          if (index < 0)
            rows.push({ quantity: 0, cost: 0, currentCost: 0, ...body.data })
          else Object.assign(rows[index], body.data)
        }
      }
    }
    return r.fulfill({ json: { workspace, role: 'Owner', demo: false } })
  })
  return { workspace, writes }
}

for (const width of [390, 768, 1440]) {
  test(`rendered photo evidence ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    await fixture(page)
    await page.goto(workspaceFixtureUrl('Inventory/Craft Materials'))
    await page
      .getByRole('button', { name: 'Add Item', exact: true })
      .first()
      .click()
    const modal = page.getByRole('dialog')
    await modal
      .getByLabel('Item Type', { exact: true })
      .selectOption('material')
    await modal
      .getByLabel('Item name', { exact: true })
      .fill('Cotton craft thread')
    await expect(modal.locator('.add-item-photo-preview')).toBeVisible()
    await page.screenshot({
      path: `docs/reviews/photo-box/${process.env.PHOTO_EVIDENCE || 'after'}-add-material-${width}.png`,
    })
    if (process.env.PHOTO_EVIDENCE === 'before')
      await modal.locator('.add-item-photo select').selectOption('saved-photo')
    else {
      await modal
        .getByRole('button', { name: 'Photo options', exact: true })
        .click()
      await page.screenshot({
        path: `docs/reviews/photo-box/after-photo-menu-${width}.png`,
      })
      await page
        .getByRole('menuitemradio', {
          name: 'Saved package photo',
          exact: true,
        })
        .click()
    }
    await expect(modal.locator('.add-item-photo-preview img')).toBeVisible()
    await page.screenshot({
      path: `docs/reviews/photo-box/${process.env.PHOTO_EVIDENCE || 'after'}-selected-${width}.png`,
    })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1)
  })
}

for (const width of [390, 768, 1440]) {
  test(`all Add Item types retain photo drafts, remove, cancel, and save ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 })
    test.setTimeout(120000)
    const { writes } = await fixture(page)
    await page.goto(workspaceFixtureUrl('Inventory/Ingredients'))
    let picks = 0
    page.on('filechooser', () => picks++)
    for (const type of [
      'ingredient',
      'packaging',
      'material',
      'supply',
      'resale',
    ]) {
      const savesBefore = writes.length
      await page
        .getByRole('button', { name: 'Add Item', exact: true })
        .first()
        .click()
      const modal = page.getByRole('dialog')
      await modal.getByLabel('Item Type', { exact: true }).selectOption(type)
      await modal
        .getByLabel('Item name', { exact: true })
        .fill(`Photo test ${type}`)
      const box = modal.locator('.add-item-photo-preview')
      const before = await box.boundingBox()
      const picker = page.waitForEvent('filechooser')
      await box.getByRole('button', { name: 'Add photo', exact: true }).click()
      await (await picker).setFiles('src/test/fixtures/package-label.png')
      await expect(box.locator('img')).toHaveAttribute(
        'src',
        '/fixture-import.png',
      )
      await expect(box.locator('img')).toHaveCSS('object-fit', 'contain')
      const after = await box.boundingBox()
      expect(after!.width).toBe(before!.width)
      expect(after!.height).toBe(before!.height)
      await modal.getByRole('tab', { name: 'More', exact: true }).click()
      await modal.getByLabel('SKU', { exact: true }).fill(`PHOTO-${type}`)
      await modal
        .getByRole('tab', { name: 'Purchase & Stock', exact: true })
        .click()
      await modal.getByRole('tab', { name: 'Details', exact: true }).click()
      await expect(box.locator('img')).toHaveAttribute(
        'src',
        '/fixture-import.png',
      )
      await expect(modal.getByLabel('Item name', { exact: true })).toHaveValue(
        `Photo test ${type}`,
      )
      expect(writes).toHaveLength(savesBefore)
      // Browser automation represents canceling the native picker as an empty selection.
      const cancelPicker = page.waitForEvent('filechooser')
      await box
        .getByRole('button', { name: 'Change photo', exact: true })
        .click()
      await (await cancelPicker).setFiles([])
      await expect(box.locator('img')).toHaveAttribute(
        'src',
        '/fixture-import.png',
      )
      const picksBefore = picks
      await box
        .getByRole('button', { name: 'Remove photo', exact: true })
        .click()
      await expect(
        box.getByRole('button', { name: 'Add photo', exact: true }),
      ).toBeVisible()
      expect(picks).toBe(picksBefore)
      await box.getByRole('button', { name: 'Photo options' }).click()
      await page
        .getByRole('menuitemradio', {
          name: 'Imported package photo',
          exact: true,
        })
        .click()
      await expect(box.locator('img')).toHaveAttribute(
        'src',
        '/fixture-import.png',
      )
      expect(writes).toHaveLength(savesBefore)
      page.once('dialog', (d) => d.accept())
      await modal.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(modal).toHaveCount(0)
      expect(writes).toHaveLength(savesBefore)
      // Reopening starts a fresh form; canceled uploads never created an item.
      await page
        .getByRole('button', { name: 'Add Item', exact: true })
        .first()
        .click()
      await modal.getByLabel('Item Type', { exact: true }).selectOption(type)
      await expect(
        box.getByRole('button', { name: 'Add photo', exact: true }),
      ).toBeVisible()
      await modal
        .getByLabel('Item name', { exact: true })
        .fill(`Saved photo ${type}`)
      await box.getByRole('button', { name: 'Photo options' }).click()
      await page
        .getByRole('menuitemradio', {
          name: 'Saved package photo',
          exact: true,
        })
        .click()
      await modal.getByRole('tab', { name: 'More', exact: true }).click()
      await modal.getByLabel('SKU', { exact: true }).fill(`SAVED-${type}`)
      await modal
        .getByRole('button', { name: 'Save item', exact: true })
        .click()
      await expect(modal).toHaveCount(0)
      expect(writes.at(-1).data).toMatchObject({
        name: `Saved photo ${type}`,
        sku: `SAVED-${type}`,
        imageAssetId: 'saved-photo',
      })
      expect(writes).toHaveLength(savesBefore + 1)
    }
  })
}

test('keyboard focus, saved-photo menu, and native picker remain independent', async ({
  page,
}) => {
  await fixture(page)
  await page.goto(workspaceFixtureUrl('Inventory/Ingredients'))
  await page
    .getByRole('button', { name: 'Add Item', exact: true })
    .first()
    .click()
  const modal = page.getByRole('dialog')
  const add = modal.getByRole('button', { name: 'Add photo', exact: true })
  await add.focus()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Shift+Tab')
  await expect(add).toBeFocused()
  await expect(add).toHaveCSS('outline-style', 'solid')
  const picker = page.waitForEvent('filechooser', { timeout: 5000 })
  await page.keyboard.press('Enter')
  await (await picker).setFiles([])
  await page.keyboard.press('Tab')
  await expect(
    modal.getByRole('button', { name: 'Photo options' }),
  ).toBeFocused()
  await page.keyboard.press('Enter')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(modal.locator('.photo-box img')).toBeVisible()
  await modal.getByRole('button', { name: 'Remove photo' }).focus()
  await page.keyboard.press('Space')
  await expect(add).toBeVisible()
  await expect(add).toBeFocused()
  expect(
    await modal.locator('input[type=file]').first().getAttribute('capture'),
  ).toBeNull()
  await page.screenshot({ path: 'docs/reviews/photo-box/after-keyboard.png' })
})

for (const width of [390, 1440]) {
  test(`ingredient edit keeps saved photo on cancel and commits removal only on save ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 })
    const { writes, workspace } = await fixture(page)
    const item = workspace.ingredients[0]
    await page.goto(workspaceFixtureUrl('Inventory/Ingredients'))
    await page.getByRole('textbox', { name: 'Search pantry' }).fill(item.name)
    await page
      .getByRole('button', { name: 'View details', exact: true })
      .first()
      .click()
    const modal = page.getByRole('dialog')
    await expect(modal.locator('.product-detail-photo img')).toHaveAttribute(
      'src',
      '/fixture-photo.jpg',
    )
    expect(await modal.locator('.photo-box').count()).toBe(0)
    await modal
      .getByRole('button', { name: 'Edit Ingredient', exact: true })
      .first()
      .click()
    await modal
      .getByRole('button', { name: 'Images & Label Info', exact: true })
      .click()
    const box = modal.locator('.photo-box')
    await box.getByRole('button', { name: 'Remove photo' }).click()
    expect(writes).toHaveLength(0)
    await modal.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(modal.locator('.product-detail-photo img')).toHaveAttribute(
      'src',
      '/fixture-photo.jpg',
    )
    expect(item.imageAssetId).toBe('saved-photo')
    await modal
      .getByRole('button', { name: 'Edit Ingredient', exact: true })
      .first()
      .click()
    await modal
      .getByRole('button', { name: 'Images & Label Info', exact: true })
      .click()
    await box.getByRole('button', { name: 'Photo options' }).click()
    await page
      .getByRole('menuitemradio', {
        name: 'Imported package photo',
        exact: true,
      })
      .click()
    await page.screenshot({
      path: `docs/reviews/photo-box/after-ingredient-edit-${width}.png`,
    })
    await modal
      .getByRole('button', { name: 'Details & Costing', exact: true })
      .click()
    await modal
      .getByRole('button', { name: 'Images & Label Info', exact: true })
      .click()
    await expect(box.locator('img')).toHaveAttribute(
      'src',
      '/fixture-import.png',
    )
    await box.getByRole('button', { name: 'Remove photo' }).click()
    expect(writes).toHaveLength(0)
    await modal
      .getByRole('button', { name: 'Save changes', exact: true })
      .click()
    await expect.poll(() => writes.length).toBe(1)
    expect(writes[0].data).toMatchObject({ id: item.id, imageAssetId: '' })
    expect(workspace.graphic_assets.some((a) => a.id === 'saved-photo')).toBe(
      true,
    )
  })
}

for (const width of [390, 1440]) {
  test(`food, handmade, resale, and kit photo controls keep their form drafts ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 })
    const { writes, workspace } = await fixture(page)
    workspace.products.push({
      id: 'resale-photo-test',
      name: 'Saved resale photo test',
      workflow: 'resale',
      price: 12,
      quantity: 3,
      cost: 4,
      stockCostKnown: true,
      threshold: 0,
      imageAssetId: '',
    })
    page.on('dialog', (d) => d.accept())
    await page.goto(workspaceFixtureUrl('Products'))
    const modal = page.getByRole('dialog')
    for (const kind of ['food', 'handmade', 'resale']) {
      if (kind === 'resale')
        await page
          .getByRole('article', {
            name: 'Saved resale photo test',
            exact: true,
          })
          .getByRole('button', { name: 'Edit Product', exact: true })
          .click()
      else
        await page
          .getByRole('button', { name: `Create ${kind} product`, exact: true })
          .click()
      await modal
        .getByLabel('Product name', { exact: true })
        .fill(`Draft ${kind} product`)
      await modal
        .getByRole('tab', { name: 'Images & Labels', exact: true })
        .click()
      const photo = modal
        .getByRole('region', { name: 'Product photo' })
        .locator('.photo-box')
      const chooser = page.waitForEvent('filechooser')
      await photo
        .getByRole('button', { name: 'Add photo', exact: true })
        .click()
      await (await chooser).setFiles('src/test/fixtures/package-label.png')
      await expect(photo.locator('img')).toHaveAttribute(
        'src',
        '/fixture-import.png',
      )
      await expect(photo.locator('img')).toHaveCSS('object-fit', 'contain')
      const geometry = await photo.boundingBox()
      expect(geometry!.height).toBe(width < 600 ? 180 : 200)
      await modal
        .getByRole('tab', {
          name: kind === 'food' ? 'Details & Pricing' : 'Details',
          exact: true,
        })
        .click()
      await expect(
        modal.getByLabel('Product name', { exact: true }),
      ).toHaveValue(`Draft ${kind} product`)
      await modal
        .getByRole('tab', { name: 'Images & Labels', exact: true })
        .click()
      await expect(photo.locator('img')).toHaveAttribute(
        'src',
        '/fixture-import.png',
      )
      await page.screenshot({
        path: `docs/reviews/photo-box/after-${kind}-product-${width}.png`,
      })
      expect(writes).toHaveLength(0)
      await modal.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(modal).toHaveCount(0)
    }
    await page
      .getByRole('button', { name: 'Create kit', exact: true })
      .first()
      .click()
    await modal.getByRole('tab', { name: 'Photo', exact: true }).click()
    const box = modal.locator('.photo-box')
    await expect(
      box.getByRole('button', { name: 'Add photo', exact: true }),
    ).toBeVisible()
    await box.getByRole('button', { name: 'Photo options' }).click()
    await page
      .getByRole('menuitemradio', {
        name: 'Imported package photo',
        exact: true,
      })
      .click()
    await expect(box.locator('img')).toHaveAttribute(
      'src',
      '/fixture-import.png',
    )
    await modal
      .getByRole('tab', { name: 'Contents & details', exact: true })
      .click()
    await modal.getByRole('tab', { name: 'Photo', exact: true }).click()
    await expect(box.locator('img')).toBeVisible()
    const size = await box.boundingBox()
    expect(size!.width).toBe(90)
    expect(size!.height).toBe(70)
    await page.screenshot({
      path: `docs/reviews/photo-box/after-kit-${width}.png`,
    })
    expect(writes).toHaveLength(0)
  })
}

test('fabric edit reuses the full photo box without changing stock', async ({
  page,
}) => {
  const { writes, workspace } = await fixture(page)
  workspace.ingredients.push({
    id: 'photo-fabric',
    name: 'Indigo photo fabric',
    usedAs: 'material',
    categoryId: 'craft-materials',
    materialType: 'fabric',
    fabricTracking: 'length',
    pieceMode: 'aggregate',
    fabricWidth: 44,
    widthUnit: 'in',
    unit: 'yd',
    storageUnit: 'yd',
    quantity: 3,
    cost: 4,
    currentCost: 4,
    imageAssetId: 'saved-photo',
    threshold: 0,
  })
  await page.goto(workspaceFixtureUrl('Inventory/Craft Materials'))
  await page
    .getByRole('article', { name: 'Indigo photo fabric' })
    .getByRole('button', { name: 'Edit Material', exact: true })
    .click()
  const modal = page.getByRole('dialog')
  const box = modal.locator('.photo-box')
  await expect(box.locator('img')).toHaveAttribute('src', '/fixture-photo.jpg')
  await expect(box).toHaveCSS('height', '128px')
  await box.getByRole('button', { name: 'Remove photo' }).click()
  expect(writes).toHaveLength(0)
  await page.screenshot({
    path: 'docs/reviews/photo-box/after-fabric-edit.png',
  })
  page.once('dialog', (d) => d.accept())
  await modal.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(modal).toHaveCount(0)
  expect(workspace.ingredients.at(-1)!.imageAssetId).toBe('saved-photo')
})

test.describe('phone touch', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  })
  test('tapping the box changes the draft and tapping Remove never opens the picker', async ({
    page,
  }) => {
    const { writes } = await fixture(page)
    await page.goto(workspaceFixtureUrl('Inventory/Ingredients'))
    await page
      .getByRole('button', { name: 'Add Item', exact: true })
      .first()
      .tap()
    const box = page.getByRole('dialog').locator('.add-item-photo-preview')
    let pickerCount = 0
    page.on('filechooser', () => pickerCount++)
    const chooser = page.waitForEvent('filechooser')
    await box.getByRole('button', { name: 'Add photo', exact: true }).tap()
    await (await chooser).setFiles('src/test/fixtures/package-label.png')
    await expect(box.locator('img')).toHaveAttribute(
      'src',
      '/fixture-import.png',
    )
    await box.getByRole('button', { name: 'Remove photo' }).tap()
    await expect(
      box.getByRole('button', { name: 'Add photo', exact: true }),
    ).toBeVisible()
    expect(pickerCount).toBe(1)
    expect(writes).toHaveLength(0)
  })
})
