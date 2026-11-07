import { test, expect, type Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { demoData } from '../src/lib/demo'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

async function fixture(page: Page) {
  await installWorkspaceFixture(page)
  const workspace = demoData()
  workspace.graphic_assets = [
    { id: 'item-photo', name: 'Product photo', fileUrl: '/fixture-eggs.jpg' },
  ]
  workspace.ingredients.push(
    ...[
      ['craft', 'Cotton craft thread', 'material', 'craft-materials'],
      ['supply', 'Cleaning supplies', 'supply', 'supplies'],
    ].map(([id, name, usedAs, categoryId]) => ({
      id,
      name,
      usedAs,
      categoryId,
      materialType: 'other',
      imageAssetId: 'item-photo',
      quantity: 24,
      unit: 'each',
      cost: 2,
      threshold: 1,
    })),
  )
  for (const ingredient of workspace.ingredients)
    ingredient.imageAssetId = 'item-photo'
  workspace.products.push({
    id: 'resale-preview',
    name: 'Free-range eggs · six-pack',
    workflow: 'resale',
    quantity: 24,
    cost: 4.5,
    stockCostKnown: true,
    price: 12,
    threshold: 3,
    imageAssetId: 'item-photo',
  })
  await page.route('**/fixture-eggs.jpg', (r) =>
    r.fulfill({
      path: fileURLToPath(
        new URL('../src/test/fixtures/eggs-unsplash.jpg', import.meta.url),
      ),
      contentType: 'image/jpeg',
    }),
  )
  const writes: any[] = []
  await page.route('**/api/workspace*', (r) => {
    if (r.request().method() === 'POST') {
      const body = r.request().postDataJSON()
      writes.push(body)
      if (body.action === 'save' && body.data) {
        const table = body.table as keyof typeof workspace
        const rows = workspace[table]
        if (Array.isArray(rows)) rows.push(body.data)
      }
    }
    return r.fulfill({ json: { workspace, role: 'Owner', demo: false } })
  })
  return { writes, workspace }
}

async function modalScroll(page: Page) {
  expect(
    await page.locator('.add-item-dialog').evaluate((el) => {
      return [el, ...el.querySelectorAll('*')]
        .filter((node) => {
          const style = getComputedStyle(node)
          return (
            ['auto', 'scroll'].includes(style.overflowY) &&
            node.scrollHeight > node.clientHeight + 1
          )
        })
        .filter((node) => !node.classList.contains('add-item-body'))
        .map((node) => node.className)
    }),
  ).toEqual([])
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    ),
  ).toBeLessThanOrEqual(1)
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
  { width: 390, height: 844 },
  { width: 720, height: 450 },
  { width: 320, height: 450 },
]) {
  test(`all types and sections stay reachable at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport)
    await fixture(page)
    await page.goto(workspaceFixtureUrl('Inventory/Ingredients'))
    await page.getByRole('button', { name: 'Add Item', exact: true }).click()
    const editor = page.getByRole('dialog')
    for (const type of [
      'ingredient',
      'packaging',
      'material',
      'supply',
      'resale',
    ]) {
      await editor.getByLabel('Item Type', { exact: true }).selectOption(type)
      await editor.getByLabel('Item name', { exact: true }).fill(`New ${type}`)
      if (type === 'material')
        await editor.getByLabel('Material Subtype').selectOption('fabric')
      for (const name of [
        'Details',
        'Purchase & Stock',
        'More',
        ...(type === 'ingredient'
          ? ['Ingredients & allergens']
          : type === 'material'
            ? ['Fabric']
            : []),
      ]) {
        await editor.getByRole('tab', { name, exact: true }).click()
        await modalScroll(page)
        await editor
          .getByRole('button', { name: 'Save item', exact: true })
          .scrollIntoViewIfNeeded()
        await expect(
          editor.getByRole('button', { name: 'Save item', exact: true }),
        ).toBeInViewport()
        if (viewport.width >= 1366) {
          await expect(editor).not.toHaveClass(/add-item-page/)
          await expect(
            editor.getByRole('button', { name: 'Cancel', exact: true }),
          ).toBeInViewport()
        }
      }
      await editor.getByRole('tab', { name: 'Details', exact: true }).click()
      await expect(editor.getByLabel('Item name', { exact: true })).toHaveValue(
        `New ${type}`,
      )
    }
    if (viewport.width === 1440 || viewport.width === 390) {
      await editor
        .getByLabel('Photo', { exact: true })
        .selectOption('item-photo')
      await editor
        .getByLabel('Item name', { exact: true })
        .fill('Free-range eggs · six-pack')
      await page.screenshot({
        path: `docs/previews/add-item-${viewport.width}.webp`,
        fullPage: viewport.width < 720,
      })
    }
    if (viewport.width < 720 || viewport.height < 640)
      await expect(editor).toHaveAttribute('data-presentation', 'detail')
  })
}

test('hidden-tab validation, long import review and modal scrolling keep edits and focus', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const { writes } = await fixture(page)
  await page.route('**/api/workspace?productImport=1', (r) =>
    r.fulfill({
      json: {
        products: [
          {
            title: 'Imported cotton',
            fields: {
              name: 'Imported cotton',
              brand: 'Cotton supplier',
              notes: 'Supplier specification. '.repeat(140),
              fabricWidth: 44,
              widthUnit: 'in',
            },
            imageUrl: '',
            sourceUrl: 'https://example.org/cotton',
            checkedAt: '2026-11-04T00:00:00Z',
            warnings: [],
            conditions: [],
          },
        ],
      },
    }),
  )
  await page.goto(workspaceFixtureUrl('Inventory/Craft Materials'))
  await page.getByRole('button', { name: 'Add Item', exact: true }).click()
  const editor = page.getByRole('dialog')
  await editor.getByLabel('Item Type', { exact: true }).selectOption('material')
  await editor.getByLabel('Material Subtype').selectOption('fabric')
  await editor.getByLabel('Item name', { exact: true }).fill('Owner cotton')
  await editor.getByRole('tab', { name: 'More', exact: true }).click()
  await editor.getByLabel('SKU', { exact: true }).fill('FAB-44')
  await editor.getByRole('button', { name: 'Save item' }).click()
  await expect(editor.getByRole('tab', { name: /Fabric/ })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(editor.getByLabel('Fabric width')).toBeFocused()
  await editor.getByLabel('Fabric width').fill('44')
  await editor.getByRole('tab', { name: 'Details', exact: true }).click()
  await editor.getByRole('button', { name: 'URL', exact: true }).click()
  await editor
    .getByLabel('Product URL', { exact: true })
    .fill('https://example.org/cotton')
  await editor.getByRole('button', { name: 'Import details' }).click()
  await expect(
    editor.getByRole('checkbox', { name: 'Brand', exact: true }),
  ).toBeVisible()
  await expect(editor).toHaveAttribute('data-presentation', 'detail')
  await editor.getByText('Expand/Edit description', { exact: true }).click()
  await modalScroll(page)
  await page.mouse.move(600, 400)
  await page.mouse.wheel(0, 600)
  await expect
    .poll(() => editor.locator('.add-item-body').evaluate((el) => el.scrollTop))
    .toBeGreaterThan(0)
  expect(await page.evaluate(() => scrollY)).toBe(0)
  await editor.getByRole('checkbox', { name: 'Brand', exact: true }).check()
  await editor.getByRole('button', { name: 'Apply selected fields' }).click()
  await editor.getByRole('button', { name: 'Manual', exact: true }).click()
  await expect(editor.getByLabel('Brand', { exact: true })).toHaveValue(
    'Cotton supplier',
  )
  await expect(editor.getByLabel('Item name', { exact: true })).toHaveValue(
    'Owner cotton',
  )
  await expect(editor.getByLabel('Item Type', { exact: true })).toHaveValue(
    'material',
  )
  await editor.getByRole('button', { name: 'Save item' }).click()
  await expect(editor).toHaveCount(0)
  expect(writes.at(-1).data).toMatchObject({
    name: 'Owner cotton',
    fabricWidth: '44',
    sku: 'FAB-44',
    brand: 'Cotton supplier',
    usedAs: 'material',
    initialStock: false,
  })
})

for (const width of [1440, 390]) {
  test(`live inventory photo cards and stock entry points ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 980 })
    const { writes } = await fixture(page)
    for (const section of [
      'Ingredients',
      'Craft Materials',
      'Packaging',
      'Supplies',
      'Finished Goods',
    ]) {
      await page.goto(workspaceFixtureUrl(`Inventory/${section}`))
      const card = page.locator('.pantry-card').first()
      await expect(card).toBeVisible()
      const photo = card.locator('.pantry-photo')
      const size = await photo.boundingBox()
      expect(size!.width).toBeGreaterThan(190)
      expect(size!.height).toBeGreaterThan(95)
      expect(size!.width / size!.height).toBeCloseTo(1.5, 1)
      await expect(photo.locator('img')).toHaveCSS('object-fit', 'contain')
      await expect(photo.locator('img')).toBeVisible()
      if (section === 'Finished Goods') {
        await page.screenshot({
          path: `docs/previews/live-finished-inventory-${width}.webp`,
          fullPage: true,
        })
        await card
          .getByRole('button', { name: 'Receive stock', exact: true })
          .click()
        await expect(page.getByRole('dialog')).toBeVisible()
        expect(writes).toHaveLength(0)
      }
    }
  })
}

