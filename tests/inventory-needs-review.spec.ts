import { test, expect } from '@playwright/test'
import { demoData } from '../src/lib/demo'
import { updateIngredient } from '../src/lib/ingredients'
import { inventoryReviewReasons } from '../src/lib/inventory-review'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

for (const width of [390, 1440]) {
  test(`inventory review saves, counts and reloads at ${width}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await installWorkspaceFixture(page)
    const workspace = demoData()
    const base = {
      name: 'Ready flour',
      id: 'ready-flour',
      usedAs: 'ingredient',
      category: 'Flour & grains',
      unit: 'g',
      storageUnit: 'g',
      recipeUnit: 'g',
      quantity: 0,
      cost: 0.01,
      currentCost: 0.01,
      purchaseQuantity: 1,
      purchaseUnit: 'kg',
      packagePrice: 10,
      threshold: 1,
      conversions: [],
      reviewed: false,
    }
    workspace.ingredients = [
      base,
      {
        ...base,
        id: 'imported-sugar',
        name: 'Imported sugar',
        category: 'Imported — needs review',
        importNeedsReview: true,
        currentCost: null,
        cost: 0,
        needsCostSetup: true,
        purchaseUnit: '',
        purchaseQuantity: null,
        packagePrice: null,
      },
      {
        ...base,
        id: 'cup-flour',
        name: 'Flour measured in cups',
        recipeUnit: 'cup',
      },
    ]
    workspace.recipes = []
    workspace.products = []
    workspace.batches = []
    workspace.ledger = []
    workspace.journals = []
    const stockBefore = workspace.ingredients.map((i) => [
      i.id,
      i.quantity,
      i.cost,
    ])
    const writes: string[] = []
    // Browser-only API fixture; persistence/validation is tested separately in PostgreSQL.
    await page.route('**/api/workspace*', async (route) => {
      if (route.request().method() === 'POST') {
        const { action, data } = route.request().postDataJSON()
        writes.push(action)
        const index = workspace.ingredients.findIndex((i) => i.id === data.id)
        if (action === 'inventoryMarkReviewed') {
          workspace.ingredients[index] = {
            ...workspace.ingredients[index],
            importNeedsReview: false,
            importReviewedAt: '2026-11-14T00:00:00Z',
          }
        } else if (action === 'ingredientUpdate') {
          workspace.ingredients[index] = updateIngredient(
            workspace.ingredients[index],
            data,
          )
        } else if (action === 'pantryView')
          workspace.settings[0].currentPantryView = data.view
      }
      await route.fulfill({ json: { workspace, role: 'Owner', demo: false } })
    })
    await page.goto(workspaceFixtureUrl('Inventory/Ingredients'))
    const inventory = page.locator('.pantry-v2')
    await inventory
      .getByRole('button', { name: 'Needs review (2)', exact: true })
      .click()
    await expect(
      inventory.getByText('Ready flour', { exact: true }),
    ).toHaveCount(0)
    await expect(inventory.getByRole('article')).toHaveCount(2)
    await inventory
      .getByRole('textbox', { name: 'Search pantry' })
      .fill('sugar')
    await expect(inventory.getByRole('article')).toHaveCount(1)
    await inventory.getByRole('button', { name: 'Table', exact: true }).click()
    await expect(inventory.locator('tbody tr')).toHaveCount(1)
    await inventory.getByRole('textbox', { name: 'Search pantry' }).fill('')
    await expect(inventory.locator('tbody tr')).toHaveCount(2)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath(`needs-review-${width}.png`),
      fullPage: true,
    })

    const sugar = inventory
      .getByRole('row')
      .filter({ hasText: 'Imported sugar' })
    await sugar
      .getByRole('button', { name: 'Review imported data', exact: true })
      .click()
    const dialog = page.getByRole('dialog')
    await dialog
      .getByRole('button', { name: 'Mark reviewed', exact: true })
      .click()
    await expect(
      dialog.getByRole('button', { name: 'Mark reviewed', exact: true }),
    ).toHaveCount(0)
    await expect(
      dialog.getByRole('button', { name: 'Add cost information', exact: true }),
    ).toBeVisible()
    await dialog
      .getByRole('button', { name: 'Add purchase details', exact: true })
      .click()
    await dialog
      .getByLabel('Purchasing package unit', { exact: true })
      .selectOption('bag')
    await dialog.getByLabel('Purchasing price', { exact: true }).fill('4.75')
    await dialog
      .getByLabel('# of stock units in purchasing unit', { exact: true })
      .fill('500')
    await dialog
      .getByRole('checkbox', { name: /I reviewed the saved basis/ })
      .check()
    await dialog
      .getByRole('button', { name: 'Save changes', exact: true })
      .click()
    await expect(
      dialog.getByRole('heading', { name: 'Imported sugar', exact: true }),
    ).toBeVisible()
    await dialog
      .getByRole('button', { name: 'Close ingredient details', exact: true })
      .click()
    await expect(
      inventory.getByRole('button', { name: 'Needs review (1)' }),
    ).toBeVisible()
    await expect(inventory.locator('tbody tr')).toHaveCount(1)
    await page.reload()
    await expect(
      inventory.getByRole('button', { name: 'Needs review (1)' }),
    ).toHaveAttribute('aria-pressed', 'true')
    await expect(inventory.locator('tbody tr')).toHaveCount(1)

    await inventory
      .getByRole('button', { name: 'Verify unit conversion', exact: true })
      .click()
    await expect(
      dialog.getByRole('heading', { name: 'Unit Conversions', exact: true }),
    ).toBeVisible()
    await dialog.getByLabel('From unit', { exact: true }).selectOption('cup')
    await dialog.getByLabel('To unit', { exact: true }).selectOption('g')
    await dialog.getByLabel('From quantity', { exact: true }).fill('1')
    await dialog.getByLabel('To quantity', { exact: true }).fill('120')
    await dialog
      .getByRole('checkbox', { name: /I verified these amounts/ })
      .check()
    await dialog
      .getByRole('button', { name: 'Save ingredient conversion', exact: true })
      .click()
    await dialog
      .getByRole('button', { name: 'Save changes', exact: true })
      .click()
    await dialog
      .getByRole('button', { name: 'Close ingredient details', exact: true })
      .click()
    await expect(
      inventory.getByRole('button', { name: 'Needs review (0)' }),
    ).toBeVisible()
    await expect(
      inventory.getByRole('heading', {
        name: 'No items need review.',
        exact: true,
      }),
    ).toBeVisible()
    await page.reload()
    await expect(
      inventory.getByRole('heading', {
        name: 'No items need review.',
        exact: true,
      }),
    ).toBeVisible()
    await inventory.getByRole('button', { name: 'Cards', exact: true }).click()
    await expect(
      inventory.getByRole('heading', {
        name: 'No items need review.',
        exact: true,
      }),
    ).toBeVisible()
    await inventory
      .getByRole('button', { name: 'All items', exact: true })
      .click()
    await expect(inventory.getByRole('article')).toHaveCount(3)
    await inventory.getByRole('button', { name: /^Low stock/ }).click()
    await expect(inventory.getByRole('article')).toHaveCount(3)
    expect(
      workspace.ingredients.map((i) => [i.id, i.quantity, i.cost]),
    ).toEqual(stockBefore)
    expect(
      workspace.ingredients.every(
        (i) => inventoryReviewReasons(i, workspace).length === 0,
      ),
    ).toBe(true)
    expect(workspace.ingredients[1].reviewed).toBe(false)
    expect(workspace.ledger).toEqual([])
    expect(workspace.journals).toEqual([])
    expect(
      writes.every((action) =>
        ['inventoryMarkReviewed', 'ingredientUpdate', 'pantryView'].includes(
          action,
        ),
      ),
    ).toBe(true)
  })
}
