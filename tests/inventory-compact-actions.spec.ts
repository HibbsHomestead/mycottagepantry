import { test, expect } from '@playwright/test'
import { demoData } from '../src/lib/demo'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

for (const width of [320, 390, 430, 820, 1440]) {
  test(`compact inventory actions ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 })
    await installWorkspaceFixture(page)
    const workspace = demoData()
    workspace.ingredients[0].storageLocation = 'Pantry shelf 1'
    workspace.ingredients[0].barcode = '001234'
    workspace.ingredients.push({
      id: 'craft-preview',
      name: 'Cotton fabric',
      usedAs: 'material',
      materialType: 'fabric',
      quantity: 3,
      unit: 'yd',
      cost: 4,
      storageLocation: 'Craft shelf',
    })
    const originalStock = JSON.stringify(workspace.ingredients)
    const writes: string[] = []
    await page.route('**/api/workspace*', async (r) => {
      if (r.request().method() === 'POST')
        writes.push(r.request().postDataJSON().action)
      await r.fulfill({ json: { workspace, role: 'Owner', demo: false } })
    })
    if (width === 390)
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'mediaDevices', {
          configurable: true,
          value: {
            getUserMedia: async () => {
              throw new DOMException('Denied for fixture', 'NotAllowedError')
            },
          },
        })
      })
    await page.goto(workspaceFixtureUrl('Inventory/Craft Materials'))
    const actions = page.locator('.inventory-primary-actions')
    await expect(actions.locator(':scope > .btn')).toHaveCount(6)
    await expect(
      actions.getByRole('button', {
        name: 'Print shelf/bin labels (0)',
        exact: true,
      }),
    ).toBeEnabled()
    const inventory = page.locator('.pantry-v2')
    await expect(
      inventory.locator(
        '.inventory-filter-actions > .inventory-primary-actions',
      ),
    ).toHaveCount(1)
    await expect(
      page.getByText('Select inventory items for shelf/bin labels', {
        exact: true,
      }),
    ).toHaveCount(0)
    await expect(inventory.getByRole('checkbox')).toHaveCount(0)
    const placement = await inventory.evaluate((el) => {
      const summary = el
        .querySelector('.pantry-summary')!
        .getBoundingClientRect()
      const tabs = el.querySelector('.inventory-tabs')!.getBoundingClientRect()
      const actions = el
        .querySelector('.inventory-primary-actions')!
        .getBoundingClientRect()
      return {
        belowSummary: actions.top >= summary.bottom,
        tabCenter: tabs.top + tabs.height / 2,
        actionCenter: actions.top + actions.height / 2,
        tabsRight: tabs.right,
        actionsLeft: actions.left,
        actionsRight: actions.right,
        resultsRight: el.getBoundingClientRect().right,
      }
    })
    expect(placement.belowSummary).toBe(true)
    if (width >= 1440) {
      expect(
        Math.abs(placement.tabCenter - placement.actionCenter),
      ).toBeLessThan(2)
      expect(placement.actionsLeft).toBeGreaterThan(placement.tabsRight)
    }
    if (width > 700)
      expect(
        Math.abs(placement.actionsRight - placement.resultsRight),
      ).toBeLessThan(2)
    const checkGrid = async () => {
      const boxes = await actions
        .locator(':scope > .btn')
        .evaluateAll((elements) =>
          elements.map((el) => {
            const r = el.getBoundingClientRect()
            return {
              x: r.x,
              y: r.y,
              width: r.width,
              height: r.height,
              fits:
                el.scrollWidth <= el.clientWidth &&
                el.scrollHeight <= el.clientHeight,
            }
          }),
        )
      if (width <= 700) {
        expect(boxes[0].y).toBe(boxes[2].y)
        expect(boxes[3].y).toBe(boxes[5].y)
        expect(boxes[3].y).toBeGreaterThan(boxes[0].y)
        for (const b of boxes) {
          expect(b.width).toBeCloseTo(boxes[0].width, 0)
          expect(b.height).toBeGreaterThanOrEqual(44)
          expect(b.fits).toBe(true)
        }
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
    }
    await checkGrid()
    await actions.scrollIntoViewIfNeeded()
    await page.screenshot({
      path: testInfo.outputPath(`craft-${width}.png`),
    })
    for (const name of [
      'Scan barcode',
      'Scan to receive',
      'Inventory count sessions',
      'Location labels',
    ]) {
      await actions.getByRole('button', { name, exact: true }).click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      await expect(
        dialog.getByRole('heading', {
          name: name.includes('Scan')
            ? 'Scan barcode'
            : name === 'Inventory count sessions'
              ? 'Inventory count session'
              : 'Shelf / bin / location labels',
          exact: true,
        }),
      ).toBeVisible()
      if (width === 390 && name === 'Scan to receive') {
        await dialog.getByRole('button', { name: 'Start rear camera' }).click()
        await expect(dialog.getByRole('alert')).toContainText(
          'Camera permission was denied',
        )
        await dialog.getByRole('textbox').fill('001234')
        await dialog.getByRole('button', { name: 'Use entered code' }).click()
        await expect(
          dialog.getByRole('heading', { name: 'Review barcode match' }),
        ).toBeVisible()
        const match = dialog.getByRole('button', {
          name: /Bread flour.*Item barcode/,
        })
        await expect(match).toBeDisabled()
        await dialog
          .getByRole('checkbox', { name: /checked the variant/ })
          .check()
        await match.click()
        await expect(
          dialog.getByRole('heading', {
            name: 'Receive inventory',
            exact: true,
          }),
        ).toBeVisible()
      }
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
    }
    if (width === 820) {
      await page.addStyleTag({
        content: '.inventory-tabs button { font-size: 26px !important }',
      })
      const tabsBox = await inventory.locator('.inventory-tabs').boundingBox()
      const actionsBox = await actions.boundingBox()
      expect(actionsBox!.y).toBeGreaterThanOrEqual(tabsBox!.y + tabsBox!.height)
      await checkGrid()
      await page.screenshot({ path: testInfo.outputPath('tablet-wrapped.png') })
    }
    await actions.getByRole('link', { name: 'Rapid barcode counts' }).click()
    await expect(page).toHaveURL(/Inventory\/Counts/)
    await page.goto(workspaceFixtureUrl('Inventory/Ingredients'))
    await inventory
      .getByRole('textbox', { name: 'Search pantry' })
      .fill('Bread flour')
    await actions
      .getByRole('button', { name: 'Print shelf/bin labels (0)' })
      .click()
    await expect(inventory.getByRole('checkbox')).toHaveCount(1)
    await expect(
      inventory.getByRole('button', { name: 'Print selected labels' }),
    ).toBeDisabled()
    await inventory
      .getByRole('button', { name: 'Select all filtered items', exact: true })
      .click()
    const shelf = actions.getByRole('button', {
      name: /^Print shelf\/bin labels/,
    })
    await expect(shelf).toBeEnabled()
    await expect(actions.locator('.inventory-action-badge')).toHaveText('1')
    await inventory.getByRole('button', { name: 'Table', exact: true }).click()
    await expect(
      inventory.getByRole('checkbox', {
        name: 'Select Bread flour for shelf/bin labels',
      }),
    ).toBeChecked()
    await inventory.getByRole('button', { name: 'Clear selection' }).click()
    await expect(actions.locator('.inventory-action-badge')).toHaveText('0')
    await inventory
      .getByRole('checkbox', {
        name: 'Select Bread flour for shelf/bin labels',
      })
      .check()
    await inventory.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(inventory.getByRole('checkbox')).toHaveCount(0)
    await expect(
      inventory.getByRole('button', { name: 'Clear selection' }),
    ).toHaveCount(0)
    await actions.scrollIntoViewIfNeeded()
    await page.screenshot({
      path: testInfo.outputPath(`selected-${width}.png`),
    })
    if (width <= 700) {
      await page.addStyleTag({
        content:
          '.inventory-primary-actions > .btn {font-size: 26px !important}',
      })
      await checkGrid()
      await page.screenshot({
        path: testInfo.outputPath(`large-text-${width}.png`),
      })
    } else {
      await expect(
        actions.locator('.inventory-action-short').first(),
      ).toBeHidden()
      await expect(
        actions.locator('.inventory-action-icon').first(),
      ).toBeVisible()
      await actions
        .getByRole('button', { name: 'Scan barcode', exact: true })
        .focus()
      await expect(page.getByRole('tooltip')).toContainText('Scan barcode')
      await page.keyboard.press('Escape')
    }
    await shelf.click()
    await expect(
      page.getByRole('heading', {
        name: 'Shelf / bin / location labels',
        exact: true,
      }),
    ).toBeVisible()
    await expect(
      page.getByRole('dialog').getByLabel('Copies per label (PDF)'),
    ).toBeVisible()
    await expect(page.locator('.shelf-label-preview > svg')).toHaveCount(1)
    await expect(page.locator('.shelf-label-preview')).toContainText(
      'Bread flour',
    )
    expect(writes.every((action) => action === 'pantryView')).toBe(true)
    expect(JSON.stringify(workspace.ingredients)).toBe(originalStock)
  })
}

for (const width of [390, 820, 1440]) {
  test(`full-width compact empty inventory ${width}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 })
    await installWorkspaceFixture(page)
    const workspace = demoData()
    const writes: string[] = []
    await page.route('**/api/workspace*', async (r) => {
      if (r.request().method() === 'POST')
        writes.push(r.request().postDataJSON().action)
      await r.fulfill({ json: { workspace, role: 'Owner', demo: false } })
    })
    for (const tab of [
      'Overview',
      'Ingredients',
      'Craft Materials',
      'Packaging',
      'Supplies',
    ]) {
      await page.goto(workspaceFixtureUrl('Inventory/' + tab))
      const inventory = page.locator('.pantry-v2')
      await inventory
        .getByRole('textbox', { name: 'Search pantry' })
        .fill('no-matching-item-fixture')
      for (const view of ['Cards', 'Table']) {
        await inventory.getByRole('button', { name: view, exact: true }).click()
        const empty = inventory.locator('.calm-empty')
        await expect(
          empty.getByRole('heading', { name: 'No items match this view.' }),
        ).toBeVisible()
        await expect(
          empty.getByRole('button', { name: /^Add Item/ }),
        ).toBeVisible()
        const geometry = await inventory.evaluate((el) => {
          const results = el
            .querySelector('.pantry-card-grid, .pantry-table')!
            .getBoundingClientRect()
          const empty = el.querySelector('.calm-empty')!.getBoundingClientRect()
          const heading = el
            .querySelector('.calm-empty h3')!
            .getBoundingClientRect()
          const text = el
            .querySelector('.calm-empty p')!
            .getBoundingClientRect()
          const button = el
            .querySelector('.calm-empty button')!
            .getBoundingClientRect()
          return {
            resultsCenter: results.left + results.width / 2,
            emptyCenter: empty.left + empty.width / 2,
            headingCenter: heading.left + heading.width / 2,
            textCenter: text.left + text.width / 2,
            buttonCenter: button.left + button.width / 2,
            width: empty.width,
            resultsWidth: results.width,
            height: empty.height,
          }
        })
        for (const center of [
          geometry.emptyCenter,
          geometry.headingCenter,
          geometry.textCenter,
          geometry.buttonCenter,
        ])
          expect(Math.abs(center - geometry.resultsCenter)).toBeLessThan(2)
        expect(geometry.width).toBeGreaterThan(geometry.resultsWidth - 5)
        expect(geometry.height).toBeLessThan(230)
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        ).toBe(true)
        if (tab === 'Ingredients') {
          await empty.scrollIntoViewIfNeeded()
          await page.screenshot({
            path: testInfo.outputPath(`empty-${view}-${width}.png`),
          })
        }
      }
    }
    expect(writes.every((action) => action === 'pantryView')).toBe(true)
  })
}
