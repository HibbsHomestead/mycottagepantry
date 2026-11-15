import { test, expect } from '@playwright/test'
import { demoData } from '../src/lib/demo'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

for (const width of [1440, 390])
  test(`handmade linked product workflow at ${width}px`, async ({ page }) => {
    test.setTimeout(180000)
    await page.setViewportSize({ width, height: 1000 })
    await installWorkspaceFixture(page)
    const w = demoData()
    w.ingredients.push({
      id: 'linen-material',
      name: 'Natural linen',
      usedAs: 'material',
      unit: 'yd',
      quantity: 20,
      cost: 8,
      threshold: 2,
    })
    w.products.push({
      id: 'linen-bag',
      name: 'Handmade natural linen market bag with reinforced handles',
      workflow: 'handmade',
      sku: 'LINEN-N',
      variant: 'Natural / large',
      price: 35,
      quantity: 4,
      cost: 12,
      stockCostKnown: true,
      bom: {
        id: 'linen-bom',
        output: 2,
        scrapPercent: 5,
        laborMinutes: 20,
        laborRate: 15,
        overhead: 2,
        lines: [{ ingredientId: 'linen-material', quantity: 1, unit: 'yd' }],
      },
    })
    w.products.push({
      id: 'legacy-bag',
      name: 'Legacy cotton bag',
      workflow: 'handmade',
      price: 35,
      quantity: 2,
    })
    const writes: any[] = []
    let failSave = false
    await page.route('**/api/workspace*', async (route) => {
      if (route.request().url().includes('productCategories=1'))
        return route.fulfill({
          json: {
            categories: [],
            mappings: {},
            rates: [],
            products: w.products,
            revision: 1,
          },
        })
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON()
        writes.push(body)
        if (failSave)
          return route.fulfill({
            status: 400,
            json: { error: 'Synthetic save failure. Try again.' },
          })
        if (body.action === 'save') {
          const i = w.products.findIndex((p) => p.id === body.data.id)
          w.products[i] = { ...w.products[i], ...body.data }
        }
      }
      return route.fulfill({
        json: { workspace: w, role: 'Owner', demo: true },
      })
    })
    const base = workspaceFixtureUrl('Handmade').split('#')[0]
    await page.goto(base + '#Handmade/Products%20%26%20Bills%20of%20Materials')
    await expect(page.locator('.product-card').first()).toBeVisible()
    await page.screenshot({
      path: `docs/reviews/handmade-refinement/list-${width}.png`,
      fullPage: true,
      animations: 'disabled',
    })
    await page
      .getByRole('button', {
        name: 'Handmade natural linen market bag with reinforced handles',
        exact: true,
      })
      .click()
    await expect(
      page.getByRole('button', { name: 'Edit product', exact: true }),
    ).toBeVisible()
    await expect(page).toHaveURL(/product=linen-bag/)
    await page.reload()
    await expect(
      page.getByRole('button', { name: 'Edit product', exact: true }),
    ).toBeVisible()
    await page.screenshot({
      path: `docs/reviews/handmade-refinement/detail-${width}.png`,
      fullPage: true,
      animations: 'disabled',
    })
    await page
      .getByRole('button', { name: 'Edit product', exact: true })
      .click()
    await expect(page.getByLabel('Product name', { exact: true })).toBeVisible()
    await page
      .getByLabel('Product name', { exact: true })
      .fill('Linen market bag — updated')
    await page.screenshot({
      path: `docs/reviews/handmade-refinement/edit-${width}.png`,
      fullPage: true,
      animations: 'disabled',
    })
    await page
      .getByRole('tab', { name: 'Bill of Materials', exact: true })
      .click()
    await page.getByLabel('Quantity', { exact: true }).fill('1.5')
    await page.screenshot({
      path: `docs/reviews/handmade-refinement/bom-${width}.png`,
      fullPage: true,
      animations: 'disabled',
    })
    await page.getByRole('tab', { name: 'Product', exact: true }).click()
    await expect(page.getByLabel('Product name', { exact: true })).toHaveValue(
      'Linen market bag — updated',
    )
    await page.getByLabel('Product name', { exact: true }).fill('')
    await page
      .getByRole('tab', { name: 'Bill of Materials', exact: true })
      .click()
    await page
      .getByRole('button', { name: 'Save product & bill of materials' })
      .click()
    await expect(page.getByLabel('Product name', { exact: true })).toBeVisible()
    await expect(page.getByRole('alert').last()).toContainText('Review')
    await page
      .getByLabel('Product name', { exact: true })
      .fill('Linen market bag — updated')
    page.once('dialog', (d) => d.dismiss())
    await page.locator('.handmade-workspace .breadcrumb a').first().click()
    await expect(page.getByLabel('Product name', { exact: true })).toHaveValue(
      'Linen market bag — updated',
    )
    failSave = true
    await page
      .getByRole('button', { name: 'Save product & bill of materials' })
      .click()
    await expect(page.getByRole('alert').last()).toContainText(
      'Synthetic save failure',
    )
    await expect(page.getByLabel('Product name', { exact: true })).toHaveValue(
      'Linen market bag — updated',
    )
    failSave = false
    await page
      .getByRole('button', { name: 'Save product & bill of materials' })
      .click()
    await expect(
      page.getByRole('button', { name: 'Edit product', exact: true }),
    ).toBeVisible()
    expect(
      writes.every((r) => r.action === 'save' && r.table === 'products'),
    ).toBe(true)
    expect(w.products.find((p) => p.id === 'linen-bag')?.quantity).toBe(4)
    expect(w.ingredients.find((p) => p.id === 'linen-material')?.quantity).toBe(
      20,
    )
    expect(
      w.products.find((p) => p.id === 'linen-bag')?.bom.lines[0].quantity,
    ).toBe('1.5')
    await page.goBack()
    await expect(page.getByLabel('Product name', { exact: true })).toBeVisible()
    await page.goForward()
    await expect(
      page.getByRole('button', { name: 'Edit product', exact: true }),
    ).toBeVisible()
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    )
    expect(overflow).toBe(false)
    await page.goto(
      base +
        '#Handmade/Products%20%26%20Bills%20of%20Materials?product=legacy-bag',
    )
    await expect(
      page.getByText('Legacy BOM needs review.', { exact: false }),
    ).toBeVisible()
    await page.goto(base + '#Products/Food')
    await expect(page.locator('.product-card').first()).toBeVisible()
    await page.screenshot({
      path: `docs/reviews/handmade-refinement/baked-reference-${width}.png`,
      fullPage: true,
      animations: 'disabled',
    })
    await page
      .locator('.product-card')
      .first()
      .getByRole('button', { name: 'View details', exact: true })
      .click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.screenshot({
      path: `docs/reviews/handmade-refinement/baked-detail-reference-${width}.png`,
      fullPage: true,
      animations: 'disabled',
    })
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Edit Product', exact: true })
      .click()
    await expect(
      page.getByRole('dialog').getByRole('tab').first(),
    ).toBeVisible()
    await page.screenshot({
      path: `docs/reviews/handmade-refinement/baked-edit-reference-${width}.png`,
      fullPage: true,
      animations: 'disabled',
    })
  })
