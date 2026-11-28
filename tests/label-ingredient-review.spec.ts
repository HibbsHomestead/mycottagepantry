import { expect, test } from '@playwright/test'
import {
  confirmFixtureAllergens,
  labelIngredientReviewFixture,
} from '../src/test/fixtures/label-ingredient-review'
import { mixedPackFixture } from '../src/test/fixtures/mixed-pack'
import { majorAllergens } from '../src/lib/label-ingredient-review'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

for (const width of [1440, 390]) {
  test(`compares both statements and explicitly reviews allergens at ${width}px`, async ({
    page,
  }, testInfo) => {
    const { workspace: oven } = mixedPackFixture()
    const { workspace, product } = labelIngredientReviewFixture()
    workspace.ingredients.find((item) => item.id === 'oil')!.name =
      'Highly refined peanut oil'
    Object.assign(product, {
      price: 5,
      quantity: 0,
      packagingLines: [],
      unitsPerPackage: 1,
      contentUnit: 'muffin',
    })
    oven.products = workspace.products
    oven.recipes = workspace.recipes
    oven.ingredients.push(...workspace.ingredients)
    await page.setViewportSize({ width, height: 1000 })
    await installWorkspaceFixture(page)
    await page.route('**/api/workspace*', async (route) => {
      if (route.request().method() === 'POST') {
        const { action, data } = route.request().postDataJSON()
        if (action === 'save') {
          expect(data.labelIngredientMode).toBe('merged')
          product.labelIngredientMode = data.labelIngredientMode
        } else {
          expect(action).toBe('productAllergenReview')
          expect(data.decisions.Wheat.status).toBe('present')
          expect(data.decisions.Eggs.status).toBe('present')
          expect(data.decisions.Peanuts).toEqual({
            status: 'absent',
            reason: 'Verified supplier clarification (fixture only)',
          })
          product.allergenReview = {
            source: data.source,
            decisions: data.decisions,
            advisory: data.advisory,
            reviewedAt: '2026-11-27T01:00:00.000Z',
          }
        }
      }
      await route.fulfill({
        json: { workspace: oven, role: 'Owner', demo: false },
      })
    })
    await page.goto(workspaceFixtureUrl('Products/Food'))
    const card = page.getByRole('article', { name: product.name, exact: true })
    await card.getByRole('button', { name: product.name, exact: true }).click()
    let dialog = page.getByRole('dialog', { name: product.name, exact: true })
    await dialog
      .getByRole('button', { name: 'Edit Product', exact: true })
      .click()
    dialog = page.getByRole('dialog')
    await dialog.getByRole('tab', { name: 'Ingredients & allergens' }).click()
    await dialog
      .getByLabel('Product’s label ingredient mode')
      .selectOption('merged')
    const comparison = dialog.locator('.label-review-comparison')
    await expect(comparison).toContainText(
      'Muffin mix (Wheat flour, cane sugar, leavening (baking soda, cornstarch), soy lecithin (soy))',
    )
    await expect(comparison).toContainText(
      'Contains less than 2% of: baking soda, cornstarch, soy lecithin (soy), Natural flavor',
    )
    expect(
      await comparison.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true)
    await comparison.screenshot({
      path: testInfo.outputPath(`ingredient-modes-${width}.png`),
    })
    await dialog
      .getByRole('button', { name: 'Save Changes', exact: true })
      .click()
    await expect(dialog).not.toBeVisible()
    await card.getByRole('button', { name: product.name, exact: true }).click()
    dialog = page.getByRole('dialog', { name: product.name, exact: true })
    await expect(
      dialog
        .getByText(
          'Ingredients: Wheat flour, cane sugar, Eggs, Highly refined peanut oil. Contains less than 2% of: baking soda, cornstarch, soy lecithin (soy), Natural flavor',
          { exact: true },
        )
        .first(),
    ).toBeVisible()
    await dialog
      .getByText('Major allergen review · Not confirmed', { exact: true })
      .click()
    const review = dialog.locator('details.label-review-section')
    await expect(review).toContainText('Muffin mix → soy lecithin (soy)')
    await expect(review).toContainText(
      'needs review · Blueberry muffins → Blueberry muffin recipe → Natural flavor',
    )
    await review.getByRole('list', { name: 'Ingredient evidence' }).screenshot({
      path: testInfo.outputPath(`allergen-evidence-${width}.png`),
    })
    for (const allergen of majorAllergens)
      await review
        .getByRole('group', { name: allergen, exact: true })
        .getByRole('combobox')
        .selectOption(
          ['Wheat', 'Eggs', 'Soybeans'].includes(allergen)
            ? 'present'
            : 'absent',
        )
    await review
      .getByLabel('Reason for dismissal')
      .fill('Verified supplier clarification (fixture only)')
    await review.getByRole('button', { name: 'Save allergen review' }).click()
    await expect(
      dialog.getByText('CONTAINS: WHEAT, SOYBEANS, EGGS', { exact: true }),
    ).toBeVisible()
    await expect(
      dialog.getByText('Major allergen review · Confirmed', { exact: true }),
    ).toBeVisible()
  })
}

test('renders different statement modes and confirmed allergens on one six-pack label', async ({
  page,
}, testInfo) => {
  const { workspace, pack, outputs, ingredients } = mixedPackFixture()
  outputs[0].labelIngredientMode = 'merged'
  ingredients[1].subingredients = 'blueberries, cane sugar'
  ingredients[1].labelComponentWeights = {
    text: ingredients[1].subingredients,
    shares: { '1': '90', '2': '10' },
  }
  confirmFixtureAllergens(workspace, outputs[0], ['Wheat'])
  confirmFixtureAllergens(workspace, outputs[1], ['Wheat', 'Milk'])
  await page.setViewportSize({ width: 1440, height: 1000 })
  await installWorkspaceFixture(page)
  await page.route('**/api/workspace*', async (route) => {
    expect(route.request().method()).toBe('GET')
    await route.fulfill({ json: { workspace, role: 'Owner', demo: false } })
  })
  await page.goto(workspaceFixtureUrl('Products/Food'))
  await page
    .getByRole('article', { name: pack.name, exact: true })
    .getByRole('button', { name: pack.name, exact: true })
    .click()
  const dialog = page.getByRole('dialog', { name: pack.name, exact: true })
  const blueberry = 'Ingredients: Muffin flour, blueberries, cane sugar'
  const cranberry = 'Ingredients: Muffin flour, cranberry fruit'
  await expect(dialog.getByText(blueberry, { exact: true })).toBeVisible()
  await expect(dialog.getByText(cranberry, { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Open Label Studio' }).click()
  await page.getByRole('button', { name: 'Build actual-size preview' }).click()
  const preview = page
    .frameLocator('iframe[title="Actual-size assortment label"]')
    .locator('article')
  await expect(preview.getByText(blueberry, { exact: true })).toBeVisible()
  await expect(preview.getByText(cranberry, { exact: true })).toBeVisible()
  await expect(
    preview.getByText('CONTAINS: WHEAT, MILK', { exact: true }),
  ).toBeVisible()
  await preview.screenshot({
    path: testInfo.outputPath('mixed-pack-label-review.png'),
  })
})
