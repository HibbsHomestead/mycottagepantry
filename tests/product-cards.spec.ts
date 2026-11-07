import { test, expect } from '@playwright/test'
import { demoData } from '../src/lib/demo'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

// Synthetic API boundary: exercises the actual UI and save/reopen handling,
// without modifying business records or claiming deployed database persistence.
for (const width of [1440, 1024, 768, 390, 320]) {
  test(`product cards, images, search, actions and saved updates (${width})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await installWorkspaceFixture(page)
    const workspace = demoData()
    const name =
      'Homestyle White Bread with Rosemary and Roasted Garlic ' +
      'LongProductName'.repeat(8)
    Object.assign(workspace.products[0], {
      name,
      imageAssetId: 'photo',
      sellingUnit: 'loaf',
      category: 'Breads',
      status: 'active',
    })
    Object.assign(workspace.products[1], {
      sellingUnit: 'half-dozen box',
      imageAssetId: 'broken-photo',
    })
    workspace.products.push({
      id: 'unfinished',
      name: 'Seasonal sampler awaiting recipe',
      sellingUnit: 'gift box',
      price: 18,
      status: 'draft',
      category: 'Seasonal',
    })
    workspace.graphic_assets = [
      {
        id: 'photo',
        name: 'Saved loaf photo',
        fileUrl: '/test-product-photo.svg',
      },
      {
        id: 'broken-photo',
        name: 'Unavailable photo',
        fileUrl: '/test-broken-photo.png',
      },
    ]
    await page.route('**/test-product-photo*.svg', (route) =>
      route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="280" height="100"><rect width="280" height="100" fill="#b68b58"/></svg>',
      }),
    )
    await page.route('**/test-broken-photo.png', (route) =>
      route.fulfill({ status: 404, body: '' }),
    )
    let saves = 0,
      uploads = 0
    await page.route('**/api/workspace*', async (route) => {
      const request = route.request()
      if (request.method() === 'POST') {
        if (request.url().includes('upload=1')) {
          uploads++
          const asset = {
            id: 'uploaded-photo',
            name: 'Updated loaf photo',
            fileUrl: '/test-product-photo-updated.svg',
          }
          workspace.graphic_assets.push(asset)
          return route.fulfill({ json: { workspace, asset } })
        }
        const payload = request.postDataJSON()
        expect(payload.action).toBe('save')
        expect(payload.table).toBe('products')
        expect(payload.data.id).toBe(workspace.products[0].id)
        workspace.products[0] = { ...workspace.products[0], ...payload.data }
        saves++
      }
      return route.fulfill({ json: { workspace, role: 'Owner', demo: false } })
    })
    await page.goto(workspaceFixtureUrl('Products & Pricing'), {
      waitUntil: 'networkidle',
    })
    const cards = page.getByRole('article')
    await expect(cards).toHaveCount(4)
    expect(await cards.allTextContents()).toEqual(
      expect.arrayContaining([expect.stringContaining(name)]),
    )
    await expect(cards.nth(0)).toHaveAccessibleName(name)
    await expect(cards.nth(1)).toHaveAccessibleName(workspace.products[1].name)
    await expect(
      cards.nth(0).getByText('$8.00 / loaf', { exact: true }),
    ).toBeVisible()
    await expect(
      cards.nth(1).getByText('$12.00 / half-dozen box', { exact: true }),
    ).toBeVisible()
    await expect(
      cards.nth(2).getByText('$12.00 / package', { exact: true }),
    ).toBeVisible()
    await expect(
      cards.nth(3).getByText('Cost incomplete', { exact: true }),
    ).toBeVisible()
    await expect(
      cards.nth(3).getByText('Unavailable', { exact: true }),
    ).toHaveCount(2)
    await expect(cards.nth(3)).not.toContainText('$0.00')
    await expect(cards.nth(0).getByRole('img')).toHaveAttribute(
      'src',
      '/test-product-photo.svg',
    )
    await expect(
      cards.nth(1).getByLabel(`product icon for ${workspace.products[1].name}`),
    ).toBeVisible()
    await expect(
      cards.nth(2).getByLabel(`product icon for ${workspace.products[2].name}`),
    ).toBeVisible()
    const layout = await page
      .locator('[aria-label="Product cards"]')
      .evaluate((grid) => ({
        columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
        overflow: document.documentElement.scrollWidth - innerWidth,
        cardOverflows: [...grid.querySelectorAll('article')].map(
          (el) => el.scrollWidth - el.clientWidth,
        ),
        photos: [...grid.querySelectorAll('.pantry-photo')].map(
          (el) => el.getBoundingClientRect().height,
        ),
        fit: getComputedStyle(grid.querySelector('img')!).objectFit,
      }))
    await page.screenshot({
      path: `/tmp/product-cards-${width}.png`,
      fullPage: true,
    })
    const overflowingElements = await page.locator('body').evaluate(() =>
      [...document.querySelectorAll('body *')]
        .filter((el) => el.getBoundingClientRect().right > innerWidth + 1)
        .map((el) => ({
          tag: el.tagName,
          className: el.className,
          right: el.getBoundingClientRect().right,
        })),
    )
    expect(
      layout.overflow,
      JSON.stringify(overflowingElements),
    ).toBeLessThanOrEqual(1)
    expect(layout.cardOverflows.every((v) => v <= 1)).toBe(true)
    expect(new Set(layout.photos)).toEqual(new Set([128]))
    expect(layout.fit).toBe('contain')
    if (width <= 640) expect(layout.columns).toBe(1)
    else expect(layout.columns).toBeGreaterThan(1)
    const search = page.getByRole('textbox', { name: 'Search products' })
    await search.fill('SEASONAL')
    await expect(cards).toHaveCount(1)
    await expect(cards.first()).toHaveAccessibleName(
      'Seasonal sampler awaiting recipe',
    )
    await search.fill('No matching product')
    await expect(page.getByText('No products match this view.')).toBeVisible()
    await search.fill('')
    await expect(cards).toHaveCount(4)
    await expect(cards.first()).toHaveAccessibleName(name)
    await expect(
      page.getByRole('button', { name: 'Create product', exact: true }).first(),
    ).toBeVisible()
    const downloadPromise = page.waitForEvent('download')
    await page
      .getByRole('button', { name: 'Export products', exact: true })
      .click()
    expect((await downloadPromise).suggestedFilename()).toBe(
      'cottage-pantry-products.csv',
    )
    await cards
      .first()
      .getByRole('button', {
        name: `View photo and details for ${name}`,
        exact: true,
      })
      .click()
    const dialog = page.getByRole('dialog')
    await expect(
      dialog.getByRole('button', { name: 'Preview label' }),
    ).toBeVisible()
    await expect(
      dialog.getByRole('button', { name: 'Edit pricing', exact: true }),
    ).toBeVisible()
    await page.keyboard.press('Escape')
    // Keyboard access to the card's action menu opens the unchanged editor.
    await cards
      .first()
      .getByRole('button', { name: `Actions for ${name}`, exact: true })
      .focus()
    await page.keyboard.press('Enter')
    await page
      .getByRole('menuitem', { name: 'Edit pricing', exact: true })
      .click()
    await expect(
      dialog.getByLabel('Retail price ($)', { exact: true }),
    ).toHaveValue('8')
    await dialog.getByLabel('Retail price ($)', { exact: true }).fill('9.25')
    await dialog
      .getByText('Product images & label graphics', { exact: true })
      .click()
    await expect(
      dialog.getByLabel('Product photo', { exact: true }),
    ).toHaveValue('photo')
    await dialog
      .getByLabel('Upload product photo', { exact: true })
      .setInputFiles({
        name: 'updated-loaf.png',
        mimeType: 'image/png',
        buffer: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=',
          'base64',
        ),
      })
    await expect(
      dialog.getByLabel('Product photo', { exact: true }),
    ).toHaveValue('uploaded-photo')
    await dialog
      .getByRole('button', { name: 'Save product', exact: true })
      .click()
    await expect(dialog).toHaveCount(0)
    await expect(
      cards.first().getByText('$9.25 / loaf', { exact: true }),
    ).toBeVisible()
    await expect(cards.first().getByRole('img')).toHaveAttribute(
      'src',
      '/test-product-photo-updated.svg',
    )
    expect(saves).toBe(1)
    expect(uploads).toBe(1)
    await cards
      .first()
      .getByRole('button', { name: 'Edit pricing', exact: true })
      .click()
    await expect(
      dialog.getByLabel('Retail price ($)', { exact: true }),
    ).toHaveValue('9.25')
    await dialog
      .getByText('Product images & label graphics', { exact: true })
      .click()
    await expect(
      dialog.getByLabel('Product photo', { exact: true }),
    ).toHaveValue('uploaded-photo')
    await page.keyboard.press('Escape')
    await page.reload({ waitUntil: 'networkidle' })
    await expect(cards).toHaveCount(4)
    await expect(
      cards.first().getByText('$9.25 / loaf', { exact: true }),
    ).toBeVisible()
    await expect(cards.first().getByRole('img')).toHaveAttribute(
      'src',
      '/test-product-photo-updated.svg',
    )
    expect(saves).toBe(1)
  })
}
