import { test, expect } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { fetchProductDetails } from '../netlify/lib/product-import'
import { ProductImportFailure } from '../src/lib/product-import-diagnostics'
import { demoData } from '../src/lib/demo'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

test('reported Amazon ASIN through the rendered Packaging import with real protected retrieval', async ({
  page,
}) => {
  test.skip(
    !process.env.TEST_AMAZON_UI,
    'Opt-in external retrieval; workspace and uploads remain isolated fixtures.',
  )
  test.setTimeout(100000)
  page.setDefaultTimeout(10000)
  const url =
    'https://www.amazon.com/Aluminum-Disposable-Containers-Roasting-Blackgold/dp/B0G4WLFMWV/'
  const workspace = demoData()
  workspace.graphic_assets = [
    { id: 'owner-photo', name: 'Owner photo', fileUrl: '/owner-photo.svg' },
  ]
  const outcomes: object[] = []
  let writes = 0
  let success = false
  await installWorkspaceFixture(page)
  await page.route('**/owner-photo.svg', (r) =>
    r.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120"><rect width="200" height="120" fill="#ece7cc"/></svg>',
    }),
  )
  await page.route('**/api/workspace*', async (route) => {
    if (route.request().url().includes('productImport')) {
      const input = route.request().postDataJSON()
      expect(input.url).toBe(url)
      try {
        const products = await fetchProductDetails(input.url)
        outcomes.push({ products })
        success = true
        return route.fulfill({ json: { products } })
      } catch (error) {
        if (!(error instanceof ProductImportFailure)) throw error
        outcomes.push({
          diagnostics: error.diagnostics,
          retryAfter: error.retryAfter || null,
        })
        return route.fulfill({
          status: 400,
          headers: error.retryAfter ? { 'retry-after': error.retryAfter } : {},
          json: { error: error.message, diagnostics: error.diagnostics },
        })
      }
    }
    if (route.request().method() === 'POST') writes++
    return route.fulfill({ json: { workspace, role: 'Owner', demo: false } })
  })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(workspaceFixtureUrl('Inventory/Packaging'), {
    waitUntil: 'domcontentloaded',
  })
  await page.getByRole('button', { name: 'Add Item', exact: true }).click()
  const modal = page.getByRole('dialog')
  const original = await modal.elementHandle()
  await modal
    .getByLabel('Item name', { exact: true })
    .fill('Owner roasting pan draft')
  await modal.getByLabel('Brand', { exact: true }).fill('Owner brand')
  await modal
    .getByRole('combobox', { name: 'Photo', exact: true })
    .selectOption('owner-photo')
  await modal
    .getByRole('tab', { name: 'Purchase & Stock', exact: true })
    .click()
  await modal.getByLabel('Purchase unit', { exact: true }).selectOption('case')
  await modal.getByLabel('Amount in each package', { exact: true }).fill('24')
  await modal.getByLabel('Cost per package', { exact: true }).fill('12.50')
  await modal.getByRole('tab', { name: 'Details', exact: true }).click()
  await modal.getByLabel('Product URL', { exact: true }).fill(url)
  await modal
    .getByRole('button', { name: 'Import details', exact: true })
    .click()
  await expect(
    modal.getByRole('button', { name: 'Import details', exact: true }),
  ).toBeVisible({ timeout: 35000 })
  if (!success) {
    await expect(modal.getByRole('alert').first()).toContainText(
      'entries are preserved',
    )
    const retry = modal.getByRole('button', { name: 'Retry', exact: true })
    await expect(retry).toBeEnabled({ timeout: 6000 })
    await retry.click()
    await expect(
      modal.getByRole('button', { name: 'Import details', exact: true }),
    ).toBeVisible({ timeout: 35000 })
  }
  expect(await original!.evaluate((el) => el.isConnected)).toBe(true)
  await expect(modal.getByLabel('Item name', { exact: true })).toHaveValue(
    'Owner roasting pan draft',
  )
  await expect(
    modal.getByRole('textbox', { name: 'Brand', exact: true }),
  ).toHaveValue('Owner brand')
  await expect(
    modal.getByRole('combobox', { name: 'Photo', exact: true }),
  ).toHaveValue('owner-photo')
  if (success) {
    const outcome = outcomes.at(-1) as {
      products: Awaited<ReturnType<typeof fetchProductDetails>>
    }
    expect(
      outcome.products.every((p) => p.fields.retailerSku === 'B0G4WLFMWV'),
    ).toBe(true)
    expect(outcome.products[0].title).toMatch(/50 Pack.*8"x8".*Aluminum Pans/i)
    await expect(
      modal.getByRole('button', { name: 'Select all', exact: true }),
    ).toBeVisible()
    await expect(
      modal.getByRole('checkbox', { name: /Import product photo/ }),
    ).not.toBeChecked()
    await expect(
      modal.getByRole('checkbox', {
        name: 'Purchase package quantity',
        exact: true,
      }),
    ).toHaveCount(0)
  } else {
    await modal
      .getByRole('button', { name: 'Enter details manually', exact: true })
      .click()
    await expect(modal.getByLabel('Item name', { exact: true })).toBeFocused()
    await modal
      .getByLabel('Item name', { exact: true })
      .fill('Manually confirmed roasting pans')
    await modal
      .getByRole('button', { name: 'Paste product text instead' })
      .click()
    await modal
      .getByLabel('Product text / notes', { exact: true })
      .fill('Owner notes retained after Amazon failure.')
  }
  await modal.locator('.add-item-body').evaluate((el) => {
    el.scrollTop = 0
  })
  await page.screenshot({
    path: 'docs/previews/amazon-B0G4WLFMWV-rendered-1440.png',
  })
  await modal
    .getByRole('tab', { name: 'Purchase & Stock', exact: true })
    .click()
  await expect(modal.getByLabel('Purchase unit', { exact: true })).toHaveValue(
    'case',
  )
  await expect(
    modal.getByLabel('Amount in each package', { exact: true }),
  ).toHaveValue('24')
  await expect(
    modal.getByLabel('Cost per package', { exact: true }),
  ).toHaveValue('12.50')
  expect(writes).toBe(0)
  await writeFile(
    'docs/amazon-B0G4WLFMWV-rendered.json',
    JSON.stringify(
      {
        retrieval:
          'real protected HTTPS importer, rendered React popup; workspace/authentication isolated with fixtures',
        outcomes,
        result: success
          ? 'Live review available; no fields applied or saved'
          : 'Live upstream retrieval unavailable; failure, retry and manual draft preservation verified',
        writes,
      },
      null,
      2,
    ) + '\n',
  )
})
