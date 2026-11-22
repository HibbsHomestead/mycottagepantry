import { test, expect } from '@playwright/test'
import { demoData } from '../src/lib/demo'
import { blankLabel, newElement } from '../src/lib/label-studio'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

for (const width of [1440, 390]) {
  test(`position controls and deselection ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    await installWorkspaceFixture(page)
    const workspace = demoData()
    const element = {
      ...newElement('text', 'Position specimen'),
      x: 36,
      y: 40,
      width: 100,
      height: 30,
    }
    workspace.label_templates = [
      {
        ...blankLabel(),
        id: 'position-label',
        name: 'Position test',
        workflowVersion: 1,
        recordKind: 'label',
        source: { kind: 'product', id: workspace.products[0].id },
        productId: workspace.products[0].id,
        manualTextReviewedFor: `product:${workspace.products[0].id}:`,
        revision: 1,
        width: 288,
        height: 216,
        elements: [element],
      },
    ]
    workspace.settings[0].labelEditorScope = 'position-fixture'
    await page.route('**/api/workspace*', async (route) => {
      if (route.request().method() === 'POST') {
        const { action, data } = route.request().postDataJSON()
        if (action === 'labelSave')
          workspace.label_templates = [
            {
              ...data.document,
              revision: (workspace.label_templates[0].revision || 1) + 1,
              savedAt: new Date().toISOString(),
              lastSaveOperationId: data.operationId,
            },
          ]
      }
      await route.fulfill({ json: { workspace, role: 'Owner', demo: false } })
    })
    await page.goto(workspaceFixtureUrl('Labels'))
    await page
      .locator('.studio-label-row')
      .getByRole('button', { name: 'Edit Position test', exact: true })
      .click()
    const target = page
      .locator(`.studio-paper [data-element="${element.id}"]`)
      .first()
    await target.click()
    // Section is labelled and has one Arrange and Layers tab.
    const panel = page.locator('.studio-position-panel')
    await expect(panel.getByLabel('Alignment reference')).toHaveValue('safe')
    await expect(panel.locator('details')).not.toHaveAttribute('open', '')
    await panel.getByRole('button', { name: 'Left', exact: true }).click()
    await expect(target).toHaveAttribute(
      'transform',
      'translate(9 40) rotate(0)',
    )
    await panel.getByLabel('Alignment reference').selectOption('edges')
    await panel.getByRole('button', { name: 'Left', exact: true }).click()
    await expect(target).toHaveAttribute(
      'transform',
      'translate(0 40) rotate(0)',
    )
    await page.getByRole('button', { name: 'Zoom out', exact: true }).click()
    await panel.getByRole('button', { name: 'Right', exact: true }).click()
    await expect(target).toHaveAttribute(
      'transform',
      'translate(188 40) rotate(0)',
    )
    await panel.getByText('Advanced', { exact: true }).click()
    await panel.getByLabel('X position (in)').fill('0.75')
    await expect(target).toHaveAttribute(
      'transform',
      'translate(54 40) rotate(0)',
    )
    await panel.getByLabel('X position (in)').press('Escape')
    await expect(page.locator('[data-selection-overlay]')).toHaveCount(1)
    await panel.getByRole('tab', { name: 'Layers', exact: true }).click()
    await expect(
      panel.getByRole('button', { name: 'Position specimen', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true')
    await panel
      .getByRole('button', { name: 'Position specimen', exact: true })
      .click()
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-selection-overlay]')).toHaveCount(0)
    await target.click()
    await page
      .locator('.studio-scroll-stage')
      .click({ position: { x: 8, y: 30 } })
    await expect(page.locator('[data-selection-overlay]')).toHaveCount(0)
    await target.click()
    await page
      .locator('.studio-paper svg')
      .click({ position: { x: 300, y: 240 } })
    await expect(page.locator('[data-selection-overlay]')).toHaveCount(0)
    await target.click()
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText(/^Saved ·/)).toBeVisible()
    expect(workspace.label_templates[0].elements[0]).toMatchObject({
      ...JSON.parse(JSON.stringify(element)),
      x: 54,
    })
    await page.screenshot({
      path: `docs/reviews/editor-position/position-${width}.png`,
      fullPage: true,
    })
    await page.reload()
    await page
      .locator('.studio-label-row')
      .getByRole('button', { name: 'Edit Position test', exact: true })
      .click()
    await expect(target).toHaveAttribute(
      'transform',
      'translate(54 40) rotate(0)',
    )
    await page
      .getByRole('button', { name: 'Preview/Print', exact: true })
      .click()
    await expect(
      page.locator('.studio-print-preview svg').first(),
    ).toHaveAttribute('viewBox', '0 0 288 216')
    await expect(
      page
        .locator(`.studio-print-preview [data-element="${element.id}"]`)
        .first(),
    ).toHaveAttribute('transform', 'translate(54 40) rotate(0)')
  })
  test(`compact packaging rows ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    await installWorkspaceFixture(page)
    const workspace = demoData(),
      items = workspace.ingredients.filter((i) => i.usedAs === 'packaging')
    const product = workspace.products[0]
    product.packagingLines = [
      {
        ingredientId: items[0].id,
        quantity: 2,
        unit: 'each',
        required: false,
        notes: 'Keep dry',
      },
      {
        ingredientId: items.at(-1)!.id,
        quantity: 1,
        unit: 'each',
        required: true,
      },
    ]
    product.packagingId = ''
    let writes = 0
    await page.route('**/api/workspace*', (route) => {
      if (route.request().url().includes('Categories'))
        return route.fulfill({
          json: {
            categories: [],
            products: workspace.products,
            recipes: workspace.recipes,
            revision: 1,
            mappings: {},
            rates: [],
          },
        })
      if (route.request().method() === 'POST') {
        writes++
        const { action, table, data } = route.request().postDataJSON()
        if (action === 'save' && table === 'products' && data.id === product.id)
          Object.assign(product, data)
      }
      return route.fulfill({ json: { workspace, role: 'Owner', demo: false } })
    })
    await page.goto(workspaceFixtureUrl('Products/Food'))
    await page
      .getByRole('button', { name: `Edit ${product.name}`, exact: true })
      .first()
      .click()
    const dialog = page.getByRole('dialog'),
      section = dialog.locator('.compact-packaging')
    const rows = section.locator('.packaging-editor')
    await expect(rows).toHaveCount(2)
    await rows.first().scrollIntoViewIfNeeded()
    await expect(rows.first().locator('details')).not.toHaveAttribute(
      'open',
      '',
    )
    await page.screenshot({
      path: `docs/reviews/editor-position/packaging-${width}.png`,
      fullPage: true,
    })
    const bounds = await rows.first().boundingBox()
    expect(bounds!.height).toBeLessThan(width > 700 ? 120 : 180)
    expect(
      await section.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true)
    await rows.first().locator('summary').click()
    await expect(rows.first().getByLabel('Required')).not.toBeChecked()
    await expect(rows.first().getByLabel('Notes')).toHaveValue('Keep dry')
    await expect(rows.first().getByLabel('Notes')).toBeVisible()
    expect(await section.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
    await rows.first().locator('summary').click()
    await rows
      .first()
      .getByRole('button', { name: 'Packaging item', exact: true })
      .click()
    await expect(page.getByLabel('Search packaging items')).toBeVisible()
    await page.getByLabel('Search packaging items').fill(items[0].name)
    await page
      .locator('.packaging-item-options')
      .getByRole('button', { name: items[0].name, exact: true })
      .click()
    await section.getByRole('button', { name: '+ Add packaging item' }).click()
    await expect(rows).toHaveCount(3)
    await expect(
      rows.last().getByRole('button', { name: 'Packaging item', exact: true }),
    ).toBeFocused()
    await rows
      .last()
      .getByRole('button', { name: 'Remove packaging item', exact: true })
      .click()
    await expect(rows).toHaveCount(2)
    expect(writes).toBe(0)
    await section.scrollIntoViewIfNeeded()
    await page.screenshot({
      path: `docs/reviews/editor-position/packaging-${width}.png`,
      fullPage: true,
    })
    await rows.first().getByLabel('Quantity').fill('5')
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    expect(writes).toBe(0)
    await page
      .getByRole('button', { name: `Edit ${product.name}`, exact: true })
      .first()
      .click()
    await expect(rows.first().getByLabel('Quantity')).toHaveValue('2')
    await rows.first().getByLabel('Quantity').fill('3')
    await dialog
      .getByRole('button', { name: 'Save Changes', exact: true })
      .click()
    await expect(dialog).toHaveCount(0)
    expect(writes).toBe(1)
    expect(product.packagingLines[0]).toMatchObject({
      quantity: '3',
      required: false,
      notes: 'Keep dry',
    })
    await page
      .getByRole('button', { name: `Edit ${product.name}`, exact: true })
      .first()
      .click()
    await expect(rows.first().getByLabel('Quantity')).toHaveValue('3')
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  })
}
