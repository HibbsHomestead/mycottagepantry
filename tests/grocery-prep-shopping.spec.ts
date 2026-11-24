import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { demoData } from '../src/lib/demo'
import type { Workspace } from '../src/lib/domain'
import {
  generateGroceryList,
  newerGroceryMark,
  type GroceryList,
} from '../src/lib/grocery-list'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

const address = workspaceFixtureUrl('Production/Grocery & Prep')
const title = 'Isolated market buns'
const flour = 'Stoneground flour'

function fixture() {
  const workspace: Workspace = {
    ...demoData(),
    products: [],
    batches: [],
    events: [],
    event_batch_links: [],
    ingredients: [
      {
        id: 'flour',
        name: flour,
        unit: 'g',
        quantity: 200,
        currentCost: 0.007,
        amountPerPackage: 500,
        vendor: 'Mill Market',
        category: 'Baking staples',
      },
      {
        id: 'sugar',
        name: 'Golden sugar',
        unit: 'g',
        quantity: 20,
        vendor: 'Mill Market',
        category: 'Baking staples',
      },
      {
        id: 'berries',
        name: 'Raspberries',
        unit: 'g',
        quantity: 0,
        vendor: 'Orchard Stand',
        category: 'Produce',
      },
      {
        id: 'jam',
        name: 'Raspberry filling',
        unit: 'g',
        quantity: 100,
        compoundRecipeId: 'jam-recipe',
      },
      {
        id: 'liner',
        name: 'Bun liners',
        unit: 'each',
        quantity: 4,
        usedAs: 'supply',
        category: 'Bakeware',
      },
      ...Array.from({ length: 24 }, (_, index) => ({
        id: `extra-${index}`,
        name: `Market spice ${index + 1}`,
        unit: 'g',
        quantity: 0,
        vendor: 'Spice Shop',
      })),
    ],
    recipes: [
      {
        id: 'market-recipe',
        name: title,
        yield: 12,
        yieldUnit: 'each',
        lines: [
          { ingredientId: 'flour', quantity: 825, unit: 'g' },
          { ingredientId: 'sugar', quantity: 120, unit: 'g' },
          { ingredientId: 'jam', quantity: 400, unit: 'g' },
          ...Array.from({ length: 24 }, (_, index) => ({
            ingredientId: `extra-${index}`,
            quantity: 3,
            unit: 'g',
          })),
        ],
        productionSupplies: [
          { ingredientId: 'liner', quantity: 12, unit: 'each' },
        ],
      },
      {
        id: 'jam-recipe',
        name: 'Raspberry filling',
        yield: 100,
        yieldUnit: 'g',
        lines: [{ ingredientId: 'berries', quantity: 110, unit: 'g' }],
      },
    ],
  }
  const lists = new Map<string, GroceryList>()
  const writes: string[] = []
  return { workspace, lists, writes }
}

async function connect(page: Page, storage: ReturnType<typeof fixture>) {
  await installWorkspaceFixture(page)
  await page.route('**/api/workspace*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (!url.searchParams.has('groceryList')) {
      if (request.method() === 'POST')
        storage.writes.push('unexpected workspace write')
      return route.fulfill({
        json: { workspace: storage.workspace, role: 'Owner', demo: false },
      })
    }
    if (request.method() === 'GET') {
      const id = url.searchParams.get('list')
      return route.fulfill({
        json: id
          ? { list: storage.lists.get(id), serverTime: Date.now() }
          : {
              lists: [...storage.lists.values()].reverse(),
              serverTime: Date.now(),
            },
      })
    }
    const input = request.postDataJSON()
    storage.writes.push(input.action)
    if (input.action === 'generate')
      storage.lists.set(
        input.id,
        generateGroceryList(
          storage.workspace,
          input.sources,
          input.id,
          '2026-11-23T14:23:00.000Z',
        ),
      )
    const list = storage.lists.get(input.id)!
    if (input.action === 'marks')
      for (const mark of input.marks)
        if (newerGroceryMark(mark, list.marks[mark.row]))
          list.marks[mark.row] = mark
    if (input.action === 'quantity') {
      if (input.amount === null) delete list.overrides[input.row]
      else list.overrides[input.row] = input.amount
    }
    if (input.action === 'manual')
      list.manual.push({
        id: input.item,
        name: input.name,
        unit: input.unit,
        toBuy: input.amount,
        needed: input.amount,
        vendor: input.vendor,
        category: '',
        kind: 'Manual',
        manual: true,
        notes: input.notes,
        sources: [],
      })
    return route.fulfill({ json: { list, serverTime: Date.now() } })
  })
}

