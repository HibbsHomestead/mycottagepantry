import { test, expect } from '@playwright/test'
import { demoData } from '../src/lib/demo'
import {
  blankLabel,
  newElement,
  resolveLabelData,
} from '../src/lib/label-studio'
import { labelLayout, labelSetPlan } from '../src/lib/label-sets'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

for (const width of [1440, 390])
  test(`paired templates render, edit and print correct sets at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 })
    await installWorkspaceFixture(page)
    const w = demoData(),
      p = w.products[0]
    p.labelMainName = 'Banana bread'
    p.netWeightOz = 9.5
    p.graphicAssetId = 'pantry-art-v1:bananas'
    p.labelArtworkVersion = 2
    const front = {
      ...blankLabel(),
      id: 'paired-template',
      recordKind: 'template' as const,
      renderVersion: 2 as const,
      revision: 1,
      name: 'Small loaf · Front + Back',
      width: 216,
      height: 144,
      background: '#fffaf0',
      elements: [
        {
          ...newElement('text', 'HIBBS HOMESTEAD'),
          font: 'DM Sans',
          fontSize: 9,
          bold: true,
          align: 'center' as const,
          x: 12,
          y: 9,
          width: 192,
          height: 14,
        },
        {
          ...newElement('text', '', 'product.displayName'),
          font: 'Lora',
          fontSize: 19,
          bold: true,
          align: 'center' as const,
          x: 10,
          y: 27,
          width: 196,
          height: 30,
        },
        {
          ...newElement('image'),
          binding: 'product.graphic',
          x: 65,
          y: 60,
          width: 86,
          height: 52,
          fit: 'contain' as const,
        },
        {
          ...newElement('text', '', 'product.netQuantity'),
          fontSize: 9,
          align: 'center' as const,
          x: 10,
          y: 122,
          width: 196,
          height: 14,
        },
      ],
    }
    const doc = {
      ...front,
      format: 'front-back' as const,
      back: {
        ...labelLayout(front),
        elements: [
          {
            ...newElement('text', 'INGREDIENTS & DETAILS'),
            fontSize: 10,
            bold: true,
            x: 12,
            y: 10,
            width: 192,
            height: 18,
          },
          {
            ...newElement('text', '', 'recipe.ingredients'),
            fontSize: 8,
            x: 12,
            y: 32,
            width: 192,
            height: 58,
          },
          {
            ...newElement('text', '', 'recipe.allergens'),
            fontSize: 8,
            bold: true,
            x: 12,
            y: 94,
            width: 192,
            height: 14,
          },
          {
            ...newElement('text', 'Made with care at Hibbs Homestead'),
            fontSize: 8,
            x: 12,
            y: 119,
            width: 192,
            height: 14,
          },
        ],
      },
    }
    p.labelDesignId = doc.id
    w.label_templates = [
      doc,
      { ...front, id: 'other-template', name: 'Cookie master' },
    ]
    w.label_recovery_drafts = []
    w.label_print_jobs = []
    w.settings[0].labelEditorScope = 'paired-browser-fixture'
    const writes: string[] = []
    await page.route('**/api/workspace*', async (route) => {
      if (route.request().method() === 'POST') {
        const { action, data } = route.request().postDataJSON()
        writes.push(action)
        if (action === 'labelPrint') {
          const plan = labelSetPlan(doc, data.copies, data.parts, data.order)
          w.label_print_jobs.push({
            id: 'job-' + writes.length,
            name: doc.name,
            documentSnapshot: doc,
            sequence: plan.runs[data.runIndex || 0].sequence,
            renderedDataSnapshot: resolveLabelData(
              w,
              data.source,
              w.brand_kits?.[0],
            ),
          })
        } else if (action === 'labelSave') {
          const old = w.label_templates.find((t) => t.id === data.document.id)
          Object.assign(old!, data.document, {
            revision: (old?.revision || 0) + 1,
            lastSaveOperationId: data.operationId,
            savedAt: new Date().toISOString(),
          })
        } else if (action !== 'labelDraft')
          throw new Error('Unexpected write: ' + action)
      }
      await route.fulfill({
        json: { workspace: w, role: 'Owner', demo: false },
      })
    })
    await page.addInitScript(() => {
      window.print = () => {
        const parent = window.parent as Window & {
          labelRuns?: { count: number; html: string }[]
        }
        parent.labelRuns ||= []
        parent.labelRuns.push({
          count: document.querySelectorAll('.label').length,
          html: document.documentElement.outerHTML,
        })
        window.dispatchEvent(new Event('afterprint'))
      }
    })
    await page.goto(workspaceFixtureUrl('Products/Food'))
    const card = page.getByRole('article', { name: p.name })
    await card
      .getByRole('button', { name: 'View details', exact: true })
      .click()
    const detail = page.getByRole('dialog', { name: p.name, exact: true })
    await expect(detail).toContainText('Label template: ' + doc.name)
    await detail
      .getByRole('button', { name: 'Preview Label', exact: true })
      .click()
    const preview = page.getByRole('dialog', {
      name: `Preview Label · ${p.name}`,
      exact: true,
    })
    await expect(
      preview.getByAltText(`front label for ${p.name}`),
    ).toBeVisible()
    await expect(preview.getByAltText(`back label for ${p.name}`)).toBeVisible()
    await page.screenshot({
      path: `docs/previews/paired-product-preview-${width}.png`,
      animations: 'disabled',
    })
    const review = preview.getByRole('checkbox', { name: /I reviewed/ })
    if (await review.count()) await review.check()
    let n = 0
    for (const [parts, copies, total] of [
      ['both', 1, 2],
      ['both', 12, 24],
      ['front', 12, 12],
      ['back', 12, 12],
    ] as const) {
      await preview.getByLabel('Labels to print').selectOption(parts)
      await preview
        .getByLabel('Number of products', { exact: true })
        .fill(String(copies))
      if (parts === 'both')
        await preview.getByLabel('Print order').selectOption('paired')
      await preview
        .getByRole('button', { name: 'Print Label', exact: true })
        .click()
      n++
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              ((window as Window & { labelRuns?: unknown[] }).labelRuns || [])
                .length,
          ),
        )
        .toBe(n)
      expect(
        await page.evaluate(
          () =>
            (
              window as unknown as Window & { labelRuns: { count: number }[] }
            ).labelRuns.at(-1)!.count,
        ),
      ).toBe(total)
    }
    expect(writes).toEqual(Array(4).fill('labelPrint'))
    expect(w.label_templates).toHaveLength(2)
    // Different stock uses two explicit runs, preserving each side's saved size.
    doc.back.height = 216
    n = 0
    await page.reload()
    await card
      .getByRole('button', { name: 'View details', exact: true })
      .click()
    await detail
      .getByRole('button', { name: 'Preview Label', exact: true })
      .click()
    await expect(preview.getByAltText(`back label for ${p.name}`)).toBeVisible()
    await preview.getByLabel('Number of products', { exact: true }).fill('12')
    await expect(preview.getByLabel('Print order')).toBeDisabled()
    const secondReview = preview.getByRole('checkbox', { name: /I reviewed/ })
    if (await secondReview.count()) await secondReview.check()
    for (const run of [0, 1]) {
      await preview.getByLabel('Print run / stock').selectOption(String(run))
      await preview
        .getByRole('button', { name: 'Print Label', exact: true })
        .click()
      n++
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              ((window as Window & { labelRuns?: unknown[] }).labelRuns || [])
                .length,
          ),
        )
        .toBe(n)
      const printed = await page.evaluate(() =>
        (
          window as unknown as Window & {
            labelRuns: { count: number; html: string }[]
          }
        ).labelRuns.at(-1)!,
      )
      expect(printed.count).toBe(12)
      expect(printed.html).toContain(
        `@page{size:216pt ${run === 0 ? 144 : 216}pt`,
      )
    }
    await preview
      .getByRole('button', { name: 'Close', exact: true })
      .first()
      .click()
    await detail
      .getByRole('button', { name: 'Edit Product', exact: true })
      .click()
    const edit = page.getByRole('dialog', { name: 'Edit Product', exact: true })
    await edit
      .getByRole('tab', { name: 'Images & Labels', exact: true })
      .click()
    await expect(
      edit.getByLabel('Label template', { exact: true }),
    ).toHaveValue(doc.id)
    await edit
      .getByLabel('Label template', { exact: true })
      .scrollIntoViewIfNeeded()
    await page.screenshot({
      path: `docs/previews/paired-product-editor-${width}.png`,
      animations: 'disabled',
    })
    await edit.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.goto(workspaceFixtureUrl('Labels'))
    const studio = page.locator('.label-studio')
    await studio.getByRole('button', { name: 'Templates', exact: true }).click()
    const template = studio.getByRole('article').filter({
      has: page.getByRole('heading', { name: doc.name, exact: true }),
    })
    await template
      .getByRole('button', { name: 'Open template', exact: true })
      .click()
    await expect(studio.getByLabel('Template format')).toHaveValue('front-back')
    await studio
      .getByRole('group', { name: 'Label side' })
      .getByRole('button', { name: 'Back', exact: true })
      .click()
    await expect(studio).toContainText(
      /Saving changes affects their future label/,
    )
    await page.screenshot({
      path: `docs/previews/paired-template-editor-${width}.png`,
      animations: 'disabled',
    })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    const frontBefore = structuredClone(doc.elements)
    const backBefore = doc.back.elements.length
    await studio
      .getByRole('button', { name: 'Static text', exact: true })
      .click()
    await studio
      .getByRole('button', { name: 'Update Template', exact: true })
      .click()
    await expect(studio.locator('.studio-save-state')).toHaveText(/^Saved/)
    expect(doc.elements).toEqual(frontBefore)
    expect(doc.back.elements).toHaveLength(backBefore + 1)
    expect(w.label_templates).toHaveLength(2)
  })
