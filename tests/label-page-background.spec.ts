import { expect, test } from '@playwright/test'
import { demoData } from '../src/lib/demo'
import {
  blankLabel,
  newElement,
  resolveLabelData,
  validateLabelDocument,
  type LabelDocument,
} from '../src/lib/label-studio'
import { labelLayout, labelSetPlan } from '../src/lib/label-sets'
import { sourceKey } from '../src/lib/saved-labels'
import { defaultSheet } from '../src/lib/label-print-layout'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

// Real editor/render/print workflow, with synthetic API responses only.
test('each page retains its color through live editing, save, reopen, duplication and printing', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installWorkspaceFixture(page)
  const workspace = demoData()
  const source = { kind: 'product' as const, id: workspace.products[0].id }
  const original: LabelDocument = {
    ...blankLabel(),
    id: 'page-color-test',
    name: 'Two color loaf label',
    workflowVersion: 1,
    recordKind: 'label',
    renderVersion: 2,
    revision: 1,
    productId: source.id,
    source,
    manualTextReviewedFor: sourceKey(source),
    width: 216,
    height: 144,
    format: 'front-back',
    elements: [
      {
        ...newElement('text', 'Front'),
        x: 30,
        y: 30,
        rotation: 12,
        width: 100,
        height: 30,
      },
    ],
    back: labelLayout({
      ...blankLabel(),
      width: 216,
      height: 144,
      elements: [
        {
          ...newElement('text', 'Back'),
          x: 30,
          y: 30,
          rotation: -10,
          width: 100,
          height: 30,
        },
      ],
    }),
    printSettings: {
      copies: 1,
      parts: 'both',
      order: 'paired',
      layout: { ...defaultSheet, mode: 'roll' },
      printingMethod: 'browser',
    },
  }
  workspace.label_templates = [structuredClone(original)]
  workspace.label_recovery_drafts = []
  workspace.label_print_jobs = []
  workspace.settings[0].labelEditorScope = 'browser-page-colors'
  await page.route('**/api/workspace*', async (route) => {
    if (route.request().method() === 'POST') {
      const { action, data } = route.request().postDataJSON()
      if (action === 'labelSave') {
        const document = validateLabelDocument(structuredClone(data.document))
        const previous = workspace.label_templates.find(
          (d) => d.id === document.id,
        )
        workspace.label_templates = workspace.label_templates.filter(
          (d) => d.id !== document.id,
        )
        workspace.label_templates.push({
          ...document,
          revision: (previous?.revision || 0) + 1,
          lastSaveOperationId: data.operationId,
          savedAt: new Date().toISOString(),
        })
      } else if (action === 'labelPrint') {
        const document = workspace.label_templates.find(
          (d) => d.id === data.templateId,
        ) as LabelDocument
        const plan = labelSetPlan(document, data.copies, data.parts, data.order)
        workspace.label_print_jobs.push({
          id: 'print-' + workspace.label_print_jobs.length,
          name: document.name,
          documentSnapshot: structuredClone(document),
          renderedDataSnapshot: resolveLabelData(workspace, source),
          sequence: plan.runs[data.runIndex || 0].sequence,
        })
      } else expect(['labelDraft', 'labelColorRecent']).toContain(action)
    }
    await route.fulfill({ json: { workspace, role: 'Owner', demo: false } })
  })
  await page.addInitScript(() => {
    window.print = () => {
      const parent = window.parent as Window & {
        printedColors?: (string | null)[][]
      }
      parent.printedColors ||= []
      parent.printedColors.push(
        [
          ...document.querySelectorAll(
            '.label svg > g[clip-path] > rect:first-child',
          ),
        ].map((el) => el.getAttribute('fill')),
      )
      window.dispatchEvent(new Event('afterprint'))
    }
  })
  await page.goto(workspaceFixtureUrl('Labels'))
  await page
    .getByRole('button', { name: `Edit ${original.name}`, exact: true })
    .click()
  const sides = page.getByRole('group', { name: 'Label side', exact: true })
  await sides.getByRole('button', { name: 'Back', exact: true }).click()
  const hex = page.getByRole('textbox', {
    name: 'Label background HEX',
    exact: true,
  })
  await expect(hex).toHaveValue('#FFFFFF')
  await hex.fill('#b8dfef')
  await page.screenshot({
    path: 'docs/previews/label-back-background-after.png',
    animations: 'disabled',
    fullPage: true,
  })
  await expect(hex).toHaveValue('#b8dfef')
  await expect(
    page.locator('.studio-scroll-stage svg > g[clip-path] > rect').first(),
  ).toHaveAttribute('fill', '#b8dfef')
  await sides.getByRole('button', { name: 'Front', exact: true }).click()
  await expect(hex).toHaveValue('#FFFFFF')

  // The full picker previews the selected side immediately; Cancel restores it.
  const canvasBackground = page
    .locator('.studio-scroll-stage svg > g[clip-path] > rect')
    .first()
  await page
    .getByRole('button', { name: 'Choose label background', exact: true })
    .click()
  await page
    .getByRole('textbox', { name: 'Picker HEX', exact: true })
    .fill('#ffd08a')
  await expect(canvasBackground).toHaveAttribute('fill', '#ffd08a')
  await page.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(hex).toHaveValue('#ffd08a')
  await sides.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(hex).toHaveValue('#b8dfef')
  await page
    .getByRole('button', { name: 'Choose label background', exact: true })
    .click()
  await page
    .getByRole('textbox', { name: 'Picker HEX', exact: true })
    .fill('#a9ccab')
  await expect(canvasBackground).toHaveAttribute('fill', '#a9ccab')
  await page
    .getByRole('button', { name: 'Cancel color change', exact: true })
    .click()
  await expect(canvasBackground).toHaveAttribute('fill', '#b8dfef')
  await page
    .getByRole('button', { name: 'Choose label background', exact: true })
    .click()
  await page
    .getByRole('textbox', { name: 'Picker HEX', exact: true })
    .fill('#9dd8f0')
  await page.getByRole('button', { name: 'Apply', exact: true }).click()
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(canvasBackground).toHaveAttribute('fill', '#b8dfef')
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect(canvasBackground).toHaveAttribute('fill', '#9dd8f0')
  await sides.getByRole('button', { name: 'Front', exact: true }).click()
  await expect(hex).toHaveValue('#ffd08a')
  await sides.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(hex).toHaveValue('#9dd8f0')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.locator('.studio-save-state')).toContainText('Saved')
  const saved = structuredClone(workspace.label_templates[0]) as LabelDocument
  expect(saved.background).toBe('#ffd08a')
  expect(saved.back!.background).toBe('#9dd8f0')
  expect(saved.elements).toEqual(original.elements)
  expect(saved.back!.elements).toEqual(original.back!.elements)
  expect(saved.printSettings).toEqual(original.printSettings)

  // Reload discards all React draft state and reopens the API's saved document.
  await page.reload()
  await page
    .getByRole('button', { name: `Edit ${original.name}`, exact: true })
    .click()
  await expect(hex).toHaveValue('#ffd08a')
  await sides.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(hex).toHaveValue('#9dd8f0')
  await page.screenshot({
    path: 'docs/previews/label-page-background-saved.png',
    fullPage: true,
    animations: 'disabled',
  })
  await page.getByRole('button', { name: 'Duplicate', exact: true }).click()
  await expect(page.getByLabel('Label name', { exact: true })).toHaveValue(
    original.name + ' — Copy',
  )
  await expect(hex).toHaveValue('#ffd08a')
  await sides.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(hex).toHaveValue('#9dd8f0')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.locator('.studio-save-state')).toContainText('Saved')
  const copy = workspace.label_templates.find(
    (d) => d.id !== original.id,
  ) as LabelDocument
  expect(copy.background).toBe(saved.background)
  expect(copy.back).toEqual(saved.back)
  expect(copy.elements).toEqual(saved.elements)
  expect(copy.printSettings).toEqual(saved.printSettings)

  await page.getByRole('button', { name: 'Preview/Print', exact: true }).click()
  const previewBackgrounds = page.locator(
    '.studio-print-preview .label-set-preview svg > g[clip-path] > rect:first-child',
  )
  await expect(previewBackgrounds).toHaveCount(2)
  await expect(previewBackgrounds.nth(0)).toHaveAttribute('fill', '#ffd08a')
  await expect(previewBackgrounds.nth(1)).toHaveAttribute('fill', '#9dd8f0')
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
        () => (window as Window & { printedColors?: string[][] }).printedColors,
      ),
    )
    .toEqual([['#ffd08a', '#9dd8f0']])
  expect(workspace.label_templates.find((d) => d.id === original.id)).toEqual(
    saved,
  )
})
