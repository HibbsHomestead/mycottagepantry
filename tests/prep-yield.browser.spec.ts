import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { breadBaseFixture } from '../src/test/fixtures/bread-base'
import { componentStock } from '../src/lib/recipe-components'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'
for (const width of [1440, 390])
  test(`compound yield preserves ounces through save and reopen ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 })
    await installWorkspaceFixture(page)
    const workspace = breadBaseFixture()
    const recipe = {
      id: 'disposable-yield-prep',
      name: 'Disposable finishing topping',
      yield: 8,
      yieldUnit: 'oz',
      compound: false,
      lines: [{ ingredientId: 'flour', quantity: 80, unit: 'g' }],
    }
    workspace.recipes = [recipe]
    await page.route('**/api/workspace*', (route) => {
      if (route.request().url().includes('recipeCategories'))
        return route.fulfill({ json: { categories: [], revision: 1 } })
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON()
        if (body.action === 'save' && body.table === 'recipes') {
          Object.assign(recipe, body.data)
          const output = componentStock(recipe, workspace.ingredients)
          workspace.ingredients = [
            ...workspace.ingredients.filter((i) => i.id !== output.id),
            output,
          ]
        }
      }
      return route.fulfill({ json: { workspace, role: 'Owner', demo: false } })
    })
    async function edit() {
      await page
        .getByRole('button')
        .filter({
          has: page.getByRole('heading', { name: recipe.name, exact: true }),
        })
        .click()
      await page
        .getByRole('button', { name: 'Edit Recipe', exact: true })
        .click()
    }
    await page.goto(workspaceFixtureUrl('Recipes'))
    await edit()
    const dialog = page.getByRole('dialog')
    const checkbox = dialog.getByRole('checkbox', {
      name: 'Compound prep — make this recipe available as an ingredient',
    })
    await checkbox.check()
    const unit = dialog.getByRole('combobox', {
      name: 'Yield unit',
      exact: true,
    })
    await expect(unit).toHaveValue('oz')
    await unit.selectOption('cup')
    await checkbox.uncheck()
    await expect(
      dialog.getByRole('textbox', { name: 'Yield unit' }),
    ).toHaveValue('cup')
    await checkbox.check()
    await unit.selectOption('oz')
    await expect(
      dialog.getByRole('spinbutton', { name: 'Batch yield' }),
    ).toHaveValue('8')
    await checkbox.scrollIntoViewIfNeeded()
    const checkboxRect = await checkbox.boundingBox()
    const yieldRect = await dialog
      .getByRole('spinbutton', { name: 'Batch yield' })
      .boundingBox()
    expect(Math.abs(checkboxRect!.y - yieldRect!.y)).toBeLessThan(180)
    expect(
      await dialog.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1)
    await mkdir('docs/reviews/prep-yield', { recursive: true })
    await page.screenshot({
      path: `docs/reviews/prep-yield/yield-${width}.png`,
      fullPage: true,
    })
    await dialog.getByRole('button', { name: /^Save/ }).click()
    await expect(dialog).toHaveCount(0)
    await page.reload()
    await edit()
    await expect(
      page.getByRole('spinbutton', { name: 'Batch yield' }),
    ).toHaveValue('8')
    await expect(
      page.getByRole('combobox', { name: 'Yield unit', exact: true }),
    ).toHaveValue('oz')
    expect(
      workspace.ingredients.filter((i) => i.compoundRecipeId === recipe.id),
    ).toHaveLength(1)
  })
