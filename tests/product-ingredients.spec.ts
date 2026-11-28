import { expect, test, type Page } from '@playwright/test'
import { productIngredientsFixture } from '../src/test/fixtures/product-ingredients'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

test.use({ viewport: { width: 1440, height: 900 }, actionTimeout: 10_000 })

async function setup(page: Page) {
  const fixture = productIngredientsFixture()
  await installWorkspaceFixture(page)
  await page.route('**/api/workspace*', async (route) => {
    expect(route.request().method()).toBe('GET')
    await route.fulfill({
      json: { workspace: fixture.workspace, role: 'Owner', demo: false },
    })
  })
  return fixture
}

async function openProduct(page: Page, name: string) {
  const card = page.getByRole('article', { name, exact: true })
  await expect(card).toBeVisible({ timeout: 15_000 })
  await card.getByRole('button', { name, exact: true }).click()
  const dialog = page.getByRole('dialog', { name, exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}

for (const width of [1440, 390]) {
  test(`reads the six-pack declarations and checks Label Studio on ${width}px`, async ({
    page,
    context,
  }, testInfo) => {
    const { pack } = await setup(page)
    await page.setViewportSize({ width, height: width === 1440 ? 1050 : 900 })
    await page.goto(workspaceFixtureUrl('Products/Food'))
    const dialog = await openProduct(page, pack.name)
    const section = dialog.getByRole('region', {
      name: 'Ingredients & allergens',
    })
    const blueberry =
      'Ingredients: Muffin flour, blueberry fruit (blueberries, cane sugar)'
    const cranberry = 'Ingredients: Muffin flour, cranberry fruit'
    await expect(section.getByText(blueberry, { exact: true })).toBeVisible()
    await expect(section.getByText(cranberry, { exact: true })).toBeVisible()
    await expect(
      section.getByText('×3 · muffin', { exact: false }),
    ).toHaveCount(2)
    await expect(section.getByText('CONTAINS: WHEAT, MILK')).toBeVisible()
    const fits = await section.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    )
    expect(fits).toBe(true)
    if (width === 1440) {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
      await section
        .getByRole('button', { name: 'Copy ingredient statement' })
        .first()
        .click()
      await expect(
        section.getByText('Ingredient statement copied.'),
      ).toBeVisible()
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
        blueberry,
      )
    }
    if (width === 390)
      await section
        .locator('summary')
        .filter({ hasText: 'Cranberry muffins' })
        .click()
    await section.evaluate((element) => {
      const dialog = element.closest('[role="dialog"]')!
      dialog.scrollTop +=
        element.getBoundingClientRect().top -
        dialog.getBoundingClientRect().top -
        (dialog.querySelector('[data-slot="dialog-header"]')?.clientHeight ??
          0) -
        20
    })
    await dialog.screenshot({
      path: testInfo.outputPath(`product-ingredients-${width}.png`),
      animations: 'disabled',
    })
    if (width === 390) {
      await section
        .locator('summary')
        .filter({ hasText: 'Blueberry muffins' })
        .click()
      await section
        .locator('summary')
        .filter({ hasText: 'Cranberry muffins' })
        .click()
      await dialog.screenshot({
        path: testInfo.outputPath('product-ingredients-390-cranberry.png'),
        animations: 'disabled',
      })
    }
    await section.getByRole('button', { name: 'Open Label Studio' }).click()
    await page
      .getByRole('button', { name: 'Build actual-size preview' })
      .click()
    const preview = page.frameLocator(
      'iframe[title="Actual-size assortment label"]',
    )
    await expect(preview.getByText(blueberry, { exact: true })).toBeVisible()
    await expect(preview.getByText(cranberry, { exact: true })).toBeVisible()
    await expect(preview.getByText('CONTAINS: WHEAT, MILK')).toBeVisible()
    if (width === 1440)
      await preview
        .locator('article')
        .screenshot({
          path: testInfo.outputPath('label-studio-ingredients.png'),
        })
  })
}

test('shows missing data, the food editor draft, and a separately reviewable manufacturer source', async ({
  page,
}) => {
  const { wrapped, missing, tea, ingredients } = await setup(page)
  ingredients[1].subingredients = ''
  ingredients[1].reviewed = false
  await page.goto(workspaceFixtureUrl('Products/Food'))
  const single = await openProduct(page, wrapped.name)
  const source = single.getByRole('region', {
    name: 'Ingredients & allergens',
  })
  await expect(
    source.getByText('Subingredients missing for blueberry fruit.'),
  ).toBeVisible()
  await expect(
    source.getByText('Allergen information not confirmed.'),
  ).toBeVisible()
  await source.getByText('Recipe breakdown · internal quantities').click()
  await expect(
    source.getByText('Blueberry prep — 60 g', { exact: false }),
  ).toBeVisible()
  await single
    .getByRole('button', { name: 'Edit Product', exact: true })
    .click()
  await page.getByRole('tab', { name: 'Ingredients & allergens' }).click()
  await expect(page.getByText(/Draft product sources/)).toBeVisible()
  await page.keyboard.press('Escape')
  const unlinked = await openProduct(page, missing.name)
  await expect(
    unlinked.getByText('No recipe linked.', { exact: true }),
  ).toBeVisible()
  await page.goto(workspaceFixtureUrl('Products/Resale'))
  const resale = await openProduct(page, tea.name)
  await expect(
    resale.getByText('Ingredients: black tea, milk powder'),
  ).toBeVisible()
  await resale
    .getByRole('button', { name: 'Review manufacturer source' })
    .click()
  const editor = page.getByRole('dialog', {
    name: 'Edit Product',
    exact: true,
  })
  const review = editor.getByRole('checkbox', {
    name: /reviewed the manufacturer/,
  })
  await expect(review).toBeChecked()
  await editor
    .getByRole('textbox', { name: 'Manufacturer contains statement' })
    .fill('Milk, soy')
  await expect(review).not.toBeChecked()
  await expect(
    editor.getByText('Allergen information not confirmed.'),
  ).toBeVisible()
})

test('summarizes collapsed basket issues and identifies non-food and nested contents', async ({
  page,
}) => {
  const { basket, foodBasket, nested, tea } = await setup(page)
  tea.supplierLabelSource.reviewed = false
  await page.goto(workspaceFixtureUrl('Products/Baskets'))
  const mixed = await openProduct(page, basket.name)
  const source = mixed.getByRole('region', { name: 'Ingredients & allergens' })
  await expect(source.getByText(/1 entry needs source review/)).toBeVisible()
  await source.locator('summary').filter({ hasText: 'Tea towel' }).click()
  await expect(source.getByText(/food declarations do not apply/)).toBeVisible()
  await mixed.getByRole('button', { name: 'Close', exact: true }).last().click()
  const food = await openProduct(page, foodBasket.name)
  const foodSource = food.getByRole('region', {
    name: 'Ingredients & allergens',
  })
  await expect(
    foodSource.getByText(/Ingredients:.*blueberry fruit/),
  ).toBeVisible()
  await expect(
    foodSource.getByText(/Ingredients: Chocolate blend/),
  ).toBeVisible()
  await food.getByRole('button', { name: 'Close', exact: true }).last().click()
  const outer = await openProduct(page, nested.name)
  const outerSource = outer.getByRole('region', {
    name: 'Ingredients & allergens',
  })
  await expect(
    outerSource.getByText('×3 · muffin', { exact: false }),
  ).toHaveCount(2)
})
