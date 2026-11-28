import { test, expect } from '@playwright/test'
import { breadBaseFixture } from '../src/test/fixtures/bread-base'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'
for (const [width, height] of [
  [1440, 1000],
  [1280, 650],
  [820, 900],
  [390, 844],
]) {
  test(`recipe layout and unsaved copy ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height })
    await installWorkspaceFixture(page)
    const workspace = breadBaseFixture()
    workspace.recipes = [
      {
        ...workspace.recipes[0],
        id: 'layout-recipe',
        name: 'Disposable layout recipe',
        description: 'Original description',
        overhead: 3,
        overheadMode: 'batch',
        wasteMode: 'percent',
        wastePercent: 2,
      },
    ]
    let saves = 0
    const category = {
      id: 'long-category',
      name: 'Seasonal finishing sugars and specialty bakery preparations',
      active: true,
      icon: 'other',
    }
    await page.route('**/api/workspace*', (route) => {
      if (route.request().url().includes('recipeCategories'))
        return route.fulfill({ json: { categories: [category], revision: 1 } })
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON()
        if (body.action === 'save' && body.table === 'recipes') {
          saves++
          const index = workspace.recipes.findIndex(
            (r) => r.id === body.data.id,
          )
          if (index < 0) workspace.recipes.push(body.data)
          else workspace.recipes[index] = body.data
        }
      }
      return route.fulfill({ json: { workspace, role: 'Owner', demo: false } })
    })
    await page.goto(workspaceFixtureUrl('Recipes'))
    await page
      .getByRole('button', {
        name: 'Edit Disposable layout recipe',
        exact: true,
      })
      .click()
    const dialog = page.getByRole('dialog')
    const ingredientSection = dialog.locator('.recipe-editor-components')
    const actions = ingredientSection.getByRole('button', { name: /^Add (ingredient|compound \/ prep|prepared stock)$/ })
    await expect(actions).toHaveCount(3)
    const actionPositions = await actions.evaluateAll((buttons) => buttons.map((button) => {
      const { top, width } = button.getBoundingClientRect()
      return { top, width, available: button.parentElement!.clientWidth }
    }))
    const tops = actionPositions.map(({ top }) => top)
    if (width >= 820) expect(Math.max(...tops) - Math.min(...tops), JSON.stringify(actionPositions)).toBeLessThan(1)
    const heading = width <= 640 ? '.recipe-line-mobile-heading' : '.recipe-line-headings span'
    await expect(ingredientSection.locator(heading).first()).toBeVisible()
    await expect(dialog.getByRole('checkbox', {name: 'Recipe type: Compound prep'})).toHaveAccessibleDescription(/used to make|used in another recipe/)
    await ingredientSection.locator('.recipe-add-actions').evaluate((element) => element.scrollIntoView({ block: 'center' }))
    await page.screenshot({ path: testInfo.outputPath(`recipe-ingredients-${width}.png`) })
    await dialog
      .getByRole('combobox', { name: 'Category', exact: true })
      .selectOption(category.id)
    const description = dialog.getByRole('textbox', {
      name: 'Description',
      exact: true,
    })
    const descriptionRect = await description.boundingBox()
    for (const name of [
      'Add category',
      'Manage categories',
      'Refresh categories',
    ]) {
      const rect = await dialog
        .getByRole('button', { name, exact: true })
        .boundingBox()
      expect(rect!.y + rect!.height).toBeLessThanOrEqual(descriptionRect!.y)
    }
    expect(await dialog.locator('.recipe-editor-overhead input').count()).toBe(
      3,
    )
    const overhead = dialog.getByRole('spinbutton', {
      name: 'Overhead amount ($ or %)',
      exact: true,
    })
    const summary = dialog.locator('.recipe-calculation')
    const before = await summary.innerText()
    await overhead.fill('17')
    await expect(summary).not.toHaveText(before)
    await dialog
      .getByRole('combobox', { name: 'Overhead calculation' })
      .selectOption('percent')
    await dialog
      .getByRole('combobox', { name: 'Waste method' })
      .selectOption('actual')
    await dialog
      .getByRole('spinbutton', { name: 'Additional actual waste cost ($)' })
      .fill('4')
    await dialog
      .getByRole('button', { name: 'Add category', exact: true })
      .click()
    await expect(
      page
        .getByRole('dialog')
        .last()
        .getByRole('heading', { name: 'Add recipe category' }),
    ).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(overhead).toHaveValue('17')
    await dialog.getByRole('button', { name: 'Manage categories', exact: true }).click()
    await expect(page.getByRole('dialog').last().getByRole('heading', { name: 'Manage recipe categories' })).toBeVisible()
    await page.keyboard.press('Escape')
    await description.fill('Layout checked')
    await dialog
      .getByRole('textbox', { name: 'Instructions', exact: true })
      .fill('Final instructions remain reachable')
    await overhead.scrollIntoViewIfNeeded()
    await page.screenshot({path:testInfo.outputPath(`overhead-${width}.png`)})
    const instructions = dialog.getByRole('textbox', { name: 'Instructions', exact: true })
    await instructions.focus()
    await page.keyboard.press('Tab')
    await dialog.getByRole('button', {name:'Save recipe',exact:true}).focus()
    await expect(dialog.getByRole('button', {name:'Save recipe',exact:true})).toBeInViewport()
    await dialog
      .locator('.food-product-scroll')
      .evaluate((el) => (el.scrollTop = 0))
    await page.screenshot({
      path: testInfo.outputPath(`recipe-${width}.png`),
    })
    await dialog
      .getByRole('button', { name: 'Save recipe', exact: true })
      .click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(saves).toBe(1)
    await page
      .getByRole('button', {
        name: 'Edit Disposable layout recipe',
        exact: true,
      })
      .click()
    await expect(overhead).toHaveValue('17')
    await expect(description).toHaveValue('Layout checked')
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page
      .getByRole('button', {
        name: 'Copy Disposable layout recipe',
        exact: true,
      })
      .click()
    await expect(
      dialog.getByRole('textbox', { name: 'Recipe name', exact: true }),
    ).toHaveValue('Disposable layout recipe — Copy')
    await expect(dialog.getByRole('button', { name: /^Delete / })).toHaveCount(
      0,
    )
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    expect(saves).toBe(1)
    expect(workspace.recipes).toHaveLength(1)
    await page
      .getByRole('button', {
        name: 'Copy Disposable layout recipe',
        exact: true,
      })
      .click()
    await dialog
      .getByRole('button', { name: 'Save recipe', exact: true })
      .click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(workspace.recipes).toHaveLength(2)
    expect(workspace.recipes[0].name).toBe('Disposable layout recipe')
    expect(workspace.recipes[1].id).not.toBe(workspace.recipes[0].id)
    await page.getByRole('button', {name:'Table',exact:true}).click()
    await expect(page.locator('td .item-record-actions').first().getByRole('button', {name:'Copy Disposable layout recipe',exact:true})).toBeVisible()
    await page.getByRole('button', {name:'Create recipe',exact:true}).click()
    await expect(dialog.locator('.recipe-editor-overhead')).toBeVisible()
    await expect(dialog.getByRole('button', {name:/^Delete /})).toHaveCount(0)
    await dialog.getByRole('button',{name:'Cancel',exact:true}).click()

  })
}
