import { expect, test, type Locator, type Download } from '@playwright/test'
import sharp from 'sharp'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'
import {
  ingredientStatementFixture,
  mainNames,
  statement,
} from '../src/test/fixtures/ingredient-statement'
import {
  resolveLabelData,
  validateLabelDocument,
  type LabelDocument,
} from '../src/lib/label-studio'
import { labelSetPlan } from '../src/lib/label-sets'

async function checkStatement(canvas: Locator) {
  const text = canvas.locator('[data-element="ingredients"] text')
  await expect(text).toHaveText(statement)
  const result = await text.evaluate(async (node) => {
    await document.fonts.ready
    const lines = [...node.children]
    const spans = lines.flatMap((line) => [...line.children])
    const { x, y, width, height } = (node as SVGGraphicsElement).getBBox()
    return {
      bold: spans
        .filter((span) => getComputedStyle(span).fontWeight === '700')
        .map((span) => span.textContent)
        .join(''),
      regular: spans
        .filter((span) => getComputedStyle(span).fontWeight === '400')
        .map((span) => span.textContent)
        .join(''),
      family: getComputedStyle(node).fontFamily,
      size: node.getAttribute('font-size'),
      fill: node.getAttribute('fill'),
      bounds: { x, y, width, height },
      lines: lines.length,
    }
  })
  expect(result.bold).toBe(mainNames.join(''))
  expect(result.regular).toContain('chocolate (cocoa mass, cocoa butter)')
  expect(result.regular).toContain('vitamins (niacin, iron)')
  expect(result.family).toBe('"DM Sans"')
  expect(result.size).toBe('10')
  expect(result.fill).toBe('#324536')
  expect(result.lines).toBeGreaterThan(1)
  expect(result.bounds.x).toBeGreaterThanOrEqual(-0.1)
  expect(result.bounds.x + result.bounds.width).toBeLessThanOrEqual(248.1)
  expect(result.bounds.y + result.bounds.height).toBeLessThanOrEqual(150)
  return text.innerHTML()
}

test('nested ingredient weights match in the editor, reopened duplicate, both previews and browser print', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await installWorkspaceFixture(page)
  const { workspace, source, document } = ingredientStatementFixture()
  workspace.settings[0].labelEditorScope = 'browser-mixed-ingredient-weights'
  await page.route('**/api/workspace*', async (route) => {
    if (route.request().method() === 'POST') {
      const { action, data } = route.request().postDataJSON()
      if (action === 'labelSave') {
        const next = validateLabelDocument(structuredClone(data.document))
        const previous = workspace.label_templates.find((d) => d.id === next.id)
        workspace.label_templates = workspace.label_templates.filter(
          (d) => d.id !== next.id,
        )
        workspace.label_templates.push({
          ...next,
          revision: (previous?.revision || 0) + 1,
          lastSaveOperationId: data.operationId,
          savedAt: new Date().toISOString(),
        })
      } else if (action === 'labelPrint') {
        const design = workspace.label_templates.find(
          (d) => d.id === data.templateId,
        ) as LabelDocument
        workspace.label_print_jobs.push({
          id: 'print-ingredients',
          name: design.name,
          documentSnapshot: structuredClone(design),
          renderedDataSnapshot: resolveLabelData(workspace, source),
          sequence: labelSetPlan(design, data.copies, data.parts, data.order)
            .runs[0].sequence,
        })
      } else expect(['labelDraft', 'labelColorRecent']).toContain(action)
    }
    await route.fulfill({ json: { workspace, role: 'Owner', demo: false } })
  })
  await page.addInitScript(() => {
    window.print = () => {
      const parent = window.parent as Window & { printedIngredients?: string[] }
      parent.printedIngredients = [
        ...window.document.querySelectorAll(
          '.label [data-element="ingredients"] text',
        ),
      ].map((node) => node.innerHTML)
      window.dispatchEvent(new Event('afterprint'))
    }
  })
  await page.goto(workspaceFixtureUrl('Labels'))
  await page
    .getByRole('button', { name: `Edit ${document.name}`, exact: true })
    .click()
  const editorCanvas = page.locator('.studio-scroll-stage svg')
  const front = await checkStatement(editorCanvas)
  const sides = page.getByRole('group', { name: 'Label side', exact: true })
  await sides.getByRole('button', { name: 'Back', exact: true }).click()
  const back = await checkStatement(editorCanvas)
  await page.screenshot({
    path: 'docs/previews/ingredient-statement-editor.png',
    animations: 'disabled',
    fullPage: true,
  })
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.locator('.studio-save-state')).toContainText('Saved')
  await page.reload()
  await page
    .getByRole('button', { name: `Edit ${document.name}`, exact: true })
    .click()
  expect(await checkStatement(editorCanvas)).toBe(front)
  await page.getByRole('button', { name: 'Duplicate', exact: true }).click()
  expect(await checkStatement(editorCanvas)).toBe(front)
  await sides.getByRole('button', { name: 'Back', exact: true }).click()
  expect(await checkStatement(editorCanvas)).toBe(back)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.locator('.studio-save-state')).toContainText('Saved')
  const copy = workspace.label_templates.find((d) => d.id !== document.id)!
  expect(copy.elements).toEqual(document.elements)
  expect(copy.back!.elements).toEqual(document.back.elements)
  await page.getByRole('button', { name: 'Preview/Print', exact: true }).click()
  const previews = page.locator('.studio-print-preview .label-set-preview svg')
  await expect(previews).toHaveCount(2)
  expect(await checkStatement(previews.nth(0))).toBe(front)
  expect(await checkStatement(previews.nth(1))).toBe(back)
  await page.screenshot({
    path: 'docs/previews/ingredient-statement-preview.png',
    animations: 'disabled',
    fullPage: true,
  })
  const review = page
    .getByRole('checkbox', {
      name: 'I reviewed these warnings and the final label.',
      exact: true,
    })
    .filter({ visible: true })
  if (await review.count()) await review.check()
  await page.getByRole('button', { name: 'Print labels', exact: true }).click()
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { printedIngredients?: string[] })
            .printedIngredients,
      ),
    )
    .toEqual(
      [front, back].map((html) =>
        html.replace(
          /font-synthesis-weight:\s*none;?/g,
          'font-synthesis-weight:none',
        ),
      ),
    )

  const downloads: Download[] = []
  page.on('download', (download) => downloads.push(download))
  await page
    .getByRole('button', { name: 'Single PNG · 300 DPI', exact: true })
    .click()
  await expect.poll(() => downloads.length).toBe(2)
  for (const side of ['front', 'back']) {
    const download = downloads.find((d) =>
      d.suggestedFilename().endsWith(`- ${side}.png`),
    )!
    expect(download).toBeDefined()
    const path = `docs/previews/ingredient-statement-${side}.png`
    await download.saveAs(path)
    expect(await sharp(path).metadata()).toMatchObject({
      width: 1200,
      height: 900,
      format: 'png',
    })
  }
})
