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
    { imageAssetId: 'fixture-eggs', expires: '2026-11-08', threshold: 50 },
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
  const writes: { action: string }[] = []
  await page.route('**/fixture-eggs.jpg', (r) =>
    r.fulfill({
      path: fileURLToPath(
        new URL('../src/test/fixtures/eggs-unsplash.jpg', import.meta.url),
      ),
      contentType: 'image/jpeg',
    }),
  )
  await page.route('**/api/workspace*', (r) => {
    if (r.request().method() === 'POST') {
      const body = r.request().postDataJSON()
      writes.push(body)
      if (body.action === 'pantryView')
        w.settings[0].currentPantryView = body.data.view
    }
    return r.fulfill({ json: { workspace: w, role: 'Owner', demo: false } })
  })
  return { writes, w }
}
for (const [name, engine] of Object.entries({ chromium, firefox })) {
  for (const width of [390, 820, 1440])
    test(`${name} integrated inventory cards and table ${width}`, async () => {
      const browser = await engine.launch(),
        page = await browser.newPage({ viewport: { width, height: 980 } })
      page.setDefaultTimeout(10000)
      try {
        const { writes, w } = await fixture(page)
        const originalInventory = JSON.stringify({
          ingredients: w.ingredients,
          ledger: w.ledger,
        })
        const errors: string[] = []
        page.on('pageerror', (e) => errors.push(e.message))
        await page.goto(workspaceFixtureUrl('Pantry'))
        await expect(
          page.getByRole('button', { name: 'Preview photo inventory' }),
        ).toHaveCount(0)
        await expect(page.getByText('MY OVEN · DESIGN PREVIEW')).toHaveCount(0)
        const inventory = page.locator('.pantry-v2')
        await expect(
          inventory.getByRole('button', { name: 'Cards', exact: true }),
        ).toHaveAttribute('aria-pressed', 'true')
        await expect(
          inventory.getByAltText('Photo of Large eggs'),
        ).toBeVisible()
        expect(
          await inventory
            .getByAltText('Photo of Large eggs')
            .evaluate(
              (el: HTMLImageElement) => el.complete && el.naturalWidth > 0,
            ),
        ).toBe(true)
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth + 1,
          ),
        ).toBe(true)
        if (width === 390) {
          const cards = inventory.locator('.pantry-card')
          const first = await cards.nth(0).boundingBox(),
            second = await cards.nth(1).boundingBox()
          expect(second!.y).toBeGreaterThan(first!.y + first!.height - 1)
          expect(first!.width).toBeGreaterThan(300)
        }
        if (name === 'chromium') {
          if (width === 390)
            await inventory
              .getByRole('article', { name: 'Large eggs', exact: true })
              .scrollIntoViewIfNeeded()
          await page.screenshot({
            path: `docs/previews/inventory-main-cards-${width}.png`,
            fullPage: width !== 390,
          })
        }
        await inventory.getByRole('button', { name: /^Low stock/ }).click()
        await inventory
          .getByRole('textbox', { name: 'Search pantry' })
          .fill('Large eggs')
        await expect(inventory.locator('.pantry-card')).toHaveCount(1)
        await inventory
          .getByRole('button', { name: 'Table', exact: true })
          .click()
        await expect(inventory.locator('tbody tr')).toHaveCount(1)
        await expect(inventory.locator('tbody tr').first()).toContainText(
          'Large eggs',
        )
        await expect(
          inventory.getByRole('button', { name: /^Low stock/ }),
        ).toHaveAttribute('aria-pressed', 'true')
        await expect(
          inventory.getByRole('textbox', { name: 'Search pantry' }),
        ).toHaveValue('Large eggs')
        await inventory
          .getByRole('button', { name: 'Actions for Large eggs' })
          .click()
        for (const action of [
          'Receive stock',
          'Adjust / record waste',
          'Print shelf/bin label',
        ]) {
          await expect(
            page.getByRole('menuitem', { name: action, exact: true }),
          ).toBeVisible()
        }
        await page.keyboard.press('Escape')
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth + 1,
          ),
        ).toBe(true)
        if (name === 'chromium')
          await page.screenshot({
            path: `docs/previews/inventory-main-table-${width}.png`,
          })
        await page.reload()
        await expect(
          page
            .locator('.pantry-v2')
            .getByRole('button', { name: 'Table', exact: true }),
        ).toHaveAttribute('aria-pressed', 'true')
        await page
          .locator('.pantry-v2')
          .getByRole('button', { name: 'Cards', exact: true })
          .click()
        await page
          .locator('.pantry-v2')
          .getByRole('button', { name: 'View details', exact: true })
          .first()
          .click()
        await expect(page.getByRole('dialog')).toBeVisible()
        await page
          .getByRole('dialog')
          .getByRole('button', { name: /^Close (ingredient|packaging) details$/ })
          .first()
          .click()
        await page
          .getByRole('button', { name: 'Scan barcode', exact: true })
          .click()
        await page.getByRole('dialog').getByRole('textbox').fill('001234')
        await page.getByRole('button', { name: 'Use entered code' }).click()
        await page
          .getByRole('button', { name: /Bread flour .*Item barcode/ })
          .click()
        await expect(
          page
            .getByRole('dialog')
            .getByRole('heading', { name: 'Bread flour', exact: true }),
        ).toBeVisible()
        expect(writes.every((body) => body.action === 'pantryView')).toBe(true)
        expect(
          JSON.stringify({ ingredients: w.ingredients, ledger: w.ledger }),
        ).toBe(originalInventory)
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
