import { test, expect, chromium, firefox, type Page } from '@playwright/test'
import bwipjs from 'bwip-js/node'
import { fileURLToPath } from 'node:url'
import { demoData } from '../src/lib/demo'
import { convert } from '../src/lib/domain'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'
async function fixture(page: Page) {
  await installWorkspaceFixture(page)
  const w = demoData()
  w.ingredients = w.ingredients.filter((i) =>
    ['flour', 'eggs', 'butter', 'sugar', 'bags'].includes(i.id),
  )
  Object.assign(w.ingredients[0], {
    quantity: convert(7.5, 'lb', w.ingredients[0].unit),
    purchaseQuantity: 5,
    purchaseUnit: 'lb',
    barcode: '001234',
    storageLocation: 'Pantry · Bin 2',
  })
  Object.assign(
    w.ingredients.find((i) => i.id === 'eggs')!,
    { imageAssetId: 'fixture-eggs', expires: '2026-11-08' },
  )
  w.ingredients.push({
    id: 'preview-fabric',
    name: 'Indigo cotton · 44 inch',
    usedAs: 'material',
    materialType: 'fabric',
    fabricTracking: 'length',
    pieceMode: 'aggregate',
    fabricWidth: 44,
    widthUnit: 'in',
    fiber: '100% cotton',
    quantity: 3.25,
    unit: 'yd',
    storageUnit: 'yd',
    cost: 7.45,
    threshold: 1,
    category: 'Quilting cotton',
    storageLocation: 'Studio · Shelf 1',
  })
  w.products.push({
    id: 'preview-resale',
    name: 'Stoneware market mug',
    workflow: 'resale',
    variant: 'Indigo / 12 oz',
    quantity: 50,
    unit: 'each',
    cost: 4.75,
    stockCostKnown: true,
    price: 12,
    threshold: 12,
    category: 'Market goods',
    barcode: '009876',
    purchaseUnit: 'case',
    itemsPerUnit: 12,
    storageLocation: 'Market · Shelf 2',
  })
  w.graphic_assets ||= []
  w.graphic_assets.push({
    id: 'fixture-eggs',
    name: 'Sample imported egg photo · Unsplash',
    fileUrl: '/fixture-eggs.jpg',
  })
  const writes: unknown[] = []
  await page.route('**/fixture-eggs.jpg', (r) =>
    r.fulfill({
      path: fileURLToPath(
        new URL('../src/test/fixtures/eggs-unsplash.jpg', import.meta.url),
      ),
      contentType: 'image/jpeg',
    }),
  )
  await page.route('**/api/workspace*', (r) => {
    if (r.request().method() === 'POST') writes.push(r.request().postDataJSON())
    return r.fulfill({ json: { workspace: w, role: 'Owner', demo: false } })
  })
  return { writes, w }
}
for (const [name, engine] of Object.entries({ chromium, firefox })) {
  for (const width of [390, 820, 1440])
    test(`${name} photo grid, detail and edit entry ${width}`, async () => {
      const browser = await engine.launch(),
        page = await browser.newPage({ viewport: { width, height: 980 } })
      page.setDefaultTimeout(10000)
      try {
        const { writes } = await fixture(page)
        const errors: string[] = []
        page.on('pageerror', (e) => errors.push(e.message))
        await page.goto(workspaceFixtureUrl('Pantry'))
        await page
          .getByRole('button', { name: 'Preview photo inventory' })
          .click()
        const d = page.getByRole('dialog')
        await expect(d.getByAltText('Photo of Large eggs')).toBeVisible()
        expect(
          await d
            .getByAltText('Photo of Large eggs')
            .evaluate(
              (el: HTMLImageElement) => el.complete && el.naturalWidth > 0,
            ),
        ).toBe(true)
        await d.getByText('Filters & sort', { exact: false }).click()
        await d.getByLabel('Sort', { exact: true }).selectOption('expiry')
        await d.getByText('Filters & sort', { exact: false }).click()
        if (name === 'chromium')
          await page.screenshot({
            path: `docs/previews/inventory-grid-${width}.webp`,
          })
        await d.getByText('Filters & sort', { exact: false }).click()
        await d
          .getByLabel('Storage location', { exact: true })
          .selectOption('Pantry · Bin 2')
        await expect(d.locator('.inventory-photo-card')).toHaveCount(1)
        await expect(d.getByText('7.5 lb remaining')).toBeVisible()
        await d.getByRole('button', { name: 'Table', exact: true }).click()
        await expect(d.getByRole('row')).toHaveCount(2)
        await d.getByRole('button', { name: 'View Bread flour' }).click()
        await expect(
          d.getByText('Package size: 5 lb / purchase package'),
        ).toBeVisible()
        await d.getByText('Stock History', { exact: true }).click()
        await d.getByRole('button', { name: 'All items' }).click()
        await d.getByText('Filters & sort', { exact: false }).click()
        await d.getByLabel('Storage location', { exact: true }).selectOption('')
        await d.getByRole('button', { name: 'Cards', exact: true }).click()
        await d.getByRole('button', { name: 'View Large eggs' }).click()
        await expect(d.getByText('42 each', { exact: true })).toBeVisible()
        expect(
          await d.evaluate((el) => el.scrollWidth - el.clientWidth),
        ).toBeLessThanOrEqual(1)
        if (name === 'chromium')
          await page.screenshot({
            path: `docs/previews/inventory-detail-${width}.webp`,
          })
        expect(writes).toHaveLength(0)
        await d.getByRole('button', { name: 'Edit item' }).click()
        await expect(
          page.getByRole('button', { name: 'Save changes', exact: true }),
        ).toBeVisible()
        expect(writes).toHaveLength(0)
        expect(errors).toEqual([])
      } finally {
        await browser.close()
      }
    })
  test(`${name} actual decoder and denied-camera manual fallback`, async () => {
    const browser = await engine.launch(),
      page = await browser.newPage({ viewport: { width: 390, height: 980 } })
    try {
      const { writes } = await fixture(page)
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'mediaDevices', {
          configurable: true,
          value: {
            getUserMedia: async () => {
              throw new DOMException('Denied for fixture', 'NotAllowedError')
            },
          },
        })
      })
      await page.goto(workspaceFixtureUrl('Pantry'))
      const png = await bwipjs.toBuffer({
        bcid: 'code128',
        text: '001234',
        scale: 3,
        height: 20,
        padding: 15,
        backgroundcolor: 'FFFFFF',
      })
      expect(
        await page.evaluate(
          async (source) => {
            const path = '/src/test/capture-workspace.tsx'
            const m = await import(/* @vite-ignore */ path)
            return m.decodeFixtureBarcode(source)
          },
          `data:image/png;base64,${png.toString('base64')}`,
        ),
      ).toBe('001234')
      await page.getByRole('button', { name: 'Add Item', exact: true }).click()
      const d = page.getByRole('dialog')
      await d
        .getByLabel('Item Type', { exact: true })
        .selectOption('ingredient')
      await d.getByRole('button', { name: 'Barcode', exact: true }).click()
      await d.getByRole('button', { name: 'Scan Barcode', exact: true }).click()
      await page.getByRole('button', { name: 'Start rear camera' }).click()
      await expect(page.getByRole('alert')).toContainText(
        'Camera permission was denied',
      )
      await page.getByRole('textbox').fill('001234')
      await page.getByRole('button', { name: 'Use entered code' }).click()
      await expect(d.getByText('Existing inventory found')).toBeVisible()
      await d.getByRole('checkbox', { name: /checked the variant/ }).check()
      await d
        .getByRole('button', { name: 'Receive Stock', exact: true })
        .click()
      await expect(
        page
          .getByRole('dialog')
          .getByRole('heading', { name: 'Receive inventory', exact: true }),
      ).toBeVisible()
      expect(writes).toHaveLength(0)
    } finally {
      await browser.close()
    }
  })
}
