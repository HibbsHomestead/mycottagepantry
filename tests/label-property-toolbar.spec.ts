import { expect, test, type Page } from '@playwright/test'
import { demoData } from '../src/lib/demo'
import {
  blankLabel,
  newElement,
  validateLabelDocument,
  type LabelDocument,
} from '../src/lib/label-studio'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})

async function canvasMarkup(page: Page) {
  return page.locator('.studio-paper svg').evaluate((svg) => {
    const clone = svg.cloneNode(true) as Element
    // React inserts changed attributes in a different order from a fresh mount.
    for (const element of [clone, ...clone.querySelectorAll('*')]) {
      const attributes = [...element.attributes].sort((a, b) =>
        a.name.localeCompare(b.name),
      )
      for (const attribute of attributes)
        element.removeAttribute(attribute.name)
      for (const attribute of attributes)
        element.setAttribute(attribute.name, attribute.value)
    }
    return clone.outerHTML
  })
}

async function editor(page: Page, mixed = false) {
  await installWorkspaceFixture(page)
  const workspace = demoData()
  const text = {
    ...newElement('text', 'Homestyle White Bread'),
    id: 'toolbar-text',
    x: 15.125,
    y: 24.5,
    width: 170.75,
    height: 45.625,
    opacity: 0.83725,
    groupId: 'product-name',
    condition: 'always' as const,
    ...(mixed
      ? {
          textRuns: [
            { id: 'first-word', text: 'Homestyle ', font: 'Lora' },
            { id: 'second-word', text: 'White Bread', font: 'DM Sans' },
          ],
        }
      : {}),
  }
  const original: LabelDocument = {
    ...blankLabel(),
    id: 'toolbar-design',
    name: 'Compact toolbar label',
    workflowVersion: 1,
    recordKind: 'label',
    revision: 1,
    renderVersion: 2,
    source: { kind: 'product', id: workspace.products[0].id },
    productId: workspace.products[0].id,
    manualTextReviewedFor: `product:${workspace.products[0].id}:`,
    elements: [
      text,
      {
        ...newElement('shape', ''),
        id: 'toolbar-shape',
        x: 15,
        y: 100,
        width: 80,
        height: 35,
      },
    ],
  }
  workspace.label_templates = [structuredClone(original)]
  workspace.label_recovery_drafts = []
  workspace.settings[0].labelEditorScope = 'toolbar-fixture'
  await page.route('**/api/workspace*', async (route) => {
    if (route.request().method() === 'POST') {
      const { action, data } = route.request().postDataJSON()
      if (action === 'labelSave') {
        const document = validateLabelDocument(structuredClone(data.document))
        workspace.label_templates = [
          {
            ...document,
            revision: workspace.label_templates[0].revision + 1,
            lastSaveOperationId: data.operationId,
            savedAt: new Date().toISOString(),
          },
        ]
      } else
        expect([
          'labelDraft',
          'labelColorRecent',
          'labelFontPreferences',
        ]).toContain(action)
    }
    await route.fulfill({ json: { workspace, role: 'Owner', demo: false } })
  })
  await page.goto(workspaceFixtureUrl('Labels'))
  await page
    .getByRole('button', { name: `Edit ${original.name}`, exact: true })
    .click()
  await page.getByRole('button', { name: 'Layers', exact: true }).click()
  await page.getByRole('button', { name: text.text, exact: true }).click()
  return { workspace, original }
}

