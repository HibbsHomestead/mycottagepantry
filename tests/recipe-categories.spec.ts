import { test, expect } from '@playwright/test'
import { demoData } from '../src/lib/demo'
import {
  recipeCategories,
  assignRecipeCategory,
} from '../src/lib/recipe-categories'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

for (const width of [390, 768, 1440]) {
  test(`recipe categories retain photos, update icons, rename, archive and reload (${width})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await installWorkspaceFixture(page)
    const workspace = demoData(),
      settings = workspace.settings[0]
    const bread = workspace.recipes[0],
      cookies = workspace.recipes.find((r) => r.category === 'Cookies')!
    const before = structuredClone(cookies)
    bread.imageAssetId = 'bread-photo'
    workspace.graphic_assets = [
      {
        id: 'bread-photo',
        name: 'Bread photo',
        fileUrl: '/recipe-fixture-photo.svg',
      },
    ]
    await page.route('**/recipe-fixture-photo.svg', (route) =>
      route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#bb9462"/></svg>',
      }),
    )
    let writes = 0
    await page.route('**/api/workspace*', async (route) => {
      const req = route.request()
      if (req.url().includes('recipeCategories')) {
        let categories = recipeCategories(workspace)
        if (req.method() === 'POST') {
          const body = req.postDataJSON()
          if (body.operation === 'saveCategory') {
            const old = categories.find((c) => c.id === body.category.id)
            const next = {
              ...old,
              ...body.category,
              id: old?.id || 'custom-market',
              active: old?.active ?? true,
              previousNames: old ? [...old.previousNames, old.name] : [],
            }
            categories = old
              ? categories.map((c) => (c.id === old.id ? next : c))
              : [...categories, next]
          } else
            categories = categories.map((c) =>
              c.id === body.categoryId ? { ...c, active: body.active } : c,
            )
          settings.recipeCategories = categories
          settings.recipeCategoryRevision =
            (settings.recipeCategoryRevision || 0) + 1
        }
        return route.fulfill({
          json: { categories, revision: settings.recipeCategoryRevision || 0 },
        })
      }
      if (req.method() === 'POST') {
        const body = req.postDataJSON()
        if (body.action === 'save' && body.table === 'recipes') {
          writes++
          const index = workspace.recipes.findIndex(
            (r) => r.id === body.data.id,
          )
          const next = assignRecipeCategory(
            body.data,
            workspace.recipes[index],
            recipeCategories(workspace),
          )
          workspace.recipes[index] = next
        } else
          return route.fulfill({
            status: 400,
            json: { error: 'Unexpected fixture mutation' },
          })
      }
      return route.fulfill({ json: { workspace, role: 'Owner', demo: false } })
    })
    await page.goto(workspaceFixtureUrl('Recipes'), {
      waitUntil: 'networkidle',
    })
    const card = page.getByRole('button').filter({
      has: page.getByRole('heading', { name: cookies.name, exact: true }),
    })
    await expect(card.locator('[data-recipe-icon="cookie"]')).toBeVisible()
    await expect(page.getByAltText('Photo of ' + bread.name)).toBeVisible()
    await page
      .getByRole('button', { name: 'Manage recipe categories', exact: true })
      .click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    const bounds = await dialog.boundingBox()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.y).toBeGreaterThanOrEqual(0)
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(901)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1)
    await dialog.getByLabel('New category name').fill('Market drinks')
    await dialog
      .getByRole('button', { name: 'Other icon', exact: true })
      .click()
    await page.screenshot({ path: `/tmp/recipe-category-picker-${width}.png` })
    await dialog.getByRole('button', { name: 'Beverage', exact: true }).click()
    await dialog
      .getByRole('button', { name: 'Add category', exact: true })
      .click()
    await expect(dialog.getByText('Category changes saved.')).toBeVisible()
    await dialog.getByRole('button', { name: 'Done', exact: true }).click()
    await card.click()
    await dialog
      .getByRole('button', { name: 'Edit Recipe', exact: true })
      .click()
    await dialog
      .getByLabel('Recipe category', { exact: true })
      .selectOption('custom-market')
    await expect(dialog.locator('[data-recipe-icon="drink"]')).toBeVisible()
    await dialog
      .getByRole('button', { name: 'Save recipe', exact: true })
      .click()
    await expect(dialog).toHaveCount(0)
    await expect(card.locator('[data-recipe-icon="drink"]')).toBeVisible()
    await expect(card.getByText('Market drinks', { exact: true })).toBeVisible()
    await page
      .getByRole('button', { name: 'Manage recipe categories', exact: true })
      .click()
    await dialog
      .getByRole('button', { name: 'Edit Market drinks', exact: true })
      .click()
    await dialog.getByLabel('Rename category').fill('Market sips')
    await dialog
      .getByRole('button', { name: 'Save category', exact: true })
      .click()
    await dialog
      .getByRole('button', { name: 'Archive Market sips', exact: true })
      .click()
    await dialog.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(
      card.getByText('Market sips (archived)', { exact: true }),
    ).toBeVisible()
    await page.reload({ waitUntil: 'networkidle' })
    await expect(card.locator('[data-recipe-icon="drink"]')).toBeVisible()
    await page
      .getByLabel('Filter by recipe category')
      .selectOption('custom-market')
    await expect(page.locator('.recipe-card')).toHaveCount(1)
    await page.getByLabel('Filter by recipe category').selectOption('all')
    await page
      .getByRole('button', { name: 'Create recipe', exact: true })
      .click()
    await expect(
      dialog.getByRole('option', {
        name: 'Market sips (archived)',
        exact: true,
      }),
    ).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page.getByAltText('Photo of ' + bread.name)).toBeVisible()
    expect(workspace.recipes.find((r) => r.id === cookies.id)).toMatchObject({
      yield: before.yield,
      yieldUnit: before.yieldUnit,
      laborRate: before.laborRate,
      laborMinutes: before.laborMinutes,
      lines: before.lines,
    })
    expect(writes).toBe(1)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: `/tmp/recipe-categories-${width}.png`,
      fullPage: true,
    })
  })
}
