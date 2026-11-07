import { test, expect } from '@playwright/test'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'
import { demoData } from '../src/lib/demo'
import { parseRecipeText } from '../src/lib/recipe-import'

// Browser interactions use a synthetic API. Durable transactions are tested
// separately in recipe-import-database.test.ts, never in customer workspaces.
for (const [width, label] of [
  [1440, 'desktop'],
  [1024, 'narrow laptop'],
  [390, 'mobile'],
  [720, '200% equivalent reflow'],
] as const) {
  test(`recipe review saving, conversion and layout: ${label}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 })
    await installWorkspaceFixture(page)
    // Netlify's dev proxy serves application routes; Vite owns source modules.
    // Keep browser/API origin on 8889 while loading the test-only entry point.
    await page.route(
      /^http:\/\/localhost:8889\/(?:@|src\/|node_modules\/)/,
      async (route) => {
        const url = new URL(route.request().url())
        url.port = '3000'
        const response = await route.fetch({ url: url.href })
        await route.fulfill({ response })
      },
    )
    const workspace = demoData()
    workspace.recipes = []
    workspace.ingredients = [
      {
        id: 'bread-flour',
        name: 'Bread flour',
        unit: 'g',
        quantity: 2000,
        cost: 0.01,
        currentCost: 0.01,
        usedAs: 'ingredient',
        conversions: [],
      },
      {
        id: 'sugar',
        name: 'Sugar',
        unit: 'g',
        quantity: 100,
        cost: 0.02,
        currentCost: 0.02,
        usedAs: 'ingredient',
        conversions: [],
      },
    ]
    const source =
      'Bread import\nYield: 2 loaves\nIngredients:\n8 cups bread flour\n10 g sugar\nInstructions:\n1. Mix.\n2. Bake.'
    let record = {
      id: 'bread-import',
      updatedAt: 'v1',
      status: 'needs_review',
      sourceText: source,
      mime: 'text/plain',
      method: 'Pasted text',
      recipeId: '',
      draft: parseRecipeText(source),
    }
    record.draft.lines = record.draft.lines.map((l, i) => ({
      ...l,
      decision: 'match',
      ingredientId: i ? 'sugar' : 'bread-flour',
      confirmed: false,
      cupStandard: i ? '' : 'us',
    }))
    let saves = 0,
      approvals = 0
    let failure: 'session' | 'network' | 'validation' | '' = 'session'
    await page.route('**/api/workspace*', async (route) => {
      const req = route.request()
      if (req.url().includes('recipeImports')) {
        if (req.method() === 'GET')
          return route.fulfill({
            json: req.url().includes('&id=')
              ? { import: record }
              : { imports: [{ ...record, summary: true }] },
          })
        const body = req.postDataJSON()
        if (failure === 'network') return route.abort('failed')
        if (failure === 'validation')
          return route.fulfill({
            status: 400,
            json: {
              code: 'IMPORT_DRAFT_INVALID',
              stage: 'draft_validation',
              error: 'Correct the source URL.',
              fields: [
                {
                  path: 'sourceUrl',
                  message: 'Use a public source URL without credentials.',
                },
              ],
            },
          })
        if (failure === 'session')
          return route.fulfill({
            status: 401,
            json: { code: 'SIGN_IN_REQUIRED', error: 'Sign in on this site.' },
          })
        if (body.operation === 'save') saves++
        if (body.operation === 'approve' && record.status !== 'approved') {
          approvals++
          const recipeId = 'import-' + record.id
          workspace.recipes.push({
            id: recipeId,
            name: body.draft.title,
            yield: body.draft.yieldQuantity,
            yieldUnit: body.draft.yieldUnit,
            instructions: body.draft.instructions.join('\n\n'),
            lines: body.draft.lines.map((l: any) => ({
              ingredientId: l.ingredientId,
              quantity: l.quantity,
              unit: l.unit,
            })),
          })
          record = { ...record, status: 'approved', recipeId }
        }
        record = {
          ...record,
          draft: body.draft,
          updatedAt: 'v' + (saves + approvals + 1),
        }
        return route.fulfill({ json: { import: record } })
      }
      if (req.method() === 'POST') {
        const body = req.postDataJSON()
        if (body.action === 'conversion') {
          const ingredient = workspace.ingredients.find(
            (i) => i.id === body.data.ingredientId,
          )!
          ingredient.conversions = [
            ...ingredient.conversions.filter(
              (c: any) => c.from !== body.data.from || c.to !== body.data.to,
            ),
            {
              ...body.data,
              amountFrom: Number(body.data.amountFrom),
              amountTo: Number(body.data.amountTo),
            },
          ]
        }
      }
      return route.fulfill({ json: { workspace, role: 'Owner', demo: false } })
    })
    async function openDraft() {
      await page
        .getByRole('button', { name: 'Import recipe', exact: true })
        .first()
        .click()
      await page.getByRole('button', { name: /Bread import.*Review/ }).click()
    }
    await page.goto(workspaceFixtureUrl('Recipes'), {
      waitUntil: 'domcontentloaded',
    })
    await openDraft()
    const dialog = page.getByRole('dialog')
    await dialog
      .getByLabel('Recipe title', { exact: true })
      .fill('Bread import edited')
    const draftButton = dialog.getByRole('button', {
      name: 'Save import draft',
      exact: true,
    })
    await expect(draftButton).toBeEnabled()
    await expect(
      dialog.getByRole('button', { name: 'Approve & create recipe' }),
    ).toBeDisabled()
    await draftButton.click()
    await expect(dialog.getByRole('alert')).toContainText('401')
    await expect(
      dialog.getByRole('link', { name: 'Sign in again in a new tab' }),
    ).toHaveAttribute('target', '_blank')
    await expect(
      dialog.getByLabel('Recipe title', { exact: true }),
    ).toHaveValue('Bread import edited')
    failure = 'network'
    await draftButton.click()
    await expect(dialog.getByRole('alert')).toContainText('could not complete')
    failure = 'validation'
    await draftButton.click()
    await expect(dialog.getByRole('alert')).toContainText('sourceUrl')
    failure = ''
    await draftButton.click()
    await expect(dialog.getByRole('status')).toContainText('Import draft saved')
    expect(saves).toBe(1)
    await dialog.getByRole('button', { name: 'Close recipe import' }).click()
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page
      .getByRole('button', { name: 'Import recipe', exact: true })
      .first()
      .click()
    await page
      .getByRole('button', { name: /Bread import edited.*Review/ })
      .click()
    await expect(dialog.getByLabel('Quantity 1', { exact: true })).toHaveValue(
      '8',
    )
    await expect(
      dialog.getByLabel('Pantry choice 1', { exact: true }),
    ).toHaveValue('bread-flour')
    const flour = dialog.getByRole('article', {
      name: 'Ingredient 1: bread flour',
    })
    const sugar = dialog.getByRole('article', { name: 'Ingredient 2: sugar' })
    await flour.getByRole('button', { name: 'Set up conversion' }).click()
    const editor = flour.locator('.recipe-conversion-editor')
    for (const field of [
      'From quantity',
      'From unit',
      'To quantity',
      'To unit',
      'Source / measurement notes',
    ]) {
      const control = editor.getByLabel(field, { exact: true })
      await control.scrollIntoViewIfNeeded()
      await expect(control).toBeVisible()
      const bounds = await control.boundingBox()
      expect(bounds!.x).toBeGreaterThanOrEqual(0)
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
    }
    await editor.getByLabel('From quantity', { exact: true }).focus()
    await page.keyboard.press('Tab')
    await expect(editor.getByLabel('From unit', { exact: true })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(
      editor.getByLabel('To quantity', { exact: true }),
    ).toBeFocused()
    await page.screenshot({
      path: `/tmp/recipe-conversion-${width}.png`,
      fullPage: true,
    })
    await editor.getByLabel('To quantity', { exact: true }).fill('125')
    await editor
      .getByLabel('Source / measurement notes')
      .fill('Synthetic measured value')
    await expect(
      editor.getByLabel('Source', { exact: true }).locator('option:checked'),
    ).toHaveText('My measurement')
    await editor.getByRole('button', { name: 'Cancel conversion' }).click()
    await flour.getByRole('button', { name: 'Set up conversion' }).click()
    await expect(editor.getByLabel('To quantity', { exact: true })).toHaveValue(
      '125',
    )
    await editor
      .getByLabel('I verified these amounts for this ingredient.')
      .check()
    await editor
      .getByRole('button', { name: 'Save ingredient conversion' })
      .click()
    await expect(editor).toBeHidden()
    await flour.getByLabel('Confirm Pantry choice 1').check()
    await sugar.getByLabel('Confirm Pantry choice 2').check()
    await expect(flour).toContainText('Complete costing · $10.00')
    await expect(flour).toContainText('Uses an existing verified conversion')
    const compactHeight = (await sugar.boundingBox())!.height
    expect(compactHeight).toBeLessThan(width < 700 ? 600 : 390)
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    const approve = dialog.getByRole('button', {
      name: 'Approve & create recipe',
    })
    await expect(approve).toBeEnabled()
    await approve.click()
    await expect(
      dialog.getByText('Approved recipe', { exact: true }),
    ).toBeVisible()
    expect(approvals).toBe(1)
    expect(workspace.recipes).toHaveLength(1)
    await page.screenshot({
      path: `/tmp/recipe-import-${width}.png`,
      fullPage: true,
    })
  })
}