async function generate(page: Page) {
  await page.goto(address)
  const button = page.getByRole('button', { name: 'Generate grocery list' })
  await expect(button).toBeDisabled()
  await page
    .getByRole('combobox', { name: 'Recipe', exact: true })
    .selectOption('market-recipe')
  await page.getByRole('button', { name: 'Add recipe' }).click()
  await button.click()
  await expect(
    page.getByRole('checkbox', { name: new RegExp(flour) }),
  ).toBeVisible()
}

async function screenshot(page: Page, info: TestInfo, name: string) {
  const folder = process.env.GROCERY_SCREENSHOTS
  if (folder) await mkdir(folder, { recursive: true })
  await page.screenshot({
    path: folder ? join(folder, `${name}.png`) : info.outputPath(`${name}.png`),
    animations: 'disabled',
  })
}

for (const [width, height] of [
  [360, 800],
  [390, 844],
  [430, 932],
  [820, 1000],
  [1440, 900],
  [844, 390],
]) {
  test(`shopping layout and checked state at ${width} × ${height}`, async ({
    browser,
  }, info) => {
    const context = await browser.newContext({
      viewport: { width, height },
      hasTouch: width < 900,
      isMobile: width < 500,
      permissions: ['clipboard-read', 'clipboard-write'],
    })
    try {
      const page = await context.newPage()
      const storage = fixture()
      const original = structuredClone(storage.workspace)
      await connect(page, storage)
      await generate(page)
      const checkbox = page.getByRole('checkbox', { name: new RegExp(flour) })
      const row = page.locator('.grocery-row').filter({ has: checkbox })
      const touch = width < 900
      const press = (target: ReturnType<Page['locator']>) =>
        touch ? target.tap() : target.click()
      await press(row.getByText(flour, { exact: true }))
      await expect(checkbox).toBeChecked()
      expect(await checkbox.ariaSnapshot()).toContain('[checked]')
      await expect(row.locator('.grocery-row-text')).toHaveCSS(
        'text-decoration-line',
        'line-through',
      )
      await press(row.locator('.grocery-check-art'))
      await expect(checkbox).not.toBeChecked()
      await press(
        row.getByRole('button', { name: `Show details for ${flour}` }),
      )
      await expect(row.getByText('Estimated cost')).toBeVisible()
      await expect(checkbox).not.toBeChecked()
      await press(row.getByRole('button', { name: 'Edit shopping quantity' }))
      await expect(page.getByRole('dialog')).toBeVisible()
      if (width === 390) {
        await page.getByRole('dialog').getByRole('spinbutton').fill('700')
        await page.getByRole('button', { name: 'Save quantity' }).click()
        await expect(row.getByText('700 g · edited')).toBeVisible()
        await row
          .getByRole('button', { name: 'Edit shopping quantity' })
          .click()
        await page.getByRole('button', { name: 'Restore suggestion' }).click()
      } else {
        await page
          .getByRole('dialog')
          .getByRole('button', { name: 'Close', exact: true })
          .click()
      }
      await expect(checkbox).not.toBeChecked()
      await expect(
        row.getByRole('button', { name: 'Edit shopping quantity' }),
      ).toBeFocused()
      await row
        .getByRole('button', { name: `Hide details for ${flour}` })
        .click()
      await checkbox.focus()
      await page.keyboard.press('Space')
      await expect(checkbox).toBeChecked()
      await page.keyboard.press('Enter')
      await expect(checkbox).not.toBeChecked()
      await press(row.getByText(flour, { exact: true }))
      const snapshot = [...storage.lists.values()][0]
      await expect
        .poll(() => Object.values(snapshot.marks).some((mark) => mark.checked))
        .toBe(true)
      expect(
        await page
          .locator('.grocery-page')
          .evaluate(
            (element) => element.scrollWidth <= element.clientWidth + 1,
          ),
      ).toBe(true)
      expect(
        (await row.locator('.grocery-row-main').boundingBox())!.height,
      ).toBeGreaterThanOrEqual(48)
      expect(
        (await row.locator('.grocery-expand').boundingBox())!.width,
      ).toBeGreaterThanOrEqual(44)
      await page
        .getByText('Shopping options', { exact: true })
        .evaluate((element) => element.scrollIntoView({ block: 'center' }))
      await screenshot(page, info, `shopping-${width}`)
      if (width === 390) {
        const cdp = await context.newCDPSession(page)
        const target = (await row.boundingBox())!
        const beforeScroll = await page.evaluate(() => window.scrollY)
        const touchPoint = {
          x: Math.round(target.x + 70),
          y: Math.round(target.y + 30),
        }
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: [touchPoint],
        })
        for (let step = 1; step <= 8; step++) {
          await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [{ ...touchPoint, y: touchPoint.y - step * 36 }],
          })
        }
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchEnd',
          touchPoints: [],
        })
        await expect
          .poll(() => page.evaluate(() => window.scrollY))
          .toBeGreaterThan(beforeScroll)
        await expect(checkbox).toBeChecked()
        await page.getByText('Shopping options', { exact: true }).click()
        await page
          .getByRole('combobox', { name: 'Group by' })
          .selectOption('category')
        await expect(
          page.getByRole('button', { name: /Ingredients · Baking staples/ }),
        ).toBeVisible()
        await page
          .getByRole('combobox', { name: 'Group by' })
          .selectOption('vendor')
        const vendor = page.getByRole('button', {
          name: /Ingredients · Mill Market/,
        })
        await vendor.click()
        await expect(checkbox).toHaveCount(0)
        await vendor.click()
        await expect(checkbox).toBeChecked()
        await page
          .getByRole('searchbox', { name: 'Search shopping list' })
          .fill('flour')
        await expect(
          page.getByRole('checkbox', { name: /Golden sugar/ }),
        ).toHaveCount(0)
        await page
          .getByRole('searchbox', { name: 'Search shopping list' })
          .clear()
        await page.getByLabel('Hide checked').check()
        await expect(checkbox).toHaveCount(0)
        await page
          .getByRole('button', { name: 'Uncheck all', exact: true })
          .click()
        await page
          .getByRole('dialog')
          .getByRole('button', { name: 'Uncheck all' })
          .click()
        await expect(checkbox).not.toBeChecked()
        await press(row.getByText(flour, { exact: true }))
        await expect(checkbox).toHaveCount(0)
        await page
          .getByRole('button', { name: 'Clear checked marks', exact: true })
          .click()
        await page
          .getByRole('dialog')
          .getByRole('button', { name: 'Clear marks' })
          .click()
        await expect(checkbox).not.toBeChecked()
        await page
          .getByRole('button', { name: 'Add item', exact: true })
          .click()
        await page.getByLabel('Item name').fill('Parchment')
        await page.getByLabel('Unit', { exact: true }).fill('roll')
        await page.getByRole('button', { name: 'Save item' }).click()
        await expect(
          page.getByRole('checkbox', { name: /Parchment.*Manual/ }),
        ).toBeVisible()
        await page.getByRole('button', { name: /Prep before baking/ }).click()
        const toMake = page.getByText('Make 300 g', { exact: true })
        await expect(toMake).toBeVisible()
        await toMake.scrollIntoViewIfNeeded()
        await screenshot(page, info, 'prep-390')
        await page.getByRole('button', { name: 'Copy text' }).click()
        await expect
          .poll(() => page.evaluate(() => navigator.clipboard.readText()))
          .toContain('Parchment: 1 roll')
        const download = page.waitForEvent('download')
        await page.getByRole('button', { name: 'Download text' }).click()
        expect((await download).suggestedFilename()).toMatch(
          /grocery-prep-.*\.txt/,
        )
        await page.evaluate(() => {
          window.print = () => {
            document.body.dataset.fixturePrinted = 'yes'
          }
        })
        await page.getByRole('button', { name: 'Print', exact: true }).click()
        await expect(page.locator('body')).toHaveAttribute(
          'data-fixture-printed',
          'yes',
        )
        await page.emulateMedia({ media: 'print' })
        await expect(page.locator('.grocery-print')).toBeVisible()
        await expect(page.locator('.grocery-print')).toContainText(
          'Prep before baking',
        )
        await expect(page.locator('.grocery-add')).toBeHidden()
        await page.evaluate(() => window.scrollTo(0, 0))
        await screenshot(page, info, 'print-390')
      }
      expect(storage.workspace).toEqual(original)
      expect(
        storage.writes.every((action) =>
          ['generate', 'marks', 'manual', 'quantity'].includes(action),
        ),
      ).toBe(true)
    } finally {
      await context.close()
    }
  })
}

