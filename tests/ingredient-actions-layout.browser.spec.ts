import { test, expect } from '@playwright/test'
import { demoData } from '../src/lib/demo'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'
for (const width of [1440, 820, 390])
  test(`ingredient shared actions ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await installWorkspaceFixture(page)
    const workspace = demoData()
    workspace.ingredients = [
      {
        ...workspace.ingredients[0],
        id: 'isolated-ingredient',
        name: 'Disposable ingredient with a long descriptive name',
        quantity: 0,
      },
    ]
    workspace.settings[0].currentPantryView = 'cards'
    await page.route('**/api/workspace*', (route) =>
      route.fulfill({ json: { workspace, role: 'Owner', demo: false } }),
    )
    await page.goto(workspaceFixtureUrl('Inventory/Ingredients'))
    const name = workspace.ingredients[0].name
    const actions = page.locator('.pantry-card .item-record-actions')
    await expect(actions.getByRole('button')).toHaveCount(3)
    await expect(
      actions.getByRole('button', { name: `Delete ${name}`, exact: true }),
    ).toHaveCSS('background-color', 'rgb(255, 248, 247)')
    await page.screenshot({
      path: `docs/reviews/recipe-actions/ingredient-cards-${width}.png`,
      fullPage: true,
    })
    await actions
      .getByRole('button', { name: `View details for ${name}`, exact: true })
      .click()
    const footer = page.getByRole('dialog').locator('.ingredient-detail-footer')
    await expect(footer.getByRole('button').first()).toHaveAccessibleName(
      `Delete ${name}`,
    )
    await expect(
      footer.getByRole('button', { name: 'Close', exact: true }),
    ).toBeVisible()
    await page.screenshot({
      path: `docs/reviews/recipe-actions/ingredient-detail-${width}.png`,
    })
    await footer.getByRole('button', { name: 'Close', exact: true }).click()
    await page.getByRole('button', { name: 'Table', exact: true }).click()
    await expect(
      page
        .locator('td .item-record-actions')
        .getByRole('button', { name: `Delete ${name}`, exact: true }),
    ).toBeVisible()
    await page.screenshot({
      path: `docs/reviews/recipe-actions/ingredient-table-${width}.png`,
      fullPage: true,
    })
  })
