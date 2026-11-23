import sharp from 'sharp'
import { expect, test } from '@playwright/test'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'
import {
  ingredientStatementFixture,
  statement,
} from '../src/test/fixtures/ingredient-statement'
import {
  resolveLabelData,
  validateLabelDocument,
} from '../src/lib/label-studio'

for (const [width, font] of [
  [1440, 'DM Sans'],
  [390, 'DM Sans'],
  [1440, 'Lora'],
  [1440, 'Oswald'],
] as const) {
  test(`ingredient auto-fit canvas, draft and preview at ${width} with ${font}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 })
    await installWorkspaceFixture(page)
    const { workspace, document, source } = ingredientStatementFixture()
    document.elements[0] = {
      ...document.elements[0],
      font,
      fontSize: 18,
      height: 60,
      autoFit: true,
      minimumFontSize: 5,
    } as (typeof document.elements)[0]
    document.format = 'single' as typeof document.format
    document.back = undefined as unknown as typeof document.back
    workspace.settings[0].labelEditorScope = `autofit-isolated-${width}`
    await page.route('**/api/workspace*', async (route) => {
      if (route.request().method() === 'POST') {
        const { action, data } = route.request().postDataJSON()
        if (action === 'labelSave') {
          const next = validateLabelDocument(structuredClone(data.document))
          const previous = workspace.label_templates.find(
            (d) => d.id === next.id,
          )
          workspace.label_templates = [
            {
              ...next,
              revision: (previous?.revision || 0) + 1,
              lastSaveOperationId: data.operationId,
              savedAt: new Date().toISOString(),
            },
          ]
        } else if (action === 'labelPrint') {
          const design = workspace.label_templates[0]
          workspace.label_print_jobs.push({
            id: 'isolated-auto-fit-print',
            name: design.name,
            documentSnapshot: structuredClone(design),
            renderedDataSnapshot: resolveLabelData(workspace, source),
          })
        } else expect(['labelDraft', 'labelColorRecent']).toContain(action)
      }
      await route.fulfill({ json: { workspace, role: 'Owner', demo: false } })
    })
    await page.addInitScript(() => {
      window.print = () => {
        const parent = window.parent as Window & {
          printedAutoFit?: string | null
        }
        parent.printedAutoFit = window.document.querySelector(
          '.label [data-element="ingredients"] text',
        )?.textContent
        window.dispatchEvent(new Event('afterprint'))
      }
    })
    await page.goto(workspaceFixtureUrl('Labels'))
    const edit = () =>
      page
        .getByRole('button', { name: `Edit ${document.name}`, exact: true })
        .click()
    await edit()
    const canvas = page.locator('.studio-scroll-stage svg')
    const text = canvas.locator('[data-element="ingredients"] text')
    await expect(text).toHaveText(statement)
    const rendered = await text.evaluate(async (node) => {
      await window.document.fonts.ready
      const box = (node as SVGGraphicsElement).getBBox()
      return {
        size: Number(node.getAttribute('font-size')),
        x: box.x,
        y: box.y,
        right: box.x + box.width,
        bottom: box.y + box.height,
      }
    })
    expect(rendered.size).toBeLessThan(18)
    expect(rendered.size).toBeGreaterThanOrEqual(5)
    expect(rendered.x).toBeGreaterThanOrEqual(-1)
    expect(rendered.right).toBeLessThanOrEqual(247)
    expect(rendered.y).toBeGreaterThanOrEqual(-1)
    expect(rendered.bottom).toBeLessThanOrEqual(59)
    if (width === 1440 && font === 'DM Sans') {
      await canvas
        .locator('[data-element="ingredients"]')
        .first()
        .click({ force: true })
      const auto = page.getByRole('checkbox', {
        name: 'Auto-fit text',
        exact: true,
      })
      await expect(auto).toBeChecked()
      await auto.uncheck()
      await expect(text).toHaveAttribute('font-size', '18')
      await auto.check()
      const minimum = page.getByLabel(
        'Minimum text size for this design (pt)',
        { exact: true },
      )
      await minimum.fill('18')
      await expect(canvas.locator('[data-ingredient-overflow]')).toHaveCount(1)
      await expect(
        page
          .getByRole('alert')
          .filter({
            hasText: 'Ingredient list does not fit at the minimum text size.',
          })
          .first(),
      ).toBeVisible()
      await page.getByRole('button', { name: 'Save', exact: true }).click()
      await expect(page.locator('.studio-save-state')).toContainText('Saved')
      await minimum.fill('5')
      await expect(canvas.locator('[data-ingredient-overflow]')).toHaveCount(0)
    }
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.locator('.studio-save-state')).toContainText('Saved')
    await page.reload()
    await edit()
    await expect(text).toHaveText(statement)
    expect(Number(await text.getAttribute('font-size'))).toBe(rendered.size)
    const saved = workspace.label_templates[0].elements[0]
    expect(saved.fontSize).toBe(18)
    expect(saved.autoFit).toBe(true)
    expect(saved.minimumFontSize).toBe(5)
    await page
      .getByRole('button', { name: 'Preview/Print', exact: true })
      .click()
    const preview = page.locator(
      '.studio-print-preview [data-element="ingredients"] text',
    )
    await expect(preview).toHaveText(statement)
    expect(Number(await preview.getAttribute('font-size'))).toBe(rendered.size)
    if (width === 1440 && font === 'DM Sans') {
      const review = page
        .getByRole('checkbox', {
          name: 'I reviewed these warnings and the final label.',
          exact: true,
        })
        .filter({ visible: true })
      if (await review.count()) await review.check()
      await page
        .getByRole('button', { name: 'Print labels', exact: true })
        .click()
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (window as Window & { printedAutoFit?: string }).printedAutoFit,
          ),
        )
        .toBe(statement)
      const pending = page.waitForEvent('download')
      await page
        .getByRole('button', { name: 'Single PNG · 300 DPI', exact: true })
        .click()
      const download = await pending
      const metadata = await sharp((await download.path())!).metadata()
      expect(metadata.width).toBe(1200)
      expect(metadata.height).toBe(900)
    }
    await page.unrouteAll({ behavior: 'ignoreErrors' })
  })
}
