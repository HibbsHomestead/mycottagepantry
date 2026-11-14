import { expect, test, type Locator } from '@playwright/test'
import { demoData } from '../src/lib/demo'
import type { Item } from '../src/lib/domain'
import { workspaceFonts } from '../src/lib/label-font-catalog'
import fontkit from '@pdf-lib/fontkit'
import { fetchGoogleFontFace } from '../netlify/lib/google-label-font'
import { readFile } from 'node:fs/promises'
import sharp, { type Sharp } from 'sharp'
import {
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  decodePDFRawStream,
} from 'pdf-lib'
import { exportSvgLabelPdf } from '../netlify/lib/label-svg-output'
import {
  blankLabel,
  newElement,
  validateLabelDocument,
  labelFonts,
  resolveLabelData,
  type LabelDocument,
} from '../src/lib/label-studio'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})

/** Endpoint positions after every SVG ancestor and viewport transform. */
async function endpoints(line: Locator) {
  return line.evaluate((node) => {
    const e = node as SVGLineElement,
      matrix = e.getScreenCTM()!
    const start = new DOMPoint(
      e.x1.baseVal.value,
      e.y1.baseVal.value,
    ).matrixTransform(matrix)
    const end = new DOMPoint(
      e.x2.baseVal.value,
      e.y2.baseVal.value,
    ).matrixTransform(matrix)
    return { x1: start.x, y1: start.y, x2: end.x, y2: end.y }
  })
}

