import { expect, test } from '@playwright/test'
import { demoData } from '../src/lib/demo'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

for (const width of [1440, 390, 320]) {
  test(`shared product editor footer and description at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await installWorkspaceFixture(page)
    const workspace = demoData()
    const product = workspace.products[0]
    let writes = 0
    await page.route('**/api/workspace*', (route) => {
      if (route.request().method() === 'POST') writes++
      return route.fulfill({ json: { workspace, role: 'Owner', demo: false } })
    })
    await page.goto(workspaceFixtureUrl('Products/Food'))
    const card = page.getByRole('article', { name: product.name, exact: true })
    await card.getByRole('button', { name: /^View details for / }).click()
    await page
      .getByRole('button', { name: 'Edit Product', exact: true })
      .click()
    const editor = page.getByRole('dialog').first()
    await expect(
      editor.getByRole('heading', { name: 'Edit Product', exact: true }),
    ).toBeVisible()
    await expect(
      editor.getByText('COTTAGE PANTRY · YOUR OVEN', { exact: true }),
    ).toHaveCount(0)
    const row = editor.locator('.description-generate-row')
    await row.scrollIntoViewIfNeeded()
    await expect(row.getByText(/For future customer use/)).toBeVisible()
    const generate = row.getByRole('button', { name: 'Generate description' })
    await expect(generate).toBeVisible()
    await expect(generate.locator('.description-generate-label')).toBeVisible()
    const positions = await row.evaluate((el) => {
      const text = el.querySelector('p')!.getBoundingClientRect()
      const button = el.querySelector('button')!.getBoundingClientRect()
      return {
        tx: text.x,
        ty: text.y,
        tb: text.bottom,
        bx: button.x,
        by: button.y,
      }
    })
    if (width > 540) {
      expect(Math.abs(positions.ty - positions.by)).toBeLessThan(3)
      expect(positions.bx).toBeGreaterThan(positions.tx)
    } else expect(positions.by).toBeGreaterThanOrEqual(positions.tb)
    await editor
      .getByLabel(/Product description/)
      .fill('Isolated unsaved description')
    const back = editor.getByRole('button', {
      name: 'Back to product details',
      exact: true,
    })
    await back.scrollIntoViewIfNeeded()
    await expect(back).toBeVisible()
    await expect(
      editor
        .locator('.form-footer')
        .getByRole('button', { name: 'Save Changes', exact: true }),
    ).toBeVisible()
    expect(
      await editor.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true)
    page.once('dialog', (dialog) => dialog.dismiss())
    await back.click()
    await expect(
      editor.getByRole('heading', { name: 'Edit Product', exact: true }),
    ).toBeVisible()
    await expect(editor.getByLabel(/Product description/)).toHaveValue(
      'Isolated unsaved description',
    )
    page.once('dialog', (dialog) => dialog.accept())
    await back.click()
    await expect(
      page.getByRole('button', { name: 'Edit Product', exact: true }),
    ).toBeVisible()
    expect(writes).toBe(0)
    await page.unrouteAll({ behavior: 'ignoreErrors' })
  })
}
