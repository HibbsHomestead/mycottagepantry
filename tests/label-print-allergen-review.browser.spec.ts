import { expect, test } from '@playwright/test'
import {
  majorAllergens,
  validateAllergenDecisions,
} from '../src/lib/label-ingredient-review'
import { validateLabelRunContent } from '../src/lib/label-sets'
import {
  blankLabel,
  newElement,
  resolveLabelData,
} from '../src/lib/label-studio'
import { confirmFixtureAllergens, labelIngredientReviewFixture } from '../src/test/fixtures/label-ingredient-review'
import { mixedPackFixture } from '../src/test/fixtures/mixed-pack'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

for (const width of [1440, 390]) {
  test(`keeps merge opt-in and offers a nested mix fallback at ${width}px`, async ({ page }, testInfo) => {
    const { workspace } = mixedPackFixture()
    workspace.settings[0].owner = 'Fixture owner'
    const fixture = labelIngredientReviewFixture()
    const { product, mix } = fixture
    product.name = 'Peanut Butter Cookies'
    fixture.recipe.name = 'Peanut Butter Cookie Recipe'
    Object.assign(mix, { category: 'Baking', quantity: 500, cost: 0.02, threshold: 0, conversions: [], updatedAt: 'fixture-ingredient-v1' })
    mix.name = mix.statement = 'Peanut Butter Cookie Mix'
    mix.subingredients = 'Peanuts, enriched flour (wheat flour, niacin), sugar'
    delete mix.labelComponentWeights
    delete product.labelIngredientMode
    workspace.ingredients.push(...fixture.workspace.ingredients)
    workspace.products = [product]
    workspace.recipes = fixture.workspace.recipes
    confirmFixtureAllergens(workspace, product, ['Peanuts', 'Wheat', 'Soybeans', 'Eggs'])
    const source = { kind: 'product', id: product.id } as const
    const standardLabel = {
      ...blankLabel(), id: 'fixture-standard-format', name: 'Standard cookie declaration',
      workflowVersion: 1 as const, recordKind: 'label' as const, source, productId: product.id, revision: 1,
      elements: [
        { ...newElement('text', '', 'recipe.ingredients'), x: 6, y: 8, width: 205, height: 86, fontSize: 9 },
        { ...newElement('text', '', 'recipe.allergens'), x: 6, y: 98, width: 205, fontSize: 9 },
      ],
    }
    const mergedLabel = {
      ...standardLabel, id: 'fixture-merged-format', name: 'Merged cookie declaration',
      ingredientMerge: { productId: product.id, mode: 'merged' as const, standardIds: [] },
    }
    workspace.label_templates = [standardLabel, mergedLabel]
    const printed: string[] = []
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.setViewportSize({ width, height: 900 })
    await installWorkspaceFixture(page)
    await page.route('**/api/workspace*', async (route) => {
      if (route.request().method() === 'POST') {
        const { action, data } = route.request().postDataJSON()
        expect(action).toBe('labelPrint')
        const label = data.templateId === mergedLabel.id ? mergedLabel : standardLabel
        const snapshot = resolveLabelData(workspace, source, undefined, label === mergedLabel ? mergedLabel.ingredientMerge : undefined, data.standardIngredientOutput)
        validateLabelRunContent(label, snapshot, ['front'])
        expect(snapshot.values['recipe.ingredients']).toContain('Peanut Butter Cookie Mix (Peanuts, enriched flour (wheat flour, niacin), sugar)')
        if (label === mergedLabel) expect(data.standardIngredientOutput).toEqual({ ingredientIds: [mix.id] })
        printed.push(label.id)
        workspace.label_print_jobs = [{ id: `job-${printed.length}`, name: label.name, documentSnapshot: label, renderedDataSnapshot: snapshot }]
      }
      await route.fulfill({ json: { workspace, role: 'Owner', demo: false } })
    })
    await page.addInitScript(() => { window.print = () => window.dispatchEvent(new Event('afterprint')) })
    await page.goto(workspaceFixtureUrl('Labels'))
    await page.getByRole('button', { name: `Preview/Print ${standardLabel.name}` }).click()
    const print = page.getByRole('button', { name: 'Print labels', exact: true })
    const reviewWarnings = page.getByRole('checkbox', { name: 'I reviewed these warnings and the final label.' })
    const merge = page.getByRole('region', { name: 'Merge requirements' })
    await expect(merge).toHaveCount(0)
    if (await reviewWarnings.count()) await reviewWarnings.check()
    await expect(print).toBeEnabled()
    await print.click()
    await expect.poll(() => printed).toEqual([standardLabel.id])
    await expect(print).toBeEnabled()
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.getByRole('button', { name: `Preview/Print ${mergedLabel.name}` }).click()
    await expect(print).toBeDisabled()
    await expect(merge).toContainText('Peanut Butter Cookie Mix: Supplier component percentages are missing.')
    await expect(merge.getByRole('button', { name: 'Print with the standard format for this ingredient' })).toBeVisible()
    await merge.screenshot({ path: testInfo.outputPath(`merge-actions-${width}.png`) })
    await merge.getByRole('button', { name: 'Enter percentages' }).click()
    expect(pageErrors).toEqual([])
    const edit = page.getByRole('dialog', { name: /Edit Ingredient/ })
    await expect(edit.getByRole('tab', { name: 'Ingredients & Allergens' })).toHaveAttribute('aria-selected', 'true')
    await expect(edit.getByText('Supplier component weights for merged labels (optional)')).toBeVisible()
    const nested = edit.getByText('enriched flour components', { exact: true })
    await nested.click()
    await expect(edit.getByLabel('niacin · % by weight')).toHaveValue('')
    await nested.scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath(`ingredient-weights-${width}.png`) })
    await page.keyboard.press('Escape')
    await merge.getByRole('button', { name: 'Print with the standard format for this ingredient' }).click()
    await expect(merge).toHaveCount(0)
    if (await reviewWarnings.count()) await reviewWarnings.check()
    await expect(print).toBeEnabled()
    await print.click()
    await expect.poll(() => printed).toEqual([standardLabel.id, mergedLabel.id])
  })

  test(`reviews and prints a blocked declaration at ${width}px`, async ({
    page,
    context,
  }, testInfo) => {
    const { workspace } = mixedPackFixture()
    workspace.settings[0].owner = 'Fixture owner'
    const fixture = labelIngredientReviewFixture()
    const { product, mix } = fixture
    const wording = mix.subingredients
    mix.subingredients = ''
    mix.reviewed = false
    mix.updatedAt = 'fixture-v1'
    workspace.ingredients.push(...fixture.workspace.ingredients)
    workspace.products = [product]
    workspace.recipes = fixture.workspace.recipes
    const source = { kind: 'product', id: product.id } as const
    const label = {
      ...blankLabel(),
      id: 'allergen-print-fixture',
      name: 'Fixture allergen declaration',
      workflowVersion: 1 as const,
      recordKind: 'label' as const,
      source,
      productId: product.id,
      revision: 1,
      elements: [
        {
          ...newElement('text', '', 'recipe.ingredients'),
          x: 6,
          y: 8,
          width: 205,
          fontSize: 9,
        },
        {
          ...newElement('text', '', 'recipe.allergens'),
          x: 6,
          y: 88,
          width: 205,
          fontSize: 9,
        },
      ],
    }
    workspace.label_templates = [label]
    let printRequests = 0
    await page.setViewportSize({ width, height: 900 })
    await installWorkspaceFixture(page)
    await page.route('**/api/workspace*', async (route) => {
      if (route.request().method() === 'POST') {
        const { action, data } = route.request().postDataJSON()
        if (action === 'ingredientAllergenSource') {
          expect(data.expectedUpdatedAt).toBe('fixture-v1')
          expect(data.subingredients).toBe(wording)
          Object.assign(mix, {
            subingredients: data.subingredients,
            reviewed: data.reviewed,
            updatedAt: 'fixture-v2',
          })
        } else if (action === 'productAllergenReview') {
          const review = resolveLabelData(workspace, source).allergenReview!
          expect(data.source).toEqual(review.source)
          product.allergenReview = {
            source: review.source,
            decisions: validateAllergenDecisions(
              data.decisions,
              review.evidence,
            ),
            actor: 'fixture-owner',
            reviewedAt: '2026-11-28T00:00:00Z',
          }
        } else if (action === 'labelPrint') {
          const snapshot = resolveLabelData(workspace, source)
          validateLabelRunContent(label, snapshot, ['front'])
          printRequests += 1
          workspace.label_print_jobs = [
            {
              id: 'fixture-print',
              name: label.name,
              documentSnapshot: label,
              renderedDataSnapshot: snapshot,
            },
          ]
        } else expect(action).toBe('labelDraft')
      }
      await route.fulfill({ json: { workspace, role: 'Owner', demo: false } })
    })
    await page.addInitScript(() => {
      window.print = () => {
        Object.assign(window.parent, {
          fixturePrintDocument: document.documentElement.outerHTML,
        })
        window.dispatchEvent(new Event('afterprint'))
      }
    })
    await page.goto(workspaceFixtureUrl('Labels'))
    await page
      .getByRole('button', { name: `Preview/Print ${label.name}` })
      .click()
    const print = page.getByRole('button', {
      name: 'Print labels',
      exact: true,
    })
    await expect(print).toBeDisabled()
    const reviewPanel = page.getByRole('region', {
      name: `Allergen review for ${product.name}`,
    })
    await expect(reviewPanel).toContainText('add the supplier’s component list')
    await reviewPanel
      .getByText('Edit allergen source for Purchased blueberry muffin mix')
      .click()
    await page.screenshot({
      path: testInfo.outputPath(`blocked-review-${width}.png`),
    })
    await reviewPanel
      .getByRole('textbox', { name: 'Supplier subingredients' })
      .fill(wording)
    await reviewPanel
      .getByRole('checkbox', { name: /I verified the ingredient/ })
      .check()
    await reviewPanel
      .getByRole('button', { name: 'Save ingredient source' })
      .click()
    await expect(
      reviewPanel.getByText('add the supplier’s component list', {
        exact: false,
      }),
    ).toHaveCount(0)
    await expect(print).toBeDisabled()
    await reviewPanel
      .getByText('Review and confirm major allergens · Not confirmed')
      .click()
    for (const allergen of majorAllergens) {
      const present = ['Eggs', 'Wheat', 'Soybeans'].includes(allergen)
      await reviewPanel
        .getByRole('group', { name: allergen, exact: true })
        .getByRole('combobox')
        .selectOption(present ? 'present' : 'absent')
    }
    await reviewPanel.getByRole('group', { name: 'Milk', exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({
      path: testInfo.outputPath(`allergen-confirmation-${width}.png`),
    })
    await reviewPanel
      .getByRole('button', { name: 'Save allergen review' })
      .click()
    await expect(print).toBeEnabled()
    const safetyCheck = page.getByRole('checkbox', {
      name: 'I reviewed these warnings and the final label.',
    })
    if (await safetyCheck.count()) await safetyCheck.check()
    await print.click()
    const printDocument = () =>
      page.evaluate(
        () =>
          (window as Window & { fixturePrintDocument?: string })
            .fixturePrintDocument || '',
      )
    await expect
      .poll(printDocument)
      .toContain('CONTAINS: WHEAT, SOYBEANS, EGGS')
    expect(printRequests).toBe(1)
    const output = await context.newPage()
    await output.setContent(await printDocument())
    await output.screenshot({
      path: testInfo.outputPath(`printed-declaration-${width}.png`),
    })
    await output.close()
  })
}
