import { expect, test } from '@playwright/test'
import { handleProduction } from '../netlify/lib/production-handler'
import { handleProductWorkflow } from '../netlify/lib/product-workflow-handler'
import type { Item } from '../src/lib/domain'
import { mixedPackFixture } from '../src/test/fixtures/mixed-pack'
import { installWorkspaceFixture, workspaceFixtureUrl } from './workspace-fixture'

for (const width of [1440, 390]) {
  test(`edits and reopens mixed contents on a ${width}px viewport`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1050 })
    await installWorkspaceFixture(page)
    const { workspace, pack } = mixedPackFixture()
    const context = {
      state: workspace,
      today: '2026-11-25',
      actor: 'Isolated fixture',
      audit: async () => {},
      save: async (table: string, item: Item) => {
        workspace[table] = [...workspace[table].filter((row) => row.id !== item.id), structuredClone(item)]
      },
    }
    await page.route('**/api/workspace*', async (route) => {
      const request = route.request()
      if (request.method() === 'POST') {
        const { action, table, data } = request.postDataJSON()
        try {
          const handled = action.startsWith('production')
            ? await handleProduction(action, table, data, context)
            : await handleProductWorkflow(action, table, data, context)
          if (!handled) throw new Error(`Fixture does not support ${action}`)
        } catch (error) {
          return route.fulfill({ status: 400, json: { error: (error as Error).message } })
        }
      }
      return route.fulfill({ json: { workspace, role: 'Owner', demo: false } })
    })
    await page.goto(workspaceFixtureUrl('Products/Food'))
    const card = page.getByRole('article', { name: pack.name })
    await card.getByRole('button', { name: pack.name, exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Edit mixed pack', exact: true }).first().click()
    const expected = dialog.getByLabel('Expected contents count (optional)')
    const basis = dialog.getByLabel('Stock basis for the next component')
    const source = dialog.getByLabel('Add source product / recipe variant')
    await basis.selectOption('package')
    await expect(source.locator('option', { hasText: 'Wrapped blueberry muffin' })).toHaveCount(1)
    await basis.selectOption('unpackaged')
    await expect(source.locator('option', { hasText: 'Wrapped blueberry muffin' })).toHaveCount(0)
    await expected.fill('7')
    await expect(dialog.getByText('Contents count mismatch: 6 selected; expected 7.').first()).toBeVisible()
    await expected.fill('6')
    await expect(dialog.getByText('6 muffins total')).toBeVisible()
    await expect(dialog.getByText('1 six-count container')).toBeVisible()
    if (width === 390) await dialog.locator('.kit-editor-component').first().evaluate((element) => element.scrollIntoView({ block: 'start' }))
    else await dialog.getByLabel('Unpackaged quantity · Cranberry muffins').scrollIntoViewIfNeeded()
    await dialog.screenshot({ path: testInfo.outputPath(`contents-${width}.png`) })
    await dialog.getByRole('tab', { name: 'Packaging & cost' }).click()
    await expect(dialog.getByText('Total / mixed pack: $4.75')).toBeVisible()
    if (width === 1440) {
      await dialog.getByText('3 × Cranberry muffins: $1.95').scrollIntoViewIfNeeded()
      await dialog.screenshot({ path: testInfo.outputPath('cost.png') })
    }
    await dialog.getByRole('button', { name: 'Save mixed pack' }).click()
    await dialog.getByRole('button', { name: 'Edit mixed pack', exact: true }).first().click()
    await expect(expected).toHaveValue('6')
    await expect(dialog.getByLabel('Unpackaged quantity · Cranberry muffins')).toHaveValue('3')
    if (width !== 1440) return
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await dialog.getByRole('button', { name: 'Assemble' }).click()
    await dialog.getByLabel('Planned mixed packs').fill('10')
    await expect(dialog.getByText(/Blueberry muffins · 30 muffin units/)).toBeVisible()
    await expect(dialog.getByText(/Cranberry muffins · 30 muffin units/)).toBeVisible()
    await expect(dialog.getByText('six-count container: 10 each required')).toBeVisible()
    await expect(dialog.getByText('Mixed pack labels: 20 each required')).toBeVisible()
    await dialog.getByText(/Blueberry muffins · 30 muffin units/).click()
    const blueberry = dialog.locator('details').filter({ has: page.locator('summary').filter({ hasText: /Blueberry muffins · 30 muffin units/ }) }).last()
    await blueberry.getByLabel('Round up to whole recipe batches').check()
    await expect(dialog.getByText(/36 muffin units · 30 for this plan · 6 extra/)).toBeVisible()
    await dialog.locator('fieldset.production-product-line').screenshot({ path: testInfo.outputPath('production.png'), style: '[data-sonner-toaster] { visibility: hidden !important; }' })
    await dialog.getByRole('button', { name: 'Save mixed pack & component plan' }).click()
    await dialog.getByRole('button', { name: 'Assortment labels for this run' }).click()
    await expect(page.getByLabel('Total label copies for this job')).toHaveValue('10')
    await page.getByRole('button', { name: 'Build actual-size preview' }).click()
    const preview = page.frameLocator('iframe[title="Actual-size assortment label"]')
    await expect(preview.getByText('3 Blueberry muffins · 3 Cranberry muffins')).toBeVisible()
    await expect(preview.getByText(/Ingredients:.*blueberry fruit/)).toBeVisible()
    await expect(preview.getByText(/Ingredients:.*cranberry fruit/)).toBeVisible()
    await preview.locator('article').screenshot({ path: testInfo.outputPath('label.png') })
  })
}
