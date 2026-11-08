import { test, expect } from '@playwright/test'
import { demoData } from '../src/lib/demo'
import { updateIngredient } from '../src/lib/ingredients'
import { ingredientHasStockHistory } from '../src/lib/ingredient-stock-unit'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

for (const width of [1440, 390])
  for (const hasHistory of [false, true]) {
    test(`jar stock shelf accepts weight with history ${hasHistory} at ${width}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1000 })
      await installWorkspaceFixture(page)
      const workspace = demoData()
      workspace.ingredients = [
        {
          id: 'jar',
          name: 'Synthetic jar ingredient',
          usedAs: 'ingredient',
          unit: 'ml',
          storageUnit: 'cup',
          recipeUnit: 'oz',
          quantity: 0,
          cost: 0.1,
          currentCost: 0.1,
          purchaseQuantity: 1,
          purchaseUnit: 'jar',
          packagePrice: 6.98,
          currency: 'USD',
          threshold: 0,
          reorderQuantity: 0,
          conversions: [
            {
              from: 'jar',
              to: 'cup',
              amountFrom: 1,
              amountTo: 0.375,
              verified: true,
            },
          ],
        },
      ]
      workspace.recipes = []
      workspace.products = []
      workspace.batches = []
      workspace.journals = []
      workspace.inventory_counts = []
      workspace.ledger = hasHistory
        ? [
            {
              id: 'past-count',
              name: 'Past count',
              ingredientId: 'jar',
              unit: 'ml',
              quantity: 0,
              amount: 0,
              type: 'inventory_count',
            },
          ]
        : []
      const oldLedger = structuredClone(workspace.ledger)
      const writes: unknown[] = []
      await page.route('**/api/workspace*', async (route) => {
        if (route.request().method() === 'POST') {
          const body = route.request().postDataJSON()
          writes.push(body)
          if (body.action === 'ingredientUpdate') {
            try {
              const item = workspace.ingredients[0]
              workspace.ingredients[0] = updateIngredient(item, body.data, {
                hasStockHistory: ingredientHasStockHistory(item, workspace),
              })
            } catch (error) {
              return route.fulfill({
                status: 400,
                json: { error: (error as Error).message },
              })
            }
          }
        }
        return route.fulfill({
          json: { workspace, role: 'Owner', demo: false },
        })
      })
      await page.goto(workspaceFixtureUrl('Inventory/Ingredients'))
      await page
        .getByRole('button', { name: 'View details', exact: true })
        .click()
      const editor = page.getByRole('dialog')
      await editor
        .getByRole('button', { name: 'Edit Ingredient', exact: true })
        .click()
      const shelf = editor.getByLabel('Stock shelf unit', { exact: true })
      const amount = editor.getByLabel('# of stock units in purchasing unit', {
        exact: true,
      })
      await expect(shelf.locator('option[value="oz"]')).toBeEnabled()
      await expect(amount).toHaveValue('0.375')
      await shelf.selectOption('oz')
      await expect(shelf).toHaveValue('oz')
      await expect(amount).toHaveValue('')
      await expect(
        editor.getByLabel('Purchasing package unit', { exact: true }),
      ).toHaveValue('jar')
      await expect(
        editor.getByLabel('Recipe unit', { exact: true }),
      ).toHaveValue('oz')
      await amount.fill('3') // Synthetic label-confirmed weight; never inferred from cups.
      if (hasHistory) {
        await expect(
          editor.getByText(/Existing stock\/history is recorded in mL/),
        ).toBeVisible()
        await editor
          .getByRole('button', { name: 'Save changes', exact: true })
          .click()
        await expect(editor.getByRole('alert')).toContainText(
          'Add a measured, verified conversion',
        )
        expect(writes).toHaveLength(0)
      } else {
        await editor
          .getByLabel(/I confirm the verified package contents/)
          .check()
      }
      await shelf.scrollIntoViewIfNeeded()
      if (width < 600)
        await editor.locator('.ingredient-detail-body').evaluate((body) => {
          const stockUnit = body.querySelector(
            '[aria-label="Stock shelf unit"]',
          )!
          body.scrollTop +=
            stockUnit.getBoundingClientRect().top -
            body.getBoundingClientRect().top -
            28
        })
      await page.screenshot({
        path: `docs/previews/stock-shelf-weight-${hasHistory ? 'history' : 'empty'}-${width}.png`,
        animations: 'disabled',
      })
      expect(
        await editor.evaluate((el) => el.scrollWidth - el.clientWidth),
      ).toBeLessThanOrEqual(1)
      if (hasHistory) {
        await editor
          .getByRole('button', { name: 'Review stock-unit conversion' })
          .click()
        await editor
          .getByLabel('From unit', { exact: true })
          .selectOption('cup')
        await editor.getByLabel('To unit', { exact: true }).selectOption('oz')
        await editor.getByLabel('From quantity', { exact: true }).fill('1')
        await editor.getByLabel('To quantity', { exact: true }).fill('8')
        await editor
          .getByLabel('Source / measurement notes', { exact: true })
          .fill('Synthetic measured relationship for this fixture only')
        await editor
          .getByLabel('I verified these amounts for this ingredient.')
          .check()
        await editor
          .getByRole('button', {
            name: 'Save ingredient conversion',
            exact: true,
          })
          .click()
        await editor
          .getByRole('button', { name: 'Details & Costing', exact: true })
          .click()
      }
      await editor
        .getByRole('button', { name: 'Save changes', exact: true })
        .click()
      await expect(
        editor.getByRole('button', { name: 'Edit Ingredient', exact: true }),
      ).toBeVisible()
      expect(writes).toHaveLength(1)
      expect(workspace.ingredients[0]).toMatchObject({
        storageUnit: 'oz',
        recipeUnit: 'oz',
        purchaseUnit: 'jar',
        quantity: 0,
        purchaseSetup: { stockUnits: 3 },
      })
      expect(workspace.ingredients[0].unit).toBe(hasHistory ? 'ml' : 'g')
      if (hasHistory) expect(workspace.ingredients[0].cost).toBe(0.1)
      expect(workspace.ledger).toEqual(oldLedger)
      expect(workspace.journals).toHaveLength(0)
    })
  }
