import { test, expect } from '@playwright/test'
import sharp from 'sharp'
import { demoData } from '../src/lib/demo'
import { defaultSheet } from '../src/lib/label-print-layout'
import { systemLabelTemplates } from '../src/lib/label-studio'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'
import { installMarketingPhotos } from './marketing-photo-fixture'

test.use({ deviceScaleFactor: 2 })

async function ready(page: import('@playwright/test').Page) {
  await page.evaluate(async () => {
    await document.fonts.ready
    document.querySelectorAll('img').forEach((i) => (i.loading = 'eager'))
    await Promise.all(
      [...document.images].map((i) => i.decode().catch(() => {})),
    )
  })
  await page
    .locator('[data-sonner-toaster]')
    .evaluateAll((els) =>
      els.forEach((el) => ((el as HTMLElement).style.visibility = 'hidden')),
    )
}
test('capture current cards, read-only costing and completed label with isolated demo data', async ({
  page,
}) => {
  test.setTimeout(180000)
  page.setDefaultTimeout(10000)
  const workspace = demoData()
  Object.assign(workspace.settings[0], {
    name: 'Clover Lane Kitchen',
    owner: 'Demo kitchen',
    email: 'hello@example.invalid',
    address: '12 Clover Lane · Example Town',
    disclaimer: 'Demonstration label · verify local requirements before sale.',
  })
  await installWorkspaceFixture(page)
  await installMarketingPhotos(page, workspace)
  for (const name of ['flour', 'strawberries']) {
    workspace.graphic_assets.push({
      id: `demo-photo-${name}`,
      name,
      fileUrl: `/demo-photo-${name}.jpg`,
    })
    await page.route(`**/demo-photo-${name}.jpg`, (r) =>
      r.fulfill({
        path: `src/test/fixtures/photos/${name}.jpg`,
        contentType: 'image/jpeg',
      }),
    )
  }
  workspace.ingredients.forEach((i) => {
    if (['flour', 'apflour'].includes(i.id)) i.imageAssetId = 'demo-photo-flour'
  })
  workspace.ingredients.push({
    id: 'strawberries',
    name: 'Fresh Strawberries',
    category: 'Fruit',
    quantity: 2400,
    threshold: 500,
    unit: 'g',
    currentCost: 0.009,
    cost: 0.009,
    imageAssetId: 'demo-photo-strawberries',
    trackInventory: true,
  })
  workspace.recipes = workspace.recipes.slice(0, 2)
  workspace.recipes.forEach((r) => (r.imageAssetId = `demo-photo-${r.id}`))
  workspace.recipes.push({
    id: 'berry',
    name: 'Strawberry Compote',
    category: 'Preps, Fillings & Toppings',
    yield: 6,
    yieldUnit: 'jars',
    laborMinutes: 20,
    laborRate: 18,
    overhead: 0.75,
    imageAssetId: 'demo-photo-strawberries',
    lines: [
      { ingredientId: 'strawberries', quantity: 1000, unit: 'g' },
      { ingredientId: 'sugar', quantity: 400, unit: 'g' },
    ],
  })
  workspace.products = workspace.products.slice(0, 2)
  workspace.products.push({
    id: 'berry-jar',
    name: 'Strawberry Compote Jar',
    recipeId: 'berry',
    unitsPerPackage: 1,
    price: 9.5,
    imageAssetId: 'demo-photo-strawberries',
  })
  const label = structuredClone(systemLabelTemplates[0])
  Object.assign(label, {
    id: 'clover-demo',
    name: 'Clover Lane · Homestyle loaf',
    isSystem: false,
    revision: 1,
    productId: 'loaf',
    source: { kind: 'product', id: 'loaf' },
    background: '#fff8e9',
  })
  label.elements.forEach((e) => {
    e.color = '#633b53'
    if (e.binding === 'product.name') {
      e.fontSize = 25
      e.text = 'Homestyle\nWhite Bread'
      e.binding = ''
    }
  })
  label.printSettings = {
    layout: { ...defaultSheet, mode: 'roll' },
    copies: 1,
    parts: 'both',
    order: 'grouped',
  }
  workspace.label_templates = [label]
  let current = workspace
  await page.route('**/api/workspace*', (r) => {
    return r.fulfill({
      json: { workspace: current, role: 'Owner', demo: true },
    })
  })
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    for (const [name, section] of [
      ['pantry', 'Pantry'],
      ['recipes', 'Recipes'],
      ['products', 'Products & Pricing'],
      ['costing', 'Recipes'],
      ['labels', 'Labels'],
    ]) {
      console.log('Capturing', width, name)
      current =
        name === 'pantry'
          ? {
              ...workspace,
              ingredients: workspace.ingredients.filter((i) =>
                ['flour', 'apflour', 'eggs', 'strawberries'].includes(i.id),
              ),
            }
          : workspace
      await page.goto(workspaceFixtureUrl(section), {
        waitUntil: 'networkidle',
      })
      await expect(page.locator('.app-shell')).toBeVisible()
      if (name === 'pantry') {
        const cards = page.getByRole('button', { name: 'Cards', exact: true })
        if (await cards.count()) await cards.click()
      }
      if (name === 'costing') {
        await page
          .locator('.recipe-card')
          .filter({ hasText: 'Homestyle White Bread' })
          .click()
        await expect(page.getByRole('dialog')).toBeVisible()
        await page.getByText('Cost breakdown', { exact: true }).click()
      }
      if (name === 'labels') {
        await page
          .getByRole('button', {
            name: 'Preview/Print ' + label.name,
            exact: true,
          })
          .click()
        await expect(page.locator('.studio-print-preview')).toBeVisible()
      }
      console.log('Waiting images', width, name)
      await ready(page)
      console.log('Taking capture', width, name)
      let target = page.locator('body')
      if (name === 'costing') target = page.getByRole('dialog')
      if (name === 'labels') target = page.locator('.studio-print-preview')
      if (['pantry', 'recipes', 'products'].includes(name)) {
        const card = page
          .locator(
            name === 'products'
              ? '.product-card'
              : name === 'recipes'
                ? '.recipe-card'
                : '.pantry-card',
          )
          .first()
        await card.evaluate((el) => el.scrollIntoView({ block: 'start' }))
        await page.evaluate(() => scrollBy(0, -85))
      }
      const capture = ['costing', 'labels'].includes(name)
        ? await target.screenshot({ animations: 'disabled' })
        : await page.screenshot({ animations: 'disabled' })
      const suffix = width === 390 ? '-mobile' : ''
      if (name !== 'products')
        await sharp(capture)
          .resize({
            width: name === 'costing' || name === 'labels' ? 1100 : 1440,
            withoutEnlargement: true,
          })
          .webp({ quality: 90 })
          .toFile(`public/screenshots/features-${name}${suffix}.webp`)
      if (name === 'products')
        await sharp(capture)
          .webp({ quality: 90 })
          .toFile(`public/screenshots/home-products${suffix}.webp`)
    }
  }
})