test('queues offline edits, resolves other-device conflicts, and restores the same list after reload', async ({
  browser,
}) => {
  const first = await browser.newContext()
  const second = await browser.newContext()
  try {
    const storage = fixture()
    const firstPage = await first.newPage()
    const secondPage = await second.newPage()
    await connect(firstPage, storage)
    await connect(secondPage, storage)
    await generate(firstPage)
    await secondPage.goto(address)
    const input = (page: Page) =>
      page.getByRole('checkbox', { name: new RegExp(flour) })
    const tap = (page: Page) =>
      page
        .locator('.grocery-row')
        .filter({ has: input(page) })
        .getByText(flour, { exact: true })
        .click()
    const snapshot = [...storage.lists.values()][0]
    const rowId = snapshot.lines.find((line) => line.name === flour)!.id
    await expect(input(secondPage)).not.toBeChecked()
    await first.setOffline(true)
    await tap(firstPage)
    await expect(input(firstPage)).toBeChecked()
    await expect(firstPage.getByText('Saved on this device')).toBeVisible()
    expect(snapshot.marks[rowId]).toBeUndefined()
    await tap(secondPage)
    await expect.poll(() => snapshot.marks[rowId]?.checked).toBe(true)
    await tap(secondPage)
    await expect.poll(() => snapshot.marks[rowId]?.checked).toBe(false)
    await first.setOffline(false)
    await expect(firstPage.getByText('Saved on this device')).toBeHidden()
    await expect(input(firstPage)).not.toBeChecked()
    await first.setOffline(true)
    await tap(firstPage)
    await expect(input(firstPage)).toBeChecked()
    await first.setOffline(false)
    await expect.poll(() => snapshot.marks[rowId]?.checked).toBe(true)
    await firstPage.reload()
    await expect(input(firstPage)).toBeChecked()
    await secondPage.reload()
    await expect(input(secondPage)).toBeChecked()
    await firstPage.getByRole('button', { name: 'Recalculate' }).click()
    await expect(input(firstPage)).not.toBeChecked()
    await firstPage
      .getByRole('combobox', { name: 'Saved snapshots' })
      .selectOption(snapshot.id)
    await expect(input(firstPage)).toBeChecked()
    await firstPage.reload()
    await expect(input(firstPage)).toBeChecked()
    expect(storage.lists.size).toBe(2)
    expect(snapshot.lines.filter((line) => line.name === flour)).toHaveLength(1)
  } finally {
    await first.close()
    await second.close()
  }
})
