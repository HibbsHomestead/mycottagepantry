import { test, expect, type Page } from '@playwright/test'
import { accessFixture } from './account-access-fixture'
import { demoData } from '../src/lib/demo'
import { fabricReceipt, fabricPurchaseCost } from '../src/lib/fabric'
import type { Item } from '../src/lib/domain'

async function fixture(page: Page, signedIn = true) {
  const workspace = demoData()
  workspace.ingredients.push({
    id: 'fabric-check',
    name: 'Indigo cotton',
    materialType: 'fabric',
    fabricTracking: 'length',
    pieceMode: 'separate',
    pieceId: 'IND-1',
    fabricWidth: 44,
    widthUnit: 'in',
    usedAs: 'material',
    category: 'Craft materials',
    unit: 'yd',
    storageUnit: 'yd',
    quantity: 2.25,
    cost: 8,
    currentCost: 8,
    threshold: 0.5,
    color: 'Indigo',
    storageLocation: 'Drawer 2',
  })
  const writes: { action: string; table: string; data: Item }[] = []
  await page.route('**/api/account-access', (route) =>
    route.fulfill({
      json: accessFixture(signedIn ? 'workspace' : 'signed_out'),
    }),
  )
  await page.route('**/.netlify/identity/**', async (route) => {
    if (new URL(route.request().url()).pathname.endsWith('/token')) {
      signedIn = true
      return route.fulfill({
        json: {
          access_token: 'synthetic-oven-session',
          refresh_token: 'synthetic-oven-refresh',
          token_type: 'bearer',
          expires_in: 3600,
        },
      })
    }
    return route.fulfill({
      json: {
        id: 'synthetic-oven-user',
        email: 'synthetic@example.invalid',
        confirmed_at: '2026-01-01T00:00:00Z',
        app_metadata: { roles: [] },
        user_metadata: {},
      },
    })
  })
  await page.route('**/api/workspace*', async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON()
      writes.push(body)
      if (
        body.action === 'save' &&
        body.table === 'ingredients' &&
        body.data.materialType === 'fabric'
      ) {
        const quantity = fabricReceipt(body.data, {
          ...body.data,
          quantity: body.data.purchaseQuantity,
          unit: body.data.purchaseUnit,
        })
        workspace.ingredients.push({
          ...body.data,
          unit: body.data.unit,
          storageUnit: body.data.unit,
          quantity,
          cost:
            fabricPurchaseCost(
              { ...body.data, quantity: body.data.purchaseQuantity },
              body.data.packagePrice,
            ) / quantity,
          currentCost:
            fabricPurchaseCost(
              { ...body.data, quantity: body.data.purchaseQuantity },
              body.data.packagePrice,
            ) / quantity,
          threshold: Number(body.data.threshold) || 0,
          usedAs: 'material',
        })
      }
    }
    return route.fulfill({ json: { workspace, role: 'Owner', demo: true } })
  })
  return { workspace, writes }
}
for (const width of [1440, 390]) {
  test(`oven aliases, refresh, history, naming and navigation at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 960 })
    await fixture(page)
    const trace = 'b5b2cac8-b9a1-42e8-a8d7-318a6832c28b'
    await page.goto('/workspace?accessTrace=' + trace + '#Pantry/Vendors')
    await expect(page.locator('.breadcrumb > span')).toHaveText('My Oven')
    await expect(page.locator('.breadcrumb > span')).toBeVisible()
    await expect(page.locator('.breadcrumb strong')).toHaveText('Purchasing')
    await expect(page).toHaveURL(
      new RegExp('/oven\\?accessTrace=' + trace + '#Purchasing/Suppliers$'),
    )
    await expect(page).toHaveTitle('Suppliers | My Oven | Cottage Pantry')
    await page.reload()
    await expect(page.locator('.breadcrumb strong')).toHaveText('Purchasing')
    await page
      .locator('.section-tabs a', { hasText: 'Purchase Orders' })
      .click()
    await expect(page).toHaveTitle('Purchase Orders | My Oven | Cottage Pantry')
    await page.goBack()
    await expect(page).toHaveTitle('Suppliers | My Oven | Cottage Pantry')
    await page.goForward()
    await expect(page).toHaveTitle('Purchase Orders | My Oven | Cottage Pantry')
    await page.goto('/studio#Inventory/Craft%20Materials')
    await expect(page).toHaveURL(/\/oven#Inventory\/Craft%20Materials$/)
    await expect(
      page.getByRole('article', { name: 'Indigo cotton' }),
    ).toContainText('44 in')
    await expect(
      page.getByRole('article', { name: 'Indigo cotton' }),
    ).toContainText('Separate piece: IND-1')
    await page.screenshot({
      path: `/tmp/oven-fabric-${width}.png`,
      fullPage: true,
    })
    await page
      .getByRole('article', { name: 'Indigo cotton' })
      .getByRole('button', { name: 'View details', exact: true })
      .click()
    await expect(page.getByRole('dialog')).toContainText('2.25 yd')
    await expect(page.getByRole('dialog')).toContainText(
      'Stock movement history',
    )
    await page.keyboard.press('Escape')
    await page.goto('/oven')
    await expect(page.locator('.breadcrumb strong')).toHaveText('Dashboard')
    await expect(page).toHaveTitle('Dashboard | My Oven | Cottage Pantry')
    if (width < 1024) {
      await page.getByRole('button', { name: 'More navigation' }).click()
      await page
        .locator('.sidebar')
        .getByRole('link', { name: 'Products', exact: true })
        .click()
    } else
      await page
        .locator('.sidebar')
        .getByRole('link', { name: 'Products', exact: true })
        .click()
    await expect(page.locator('.breadcrumb strong')).toHaveText('Products')
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1)
  })
  test(`fabric fractions, bolt confirmation and width requirement forms at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 960 })
    const { writes } = await fixture(page)
    await page.goto('/oven#Inventory/Craft%20Materials')
    await page
      .getByRole('button', { name: 'Receive craft material', exact: true })
      .click()
    const dialog = page.getByRole('dialog')
    await dialog
      .getByLabel('Material name', { exact: true })
      .fill('Linen · 54 inch')
    await dialog
      .getByLabel('Material type', { exact: true })
      .selectOption('fabric')
    await dialog.getByLabel('Purchase quantity', { exact: true }).fill('1 1/2')
    await dialog.getByLabel('Fabric width', { exact: true }).fill('54')
    await dialog
      .getByLabel('Total acquisition cost', { exact: true })
      .fill('18')
    await expect(dialog).toContainText('Receive 1.5 yd')
    await dialog.getByLabel('Purchase price entry').selectOption('per_unit')
    await dialog
      .getByLabel('Price per purchase unit', { exact: true })
      .fill('12')
    await expect(dialog).toContainText('$12.00 per yd')
    await dialog.getByLabel('Purchase price entry').selectOption('total')
    await dialog
      .getByLabel('Purchase unit', { exact: true })
      .selectOption('bolt')
    await dialog.getByLabel('Purchase quantity', { exact: true }).fill('1')
    await dialog
      .getByLabel('Usable length per bolt / roll', { exact: true })
      .fill('3 1/2')
    await dialog.getByLabel('I confirmed the usable length').check()
    await expect(dialog).toContainText('Receive 3.5 yd')
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    expect(
      writes.find((w) => w.data.name === 'Linen · 54 inch')!.data,
    ).toMatchObject({
      purchaseQuantity: '1',
      usableLength: '3 1/2',
      purchaseUnit: 'bolt',
      lengthConfirmed: true,
      fabricWidth: '54',
    })
    await page.reload()
    await expect(
      page.getByRole('article', { name: 'Linen · 54 inch' }),
    ).toContainText('3.5 yd')
    await page.goto('/oven#Production/Recipes%20%26%20Designs')
    await page
      .getByRole('button', { name: 'Create handmade design', exact: true })
      .click()
    await dialog.getByLabel('Design name', { exact: true }).fill('Indigo pouch')
    await dialog.getByRole('button', { name: 'Add material line' }).click()
    await dialog
      .getByLabel('Material 1', { exact: true })
      .selectOption('fabric-check')
    await dialog.getByLabel('Quantity 1', { exact: true }).fill('18')
    await dialog.getByLabel('Unit 1', { exact: true }).selectOption('in')
    await dialog.getByLabel('Minimum fabric width 1').fill('45')
    await expect(dialog).toContainText('narrower than the design requires')
    await dialog.getByLabel('Minimum fabric width 1').fill('40')
    await expect(dialog).toContainText('2.25 yd available')
    await expect(dialog).toContainText('$4.00 estimated')
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1)
  })
}
test('login returns to the requested legacy tab with its trace', async ({
  page,
}) => {
  await fixture(page, false)
  await page.goto('/workspace#Pantry/Vendors')
  await expect(page).toHaveURL(/\/login\?/)
  await page
    .getByLabel('Email', { exact: true })
    .fill('synthetic@example.invalid')
  await page
    .getByLabel('Password', { exact: true })
    .fill('synthetic-oven-input')
  await page.getByRole('button', { name: 'Log in', exact: true }).click()
  await expect(page.locator('.breadcrumb strong')).toHaveText('Purchasing')
  await expect(page).toHaveURL(
    /\/oven\?accessTrace=[a-f0-9-]+#Purchasing\/Suppliers$/,
  )
})
test('billing return aliases retain query parameters', async ({ page }) => {
  await fixture(page)
  await page.route('**/api/registration*', (route) =>
    route.fulfill({
      json: {
        workspace: { name: 'Synthetic oven' },
        billing: null,
        attempts: [],
        invoiceHistoryAvailable: false,
      },
    }),
  )
  await page.goto('/workspace/billing?return=provider')
  await expect(page).toHaveURL(/\/oven\/billing\?return=provider$/)
  await expect(page).toHaveTitle('Plan & billing | My Oven | Cottage Pantry')
})
