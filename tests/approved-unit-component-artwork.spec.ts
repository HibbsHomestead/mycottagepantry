import { test, expect } from '@playwright/test'
import { demoData } from '../src/lib/demo'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'
for (const width of [1440, 390]) {
  test(`five ingredient fields and dedicated conversions at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 })
    await installWorkspaceFixture(page)
    const workspace = demoData(),
      ingredient = workspace.ingredients.find((i) => i.id === 'sugar')!
    Object.assign(ingredient, {
      name: 'Spiced Orange Finishing Sugar',
      purchaseQuantity: 1,
      purchaseUnit: 'bottle',
      packagePrice: 5.99,
      storageUnit: 'oz',
      recipeUnit: 'oz',
      conversions: [
        {
          from: 'bottle',
          to: 'oz',
          amountFrom: 1,
          amountTo: 3.7,
          verified: true,
        },
      ],
    })
    await page.route('**/api/workspace*', (r) =>
      r.fulfill({ json: { workspace, role: 'Owner', demo: false } }),
    )
    await page.goto(workspaceFixtureUrl('Inventory/Ingredients'))
    await page
      .getByRole('textbox', { name: 'Search pantry' })
      .fill(ingredient.name)
    await page
      .getByRole('button', { name: 'View details', exact: true })
      .click()
    await page
      .getByRole('button', { name: 'Edit Ingredient', exact: true })
      .click()
    const dialog = page.getByRole('dialog')
    await expect(
      dialog.getByLabel('Purchasing package unit', { exact: true }),
    ).toHaveValue('bottle')
    await expect(
      dialog.getByLabel('Purchasing price', { exact: true }),
    ).toHaveValue('5.99')
    await expect(
      dialog.getByLabel('Stock shelf unit', { exact: true }),
    ).toHaveValue('oz')
    await expect(
      dialog.getByLabel('# of stock units in purchasing unit', { exact: true }),
    ).toHaveValue('3.7')
    await expect(dialog.getByLabel('Recipe unit', { exact: true })).toHaveValue(
      'oz',
    )
    await expect(dialog.locator('.purchase-unit-summary')).toContainText(
      '$1.62 per oz',
    )
    await expect(
      dialog.getByLabel('Purchase package quantity', { exact: true }),
    ).toHaveCount(0)
    await dialog
      .getByLabel('Purchasing price', { exact: true })
      .scrollIntoViewIfNeeded()
    await page.screenshot({
      animations: 'disabled',
      path: `docs/previews/ingredient-five-fields-${width}.png`,
    })
    await dialog.getByLabel('Recipe unit', { exact: true }).selectOption('cup')
    await dialog
      .getByRole('button', { name: 'Open Unit Conversions', exact: true })
      .click()
    await expect(
      dialog.getByLabel('Purchasing price', { exact: true }),
    ).toBeHidden()
    await expect(
      dialog.getByText('1 bottle = 3.7 oz (weight)', { exact: false }).first(),
    ).toBeVisible()
    await expect(dialog.getByLabel('From unit', { exact: true })).toBeVisible()
    await page.screenshot({
      animations: 'disabled',
      path: `docs/previews/ingredient-unit-conversions-${width}.png`,
    })
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true)
  })
  test(`linked prepared recipe component at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    await installWorkspaceFixture(page)
    const workspace = demoData()
    workspace.recipes.push({
      id: 'frosting-review',
      name: 'Prepared frosting',
      yield: 100,
      yieldUnit: 'g',
      lines: [{ ingredientId: 'sugar', quantity: 100, unit: 'g' }],
      laborMinutes: 0,
      laborRate: 0,
      overhead: 0,
    })
    await page.route('**/api/workspace*', (r) =>
      r.fulfill({ json: { workspace, role: 'Owner', demo: false } }),
    )
    await page.goto(workspaceFixtureUrl('Recipes'))
    await page
      .getByRole('button', { name: 'Create recipe', exact: true })
      .first()
      .click()
    await page
      .getByRole('button', { name: 'Add recipe component', exact: true })
      .click()
    await page
      .getByRole('dialog', { name: 'Add recipe component', exact: true })
      .getByLabel('Search recipes', { exact: true })
      .fill('Prepared frosting')
    await page.getByRole('button', { name: /Prepared frosting/ }).click()
    const row = page.locator('.recipe-line-editor').last()
    await expect(row).toContainText('Finished yield: 100 g')
    await expect(row).toContainText('Use prepared stock')
    await row.getByLabel('Ingredient quantity').fill('25')
    await expect(row.locator('.recipe-line-cost')).not.toContainText(
      'Cost unavailable',
    )
    await expect(
      row.getByRole('link', { name: 'Open recipe', exact: true }),
    ).toHaveAttribute('target', '_blank')
    await expect(
      row.getByRole('link', { name: 'Open recipe', exact: true }),
    ).toHaveAttribute('href', '/oven?recipe=frosting-review#Recipes')
    await row.scrollIntoViewIfNeeded()
    await page.screenshot({
      animations: 'disabled',
      path: `docs/previews/recipe-prepared-component-${width}.png`,
    })
    expect(
      await page
        .getByRole('dialog')
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true)
    // Verify the URL target initializes the source editor in a fresh rendered workspace.
    page.on('dialog', (message) => message.accept())
    const target = new URL(workspaceFixtureUrl('Recipes'))
    target.searchParams.set('recipe', 'frosting-review')
    await page.goto(target.toString())
    await expect(
      page.getByRole('heading', { name: 'Edit Recipe', exact: true }),
    ).toBeVisible()
    await expect(page.getByLabel('Recipe name', { exact: true })).toHaveValue(
      'Prepared frosting',
    )
  })
  test(`production artwork picker and print-size labels at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 })
    await page.route('**/artwork-library-fixture', (r) =>
      r.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><script type="module">import RefreshRuntime from "/@react-refresh";RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>(type)=>type;window.__vite_plugin_react_preamble_installed__=true;import("/src/test/capture-artwork-library.tsx").then(m=>m.mountArtworkLibrary())</script></body></html>',
      }),
    )
    await page.goto('/artwork-library-fixture')
    await page
      .getByRole('button', { name: 'Choose artwork', exact: true })
      .click()
    const picker = page.getByRole('dialog')
    await expect(picker.locator('.artwork-picker-grid button')).toHaveCount(15)
    await page.screenshot({
      animations: 'disabled',
      path: `docs/previews/artwork-library-picker-${width}.png`,
    })
    await picker.getByRole('searchbox').fill('biscoff')
    await expect(
      picker.getByRole('button', {
        name: 'Spiced biscuit / cookie butter',
        exact: true,
      }),
    ).toBeVisible()
    await picker.getByRole('searchbox').fill('spiced orange')
    await picker
      .getByRole('button', { name: 'Spiced orange', exact: true })
      .click()
    await expect(
      page.locator('.sample-label').first().locator('image'),
    ).toHaveAttribute('href', '/artwork/spiced-orange.svg')
    await page.evaluate(async () => {
      await document.fonts.ready
      await Promise.all([...document.images].map((i) => i.decode()))
    })
    await page.screenshot({
      animations: 'disabled',
      path: `docs/previews/artwork-library-labels-${width}.png`,
      fullPage: true,
    })
    const label = await page.locator('.sample-label').first().boundingBox()
    expect(label!.width).toBe(288)
    expect(label!.height).toBe(192)
    if (width === 1440)
      await page.pdf({
        path: 'docs/previews/artwork-library-print-size.pdf',
        format: 'Letter',
        printBackground: true,
      })
    await page
      .getByRole('button', { name: 'Remove artwork', exact: true })
      .click()
    await expect(
      page.locator('.sample-label').first().locator('image'),
    ).toHaveCount(0)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
  })
}
