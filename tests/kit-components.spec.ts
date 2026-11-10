import { test, expect, type Page, type Locator } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { demoData } from '../src/lib/demo'
import {
  money,
  productCosting,
  packagingLines,
  effectiveRecipeLines,
  type Item,
} from '../src/lib/domain'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

const output = 'docs/reviews/kit-components'
const before = process.env.KIT_REFINEMENT_CAPTURE === 'before'
const phase = before ? 'before' : 'after'
const names = [
  'Homestyle White Bread',
  'Classic Chocolate Chip Cookies – 3ct',
  'Pumpkin Bread w/Streusel & Glaze',
]
const quantities = [1, 2, 1]
async function setup(page: Page, issue?: 'cost' | 'basis' | 'sources') {
  await mkdir(output, { recursive: true })
  await installWorkspaceFixture(page)
  const workspace = demoData()
  workspace.products.forEach((product, index) =>
    Object.assign(product, {
      name: names[index],
      sellingUnit: index === 1 ? '3ct bag' : 'loaf',
      contentUnit: index === 1 ? 'cookies' : 'loaves',
      unitsPerPackage: index === 1 ? 3 : 1,
    }),
  )
  workspace.graphic_assets = [
    {
      id: 'unchanged-photo',
      name: 'Existing artwork used by test fixture',
      fileUrl: '/artwork/cinnamon-roll.png',
    },
  ]
  const kit: Item = {
    id: 'pass-the-bread',
    name: 'Pass the Bread',
    workflow: 'kit',
    status: 'active',
    price: 36.75,
    imageAssetId: 'unchanged-photo',
    assemblyMinutes: 6,
    assemblyRate: 18,
    kitComponents: workspace.products.map((p, index) => ({
      productId: p.id,
      quantity: quantities[index],
      basis: 'package',
    })),
    packagingLines: [{ ingredientId: 'bags', quantity: 1, unit: 'each' }],
  }
  if (issue === 'cost') workspace.products[0].needsCostSetup = true
  if (issue === 'basis') kit.kitComponents[0].basis = 'content'
  if (issue === 'sources') workspace.products[0].recipeId = 'unavailable-recipe'
  workspace.products.push(kit)
  const original = JSON.stringify(workspace)
  const writes: Item[] = []
  await page.route('**/api/workspace*', (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON()
      expect(body.action).toBe('save')
      expect(body.table).toBe('products')
      expect(body.data.id).toBe(kit.id)
      writes.push(body)
      workspace.products[workspace.products.findIndex((p) => p.id === kit.id)] =
        body.data
    }
    return route.fulfill({ json: { workspace, role: 'Owner', demo: false } })
  })
  await page.goto(workspaceFixtureUrl('Products/Kits'), {
    waitUntil: 'networkidle',
  })
  return { workspace, kit, writes, original }
}
async function settle(dialog: Locator) {
  await dialog.evaluate((el) =>
    Promise.all(
      el
        .getAnimations({ subtree: true })
        .map((a) => a.finished.catch(() => {})),
    ),
  )
}
async function geometry(dialog: Locator) {
  await settle(dialog)
  return dialog.evaluate((el) => {
    const panel = el.getBoundingClientRect()
    const shape = (selector: string) => {
      const node = el.querySelector(selector)!,
        rect = node.getBoundingClientRect(),
        css = getComputedStyle(node)
      return {
        x: rect.x - panel.x,
        y: rect.y - panel.y,
        width: rect.width,
        height: rect.height,
        font: css.font,
        padding: css.padding,
        background: css.backgroundColor,
        radius: css.borderRadius,
      }
    }
    return {
      width: panel.width,
      height: panel.height,
      columns: getComputedStyle(el.querySelector('.product-detail-layout')!)
        .gridTemplateColumns,
      title: shape('[data-slot="dialog-title"]'),
      photo: shape('.product-detail-photo'),
      cards: [...el.querySelectorAll('.cost-card')].map((node) => ({
        text: node.textContent,
        css: getComputedStyle(node).cssText,
        background: getComputedStyle(node).backgroundColor,
      })),
      firstCard: shape('.cost-card'),
      image: el.querySelector('img')?.getAttribute('src'),
    }
  })
}
for (const width of [1440, 768, 390]) {
  test(`Pass the Bread matching screenshots and compact components at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 950 })
    const { workspace, kit, writes, original } = await setup(page)
    const productCard = page.getByRole('article', {
      name: kit.name,
      exact: true,
    })
    await expect(productCard).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    await productCard.screenshot({
      path: `${output}/${phase}-card-${width}.png`,
      animations: 'disabled',
    })
    if (!before) {
      await expect(
        productCard.locator('p').filter({ hasText: /^kit$/ }),
      ).toHaveCount(0)
      await expect(productCard.locator('ul')).toContainText(`${names[1]} ×2`)
      const rowHeights = await productCard
        .locator('.kit-component-list li')
        .evaluateAll((nodes) =>
          nodes.map((n) => n.getBoundingClientRect().height),
        )
      expect(Math.max(...rowHeights)).toBeLessThan(50)
    }
    await productCard
      .getByRole('button', { name: kit.name, exact: true })
      .click()
    const dialog = page.getByRole('dialog')
    const measured = await geometry(dialog)
    await page.screenshot({
      path: `${output}/${phase}-details-${width}.png`,
      animations: 'disabled',
    })
    if (before)
      await writeFile(
        `${output}/before-geometry-${width}.json`,
        JSON.stringify(measured, null, 2),
      )
    else {
      const reference = JSON.parse(
        await readFile(`${output}/before-geometry-${width}.json`, 'utf8'),
      )
      // The shorter list naturally moves mobile cost cards up;
      // photo, columns, type and card styling stay identical.
      expect({
        ...measured,
        firstCard: { ...measured.firstCard, y: reference.firstCard.y },
      }).toEqual(reference)
      if (width >= 640) expect(measured.firstCard.y).toBe(reference.firstCard.y)
      await writeFile(
        `${output}/after-geometry-${width}.json`,
        JSON.stringify(measured, null, 2),
      )
      const list = dialog.getByRole('region', {
        name: 'Included products',
        exact: true,
      })
      await expect(list.getByRole('listitem')).toHaveCount(3)
      for (let i = 0; i < names.length; i++) {
        await expect(
          list.getByRole('button', {
            name: `${names[i]} ×${quantities[i]}`,
            exact: true,
          }),
        ).toBeVisible()
      }
      await expect(list).not.toContainText(/package|per loaf|per cookie/)
    }
    await dialog.getByRole('button', { name: 'Edit kit', exact: true }).click()
    await expect(
      dialog.getByRole('tab', { name: 'Contents & details' }),
    ).toBeVisible()
    const first = before
      ? dialog.locator('section.calculation-box').first()
      : dialog.locator('.kit-editor-component').first()
    await first.evaluate((el) => {
      const body = el.closest('.product-editor-body')!
      body.scrollTop +=
        el.getBoundingClientRect().top - body.getBoundingClientRect().top - 16
    })
    await settle(dialog)
    await page.screenshot({
      path: `${output}/${phase}-editor-${width}.png`,
      animations: 'disabled',
    })
    const firstDisclosure = first.locator('summary')
    await firstDisclosure.click()
    await page.screenshot({
      path: `${output}/${phase}-expanded-${width}.png`,
      animations: 'disabled',
    })
    if (before) return
    const rows = dialog.locator('.kit-editor-component')
    await expect(rows).toHaveCount(3)
    await expect(rows.locator('details details')).toHaveCount(0)
    await expect(rows.nth(0).locator('details')).toHaveAttribute('open', '')
    await expect(rows.nth(1).locator('details')).not.toHaveAttribute('open', '')
    await expect(rows.nth(0)).toContainText('Supplier statement:')
    await expect(rows.nth(0)).toContainText('Declared allergens:')
    await expect(rows.nth(0)).toContainText('Bread bags')
    await expect(rows.nth(0)).toContainText('production labor, overhead')
    await expect(rows.nth(0)).toContainText('not a verified kit label')
    await expect(rows.nth(0)).toContainText('per package')
    for (let i = 0; i < 3; i++) {
      const row = rows.nth(i)
      if (i > 0) await row.locator('summary').click()
      const component = workspace.products[i]
      for (const line of packagingLines(component)) {
        const packaging = workspace.ingredients.find(
          (p) => p.id === line.ingredientId,
        )!
        await expect(row.locator('.kit-component-explanation')).toContainText(
          `${line.quantity} ${line.unit || 'each'} ${packaging.name}`,
        )
      }
      const recipe = workspace.recipes.find((r) => r.id === component.recipeId)!
      for (const line of effectiveRecipeLines(recipe, workspace.recipes)) {
        const ingredient = workspace.ingredients.find(
          (p) => p.id === line.ingredientId,
        )!
        await expect(row.locator('.kit-component-explanation')).toContainText(
          ingredient.name,
        )
        await expect(row.locator('.kit-component-explanation')).toContainText(
          ingredient.subingredients || 'Missing',
        )
        for (const allergen of ingredient.allergens || [])
          await expect(row.locator('.kit-component-explanation')).toContainText(
            allergen,
          )
      }
      if (i > 0) await row.locator('summary').click()
    }
    await rows.nth(0).getByRole('spinbutton').fill('3')
    const draft = {
      ...kit,
      kitComponents: [
        { ...kit.kitComponents[0], quantity: 3 },
        ...kit.kitComponents.slice(1),
      ],
    }
    const extended = productCosting(
      {
        ...draft,
        kitComponents: [draft.kitComponents[0]],
        packagingLines: [],
        assemblyMinutes: 0,
      },
      workspace,
    ).perPackage
    await expect(rows.nth(0).locator('output')).toContainText(money(extended))
    await rows
      .nth(1)
      .getByText('Display component details', { exact: true })
      .click()
    await expect(rows.nth(0).locator('details')).toHaveAttribute('open', '')
    await expect(rows.nth(1).locator('details')).toHaveAttribute('open', '')
    await firstDisclosure.click()
    await expect(rows.nth(0).getByRole('spinbutton')).toHaveValue('3')
    await expect(
      rows
        .nth(0)
        .getByRole('button', { name: `Remove ${names[0]}`, exact: true }),
    ).toBeVisible()
    await dialog.getByRole('tab', { name: 'Packaging & cost' }).click()
    await dialog.getByRole('tab', { name: 'Photo', exact: true }).click()
    await dialog.getByRole('tab', { name: 'Contents & details' }).click()
    await expect(rows.nth(0).getByRole('spinbutton')).toHaveValue('3')
    await expect(rows.nth(1).locator('details')).toHaveAttribute('open', '')
    await expect(rows.nth(0).locator('details')).not.toHaveAttribute('open', '')
    expect(writes).toHaveLength(0)
    expect(JSON.stringify(workspace)).toBe(original)
    for (const row of await rows.all()) {
      await row.getByRole('spinbutton').scrollIntoViewIfNeeded()
      await expect(row.getByRole('spinbutton')).toBeInViewport()
    }
    const overflow = await dialog.evaluate((panel) => ({
      x: panel.scrollWidth - panel.clientWidth,
      nested: [
        ...panel.querySelectorAll(
          '.kit-editor-component, .kit-editor-component *',
        ),
      ]
        .filter(
          (el) =>
            /(auto|scroll|hidden|clip)/.test(getComputedStyle(el).overflowY) &&
            el.scrollHeight > el.clientHeight + 1,
        )
        .map((el) => el.className),
    }))
    expect(overflow).toEqual({ x: 0, nested: [] })
    await rows
      .nth(2)
      .getByRole('button', { name: `Remove ${names[2]}`, exact: true })
      .click()
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(0).getByRole('spinbutton')).toHaveValue('3')
    await page.getByRole('button', { name: 'Save kit', exact: true }).click()
    await expect(
      dialog.getByRole('heading', { name: kit.name, exact: true }),
    ).toBeVisible()
    await expect(
      dialog.getByRole('region', { name: 'Included products' }),
    ).toContainText(`${names[0]} ×3`)
    await expect(
      dialog
        .getByRole('region', { name: 'Included products' })
        .getByRole('listitem'),
    ).toHaveCount(2)
    await dialog.getByRole('button', { name: 'Edit kit', exact: true }).click()
    await expect(
      dialog.locator('.kit-editor-component').first().getByRole('spinbutton'),
    ).toHaveValue('3')
    await expect(dialog.locator('.kit-editor-component')).toHaveCount(2)
    expect(writes).toHaveLength(1)
    const saved = workspace.products.find((p) => p.id === kit.id)!
    expect(saved.kitComponents.map((line: Item) => line.basis)).toEqual([
      'package',
      'package',
    ])
    expect(saved.packagingLines).toEqual(kit.packagingLines)
    expect(saved.imageAssetId).toBe(kit.imageAssetId)
    expect(
      JSON.stringify({
        ...workspace,
        products: workspace.products.map((p) => (p.id === kit.id ? kit : p)),
      }),
    ).toBe(original)
  })
}

for (const issue of ['cost', 'basis', 'sources'] as const) {
  test(`collapsed row preserves actionable ${issue} warnings`, async ({
    page,
  }) => {
    test.skip(before, 'Before screenshots only')
    await page.setViewportSize({ width: 390, height: 950 })
    const { kit, writes } = await setup(page, issue)
    await page
      .getByRole('article', { name: kit.name })
      .getByRole('button', { name: 'Edit kit', exact: true })
      .click()
    const first = page
      .getByRole('dialog')
      .locator('.kit-editor-component')
      .first()
    await expect(first.locator('details')).not.toHaveAttribute('open', '')
    await expect(first.locator('[role="status"]')).toBeVisible()
    await expect(first.locator('output')).toHaveText('Cost unavailable')
    await first.getByText('Display component details', { exact: true }).click()
    await expect(first.locator('.kit-component-details')).toContainText(
      /incomplete|unavailable|Individual contents/,
    )
    expect(writes).toHaveLength(0)
  })
}

for (const width of [768, 390]) {
  test(`long names and expanded source information wrap at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 950 })
    const { workspace, kit, writes } = await setup(page)
    const longName =
      'Pumpkin Bread w/Streusel & Glaze with a very long seasonal product description and SpecialOrderWithoutSpacesForWrapping'
    workspace.products[2].name = longName
    await page.reload({ waitUntil: 'networkidle' })
    const card = page.getByRole('article', { name: kit.name, exact: true })
    const link = card.getByRole('button', {
      name: `${longName} ×1`,
      exact: true,
    })
    await expect(link).toBeVisible()
    await card.getByRole('button', { name: kit.name, exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(
      dialog.getByRole('button', { name: `${longName} ×1`, exact: true }),
    ).toBeVisible()
    await dialog.getByRole('button', { name: 'Edit kit', exact: true }).click()
    const row = dialog.locator('.kit-editor-component').nth(2)
    await row.locator('summary').click()
    await row
      .getByText(/Ingredient\/allergen information belongs/)
      .scrollIntoViewIfNeeded()
    await expect(
      row.getByText(/Ingredient\/allergen information belongs/),
    ).toBeInViewport()
    const overflow = await dialog.evaluate((panel) => ({
      horizontal: panel.scrollWidth - panel.clientWidth,
      nested: [
        ...panel.querySelectorAll(
          '.kit-editor-component, .kit-editor-component *',
        ),
      ].filter(
        (el) =>
          /(auto|scroll|hidden|clip)/.test(getComputedStyle(el).overflowY) &&
          el.scrollHeight > el.clientHeight + 1,
      ).length,
    }))
    expect(overflow).toEqual({ horizontal: 0, nested: 0 })
    expect(writes).toHaveLength(0)
  })
}
