import { mkdir } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { breadBaseFixture } from '../src/test/fixtures/bread-base'
import { productionDefinition } from '../src/lib/production'
import { planStockPrep } from '../src/lib/stock-prep'
import { preparedRequirement } from '../src/lib/prepared-requirement'
import type { Item } from '../src/lib/domain'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

const screenshots = 'docs/reviews/guided-production'

for (const width of [1440, 390]) {
  test.describe(`production at ${width}px`, () => {
  test.use({ hasTouch: width === 390 })
  test(`moves existing runs through the board at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1050 })
    await installWorkspaceFixture(page)
    const workspace = breadBaseFixture()
    const fruit = {
      id: 'bananas-fixture',
      name: 'Bananas',
      unit: 'each',
      quantity: 20,
      cost: 0.45,
      usedAs: 'ingredient',
    }
    const date = '2026-11-20'
    const plan = planStockPrep(
      fruit,
      [],
      {
        used: 12,
        portions: 3,
        perPortion: 4,
        outputUnit: 'each',
        method: 'Frozen',
        location: 'Freezer',
        date,
        note: 'Approximately two cups',
      },
      date,
    )
    const lot = {
      ...plan,
      id: 'frozen-bananas-fixture-lot',
      name: 'Frozen',
      kind: 'ingredient_prep',
      ingredientId: fruit.id,
      quantity: plan.usable,
    }
    const recipe: Item = {
      id: 'banana-loaf-recipe',
      name: 'Banana Brownies',
      yield: 1,
      yieldUnit: 'each',
      lines: [
        {
          ingredientId: fruit.id,
          unit: 'each',
          quantity: 4,
          prepared: preparedRequirement(fruit, lot),
        },
      ],
    }
    const product = {
      id: 'banana-loaf-product',
      name: 'Banana Brownies',
      recipeId: recipe.id,
      unitsPerPackage: 1,
      price: 9,
      unpacked: true,
    }
    workspace.ingredients.push(fruit)
    workspace.lots = [lot]
    workspace.recipes.push(recipe)
    workspace.products.push(product)
    const mapping = { quantity: 1, unit: 'each', verified: true }
    const definition = productionDefinition(product, workspace, mapping)
    const draft: Item = {
      id: 'banana-fixture-draft',
      name: 'Banana brownies — market prep',
      recipeId: recipe.id,
      date,
      dueDate: '2026-11-24',
      status: 'draft',
      revision: 1,
      productionVersion: 2,
      lines: [
        {
          id: 'banana-fixture-line',
          productId: product.id,
          name: product.name,
          mapping,
          definition,
          quantity: 2,
        },
      ],
    }
    workspace.events = [{ id: 'autumn-market', name: 'Autumn Market' }]
    workspace.event_batch_links = [
      {
        id: 'event-banana-run',
        name: '',
        recordId: draft.id,
        eventId: 'autumn-market',
      },
    ]
    workspace.batches = [
      draft,
      {
        id: 'board-ready-fixture',
        name: 'Spinach parmesan prep',
        recipeId: 'spinach-parmesan',
        date,
        count: 1,
        yield: 3,
        status: 'scheduled',
      },
      {
        id: 'board-active-fixture',
        name: 'White bread — morning bake',
        recipeId: 'bread',
        date,
        count: 1,
        yield: 2,
        status: 'in_progress',
      },
      {
        id: 'board-complete-fixture',
        name: 'White bread — prior bake',
        recipeId: 'bread',
        date,
        count: 1,
        yield: 2,
        status: 'completed',
      },
    ]
    let startAttempts = 0
    let finalAttempts = 0
    let completes = 0
    await page.route('**/api/workspace*', (route) => {
      if (route.request().url().includes('recipeCategories'))
        return route.fulfill({ json: { categories: [], revision: 1 } })
      if (route.request().method() === 'POST') {
        const { action, data } = route.request().postDataJSON()
        if (action === 'productionSave') {
          if (draft.status === 'draft' && data.status === 'scheduled' && ++startAttempts === 1)
            return route.fulfill({
              status: 400,
              json: { error: 'Fixture: review the current run first.' },
            })
          Object.assign(draft, data, { revision: draft.revision + 1 })
        }
        if (action === 'productionComplete') {
          if (++finalAttempts === 1) return route.fulfill({ status: 400, json: { error: 'Fixture: another run used this prepared stock. Review the allocation before trying again.' } })
          completes++
          Object.assign(draft, {
            status: 'completed',
            revision: draft.revision + 1,
            completedAt: date,
            lines: draft.lines.map((line: Item) => ({
              ...line,
              usage: [],
              costSnapshot: {},
              actualYield: 2,
            })),
          })
        }
      }
      return route.fulfill({ json: { workspace, role: 'Owner', demo: false } })
    })
    await page.goto(workspaceFixtureUrl('Production/Batch runs'))
    await page.getByRole('button', { name: 'Kanban board' }).click()
    const board = page.getByRole('region', { name: 'Production board' })
    const lane = (stage: string) =>
      board.locator('.production-board-lane').filter({
        has: page.getByRole('heading', { name: new RegExp(`^${stage}`) }),
      })
    const card = board.locator('article').filter({ hasText: draft.name })
    const chooseStage = async (stage: string) => {
      if (width === 390) await board.getByRole('group', { name: 'Production stage' }).getByRole('button', { name: new RegExp(`^${stage}`) }).click()
    }
    await expect(card.getByText('Autumn Market')).toBeVisible()
    await expect(card.getByText(/Due 2026-11-24/)).toBeVisible()
    await mkdir(screenshots, { recursive: true })
    if (width === 390)
      await board.evaluate((element) => element.scrollIntoView({ block: 'center' }))
    await page.screenshot({
      path: `${screenshots}/board-${width}.png`,
      fullPage: width === 1440,
      animations: 'disabled',
    })
    if (width === 1440)
      await card
        .locator('.production-board-grip')
        .dragTo(lane('In Progress').getByRole('heading'))
    else await card.getByRole('button', { name: 'Review & start' }).press('Enter')
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Start run', exact: true }).click()
    await expect(dialog.getByRole('alert')).toContainText('Fixture: review the current run first.')
    expect(draft.status).toBe('draft')
    await dialog.getByRole('button', { name: 'Start run', exact: true }).click()
    await expect(dialog.getByRole('heading', { name: 'Record output', exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: 'Enter output', exact: true }).click()
    const goodOutput = dialog.getByRole('spinbutton', { name: /Actual good output/ })
    await expect(goodOutput).toBeFocused()
    if (width === 1440) await dialog.screenshot({ path: `${screenshots}/blocked-output.png`, animations: 'disabled' })
    await expect(dialog.getByRole('button', { name: 'Review & finalize' })).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(
      lane('In Progress').getByRole('button', { name: draft.name }),
    ).toBeVisible()
    await page.reload()
    await chooseStage('In Progress')
    await expect(
      lane('In Progress').getByRole('button', { name: draft.name }),
    ).toBeVisible()
    if (width === 390) await card.getByRole('button', { name: 'Record output' }).tap()
    else await card.getByRole('button', { name: 'Record output' }).click()
    await expect(dialog).toBeVisible()
    expect(completes).toBe(0)
    await expect(goodOutput).toHaveValue('')
    await goodOutput.fill('2')
    if (width === 1440) await dialog.screenshot({ path: `${screenshots}/record-output.png`, animations: 'disabled' })
    const allocation = dialog.getByLabel(/Prepared stock · Bananas — Frozen/)
    await expect(allocation.locator('option')).not.toContainText([
      'Unportioned',
    ])
    await allocation.selectOption(lot.id)
    if (width === 1440) {
      await allocation.scrollIntoViewIfNeeded()
      await page.screenshot({
        path: `${screenshots}/production-allocation.png`,
        animations: 'disabled',
      })
    }
    await dialog
      .getByRole('button', { name: 'Save output', exact: true })
      .click()
    await expect(dialog.getByRole('button', { name: 'Review & finalize', exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    await page.reload()
    await chooseStage('Ready to Finalize')
    await expect(lane('Ready to Finalize').getByRole('button', { name: draft.name })).toBeVisible()
    if (width === 1440) await card.locator('.production-board-grip').dragTo(lane('Completed').getByRole('heading'))
    else await card.getByRole('button', { name: 'Review & finalize', exact: true }).click()
    await expect(
      dialog.getByRole('heading', { name: 'Finalization review' }),
    ).toBeVisible()
    if (width === 1440) await dialog.screenshot({ path: `${screenshots}/final-review.png`, animations: 'disabled' })
    await dialog.getByRole('button', { name: 'Back to output', exact: true }).click()
    await expect(dialog.getByRole('heading', { name: 'Record output', exact: true })).toBeVisible()
    expect(completes).toBe(0)
    await dialog.getByRole('button', { name: 'Review & finalize', exact: true }).click()
    await dialog
      .getByRole('button', { name: 'Finalize production', exact: true })
      .click()
    await expect(dialog.getByRole('alert')).toContainText('another run used this prepared stock')
    expect(draft.status).toBe('scheduled')
    expect(completes).toBe(0)
    await dialog.getByRole('button', { name: 'Back to output', exact: true }).click()
    await expect(goodOutput).toHaveValue('2')
    await dialog.getByRole('button', { name: 'Review & finalize', exact: true }).click()
    await dialog.getByRole('button', { name: 'Finalize production', exact: true }).click()
    await expect(dialog.getByRole('heading', { name: 'Recorded result', exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(card.getByText('Finalized · no backward moves')).toBeVisible()
    await expect(card.locator('.production-board-grip')).toHaveCount(0)
    expect(completes).toBe(1)

    if (width === 1440) {
      await page.goto(workspaceFixtureUrl('Recipes'))
      await page
        .getByRole('button')
        .filter({
          has: page.getByRole('heading', { name: recipe.name, exact: true }),
        })
        .click()
      await page
        .getByRole('button', { name: 'Edit Recipe', exact: true })
        .click()
      await dialog
        .getByRole('button', { name: 'Add prepared stock', exact: true })
        .click()
      const picker = page.getByRole('dialog', {
        name: 'Choose prepared stock',
      })
      const option = picker.getByRole('button', {
        name: /Bananas — Frozen · 4 counted units per portion · Freezer/,
      })
      await expect(option).toContainText('3 portion equivalents available')
      await page.screenshot({
        path: `${screenshots}/recipe-selection.png`,
        animations: 'disabled',
      })
      await option.click()
      await expect(dialog.getByLabel('Portions per batch').last()).toHaveValue(
        '1',
      )
      await dialog.getByLabel('Portions per batch').last().fill('2')
      await expect(
        dialog.getByText('8 counted units measured total'),
      ).toBeVisible()
    }
  })
  })
}