test('admin reset button exposes email recovery without requesting the old password', async ({
  page,
}) => {
  await page.route('**/api/admin*', (r) =>
    r.fulfill({
      json:
        r.request().method() === 'POST'
          ? {
              message:
                'If this address has an account, a password reset link has been sent.',
            }
          : { stage: 'signed_out' },
    }),
  )
  await page.goto('http://localhost:8889/admin')
  await page
    .getByRole('button', { name: 'Reset password', exact: true })
    .click()
  await expect(page.getByLabel('Password', { exact: true })).toHaveCount(0)
  await page.getByLabel('Email address').fill('owner@example.org')
  await page.getByRole('button', { name: 'Send reset link' }).click()
  await expect(page.getByRole('status')).toContainText('password reset link')
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 980 })
    await page.screenshot({
      path: `docs/previews/admin-password-reset-${width}.webp`,
      fullPage: true,
    })
  }
})

test('popup editing traps focus, protects a draft and returns focus to Add Item', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await fixture(page)
  await page.goto(workspaceFixtureUrl('Inventory/Ingredients'))
  const opener = page.getByRole('button', { name: 'Add Item', exact: true })
  await opener.click()
  const editor = page.getByRole('dialog')
  await expect(editor).toHaveAttribute('data-presentation', 'detail')
  await editor.getByLabel('Item name', { exact: true }).fill('Keep this draft')
  await editor.getByRole('button', { name: 'Save item', exact: true }).focus()
  await page.keyboard.press('Tab')
  expect(
    await page.evaluate(
      () => !!document.activeElement?.closest('.add-item-dialog'),
    ),
  ).toBe(true)
  page.once('dialog', (dialog) => dialog.dismiss())
  await page.keyboard.press('Escape')
  await expect(editor).toBeVisible()
  await expect(editor.getByLabel('Item name', { exact: true })).toHaveValue(
    'Keep this draft',
  )
  page.once('dialog', (dialog) => dialog.accept())
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(editor).toHaveCount(0)
  await expect(opener).toBeFocused()
  await expect(page.locator('[data-item-editor-background]')).toHaveCount(0)
})
