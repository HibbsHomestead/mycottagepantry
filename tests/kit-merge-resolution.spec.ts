import { test, expect } from '@playwright/test'
import { demoData } from '../src/lib/demo'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

for (const width of [1440, 390]) {
  test(`incomplete kit review action preserves unsaved edits at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 950 })
    await installWorkspaceFixture(page)
    const workspace = demoData()
    workspace.products.push({
      id: 'merge-review-kit',
      name: 'Merge review kit',
      workflow: 'kit',
      status: 'active',
      taxSource: 'category',
      price: 12,
      assemblyMinutes: 0,
      assemblyRate: 0,
      kitComponents: [
        { productId: workspace.products[0].id, quantity: 1, basis: 'package' },
      ],
      packagingLines: [],
    })
    const before = JSON.stringify(workspace)
    const writes: string[] = []
    await page.route('**/api/workspace*', (route) => {
      if (route.request().method() !== 'GET')
        writes.push(route.request().method())
      return route.fulfill({ json: { workspace, role: 'Owner', demo: false } })
    })
    await page.goto(workspaceFixtureUrl('Products/Kits'), {
      waitUntil: 'networkidle',
    })
    await page
      .getByRole('article', { name: 'Merge review kit' })
      .getByRole('button', { name: 'Edit kit', exact: true })
      .click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Whole selling packages').first().fill('2')
    await dialog
      .getByRole('tab', { name: 'Packaging & cost', exact: true })
      .click()
    await dialog.getByLabel('Kit selling price').fill('19.25')
    await dialog
      .getByRole('button', { name: 'Review contents & details', exact: true })
      .first()
      .click()
    await expect(
      dialog.getByRole('tab', { name: 'Contents & details' }),
    ).toHaveAttribute('aria-selected', 'true')
    await expect(
      dialog.getByLabel('Whole selling packages').first(),
    ).toHaveValue('2')
    await dialog
      .getByRole('tab', { name: 'Packaging & cost', exact: true })
      .click()
    await expect(dialog.getByLabel('Kit selling price')).toHaveValue('19.25')
    await expect(dialog.getByRole('status').first()).toContainText(
      'Product category not configured.',
    )
    expect(writes).toEqual([])
    expect(JSON.stringify(workspace)).toBe(before)
  })
}
