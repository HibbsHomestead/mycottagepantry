import { test, expect } from '@playwright/test'
import { breadBaseFixture } from '../src/test/fixtures/bread-base'
import { rollup } from '../src/lib/demo'
import { costBreakdown } from '../src/lib/domain'
import { validateRecipeComponents } from '../src/lib/recipe-components'
import { resolveLabelData } from '../src/lib/label-studio'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

for (const width of [1440, 390]) {
  test(`bread base and inclusions remain separate in the existing recipe popup at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 })
    await installWorkspaceFixture(page)
    const workspace = breadBaseFixture()
    const variation = workspace.recipes[1]
    delete variation.baseRecipeId
    delete variation.baseRecipe
    const sourceBefore = structuredClone(workspace.recipes[0])
    const writes: any[] = []
    await page.route('**/api/workspace*', (route) => {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON()
        writes.push(body)
        if (body.action === 'save' && body.table === 'recipes') {
          validateRecipeComponents(body.data, workspace)
          Object.assign(variation, body.data)
          rollup(workspace)
        }
      }
      return route.fulfill({
        json: { workspace, role: 'Owner', demo: false },
      })
    })
    await page.goto(workspaceFixtureUrl('Recipes'))
    await page
      .getByRole('button')
      .filter({
        has: page.getByRole('heading', {
          name: 'Spinach Parmesan',
          exact: true,
        }),
      })
      .click()
    await page.getByRole('button', { name: 'Edit Recipe', exact: true }).click()
    const editor = page.getByRole('dialog')
    await editor
      .getByRole('combobox', { name: 'Base recipe', exact: true })
      .selectOption('bread')
    await editor.getByLabel('Base quantity (batches)', { exact: true }).fill('')
    await expect(
      editor.getByRole('alert').filter({ hasText: 'Base batch multiplier' }),
    ).toBeVisible()
    await editor
      .getByLabel('Base quantity (batches)', { exact: true })
      .fill('0.5')
    await expect(
      editor.getByRole('heading', { name: '1 · Inclusions', exact: true }),
    ).toBeVisible()
    const quantities = editor.getByRole('textbox', {
      name: 'Ingredient quantity',
      exact: true,
    })
    await expect(quantities.nth(0)).toHaveValue('80')
    await expect(quantities.nth(1)).toHaveValue('50')
    await expect(
      editor.getByRole('link', { name: 'Open base recipe' }),
    ).toHaveAttribute('href', /recipe=bread/)
    await editor
      .locator('summary')
      .filter({ hasText: 'Base ingredients and quantities' })
      .click()
    await expect(
      editor.getByText('Bread flour: 500 g', { exact: true }),
    ).toBeVisible()
    await expect(editor.getByLabel('Yield unit', { exact: true })).toHaveValue(
      'loaves',
    )
    await expect(editor.getByLabel('Batch yield', { exact: true })).toHaveValue(
      '3',
    )
    await editor
      .getByRole('combobox', { name: 'Base recipe', exact: true })
      .scrollIntoViewIfNeeded()
    await page.screenshot({
      animations: 'disabled',
      path: `docs/previews/bread-base-link-${width}.png`,
    })
    await quantities.nth(0).scrollIntoViewIfNeeded()
    await page.screenshot({
      animations: 'disabled',
      path: `docs/previews/bread-base-inclusions-${width}.png`,
    })
    expect(writes).toHaveLength(0)
    expect(workspace.ledger).toHaveLength(0)
    expect(
      await editor.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1)
    await editor.getByRole('button', { name: /^Save/ }).click()
    await expect(editor).toHaveCount(0)
    expect(writes).toHaveLength(1)
    expect(variation).toMatchObject({
      baseRecipeId: 'bread',
      baseMultiplier: 0.5,
      yield: 3,
      yieldUnit: 'loaves',
    })
    expect(workspace.recipes[0]).toEqual(sourceBefore)
    expect(workspace.ledger).toHaveLength(0)
    expect(costBreakdown(variation, workspace.ingredients).total).toBeCloseTo(
      7.97,
    )
    const label = resolveLabelData(workspace, {
      kind: 'product',
      id: 'spinach-loaf',
    })
    expect(label.allergens).toEqual(expect.arrayContaining(['Wheat', 'Milk']))
    expect(label.ingredientParts).toHaveLength(6)
  })
}