for (const width of [1762, 1280, 1150, 390]) {
  test(`property controls fit and stay grouped at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 950 })
    await editor(page)
    const inspector = page.locator('.studio-inspector')
    await inspector.scrollIntoViewIfNeeded()
    await expect(
      page.getByRole('group', { name: 'Text formatting', exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('group', { name: 'Position, size & layers', exact: true }),
    ).toBeVisible()
    const issues = await inspector.evaluate((panel) => {
      const boundary = panel.getBoundingClientRect()
      return [
        ...panel.querySelectorAll<HTMLElement>(
          '.studio-property-toolbar, .studio-property-toolbar button, .studio-compact-number, .studio-case-control',
        ),
      ]
        .filter((el) => {
          const rect = el.getBoundingClientRect()
          return (
            rect.left < boundary.left ||
            rect.right > boundary.right ||
            el.scrollWidth > el.clientWidth + 1
          )
        })
        .map((el) => el.getAttribute('aria-label') || el.className)
    })
    expect(issues).toEqual([])
    const fields = await page
      .locator('.studio-geometry-toolbar .studio-numeric-row')
      .evaluateAll((rows) =>
        rows.map((row) => {
          const labels = row.querySelectorAll('label')
          return (
            labels[0].getBoundingClientRect().top ===
            labels[1].getBoundingClientRect().top
          )
        }),
      )
    expect(fields).toEqual([true, true, true])
    const tools = page.locator('.studio-element-fields')
    await tools.screenshot({
      path: `docs/previews/label-compact-tools-${width}.png`,
    })
    // Geometry and typography stay together above the collapsed advanced controls.
    expect(
      await page.locator('.studio-advanced').getAttribute('open'),
    ).toBeNull()
    if (width >= 1150) {
      const fits = await inspector.evaluate((panel) => {
        const bottom = panel
          .querySelector('.studio-geometry-toolbar')!
          .getBoundingClientRect().bottom
        return bottom <= panel.getBoundingClientRect().bottom
      })
      expect(fits).toBe(true)
    }
  })
}

test('formatting, selection, precise geometry, rotation and layers survive save and reload', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 950 })
  const { workspace, original } = await editor(page)
  const overlay = page.locator('[data-selection-overlay="toolbar-text"]')
  const text = page
    .locator('.studio-paper g[data-element="toolbar-text"] text')
    .first()
  await expect(page.getByLabel('Opacity', { exact: true })).toHaveValue(
    '83.725',
  )
  await page.getByRole('button', { name: 'Bold', exact: true }).focus()
  await page.keyboard.press('Space')
  await expect(text).toHaveAttribute('font-weight', '700')
  await page.keyboard.press('ArrowRight')
  await expect(page.getByLabel('X (pt)', { exact: true })).toHaveValue('15.125')
  for (const name of ['Italic', 'Underline', 'Align center', 'Align middle'])
    await page.getByRole('button', { name, exact: true }).click()
  await page.getByLabel('Text case', { exact: true }).selectOption('title')
  for (const [label, value] of [
    ['Size (pt)', '14.375'],
    ['Line height', '1.45'],
    ['Letter spacing (pt)', '-0.125'],
    ['Opacity', '37.125'],
  ])
    await page.getByLabel(label, { exact: true }).fill(value)
  await expect(text).toHaveAttribute('font-style', 'italic')
  await expect(text).toHaveAttribute('text-decoration', 'underline')
  await expect(text).toHaveAttribute('text-anchor', 'middle')
  await expect(text).toHaveAttribute('letter-spacing', '-0.125')
  await expect(overlay).toBeVisible()
  await page.getByRole('button', { name: 'Choose text color' }).click()
  await page
    .getByRole('textbox', { name: 'Picker HEX', exact: true })
    .fill('#476b46')
  await expect(text).toHaveAttribute('fill', '#476b46')
  await page.keyboard.press('Escape')
  await expect(text).toHaveAttribute('fill', original.elements[0].color)
  await page.getByRole('button', { name: 'Choose text color' }).click()
  await page
    .getByRole('textbox', { name: 'Picker HEX', exact: true })
    .fill('#476b46')
  await page.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(overlay).toBeVisible()
  // The angle field/reset use the existing center-pivot geometry and undo stack.
  await page.getByLabel('Rotation (°)', { exact: true }).fill('32.5')
  await expect(page.getByLabel('Rotation (°)', { exact: true })).toHaveValue(
    '32.5',
  )
  await page
    .getByRole('button', { name: 'Reset rotation to 0°', exact: true })
    .click()
  await expect(page.getByLabel('Rotation (°)', { exact: true })).toHaveValue(
    '0',
  )
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(page.getByLabel('Rotation (°)', { exact: true })).toHaveValue(
    '32.5',
  )
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect(page.getByLabel('Rotation (°)', { exact: true })).toHaveValue(
    '0',
  )
  await page.getByLabel('X (pt)', { exact: true }).fill('-12.375')
  await page.getByLabel('Y (pt)', { exact: true }).fill('24.0625')
  await page.getByLabel('Width (pt)', { exact: true }).fill('174.875')
  await page.getByLabel('Height (pt)', { exact: true }).fill('57.25')
  await page
    .getByRole('button', { name: 'Bring to front', exact: true })
    .click()
  await expect(
    page.getByRole('button', { name: 'Bring to front', exact: true }),
  ).toBeDisabled()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.locator('.studio-save-state')).toContainText('Saved')
  const saved = structuredClone(workspace.label_templates[0])
  expect(saved.elements[0]).toEqual(original.elements[1])
  expect(saved.elements[1]).toMatchObject({
    id: 'toolbar-text',
    groupId: 'product-name',
    condition: 'always',
    opacity: 0.37125,
    x: -12.375,
    y: 24.0625,
    width: 174.875,
    height: 57.25,
    fontSize: 14.375,
    lineHeight: 1.45,
    letterSpacing: -0.125,
  })
  expect(saved.width).toBe(original.width)
  expect(saved.height).toBe(original.height)
  const canvas = await canvasMarkup(page)
  await page.reload()
  await page
    .getByRole('button', { name: `Edit ${original.name}`, exact: true })
    .click()
  await page.getByRole('button', { name: 'Layers', exact: true }).click()
  await page
    .getByRole('button', { name: 'Homestyle White Bread', exact: true })
    .click()
  expect(await canvasMarkup(page)).toBe(canvas)
  for (const name of [
    'Bold',
    'Italic',
    'Underline',
    'Align center',
    'Align middle',
  ])
    await expect(
      page.getByRole('button', { name, exact: true }),
    ).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByLabel('Opacity', { exact: true })).toHaveValue(
    '37.125',
  )
  await expect(page.getByLabel('Text case', { exact: true })).toHaveValue(
    'title',
  )
  await page.getByRole('button', { name: 'shape', exact: true }).click()
  for (const name of [
    'Bold',
    'Italic',
    'Underline',
    'Align center',
    'Choose text color',
  ])
    await expect(page.getByRole('button', { name, exact: true })).toBeDisabled()
  await expect(page.getByLabel('Size (pt)', { exact: true })).toBeDisabled()
  await expect(page.getByLabel('X (pt)', { exact: true })).toBeEnabled()
})

test('mixed per-word fonts remain intact when opening and formatting a saved label', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 950 })
  const { workspace, original } = await editor(page, true)
  await expect(
    page.getByRole('button', { name: 'Font: Mixed fonts', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Italic', exact: true }).click()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.locator('.studio-save-state')).toContainText('Saved')
  expect(workspace.label_templates[0].elements[0].textRuns).toEqual(
    original.elements[0].textRuns,
  )
  expect(workspace.label_templates[0].elements[0]).toEqual({
    ...original.elements[0],
    italic: true,
  })
  await expect(
    page.getByRole('button', { name: 'Font: Mixed fonts', exact: true }),
  ).toBeVisible()
  await page.getByText('Advanced', { exact: true }).click()
  await page.getByRole('textbox', { name: 'Text', exact: true }).focus()
  await page.keyboard.press('ControlOrMeta+A')
  const range = page.getByRole('group', {
    name: 'Font for selected text',
    exact: true,
  })
  await expect(
    range.getByRole('button', { name: 'Font: Mixed fonts', exact: true }),
  ).toBeEnabled()
})
