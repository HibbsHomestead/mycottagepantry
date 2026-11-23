import { expect, test } from '@playwright/test'
import { demoData } from '../src/lib/demo'
import { recipeCategories } from '../src/lib/recipe-categories'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

for (const width of [1440, 390]) {
  test(`recipe types, linked components and create defaults at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await installWorkspaceFixture(page)
    const workspace = demoData()
    const categories = recipeCategories(workspace)
    const base = {
      yield: 1,
      yieldUnit: 'g',
      laborMinutes: 0,
      laborRate: 0,
      lines: [{ ingredientId: 'flour', quantity: 4, unit: 'g' }],
    }
    workspace.recipes = [
      {
        ...base,
        id: 'fixture-regular',
        name: 'Fixture Lemon Tart',
        recipeCategoryId: categories[0].id,
        lines: [
          {
            ingredientId: 'prep-fixture-filling',
            componentRecipeId: 'fixture-filling',
            quantity: 1,
            unit: 'g',
          },
        ],
      },
      {
        ...base,
        id: 'fixture-filling',
        name: 'Fixture Lemon Filling',
        recipeCategoryId: categories[0].id,
        compound: true,
        lines: [{ ingredientId: 'prep-fixture-syrup', quantity: 1, unit: 'g' }],
      },
      {
        ...base,
        id: 'fixture-syrup',
        name: 'Fixture Sugar Syrup',
        recipeCategoryId: categories[1].id,
        compound: true,
      },
      {
        ...base,
        id: 'fixture-legacy',
        name: 'Fixture Legacy Mix',
        recipeCategoryId: categories[1].id,
      },
      {
        ...base,
        id: 'fixture-design',
        name: 'Fixture Apron Design',
        workflow: 'handmade',
        compound: true,
      },
    ]
    workspace.ingredients = [
      workspace.ingredients.find((i) => i.id === 'flour')!,
      ...[
        ['fixture-filling', 'Fixture Lemon Filling'],
        ['fixture-syrup', 'Fixture Sugar Syrup'],
        ['fixture-legacy', 'Fixture Legacy Mix'],
      ].map(([id, name]) => ({
        id: `prep-${id}`,
        name,
        compoundRecipeId: id,
        usedAs: 'ingredient',
        unit: 'g',
        quantity: 0,
        cost: 0.25,
      })),
    ]
    let writes = 0
    await page.route('**/api/workspace*', (route) => {
      if (
        route.request().method() === 'POST' &&
        route.request().postDataJSON().action === 'save'
      )
        writes++
      return route.fulfill({ json: { workspace, role: 'Owner', demo: false } })
    })
    await page.goto(workspaceFixtureUrl('Recipes'))
    const filters = page.getByRole('group', { name: 'Recipe type filter' })
    const cards = page.locator('.recipe-card')
    const search = page.getByRole('textbox', { name: 'Search recipes' })
    await search.fill('Fixture')
    await expect(cards).toHaveCount(4)
    await expect(
      page.getByText('Fixture Apron Design', { exact: true }),
    ).toHaveCount(0)
    await expect(page.locator('.recipe-type-review summary')).toHaveText(
      '1 recipe type needs review',
    )
    await page.locator('.recipe-type-review summary').click()
    await expect(page.locator('.recipe-type-review')).toContainText(
      'Fixture Legacy Mix',
    )
    await filters.getByRole('button', { name: 'Recipes', exact: true }).click()
    await expect(cards).toHaveCount(2)
    await expect(cards.first().locator('.recipe-type-badge')).toHaveText(
      'Recipe',
    )
    await filters.getByRole('button', { name: 'Compound & Prep' }).click()
    await expect(cards).toHaveCount(2)
    await page
      .getByLabel('Filter by recipe category')
      .selectOption(categories[0].id)
    await search.fill('Lemon')
    await expect(cards).toHaveCount(1)
    await expect(cards.first()).toContainText('Used in 1 recipe')
    await search.fill('Nothing matches')
    await expect(
      page.getByText('No compound or prep recipes match these filters.'),
    ).toBeVisible()
    await search.fill('Lemon')
    await page
      .getByRole('group', { name: 'Recipes display' })
      .getByRole('button', { name: 'Table' })
      .click()
    const table = page.getByRole('region', { name: 'Recipes table' })
    await expect(
      table.getByRole('columnheader', { name: 'Type' }),
    ).toBeVisible()
    await expect(table.locator('tbody')).toContainText('Compound / Prep')
    await table
      .getByRole('button', { name: 'Fixture Lemon Filling', exact: true })
      .click()
    const details = page.getByRole('dialog')
    await expect(details.getByText('Prepared stock on hand:')).toBeVisible()
    await expect(
      details.getByRole('heading', { name: 'Used in (1)' }),
    ).toBeVisible()
    await expect(
      details.getByRole('button', { name: 'Fixture Lemon Tart' }),
    ).toBeVisible()
    await page
      .getByRole('dialog')
      .locator('[data-slot=dialog-close]')
      .click()
    await page
      .getByRole('button', { name: 'Create compound/prep recipe' })
      .click()
    await expect(
      page.getByRole('checkbox', { name: 'Recipe type: Compound prep' }),
    ).toBeChecked()
    await expect(
      page.getByRole('combobox', { name: 'Yield unit' }),
    ).toHaveValue('each')
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Cancel', exact: true })
      .click()
    await page
      .getByRole('button', { name: 'Create recipe', exact: true })
      .click()
    await expect(
      page.getByRole('checkbox', { name: 'Recipe type: Compound prep' }),
    ).not.toBeChecked()
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Cancel', exact: true })
      .click()
    await table
      .getByRole('button', { name: 'Edit Fixture Lemon Filling' })
      .click()
    await expect(
      page.getByRole('checkbox', { name: 'Recipe type: Compound prep' }),
    ).toBeDisabled()
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Cancel', exact: true })
      .click()
    await table
      .getByRole('button', { name: 'Copy Fixture Lemon Filling' })
      .click()
    await expect(
      page.getByRole('checkbox', { name: 'Recipe type: Compound prep' }),
    ).toBeChecked()
    await expect(
      page.getByRole('checkbox', { name: 'Recipe type: Compound prep' }),
    ).toBeEnabled()
    await expect(
      page.getByRole('combobox', { name: 'Yield unit' }),
    ).toHaveValue('g')
    expect(writes).toBe(0)
  })
}
