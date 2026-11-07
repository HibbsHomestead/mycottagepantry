import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'
import { test, expect } from '@playwright/test'
import { demoData } from '../src/lib/demo'
import { updateProductRecipe } from '../src/lib/product-recipe-links'
for (const width of [1440, 390])
  test(`compact recipe and ingredient details ${width}`, async ({ page }) => {
    await installWorkspaceFixture(page)
    await page.setViewportSize({ width, height: 900 })
    const workspace = demoData(),
      recipe =
        workspace.recipes.find((r) => r.yieldUnit === 'loaves') ||
        workspace.recipes[0]
    workspace.settings[0].appearance = {
      theme: 'cottage',
      mode: width === 390 ? 'dark' : 'light',
    }
    const product = workspace.products[0]
    product.recipeId = null
    product.sku = 'LINK-TEST'
    product.packagingLines = []
    product.packagingId = null
    product.unpacked = true
    let linkRequests = 0
    await page.route('**/api/workspace*', async (route) => {
      if (route.request().url().includes('priceSearch'))
        return route.fulfill({ json: { configured: false, cache: null } })
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON()
        if (body.action === 'productRecipeLink') {
          linkRequests++
          const next = updateProductRecipe(workspace, body.data)
          workspace.products = workspace.products.map((p) =>
            p.id === next.id ? next : p,
          )
        }
      }
      return route.fulfill({ json: { workspace, role: 'Owner', demo: true } })
    })
    await page.goto(workspaceFixtureUrl('Recipes'), {
      waitUntil: 'domcontentloaded',
    })
    await page
      .locator('.recipe-card')
      .filter({
        has: page.getByRole('heading', { name: recipe.name, exact: true }),
      })
      .click()
    const modal = page.getByRole('dialog')
    await expect(
      modal.getByRole('heading', { name: recipe.name, exact: true }),
    ).toBeVisible()
    await expect(modal).not.toContainText(
      'Everything you need to keep your business in good order',
    )
    await expect(modal.locator('.recipe-summary')).toBeInViewport()
    expect(
      await modal.locator('.recipe-detail-body').evaluate((el) => el.scrollTop),
    ).toBe(0)
    await page.screenshot({
      animations: 'disabled',
      path: `/tmp/compact-recipe-opening-${width}.png`,
    })
    const box = await modal.boundingBox()
    expect(box!.y).toBeGreaterThan(5)
    expect(box!.y + box!.height).toBeLessThan(895)
    expect(Math.abs(box!.x + box!.width / 2 - width / 2)).toBeLessThan(2)
    await expect(
      modal.getByText('Cost breakdown', { exact: true }),
    ).toBeVisible()
    await expect(
      modal.locator('.recipe-breakdown').first(),
    ).not.toHaveAttribute('open', '')
    await modal.getByText('Cost breakdown', { exact: true }).click()
    await expect(modal.locator('.recipe-breakdown').first()).toHaveAttribute(
      'open',
      '',
    )
    await modal.getByText('Cost breakdown', { exact: true }).click()
    expect(
      await modal.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1)
    await page.screenshot({
      animations: 'disabled',
      path: `/tmp/compact-recipe-top-${width}.png`,
    })
    await modal
      .locator('.recipe-detail-body')
      .evaluate((el) => (el.scrollTop = el.scrollHeight))
    const positions = await modal.evaluate((el) => ({
      body: el.querySelector('.recipe-detail-body')!.getBoundingClientRect()
        .bottom,
      footer: el.querySelector('.recipe-detail-footer')!.getBoundingClientRect()
        .top,
      scrollLock: document.body.getAttribute('data-scroll-locked'),
    }))
    expect(positions.body).toBeLessThanOrEqual(positions.footer + 1)
    expect(positions.scrollLock).toBeTruthy()
    await page.screenshot({
      animations: 'disabled',
      path: `/tmp/compact-recipe-${width}.png`,
    })
    const addProduct = modal.getByRole('button', {
      name: 'Add product',
      exact: true,
    })
    await expect(addProduct).toBeInViewport()
    await expect(
      modal.getByRole('button', { name: 'Product options' }),
    ).toHaveCount(0)
    await addProduct.focus()
    await page.keyboard.press('Enter')
    await expect(
      page.getByRole('menuitem', {
        name: 'Link existing product',
        exact: true,
      }),
    ).toBeFocused()
    await page.keyboard.press('Enter')
    await modal.getByLabel('Search products by name or SKU').fill('LINK-TEST')
    await modal.getByRole('button', { name: new RegExp(product.name) }).click()
    await expect(
      modal.getByRole('button', { name: 'Confirm link' }),
    ).toBeDisabled()
    await modal.getByLabel(/Product selling unit/).fill('loaf')
    await modal.getByLabel(/Recipe output quantity/).fill('1')
    await modal.getByLabel(/I verified this output/).check()
    await modal.getByRole('button', { name: 'Confirm link' }).click()
    await expect(
      modal.getByRole('button', {
        name: `Options for ${product.name}`,
        exact: true,
      }),
    ).toBeVisible()
    expect(linkRequests).toBe(1)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page
      .locator('.recipe-card')
      .filter({
        has: page.getByRole('heading', { name: recipe.name, exact: true }),
      })
      .click()
    await expect(
      modal.locator('.linked-product').filter({ hasText: product.name }),
    ).toBeVisible()
    await modal
      .locator('.linked-product')
      .filter({ hasText: product.name })
      .getByRole('button', { name: product.name, exact: true })
      .click()
    await expect(
      modal.getByRole('button', { name: 'Open recipe' }),
    ).toBeVisible()
    await modal.getByRole('button', { name: 'Open recipe' }).click()
    const options = modal.getByRole('button', {
      name: `Options for ${product.name}`,
      exact: true,
    })
    await options.focus()
    await page.keyboard.press('Enter')
    await expect(
      page.getByRole('menuitem', { name: 'Manage link', exact: true }),
    ).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(
      modal.getByRole('heading', { name: 'Review recipe connection' }),
    ).toBeVisible()
    await modal.getByRole('button', { name: 'Cancel', exact: true }).click()
    await options.focus()
    await page.keyboard.press('Enter')
    await page.keyboard.press('ArrowDown')
    await expect(
      page.getByRole('menuitem', { name: 'Unlink', exact: true }),
    ).toBeFocused()
    await page.keyboard.press('Enter')
    await modal.getByRole('button', { name: 'Confirm unlink' }).click()
    expect(
      workspace.products.find((p) => p.id === product.id)!.recipeId,
    ).toBeNull()
    const footer = modal.locator('.recipe-detail-footer')
    await expect(
      footer.getByRole('button', { name: 'Plan a batch' }),
    ).toBeInViewport()
    await expect(
      footer.getByRole('button', { name: 'Edit recipe' }),
    ).toBeInViewport()
    await footer.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(modal).toHaveCount(0)
    await page.goto(workspaceFixtureUrl('Pantry'))
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page
      .getByRole('button', { name: 'View details', exact: true })
      .first()
      .click()
    const ingredient = page.getByRole('dialog')
    await expect(ingredient.locator('.product-detail-layout')).toBeVisible()
    expect(
      await ingredient
        .getByRole('button', { name: 'Edit Ingredient', exact: true })
        .count(),
    ).toBe(1)
    await ingredient
      .locator('summary')
      .filter({ hasText: /^Purchasing$/ })
      .click()
    await expect(
      ingredient.getByText(/Price comparison isn’t configured/),
    ).toHaveCount(0)
    await ingredient
      .locator('summary')
      .filter({ hasText: /^Label & ingredient details$/ })
      .click()
    await expect(
      ingredient.getByRole('heading', { name: 'Identification', exact: true }),
    ).toBeVisible()
    await ingredient
      .locator('summary')
      .filter({ hasText: /^Inventory$/ })
      .click()
    await expect(
      ingredient.getByRole('button', { name: 'Receive stock', exact: true }),
    ).toBeVisible()
    expect(
      await ingredient.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1)
    await page.screenshot({
      animations: 'disabled',
      path: `/tmp/compact-ingredient-${width}.png`,
    })
  })
