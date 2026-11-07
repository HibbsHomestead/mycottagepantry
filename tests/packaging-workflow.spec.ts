import { test, expect } from '@playwright/test'
import { demoData } from '../src/lib/demo'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

for (const width of [1440, 390]) {
  test(`packaging workflow and deployment notice at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await installWorkspaceFixture(page)
    const workspace = demoData()
    let published = false
    await page.route('**/app-version.json*', (route) =>
      published
        ? route.fulfill({ json: { version: 'synthetic-new-deployment' } })
        : route.fulfill({ status: 404, body: '' }),
    )
    await page.route('**/api/workspace*', async (route) => {
      if (route.request().method() === 'POST') {
        const { action, table, data } = route.request().postDataJSON()
        if (action === 'save' && table === 'ingredients') {
          workspace.ingredients.push({
            ...data,
            purchaseQuantity: Number(data.purchaseQuantity),
            packagePrice: Number(data.packagePrice),
            quantity: Number(data.purchaseQuantity),
            cost: Number(data.packagePrice) / Number(data.purchaseQuantity),
            currentCost:
              Number(data.packagePrice) / Number(data.purchaseQuantity),
          })
        }
      }
      return route.fulfill({ json: { workspace, role: 'Owner', demo: false } })
    })
    await page.goto(workspaceFixtureUrl('Pantry/Packaging'))
    await page
      .getByRole('button', { name: 'Add packaging', exact: true })
      .first()
      .click()
    const modal = page.getByRole('dialog')
    await expect(
      modal.getByRole('heading', { name: 'Add packaging' }),
    ).toBeVisible()
    await expect(
      modal.getByLabel('Purchase unit', { exact: true }),
    ).toHaveValue('each')
    await expect(modal.getByLabel('Ingredient statement name')).toHaveCount(0)
    await modal.getByLabel('Packaging name').fill('Market bread bags')
    await modal.getByLabel('Purchase quantity', { exact: true }).fill('100')
    await modal.getByLabel('Package price').fill('12')
    await expect(modal.getByText(/\$0.120000 per each/)).toBeVisible()
    expect(
      await modal.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1)
    await modal
      .getByRole('button', { name: 'Save packaging', exact: true })
      .click()
    await expect(modal).toHaveCount(0)
    const card = page.getByRole('article', { name: 'Market bread bags' })
    await card.getByRole('button', { name: 'Edit', exact: true }).click()
    await expect(
      modal.getByRole('heading', { name: 'Edit packaging' }),
    ).toBeVisible()
    await expect(modal.getByLabel('Category', { exact: true })).toHaveValue(
      'packaging',
    )
    await expect(
      modal.getByLabel('Purchase unit', { exact: true }),
    ).toHaveValue('each')
    await expect(
      modal.getByLabel('Package price', { exact: true }),
    ).toHaveValue('12')
    await expect(
      modal.getByLabel('Purchase package quantity', { exact: true }),
    ).toHaveValue('100')
    await expect(
      modal.getByRole('button', { name: 'Close packaging details' }),
    ).toBeVisible()
    await modal.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(
      modal.getByRole('heading', { name: 'Packaging details' }),
    ).toBeVisible()
    await modal.getByRole('button', { name: 'Close', exact: true }).click()
    // A deployment change affects the notice, never causes an automatic reload.
    await page.evaluate(() => {
      ;(window as Window & { updateSentinel?: string }).updateSentinel =
        'still-open'
    })
    published = true
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    const notice = page
      .getByRole('status')
      .filter({ hasText: 'A Cottage Pantry update is available.' })
    await expect(notice).toBeVisible()
    expect(
      await page.evaluate(
        () => (window as Window & { updateSentinel?: string }).updateSentinel,
      ),
    ).toBe('still-open')
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1)
    await page.screenshot({
      path: `/tmp/packaging-update-${width}.png`,
      fullPage: true,
    })
    await notice.getByRole('button', { name: 'Refresh app' }).click()
    await page.waitForLoadState('domcontentloaded')
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as Window & { updateSentinel?: string }).updateSentinel,
        ),
      )
      .toBeUndefined()
    await expect(
      page.getByRole('article', { name: 'Market bread bags' }),
    ).toBeVisible()
  })
}
