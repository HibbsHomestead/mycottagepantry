import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import type { Item } from '../src/lib/domain'
import { demoData } from '../src/lib/demo'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

const captures = 'docs/reviews/product-description-actions'
for (const size of [
  { width: 1440, zoom: 1 },
  { width: 1440, zoom: 0.8 },
  { width: 1100, zoom: 1 },
  { width: 820, zoom: 1 },
  { width: 390, zoom: 1 },
]) {
  test(`compact card and table layouts ${size.width} zoom ${size.zoom}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: size.width, height: 1000 })
    await installWorkspaceFixture(page)
    const w = demoData()
    w.products = ['food', 'handmade', 'resale', 'kit'].map(
      (workflow, index) => ({
        ...w.products[0],
        id: `isolated-${workflow}`,
        name: index
          ? `${workflow} example with a deliberately long descriptive name that spans two lines`
          : 'Example loaf',
        workflow,
        imageAssetId: undefined,
        recipeId: workflow === 'food' ? w.recipes[0].id : '',
        kitComponents: [],
        packagingLines: [],
        quantity: 0,
        status: 'active',
      }),
    )
    await page.route('**/api/workspace*', (route) =>
      route.fulfill({ json: { workspace: w, role: 'Owner', demo: false } }),
    )
    await mkdir(captures, { recursive: true })
    for (const section of [
      'Inventory/Ingredients',
      'Production/Recipes & Designs',
      'Products/All Products',
      'Handmade/Products & Bills of Materials',
      'Resale/Items & Stock',
    ]) {
      await page.goto(workspaceFixtureUrl(section))
      await page.evaluate((zoom) => {
        document.documentElement.style.zoom = String(zoom)
      }, size.zoom)
      const cards = page.locator(
        '.pantry-card .item-record-actions, .recipe-card > .item-record-actions',
      )
      await expect(cards.first()).toBeVisible()
      const checkLines = async () => {
        const groups = page.locator('.item-record-actions')
        for (const group of await groups.all()) {
          const bounds = await group
            .getByRole('button')
            .evaluateAll((buttons) =>
              buttons.map((b) => {
                const r = b.getBoundingClientRect()
                return {
                  top: r.top,
                  bottom: r.bottom,
                  left: r.left,
                  right: r.right,
                  label: b.getAttribute('aria-label'),
                  text: b.textContent,
                }
              }),
            )
          expect(
            Math.max(...bounds.map((b) => b.top)) -
              Math.min(...bounds.map((b) => b.top)),
          ).toBeLessThan(2)
          expect(bounds.every((b) => b.label)).toBeTruthy()
          for (let i = 1; i < bounds.length; i++)
            expect(bounds[i].left).toBeGreaterThanOrEqual(bounds[i - 1].right)
        }
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth + 1,
          ),
        ).toBeTruthy()
      }
      await checkLines()
      const slug =
        section.replace(/[^a-z]+/gi, '-').toLowerCase() +
        `-${size.width}-${size.zoom}`
      await page.screenshot({
        path: `${captures}/${slug}-cards.png`,
        fullPage: true,
      })
      await page.getByRole('button', { name: 'Table', exact: true }).click()
      await expect(
        page.locator('table .item-record-actions').first(),
      ).toBeVisible()
      await expect(
        page.getByRole('columnheader', { name: 'Photo', exact: true }),
      ).toBeVisible()
      await expect(page.locator('tbody .table-thumbnail').first()).toBeVisible()
      await checkLines()
      const region = page
        .locator('.catalog-table-region, .pantry-table .table-wrap')
        .first()
      await region.evaluate((el) => {
        el.scrollLeft = 0
      })
      await page.screenshot({
        path: `${captures}/${slug}-table.png`,
        fullPage: true,
      })
      await region.evaluate((el) => {
        el.scrollLeft = el.scrollWidth
      })
      await page.screenshot({
        path: `${captures}/${slug}-table-actions.png`,
        fullPage: true,
      })
    }
  })
}

for (const workflow of ['food', 'handmade', 'resale', 'kit'])
  test(`description review, restore and fixture save ${workflow}`, async ({
    page,
  }) => {
    await page.setViewportSize({
      width: workflow === 'resale' ? 390 : 1440,
      height: 1000,
    })
    await installWorkspaceFixture(page)
    const w = demoData()
    const p: Item = {
      ...w.products[0],
      id: 'isolated-description',
      name: 'Verified product',
      workflow,
      publicDescription: 'Original public text',
      description: 'Original public text',
      notes: 'PRIVATE internal note',
      supplierId: 'PRIVATE supplier',
      kitComponents: [],
      packagingLines: [],
      recipeId: workflow === 'food' ? w.recipes[0].id : '',
    }
    const component = {
      ...w.products[1],
      id: 'isolated-kit-component',
      name: 'Kit component',
      workflow: 'resale',
      quantity: 0,
    }
    if (workflow === 'kit')
      p.kitComponents = [{ productId: component.id, quantity: 1 }]
    if (workflow === 'handmade')
      w.ingredients.push({
        id: 'isolated-material',
        name: 'Recorded cotton',
        usedAs: 'material',
        unit: 'each',
        quantity: 0,
        cost: 1,
      })
    if (workflow === 'handmade')
      Object.assign(p, {
        bom: {
          id: 'isolated-bom',
          name: 'Definition',
          output: 1,
          lines: [
            { ingredientId: 'isolated-material', quantity: 1, unit: 'each' },
          ],
          laborMinutes: 0,
          laborRate: 0,
          overhead: 0,
          scrapPercent: 0,
        },
      })
    w.products = workflow === 'kit' ? [p, component] : [p]
    let writes = 0,
      calls = 0
    await page.route('**/api/workspace*', (route) => {
      if (route.request().method() === 'POST') {
        const b = route.request().postDataJSON()
        if (b.action === 'save') {
          writes++
          Object.assign(p, b.data)
        }
      }
      return route.fulfill({
        json: { workspace: w, role: 'Owner', demo: false },
      })
    })
    await page.route('**/api/support*', async (route) => {
      calls++
      const payload = route.request().postDataJSON()
      expect(JSON.stringify(payload)).not.toMatch(
        /PRIVATE|Original public text|Legacy text|supplierId|price|cost|margin|taxCode/,
      )
      expect(payload.productSource.name).toBe('Verified product')
      await new Promise((resolve) => setTimeout(resolve, 150))
      await route.fulfill({
        json: {
          description:
            'A concise suggestion based on the verified product details.',
        },
      })
    })
    await page.goto(workspaceFixtureUrl('Products/All Products'))
    await page
      .getByRole('button', { name: 'Edit Verified product', exact: true })
      .click()
    const editor = page.getByRole('dialog').first()
    const field = page.locator('.product-description-field > textarea')
    await expect(field).toHaveValue('Original public text')
    await editor
      .getByRole('button', { name: 'Generate description', exact: true })
      .click()
    const review = page.getByRole('dialog', {
      name: 'Review product description',
    })
    await expect(review.getByRole('status')).toBeVisible()
    await expect(
      review.getByRole('button', { name: 'Generate again' }),
    ).toBeDisabled()
    await expect(
      review.getByRole('textbox', { name: 'Proposed description' }),
    ).toHaveValue(/concise suggestion/)
    await expect(field).toHaveValue('Original public text')
    await mkdir(captures, { recursive: true })
    await page.screenshot({
      path: `${captures}/description-review-${workflow}.png`,
    })
    expect(
      await review.evaluate((el) => el.contains(document.activeElement)),
    ).toBeTruthy()
    const box = await review.boundingBox()
    expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(box!.y + box!.height).toBeLessThanOrEqual(1001)
    await review.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(field).toHaveValue('Original public text')
    expect(writes).toBe(0)
    await editor
      .getByRole('button', { name: 'Generate description', exact: true })
      .click()
    await expect(
      review.getByRole('textbox', { name: 'Proposed description' }),
    ).toHaveValue(/concise suggestion/)
    await review
      .getByRole('textbox', { name: 'Proposed description' })
      .fill('Reviewed customer description')
    await review
      .getByRole('button', { name: 'Use description', exact: true })
      .click()
    await expect(field).toHaveValue('Reviewed customer description')
    expect(writes).toBe(0)
    await editor
      .getByRole('button', { name: 'Restore previous description' })
      .click()
    await expect(field).toHaveValue('Original public text')
    await editor
      .getByRole('button', { name: 'Generate description', exact: true })
      .click()
    await expect(
      review.getByRole('textbox', { name: 'Proposed description' }),
    ).toHaveValue(/concise suggestion/)
    await review
      .getByRole('button', { name: 'Use description', exact: true })
      .click()
    await editor
      .getByRole('button', {
        name: /^(Save Changes|Save changes|Save product|Save product & bill of materials|Save kit|Save Kit)$/,
      })
      .click()
    if (workflow === 'kit')
      await page
        .getByRole('dialog')
        .getByRole('button', { name: 'Close', exact: true })
        .last()
        .click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(writes).toBe(1)
    await page
      .getByRole('button', { name: 'Edit Verified product', exact: true })
      .click()
    await expect(
      page.getByRole('textbox', {
        name: 'Product description (customer-facing)',
      }),
    ).toHaveValue(/concise suggestion/)
    expect(p.notes).toBe('PRIVATE internal note')
    expect(calls).toBe(3)
  })
