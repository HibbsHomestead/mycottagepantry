import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas'
import { handleAssortmentLabel } from '../netlify/lib/assortment-label-handler'
import { handleProductWorkflow } from '../netlify/lib/product-workflow-handler'
import type { Item } from '../src/lib/domain'
import { mixedPackFixture } from '../src/test/fixtures/mixed-pack'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

test.use({ actionTimeout: 10_000 })

test('mixed pack opens a single editor and explicit help restores focus', async ({
  page,
}, testInfo) => {
  const { workspace } = mixedPackFixture()
  await installWorkspaceFixture(page)
  await page.route('**/api/workspace*', (route) =>
    route.fulfill({ json: { workspace, role: 'Owner', demo: false } }),
  )
  await page.goto(workspaceFixtureUrl('Products/Food'))
  await page
    .getByRole('button', { name: 'Create mixed pack', exact: true })
    .click()
  await page.screenshot({ path: testInfo.outputPath('create-mixed-pack.png') })
  await expect(
    page.locator('[data-slot="dialog-content"] [data-slot="dialog-title"]'),
  ).toHaveText(['Create mixed pack'])
  const dialog = page.getByRole('dialog', { name: 'Create mixed pack' })
  await expect(
    dialog.getByText(
      'Add contents and set a selling price to calculate cost and margin.',
    ),
  ).toBeVisible()
  await dialog.getByLabel('Mixed pack name').fill('Unsaved fixture pack')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  for (const name of ['Help and guides', 'Help & support']) {
    const help = page.getByRole('button', { name, exact: true })
    await help.focus()
    await help.press('Enter')
    await expect(
      page.getByRole('dialog', { name: 'Help & support' }),
    ).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(help).toBeFocused()
  }
  await expect(page).toHaveURL(/#Products\/Food$/)
})

for (const width of [1440, 390]) {
  test(`creates and saves a six-pack on ${width}px, then prints one outer label per pack`, async ({
    page,
    context,
  }, testInfo) => {
    const { workspace, container, outputs, ingredients } = mixedPackFixture()
    const design = {
      ...workspace.label_templates[0],
      id: 'three-by-four',
      name: 'Three by four',
      width: 216,
      height: 288,
      assortmentLayout: {
        minimumFontSize: 10,
        parentFields: ['business.name', 'business.address'],
      },
    }
    workspace.label_templates.push(design)
    ingredients[1].subingredients = 'blueberries, cane sugar'
    ingredients[1].requiresSubingredients = true
    ingredients[2].subingredients = 'cranberries, cane sugar'
    ingredients[2].requiresSubingredients = true
    const openStock = () =>
      JSON.stringify({
        ingredients: workspace.ingredients,
        productStock: workspace.products.map(({ id, quantity, cost }) => ({
          id,
          quantity,
          cost,
        })),
        ledger: workspace.ledger,
      })
    const baseStock = JSON.parse(openStock())
    const writes: string[] = []
    let pauseRefresh = false
    let refreshStarted = false
    let resumeRefresh!: () => void
    let finishRefresh!: () => void
    const refreshGate = new Promise<void>((resolve) => {
      resumeRefresh = resolve
    })
    const refreshFinished = new Promise<void>((resolve) => {
      finishRefresh = resolve
    })
    const save = async (table: string, item: Item) => {
      writes.push(table)
      workspace[table] = [
        ...workspace[table].filter((row) => row.id !== item.id),
        structuredClone(item),
      ]
    }
    await page.setViewportSize({ width, height: 1050 })
    await context.addInitScript(() => {
      window.print = () => {}
    })
    await installWorkspaceFixture(page)
    await page.route('**/api/workspace*', async (route) => {
      if (route.request().method() === 'POST') {
        const { action, table, data } = route.request().postDataJSON()
        try {
          if (action === 'assortmentLabel')
            await handleAssortmentLabel(workspace, data, 'Fixture owner', save)
          else if (
            !(await handleProductWorkflow(action, table, data, {
              state: workspace,
              today: '2026-11-25',
              actor: 'Fixture owner',
              audit: async () => {},
              save,
            }))
          )
            throw new Error(`Unexpected fixture operation: ${action}`)
        } catch (error) {
          return route.fulfill({
            status: 400,
            json: { error: (error as Error).message },
          })
        }
      } else if (pauseRefresh && !refreshStarted) {
        refreshStarted = true
        await refreshGate
        await route.fulfill({
          json: { workspace, role: 'Owner', demo: false },
        })
        finishRefresh()
        return
      }
      return route.fulfill({ json: { workspace, role: 'Owner', demo: false } })
    })
    const name = 'Mixed Muffin 6-Pack · Fixture'
    await page.goto(workspaceFixtureUrl('Products/Food'))
    const create = page.getByRole('button', {
      name: 'Create mixed pack',
      exact: true,
    })
    await expect(create).toBeEnabled()
    pauseRefresh = true
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect.poll(() => refreshStarted).toBe(true)
    await create.click()
    const editor = page.getByRole('dialog', { name: 'Create mixed pack' })
    const nameInput = editor.getByLabel('Mixed pack name')
    await expect.poll(() => editor.evaluate((element) => element.contains(document.activeElement))).toBe(true)
    await nameInput.fill(name)
    outputs[0].sku = 'REFRESH-FIXTURE'
    resumeRefresh()
    await refreshFinished
    const chooseSource = editor.getByLabel(
      'Add source product / recipe variant',
    )
    await expect(
      chooseSource.locator('option', { hasText: 'REFRESH-FIXTURE' }),
    ).toHaveCount(1)
    await expect(nameInput).toBeFocused()
    await expect(nameInput).toHaveValue(name)
    const contentsTab = editor.getByRole('tab', { name: 'Contents & details' })
    const costTab = editor.getByRole('tab', { name: 'Packaging & cost' })
    await chooseSource.press('ArrowDown')
    await expect(
      editor.getByLabel('Unpackaged quantity · Blueberry muffins'),
    ).toBeVisible()
    await chooseSource.selectOption(outputs[1].id)
    for (const flavor of ['Blueberry', 'Cranberry'])
      await editor
        .getByLabel(`Unpackaged quantity · ${flavor} muffins`)
        .fill('3')
    await expect(editor.getByText('6 muffins total')).toBeVisible()
    await contentsTab.press('ArrowRight')
    await expect(costTab).toBeFocused()
    await expect(costTab).toHaveAttribute('aria-selected', 'true')
    await expect(
      editor.getByText('Set a selling price to calculate profit and margin.'),
    ).toBeVisible()
    await editor
      .getByLabel('Add outer packaging or label stock')
      .selectOption(container.id)
    await editor.getByLabel('Assortment label template').selectOption(design.id)
    await editor.getByLabel('Mixed pack selling price').fill('18.50')
    await expect(editor.getByText('Selling price: $18.50')).toBeVisible()
    await contentsTab.click()
    await expect(nameInput).toHaveValue(name)
    await expect(editor.getByText('1 six-count container')).toBeVisible()
    await expect(editor.getByText('6 muffins total')).toBeVisible()
    await costTab.click()
    await expect(editor.getByLabel('Mixed pack selling price')).toHaveValue(
      '18.50',
    )
    await contentsTab.click()
    await expect(page.locator('[data-slot="dialog-content"]')).toHaveCount(1)
    expect(
      await editor.evaluate(
        (element) => element.scrollWidth - element.clientWidth,
      ),
    ).toBeLessThanOrEqual(1)
    await editor.getByText('6 muffins total').scrollIntoViewIfNeeded()
    await editor.screenshot({
      path: testInfo.outputPath(`unobstructed-${width}.png`),
      animations: 'disabled',
    })
    await editor.getByRole('button', { name: 'Save mixed pack' }).click()
    const stored = workspace.products.find((product) => product.name === name)
    expect(stored).toMatchObject({
      assemblyType: 'mixed-pack',
      price: 18.5,
      kitComponents: outputs.map((output) => ({
        productId: output.id,
        quantity: 3,
        basis: 'unpackaged',
      })),
      packagingLines: [{ ingredientId: container.id, quantity: 1 }],
    })
    expect(writes).toEqual(['products'])
    const after = JSON.parse(openStock())
    expect(after.ingredients).toEqual(baseStock.ingredients)
    expect(after.ledger).toEqual(baseStock.ledger)
    expect(
      after.productStock.filter((product: Item) => product.id !== stored!.id),
    ).toEqual(baseStock.productStock)
    expect(stored!.quantity).toBe(0)
    await page
      .getByRole('button', { name: 'Edit mixed pack', exact: true })
      .first()
      .click()
    const reopened = page.getByRole('dialog', { name: `Mixed pack · ${name}` })
    await expect(reopened.getByText('6 muffins total')).toBeVisible()
    await expect(reopened.getByText('1 six-count container')).toBeVisible()
    await expect(page.locator('[data-slot="dialog-content"]')).toHaveCount(1)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name })).toBeVisible()
    if (width === 390) return

    await page.goto(workspaceFixtureUrl('Labels/Assortments'))
    await page.getByLabel('Outer container product').selectOption(stored!.id)
    await expect(page.getByLabel('Assortment name')).toHaveValue(name)
    await expect(page.getByLabel('Product / flavor')).toHaveCount(2)
    await expect(page.getByLabel('Label stock size')).toHaveValue(design.id)
    await page.getByLabel('Outer containers in this packing group').fill('10')
    await expect(
      page.getByLabel('Total label copies for this job'),
    ).toHaveValue('10')
    await page.getByLabel('Output rotation').selectOption('90')
    await expect(
      page.getByText('Physical media (across × feed): 4 × 3 in'),
    ).toBeVisible()
    const buildPreview = page.getByRole('button', {
      name: 'Build actual-size preview',
    })
    const approve = page.getByRole('button', { name: 'Approve label job' })
    const preview = page.frameLocator(
      'iframe[title="Actual-size assortment label"]',
    )
    await buildPreview.click()
    await expect(preview.locator('article')).toHaveCount(1)
    await expect(
      preview.getByText('3 Blueberry muffins · 3 Cranberry muffins'),
    ).toBeVisible()
    const blue = preview
      .locator('section')
      .filter({ hasText: 'Blueberry muffins' })
    const cranberry = preview
      .locator('section')
      .filter({ hasText: 'Cranberry muffins' })
    await expect(blue).toContainText(
      'blueberry fruit (blueberries, cane sugar)',
    )
    await expect(blue).toContainText('CONTAINS: WHEAT')
    await expect(cranberry).toContainText(
      'cranberry fruit (cranberries, cane sugar)',
    )
    await expect(cranberry).toContainText('CONTAINS: WHEAT, MILK')
    await expect(
      preview.getByText('Fixture Bakery', { exact: true }),
    ).toBeVisible()
    await expect(preview.getByText(/Net Wt\.|Best by/)).toHaveCount(0)
    await preview
      .locator('article')
      .screenshot({ path: testInfo.outputPath('studio-rotated-preview.png') })
    await page
      .getByLabel('I reviewed the actual contents', { exact: false })
      .check()
    await approve.click()
    const job = workspace.label_print_jobs!.at(-1)!
    const original = structuredClone(job.assortmentSnapshot)
    await expect(
      page.getByText('10 approved · 0 printed', { exact: false }),
    ).toBeVisible()
    const popupPromise = page.waitForEvent('popup')
    await page.getByRole('button', { name: 'Print approved copies' }).click()
    const popup = await popupPromise
    await expect(popup.locator('article')).toHaveCount(10)
    await popup.emulateMedia({ media: 'print' })
    const pdfBuffer = await popup.pdf({
      path: testInfo.outputPath('ten-outer-labels-4x3.pdf'),
      preferCSSPageSize: true,
    })
    Object.assign(globalThis, { DOMMatrix, ImageData, Path2D })
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const pdfTask = getDocument({
      data: new Uint8Array(pdfBuffer),
      useSystemFonts: true,
    })
    const pdf = await pdfTask.promise
    expect(pdf.numPages).toBe(10)
    for (let index = 1; index <= pdf.numPages; index++) {
      const sheet = await pdf.getPage(index)
      expect(sheet.view).toEqual([0, 0, 288, 216])
      const text = await sheet.getTextContent()
      const content = text.items
        .flatMap((item) =>
          'str' in item ? [item.str + (item.hasEOL ? ' ' : '')] : [],
        )
        .join('')
        .replace(/\s+/g, ' ')
      expect(content).toContain(
        'Ingredients: Muffin flour, blueberry fruit (blueberries, cane sugar)',
      )
      expect(content).toContain(
        'Ingredients: Muffin flour, cranberry fruit (cranberries, cane sugar)',
      )
      expect(content).toContain('CONTAINS: WHEAT, MILK')
      expect(content.match(/CONTAINS: WHEAT/g)).toHaveLength(2)
      expect(content).toContain(
        'Fixture Bakery 100 Example Lane · Fixture address',
      )
      const title = text.items.find(
        (item) => 'str' in item && item.str.startsWith('Mixed Mu'),
      )
      expect(title && 'transform' in title && title.transform[1]).toBeLessThan(
        -12,
      )
      const declarations = text.items.filter((item) => 'str' in item && item.str.startsWith('Ingredients:'))
      expect(declarations).toHaveLength(2)
      for (const declaration of declarations)
        if ('transform' in declaration) expect(Math.abs(declaration.transform[1])).toBeCloseTo(10, 1)
      if (index === 1) {
        const viewport = sheet.getViewport({ scale: 2 })
        const canvas = createCanvas(viewport.width, viewport.height)
        await sheet.render({
          canvas: canvas as unknown as HTMLCanvasElement,
          canvasContext: canvas.getContext(
            '2d',
          ) as unknown as CanvasRenderingContext2D,
          viewport,
        }).promise
        await writeFile(
          testInfo.outputPath('printed-label-page-1.png'),
          canvas.toBuffer('image/png'),
        )
      }
    }
    await pdfTask.destroy()
    await popup.close()
    await page.getByRole('button', { name: 'Confirm printed' }).click()
    await expect(
      page.getByText('10 printed (including reprints)', { exact: false }),
    ).toBeVisible()

    const lemon = workspace.products.find((product) => product.id === 'lemon')!
    const changed = {
      ...outputs[1],
      id: 'actual-extra-flavor',
      name: lemon.name,
      recipeId: lemon.recipeId,
    }
    workspace.products.push(changed)
    workspace.batches.push({
      id: 'actual-packing-run',
      name: 'Actual three-flavor packing',
      status: 'completed',
      productionVersion: 2,
      lines: [
        {
          id: 'actual-output-line',
          productId: stored!.id,
          actualYield: 10,
          definition: {
            product: {
              ...stored,
              kitComponents: [
                { ...stored!.kitComponents[0], quantity: 2 },
                { ...stored!.kitComponents[1], quantity: 2 },
                {
                  productId: changed.id,
                  quantity: 2,
                  basis: 'unpackaged',
                  contentUnit: 'muffin',
                },
              ],
            },
          },
        },
      ],
    })
    ingredients[2].reviewed = false
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(
      page.getByText('Source information changed. Build a fresh preview.'),
    ).toBeVisible()
    await expect(
      page.getByText(/Needs re-review\. This snapshot is retained/),
    ).toBeVisible()
    expect(job.assortmentSnapshot).toEqual(original)
    expect(job.assortmentSnapshot.sections).toHaveLength(2)
    await page
      .getByRole('combobox', { name: 'Run', exact: true })
      .selectOption('actual-packing-run')
    await page.getByLabel('Outer container product').selectOption(stored!.id)
    await expect(page.getByLabel('Product / flavor')).toHaveCount(3)
    await page.getByLabel('Label stock size').selectOption('larger-stock')
    await buildPreview.click()
    await expect(
      preview.getByText(
        '2 Blueberry muffins · 2 Cranberry muffins · 2 Lemon muffins',
      ),
    ).toBeVisible()
    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: /Cranberry muffins:.*verify allergens/ }),
    ).toBeVisible()
    await expect(approve).toBeDisabled()
    ingredients[2].reviewed = true
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(
      page.getByText('Source information changed. Build a fresh preview.'),
    ).toBeVisible()
    await buildPreview.click()
    await page
      .getByLabel('I reviewed the actual contents', { exact: false })
      .check()
    await expect(approve).toBeEnabled()
    await page.getByLabel('Contents type').selectOption('variable')
    await page.getByLabel('Product / flavor').nth(2).selectOption('chocolate')
    await expect(
      page.getByRole('button', { name: 'Approve label job' }),
    ).toHaveCount(0)
    await buildPreview.click()
    await expect(
      preview.getByText(
        '2 Blueberry muffins · 2 Cranberry muffins · 2 Chocolate muffins',
      ),
    ).toBeVisible()
    await expect(
      preview.getByText(/Ingredients: Chocolate blend/),
    ).toBeVisible()
    await expect(approve).toBeDisabled()
    await page.getByLabel('Label stock size').selectOption('small-stock')
    await buildPreview.click()
    await expect(
      page.getByRole('alert').filter({ hasText: 'Content overflows' }),
    ).toBeVisible()
    await page
      .getByLabel('I reviewed the actual contents', { exact: false })
      .check()
    await expect(approve).toBeDisabled()
  })
}
