import { test, expect } from '@playwright/test'
import { demoData } from '../src/lib/demo'
import { productCosting, profitability, money } from '../src/lib/domain'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

for (const width of [1440, 390]) {
  test(`renders matching ingredient/product detail structures and cost cards at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await installWorkspaceFixture(page)
    const workspace = demoData()
    const yeast = workspace.ingredients.find((i) => i.id === 'yeast')!
    Object.assign(yeast, {
      name: 'Instant Dry Yeast',
      purchaseQuantity: 1,
      purchaseUnit: 'bag',
      packagePrice: 5.12,
      storageUnit: 'oz',
      recipeUnit: 'g',
      conversions: [
        { from: 'bag', to: 'oz', amountFrom: 1, amountTo: 16, verified: true },
      ],
    })
    let writes = 0
    await page.route('**/api/workspace*', (route) => {
      if (route.request().method() === 'POST') writes++
      return route.fulfill({ json: { workspace, role: 'Owner', demo: false } })
    })
    await page.goto(workspaceFixtureUrl('Inventory/Ingredients'))
    await page.getByRole('textbox', { name: 'Search pantry' }).fill('yeast')
    await page
      .getByRole('button', { name: 'View details', exact: true })
      .click()
    const modal = page.getByRole('dialog')
    const geometry = () =>
      modal.evaluate((el) => {
        const modal = el.getBoundingClientRect()
        const relative = (selector: string) => {
          const node = el.querySelector(selector)!
          const rect = node.getBoundingClientRect()
          const css = getComputedStyle(node)
          return {
            x: rect.x - modal.x,
            y: rect.y - modal.y,
            width: rect.width,
            height: rect.height,
            fontSize: css.fontSize,
            fontWeight: css.fontWeight,
            padding: css.padding,
            borderRadius: css.borderRadius,
          }
        }
        const css = getComputedStyle(el)
        return {
          width: modal.width,
          height: modal.height,
          padding: css.padding,
          maxHeight: css.maxHeight,
          radius: css.borderRadius,
          header: relative('[data-slot="dialog-header"]'),
          title: relative('[data-slot="dialog-title"]'),
          photo: relative('.product-detail-photo'),
          columns: getComputedStyle(el.querySelector('.product-detail-layout')!)
            .gridTemplateColumns,
          card: relative('.detail-stats .cost-card'),
          button: relative('.button-row .btn'),
          section: relative('details.calculation-box'),
        }
      })
    await expect(modal.getByRole('heading', { name: yeast.name })).toBeVisible()
    await expect(modal.locator('.detail-stats')).toContainText('$5.12')
    await expect(modal.locator('.detail-stats')).toContainText('$0.32 / oz')
    await expect(modal.getByText('16 oz', { exact: true })).toBeVisible()
    await expect(modal.getByText('$0.0113 / g', { exact: true })).toBeVisible()
    await expect(
      modal.getByText('1 g = 0.03527 oz', { exact: true }),
    ).toBeVisible()
    await expect(modal.locator('nav, [role="tablist"]')).toHaveCount(0)
    await modal.evaluate((el) =>
      Promise.all(
        el
          .getAnimations({ subtree: true })
          .map((animation) => animation.finished.catch(() => {})),
      ),
    )
    await modal.getByRole('heading', { name: yeast.name, exact: true }).click()
    const ingredientGeometry = await geometry()
    await page.screenshot({
      path: `docs/previews/ingredient-cost-cards-${width}.png`,
      animations: 'disabled',
    })
    if (width < 640) {
      await modal.evaluate((el) => {
        el.scrollTop +=
          el.querySelector('.pricing-summary')!.getBoundingClientRect().top -
          el.getBoundingClientRect().top -
          22
      })
      await page.screenshot({
        path: `docs/previews/ingredient-cost-cards-${width}-scrolled.png`,
        animations: 'disabled',
      })
    }
    for (const name of [
      'How this is calculated',
      'Purchasing',
      'Inventory',
      'Label & ingredient details',
    ]) {
      const summary = modal
        .locator('summary')
        .filter({ hasText: new RegExp(`^${name}$`) })
      await summary.click()
      await summary.click()
    }
    expect(
      await modal.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1)
    await modal
      .getByRole('button', { name: 'Edit Ingredient', exact: true })
      .click()
    await expect(modal.getByLabel('Name', { exact: true })).toHaveValue(
      yeast.name,
    )
    await modal.getByRole('button', { name: 'Cancel', exact: true }).click()
    await modal
      .getByRole('button', { name: 'Close ingredient details' })
      .click()
    await page.goto(workspaceFixtureUrl('Products'))
    const product = workspace.products[0]
    await page.getByRole('button', { name: product.name, exact: true }).click()
    await expect(
      modal.getByRole('heading', { name: product.name }),
    ).toBeVisible()
    const costing = productCosting(product, workspace)
    const pricing = profitability(
      product,
      costing.perPackage,
      workspace.settings[0],
    )
    await expect(modal.locator('.detail-stats')).toContainText(
      money(costing.perPackage),
    )
    await expect(modal.locator('.detail-stats')).toContainText(
      money(pricing.profit),
    )
    await expect(
      modal.getByText(`${pricing.margin.toFixed(2)}%`, { exact: true }),
    ).toBeVisible()
    await expect(modal.getByText('Ingredients', { exact: true })).toBeVisible()
    await expect(modal.getByText('Packaging', { exact: true })).toBeVisible()
    await expect(modal.getByText('Labor', { exact: true })).toBeVisible()
    await expect(modal.getByText('Overhead', { exact: true })).toBeVisible()
    await expect(modal.locator('details')).toHaveCount(1)
    await modal.evaluate((el) =>
      Promise.all(
        el
          .getAnimations({ subtree: true })
          .map((animation) => animation.finished.catch(() => {})),
      ),
    )
    await modal
      .getByRole('heading', { name: product.name, exact: true })
      .click()
    const productGeometry = await geometry()
    await page.screenshot({
      path: `docs/previews/product-cost-cards-${width}.png`,
      animations: 'disabled',
    })
    const {
      width: modalWidth,
      padding,
      maxHeight,
      radius,
      title,
      photo,
      columns,
      card,
      button,
      section,
      header,
    } = ingredientGeometry
    expect(productGeometry.width).toBe(modalWidth)
    expect(productGeometry.height).toBe(ingredientGeometry.height)
    expect(productGeometry.padding).toBe(padding)
    expect(productGeometry.maxHeight).toBe(maxHeight)
    expect(productGeometry.radius).toBe(radius)
    expect(productGeometry.columns).toBe(columns)
    // The longer product name wraps on mobile; its following content moves by one title line.
    const titleWrap = productGeometry.title.height - title.height
    expect(productGeometry.title).toEqual({
      ...title,
      height: title.height + titleWrap,
    })
    const headerWrap = productGeometry.header.height - header.height
    expect(productGeometry.header).toEqual({
      ...header,
      height: header.height + headerWrap,
    })
    expect(productGeometry.photo).toEqual({ ...photo, y: photo.y + headerWrap })
    for (const key of [
      'fontSize',
      'fontWeight',
      'padding',
      'borderRadius',
    ] as const) {
      expect(productGeometry.card[key]).toEqual(card[key])
      expect(productGeometry.button[key]).toEqual(button[key])
      expect(productGeometry.section[key]).toEqual(section[key])
    }
    await page.screenshot({
      path: `docs/previews/product-cost-cards-${width}.png`,
      animations: 'disabled',
    })
    if (width < 640) {
      await modal.evaluate((el) => {
        el.scrollTop +=
          el.querySelector('.pricing-summary')!.getBoundingClientRect().top -
          el.getBoundingClientRect().top -
          22
      })
      await page.screenshot({
        path: `docs/previews/product-cost-cards-${width}-scrolled.png`,
        animations: 'disabled',
      })
    }
    await modal.getByText('How this is calculated', { exact: true }).click()
    await expect(modal.getByText(/Wholesale selling price:/)).toBeVisible()
    expect(
      await modal.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1)
    expect(writes).toBe(0)
  })
}