test('dashboard action bar and product criteria work across widths', async ({
  page,
}) => {
  page.setDefaultTimeout(10000)
  await installWorkspaceFixture(page)
  const workspace = demoData()
  await page.route('**/api/workspace*', (r) =>
    r.fulfill({ json: { workspace, role: 'Owner', demo: true } }),
  )
  for (const width of [1600, 1100, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.goto(workspaceFixtureUrl('Dashboard'), {
      waitUntil: 'networkidle',
    })
    const actions = page.locator('.dashboard-quick-actions')
    await expect(actions.getByRole('button')).toHaveCount(5)
    const heading = await page
      .getByRole('heading', { name: 'Quick actions', exact: true })
      .boundingBox()
    const group = await actions.boundingBox()
    expect(heading!.y + heading!.height).toBeLessThanOrEqual(group!.y)
    expect(heading!.x).toBe(group!.x)
    const boxes = await actions.getByRole('button').evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect()
        return { x: r.x, y: r.y, width: r.width, height: r.height }
      }),
    )
    if (width === 1600) expect(new Set(boxes.map((b) => b.y)).size).toBe(1)
    if (width === 390) expect(boxes[4].x).toBe(boxes[0].x)
    await page.goto(workspaceFixtureUrl('Products & Pricing'), {
      waitUntil: 'networkidle',
    })
    const browse = page.locator('.product-browse')
    await browse
      .getByRole('combobox', { name: 'Sort by', exact: true })
      .selectOption('price')
    await browse
      .getByRole('combobox', { name: 'Direction', exact: true })
      .selectOption('desc')
    await browse.getByLabel('Search products', { exact: true }).fill('bread')
    await expect(page.locator('article.product-card')).toHaveCount(1)
    await page.reload({ waitUntil: 'networkidle' })
    await expect(browse.getByLabel('Search products', { exact: true })).toHaveValue('bread')
    await expect(browse.getByRole('combobox', { name: 'Direction', exact: true })).toHaveValue('desc')
    await page
      .locator('article.product-card')
      .getByRole('button', { name: /View photo and details/ })
      .click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(
      browse.getByLabel('Search products', { exact: true }),
    ).toHaveValue('bread')
    await browse.getByRole('button', { name: 'Filters', exact: true }).click()
    await page.getByLabel('Minimum selling price', { exact: true }).fill('999')
    await page.getByRole('button', { name: 'Show 0 products' }).click()
    await expect(
      page.getByRole('heading', { name: 'No matching products' }),
    ).toBeVisible()
    await browse
      .getByRole('button', { name: 'Clear filters', exact: true })
      .first()
      .click()
    await expect(page.locator('article.product-card')).toHaveCount(
      workspace.products.length,
    )
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
  }
})