test('straightens the same saved divider, with undo, resize, zoom, reload and preview', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installWorkspaceFixture(page)
  const workspace = demoData()
  const capturePath = (file: string) =>
    process.env.CAPTURE_EXISTING_LABEL === '1'
      ? `docs/reviews/divider-and-details/${file}`
      : test.info().outputPath(file)
  const privateFiles = new Map<string, { body: Buffer; contentType: string }>()
  let original: LabelDocument = {
    ...blankLabel(),
    id: 'divider-label',
    name: 'Divider regression label',
    revision: 1,
    workflowVersion: 1,
    recordKind: 'label',
    renderVersion: 2,
    source: { kind: 'product', id: workspace.products[0].id },
    productId: workspace.products[0].id,
    manualTextReviewedFor: `product:${workspace.products[0].id}:`,
    elements: [
      { ...newElement('text', 'Existing heading'), x: 18, y: 80 },
      {
        ...newElement('line'),
        id: 'existing-divider',
        x: 18,
        y: 171,
        width: 180,
        height: 2,
        rotation: 0,
      },
      { ...newElement('text', 'Existing footer'), x: 18, y: 200 },
    ],
  }
  if (process.env.CAPTURE_EXISTING_LABEL === '1') {
    // Explicit opt-in: read only the requested existing design and its display
    // dependencies, within the owning workspace's RLS context. Keep data in memory.
    const { getDatabase } = await import('@netlify/database')
    const db = getDatabase(),
      client = await db.pool.connect()
    try {
      await client.query('BEGIN READ ONLY')
      const businesses = await client.query(
        "select id from businesses where business_name ilike '%Hibbs%'",
      )
      let found = false
      for (const business of businesses.rows) {
        await client.query("select set_config('app.business_id',$1,true)", [
          business.id,
        ])
        const labels = await client.query(
          "select data from label_templates where data->>'name' ilike '%Hearthside%Winter%Simmer%'",
        )
        if (!labels.rows.length) continue
        expect(labels.rows).toHaveLength(1)
        original = labels.rows[0].data
        expect(original.elements.filter((e) => e.type === 'line')).toHaveLength(
          1,
        )
        const product = await client.query(
          'select data from products where id=$1',
          [original.productId || original.source?.id],
        )
        expect(product.rows).toHaveLength(1)
        workspace.products = product.rows.map((r: { data: Item }) => r.data)
        workspace.font_assets = (
          await client.query(
            "select data from font_assets where data->>'name'=any($1::text[])",
            [original.elements.map((e) => e.font)],
          )
        ).rows.map((r: { data: Item }) => r.data)
        workspace.brand_kits = (
          await client.query('select data from brand_kits where id=$1', [
            original.brandId || '',
          ])
        ).rows.map((r: { data: Item }) => r.data)
        const settings =
          (await client.query('select data from settings limit 1')).rows[0]
            ?.data || {}
        for (const key of [
          'name',
          'address',
          'website',
          'phone',
          'email',
          'disclaimer',
          'cottageFoodDisclaimer',
          'logoAssetId',
        ])
          if (settings[key] !== undefined)
            workspace.settings[0][key] = settings[key]
        const ids = new Set(
          original.elements.map((e) => e.assetId).filter(Boolean),
        )
        for (const key of ['imageAssetId', 'graphicAssetId', 'iconAssetId'])
          if (workspace.products[0][key]) ids.add(workspace.products[0][key])
        if (settings.logoAssetId) ids.add(settings.logoAssetId)
        for (const brand of workspace.brand_kits)
          for (const key of [
            'primaryLogoAssetId',
            'secondaryLogoAssetId',
            'markAssetId',
          ])
            if (brand[key]) ids.add(brand[key])
        workspace.graphic_assets = (
          await client.query(
            'select data from graphic_assets where id=any($1::text[])',
            [[...ids]],
          )
        ).rows.map((r: { data: Item }) => r.data)
        const { getStore } = await import('@netlify/blobs')
        const store = (name: string) =>
          getStore({
            name,
            siteID: process.env.NETLIFY_SITE_ID!,
            token: process.env.NETLIFY_AUTH_TOKEN!,
          })
        for (const asset of workspace.graphic_assets) {
          if (!asset.fileUrl.startsWith('/api/workspace?asset=')) continue
          const bytes = await store('label-graphics').get(
            `${business.id}/${asset.id}`,
            { type: 'arrayBuffer' },
          )
          expect(
            bytes,
            'The existing graphic must load without a substitute',
          ).not.toBeNull()
          privateFiles.set(`asset:${asset.id}`, {
            body: Buffer.from(bytes!),
            contentType: asset.fileType,
          })
        }
        for (const asset of workspace.font_assets) {
          const bytes = await store('label-fonts-private').get(
            `${business.id}/${asset.id}`,
            { type: 'arrayBuffer' },
          )
          expect(
            bytes,
            'The existing font must load without a substitute',
          ).not.toBeNull()
          privateFiles.set(`font:${asset.id}`, {
            body: Buffer.from(bytes!),
            contentType: 'font/ttf',
          })
        }
        for (const name of new Set(
          original.elements.filter((e) => e.type === 'text').map((e) => e.font),
        )) {
          const font = labelFonts.find((f) => f.name === name)
          if (font?.source !== 'google') continue
          for (const key of [
            font.file,
            ...(font.weights.includes(700) ? [font.file + '-bold'] : []),
          ]) {
            const bytes =
              (await store('google-label-fonts').get(`v1/${key}`, {
                type: 'arrayBuffer',
              })) || (await fetchGoogleFontFace(key))
            privateFiles.set(`google:${key}`, {
              body: Buffer.from(bytes),
              contentType: 'font/ttf',
            })
          }
        }
        found = true
        break
      }
      expect(
        found,
        'The requested saved label must exist; never substitute a recreated divider',
      ).toBe(true)
    } finally {
      await client.query('ROLLBACK')
      client.release()
      await db.pool.end()
    }
  }
  workspace.label_templates = [structuredClone(original)]
  workspace.label_recovery_drafts = []
  workspace.settings[0].labelEditorScope = 'divider-regression'
  const divider = original.elements.find((e) => e.type === 'line')!
  const initialOrder = original.elements.map((e) => e.id)
  let saves = 0
  workspace.label_print_jobs = []
  await page.route('**/api/workspace*', async (route) => {
    const url = new URL(route.request().url())
    const key = url.searchParams.has('asset')
      ? `asset:${url.searchParams.get('asset')}`
      : `font:${url.searchParams.get('font')}`
    const file = privateFiles.get(key)
    if (file) {
      if (url.searchParams.get('metrics') === '1') {
        const face = fontkit.create(file.body)
        return route.fulfill({
          json: Object.fromEntries(
            face.characterSet.map((code: number) => [
              code,
              face.glyphForCodePoint(code).advanceWidth / face.unitsPerEm,
            ]),
          ),
        })
      }
      return route.fulfill(file)
    }
    if (url.searchParams.has('labelPdf')) {
      const data = route.request().postDataJSON()
      const document = workspace.label_templates[0] as LabelDocument
      const pdf = await exportSvgLabelPdf(
        [document],
        resolveLabelData(
          workspace,
          data.source,
          workspace.brand_kits?.find((b) => b.id === data.brandId),
        ),
        workspace.graphic_assets,
        data.layout,
        {
          fonts: workspaceFonts(workspace.font_assets),
          font: async (key) => {
            if (key.startsWith('custom-'))
              return privateFiles.get(`font:${key.slice(7)}`)!.body
            if (key.startsWith('google-'))
              return privateFiles.get(`google:${key}`)!.body
            return readFile(`public/label-fonts/${key}.ttf`)
          },
          image: async (asset) => privateFiles.get(`asset:${asset.id}`)!.body,
        },
      )
      return route.fulfill({
        body: Buffer.from(pdf),
        contentType: 'application/pdf',
      })
    }
    if (route.request().method() === 'POST') {
      const { action, data } = route.request().postDataJSON()
      if (action === 'labelSave') {
        saves++
        workspace.label_templates = [
          {
            ...validateLabelDocument(
              structuredClone(data.document),
              workspaceFonts(workspace.font_assets),
            ),
            revision: (workspace.label_templates[0].revision || 0) + 1,
            lastSaveOperationId: data.operationId,
            savedAt: new Date().toISOString(),
          },
        ]
      } else if (action === 'labelPrint') {
        workspace.label_print_jobs.push({
          id: 'divider-output',
          name: original.name,
          documentSnapshot: workspace.label_templates[0],
          renderedDataSnapshot: resolveLabelData(
            workspace,
            data.source,
            workspace.brand_kits?.find((b) => b.id === data.brandId),
          ),
        })
      } else
        expect([
          'labelDraft',
          'labelColorRecent',
          'labelFontPreferences',
          'labelPrint',
        ]).toContain(action)
    }
    await route.fulfill({ json: { workspace, role: 'Owner', demo: false } })
  })
  await page.addInitScript(() => {
    window.print = () => {
      const line = document.querySelector<SVGLineElement>(
        'svg g[data-element] > line',
      )!
      const matrix = line.getScreenCTM()!
      const start = new DOMPoint(
        line.x1.baseVal.value,
        line.y1.baseVal.value,
      ).matrixTransform(matrix)
      const end = new DOMPoint(
        line.x2.baseVal.value,
        line.y2.baseVal.value,
      ).matrixTransform(matrix)
      ;(
        window.parent as Window & {
          dividerPrinted?: { y1: number; y2: number }
        }
      ).dividerPrinted = { y1: start.y, y2: end.y }
      window.dispatchEvent(new Event('afterprint'))
    }
  })
  await page.route('**/.netlify/functions/google-label-font?*', (route) => {
    const url = new URL(route.request().url())
    const file = privateFiles.get(`google:${url.searchParams.get('font')}`)
    if (file && url.searchParams.get('metrics') === '1') {
      const face = fontkit.create(file.body)
      return route.fulfill({
        json: Object.fromEntries(
          face.characterSet.map((code: number) => [
            code,
            face.glyphForCodePoint(code).advanceWidth / face.unitsPerEm,
          ]),
        ),
      })
    }
    return file ? route.fulfill(file) : route.fallback()
  })
  const openEditor = async () => {
    await page.goto(workspaceFixtureUrl('Labels'))
    await page.reload()
    await page
      .getByRole('button', { name: `Edit ${original.name}`, exact: true })
      .click()
    await page.getByRole('button', { name: 'Layers', exact: true }).click()
    // Click the actual line using its existing ID, retaining the full saved design.
    await page
      .locator(`.studio-paper g[data-element="${divider.id}"] > line`)
      .click({ force: true })
    await page.evaluate(() => document.fonts.ready)
  }
  await openEditor()
  const line = page.locator(
    `.studio-paper g[data-element="${divider.id}"] > line`,
  )
  const before = await endpoints(line)
  expect(before.y2).toBeGreaterThan(before.y1)
  await expect(page.getByLabel('Line angle (°)', { exact: true })).toHaveValue(
    String((Math.atan2(divider.height, divider.width) * 180) / Math.PI),
  )
  await page.screenshot({
    path: capturePath('divider-before.png'),
    animations: 'disabled',
  })
  await page
    .getByRole('button', { name: 'Make horizontal', exact: true })
    .click()
  const after = await endpoints(line)
  expect(after.y2).toBeCloseTo(after.y1, 5)
  expect((after.x1 + after.x2) / 2).toBeCloseTo((before.x1 + before.x2) / 2, 5)
  expect((after.y1 + after.y2) / 2).toBeCloseTo((before.y1 + before.y2) / 2, 5)
  expect(Math.hypot(after.x2 - after.x1, after.y2 - after.y1)).toBeCloseTo(
    Math.hypot(before.x2 - before.x1, before.y2 - before.y1),
    5,
  )
  await expect(page.getByLabel('Line angle (°)', { exact: true })).toHaveValue(
    '0',
  )
  await page.screenshot({
    path: capturePath('divider-after.png'),
    animations: 'disabled',
  })
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  const undone = await endpoints(line)
  expect(undone.y2 - undone.y1).toBeCloseTo(before.y2 - before.y1, 5)
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  const redone = await endpoints(line)
  expect(redone.y2).toBeCloseTo(redone.y1, 5)
  // Resize retains the raw rotation, but the displayed line angle now follows
  // the changed endpoints instead of continuing to claim it is horizontal.
  await page.getByLabel('Height (pt)', { exact: true }).fill('20')
  expect(
    Number(
      await page.getByLabel('Line angle (°)', { exact: true }).inputValue(),
    ),
  ).toBeGreaterThan(1)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(page.getByLabel('Line angle (°)', { exact: true })).toHaveValue(
    '0',
  )
  // Real endpoint-handle resizing also updates the visible angle; one undo
  // restores the horizontal divider with the original center and length.
  await line.scrollIntoViewIfNeeded()
  const handle = await page
    .locator(`[data-selection-overlay="${divider.id}"] [data-handle="se"]`)
    .boundingBox()
  expect(handle).not.toBeNull()
  await page.mouse.move(
    handle!.x + handle!.width / 2,
    handle!.y + handle!.height / 2,
  )
  await page.mouse.down()
  await page.mouse.move(
    handle!.x + handle!.width / 2 + 12,
    handle!.y + handle!.height / 2 + 30,
    { steps: 3 },
  )
  await page.mouse.up()
  expect(
    Math.abs(
      Number(
        await page.getByLabel('Line angle (°)', { exact: true }).inputValue(),
      ),
    ),
  ).toBeGreaterThan(1)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(page.getByLabel('Line angle (°)', { exact: true })).toHaveValue(
    '0',
  )
  for (const zoom of [0.5, 1, 2]) {
    const box = page.locator('.studio-paper')
    // Exercise the actual zoom buttons (50%, 100%, 200%).
    while (
      Number(
        (await page.locator('.studio-canvas-tools').innerText()).match(
          /(\d+)%/,
        )?.[1] || 100,
      ) !==
      zoom * 100
    ) {
      const current = Number(
        (await page.locator('.studio-canvas-tools').innerText()).match(
          /(\d+)%/,
        )?.[1] || 100,
      )
      await page
        .getByRole('button', {
          name: current < zoom * 100 ? 'Zoom in' : 'Zoom out',
          exact: true,
        })
        .click()
    }
    await expect(box).toBeVisible()
    const points = await endpoints(line)
    expect(points.y1).toBeCloseTo(points.y2, 5)
  }
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect.poll(() => saves).toBe(1)
  const saved = structuredClone(workspace.label_templates[0]) as LabelDocument
  expect(saved.elements.map((e) => e.id)).toEqual(initialOrder)
  for (const e of saved.elements) {
    const prior = original.elements.find((p) => p.id === e.id)!
    if (e.id !== divider.id) expect(e).toEqual(prior)
    else expect(e).toEqual({ ...prior, x: e.x, y: e.y, rotation: e.rotation })
  }
  await openEditor()
  const reopened = await endpoints(line)
  expect(reopened.y1).toBeCloseTo(reopened.y2, 5)
  await page.getByRole('button', { name: 'Preview/Print', exact: true }).click()
  const preview = page
    .locator(`svg g[data-element="${divider.id}"] > line`)
    .first()
  const printed = await endpoints(preview)
  expect(printed.y1).toBeCloseTo(printed.y2, 5)
  await page.screenshot({
    path: capturePath('divider-preview.png'),
    animations: 'disabled',
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
        () => (window as Window & { dividerPrinted?: unknown }).dividerPrinted,
      ),
    )
    .toBeTruthy()
  const printedEndpoints = await page.evaluate(
    () =>
      (window as Window & { dividerPrinted?: { y1: number; y2: number } })
        .dividerPrinted!,
  )
  expect(printedEndpoints.y1).toBeCloseTo(printedEndpoints.y2, 5)
  const downloadPng = page.waitForEvent('download')
  await page
    .getByRole('button', { name: 'Single PNG · 300 DPI', exact: true })
    .click()
  const png = await downloadPng
  const pngPath = capturePath('divider-export.png')
  await png.saveAs(pngPath)
  const downloadPdf = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download PDF', exact: true }).click()
  const pdf = await downloadPdf
  const pdfPath = capturePath('divider-export.pdf')
  await pdf.saveAs(pdfPath)
  // Check the visible stroke at distant X positions in both real output files.
  const flatStroke = async (input: Sharp) => {
    const { data, info } = await input
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    const scale = info.width / original.width
    const lineY = (divider.y + divider.height / 2) * scale
    const centers = [0.2, 0.8].map((fraction) => {
      const x = Math.round((divider.x + divider.width * fraction) * scale)
      let sum = 0,
        weight = 0
      for (let y = Math.floor(lineY - 6); y <= Math.ceil(lineY + 6); y++) {
        const offset = (y * info.width + x) * info.channels
        const dark = 765 - data[offset] - data[offset + 1] - data[offset + 2]
        sum += y * dark
        weight += dark
      }
      expect(weight).toBeGreaterThan(100)
      return sum / weight
    })
    expect(Math.abs(centers[0] - centers[1])).toBeLessThan(0.03)
  }
  await flatStroke(sharp(pngPath))
  const pdfDoc = await PDFDocument.load(await readFile(pdfPath))
  const xObjects = pdfDoc
    .getPage(0)
    .node.Resources()!
    .lookup(PDFName.of('XObject'), PDFDict)
  const raster = xObjects.lookup(xObjects.keys()[0])
  expect(raster).toBeInstanceOf(PDFRawStream)
  const stream = raster as PDFRawStream
  await flatStroke(
    sharp(Buffer.from(decodePDFRawStream(stream).decode()), {
      raw: {
        width: Number(stream.dict.get(PDFName.of('Width'))!.toString()),
        height: Number(stream.dict.get(PDFName.of('Height'))!.toString()),
        channels: 3,
      },
    }),
  )
})
