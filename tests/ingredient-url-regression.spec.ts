import { readFileSync } from 'node:fs'
import { test, expect, type Page } from '@playwright/test'
import { demoData } from '../src/lib/demo'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

// Public responses captured with the real secure fetcher on 2026-11-06.
// Workspace/auth fixtures isolate customer data; these are rendered UI checks,
// not an authenticated deployed-backend acceptance claim.
const baking = JSON.parse(
  readFileSync(
    new URL('./fixtures/sams-baking-soda-2026-11-06.json', import.meta.url),
    'utf8',
  ),
)
const flour = JSON.parse(
  readFileSync(
    new URL('./fixtures/sams-bread-flour-2026-11-06.json', import.meta.url),
    'utf8',
  ),
)
const bakingUrl =
  'https://www.samsclub.com/ip/Arm-Hammer-Pure-Baking-Soda-13-5-lbs/13960262278?classType=REGULAR&athbdg=L1103&from=/search'
const flourUrl =
  'https://www.samsclub.com/ip/Member-s-Mark-Bread-Pizza-Flour-25-lbs/13909715756'

async function setup(page: Page, payload = baking, status = 200) {
  await installWorkspaceFixture(page)
  const workspace = demoData()
  const writes: Record<string, unknown>[] = [],
    urls: string[] = []
  let release: (() => void) | undefined
  let delayed = false
  await page.route('**/api/workspace*', async (route) => {
    const req = route.request()
    if (req.url().includes('productImport')) {
      urls.push(req.postDataJSON().url)
      if (delayed)
        await new Promise<void>((resolve) => {
          release = resolve
        })
      return route.fulfill({ status, json: payload })
    }
    if (req.url().includes('productVendors'))
      return route.fulfill({ json: { vendors: workspace.vendors } })
    if (req.method() === 'POST') writes.push(req.postDataJSON())
    return route.fulfill({ json: { workspace, role: 'Owner', demo: false } })
  })
  return {
    workspace,
    writes,
    urls,
    delay: () => {
      delayed = true
    },
    release: () => release?.(),
  }
}
async function add(page: Page, url = bakingUrl) {
  await page.goto(workspaceFixtureUrl('Inventory/Ingredients'))
  await page.getByRole('button', { name: 'Add Item', exact: true }).click()
  const modal = page.getByRole('dialog')
  await modal.getByLabel('Product URL', { exact: true }).fill(url)
  return modal
}

for (const width of [1440, 390]) {
  test(`exact baking-soda URL fills shared draft and selected offer at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 })
    const f = await setup(page)
    const modal = await add(page)
    const original = await modal.elementHandle()
    const location = page.url()
    await modal
      .getByRole('button', { name: 'Import details', exact: true })
      .click()
    await expect(modal.getByLabel('Item name', { exact: true })).toHaveValue(
      baking.products[0].fields.name,
    )
    await expect(modal.getByLabel('Brand', { exact: true })).toHaveValue(
      'ARM & HAMMER',
    )
    await modal
      .getByLabel('Item name', { exact: true })
      .scrollIntoViewIfNeeded()
    await page.screenshot({
      path: `docs/previews/ingredient-url-after-details-${width}.png`,
    })
    expect(f.urls).toEqual([bakingUrl])
    await modal
      .getByRole('tab', { name: 'Purchase & Stock', exact: true })
      .click()
    await expect(
      modal.getByLabel('Purchase unit', { exact: true }),
    ).toHaveValue('package')
    await expect(modal.getByLabel('Stock unit', { exact: true })).toHaveValue(
      'g',
    )
    await expect(
      modal.getByRole('spinbutton', {
        name: 'Amount in each package',
        exact: true,
      }),
    ).toHaveValue('6123.496995')
    await expect(
      modal.getByLabel('Cost per package', { exact: true }),
    ).toHaveValue('')
    await expect(
      modal.getByLabel('Add what I already have on hand'),
    ).not.toBeChecked()
    await page.screenshot({
      path: `docs/previews/ingredient-url-common-fields-${width}.png`,
    })
    await modal.getByRole('tab', { name: 'Details', exact: true }).click()
    await modal
      .getByLabel('Choose the exact product / package / offer')
      .selectOption('1')
    await expect(
      modal.getByText(/Source Contains statement not available/),
    ).toBeVisible()
    await modal
      .getByRole('tab', { name: 'Ingredients & allergens', exact: true })
      .click()
    await expect(
      modal.getByLabel('Subingredients', { exact: true }),
    ).toHaveValue('Sodium Bicarbonate 100%')
    await expect(
      modal.getByLabel('Source Contains statement', { exact: true }),
    ).toHaveValue('')
    await expect(
      modal.getByLabel('May contain / facility statement', { exact: true }),
    ).toHaveValue('')
    await page.screenshot({
      path: `docs/previews/ingredient-url-statements-${width}.png`,
    })
    await modal.getByRole('tab', { name: 'More', exact: true }).click()
    await expect(
      modal.getByRole('textbox', { name: 'Barcode', exact: true }),
    ).toHaveValue('033200003403')
    await expect(modal.getByLabel('Notes', { exact: true })).toHaveValue(
      baking.products[0].fields.notes,
    )
    await modal
      .getByText('Product source & specifications', { exact: true })
      .click()
    await expect(
      modal.getByRole('textbox', {
        name: 'Retailer product identifier (not internal SKU or barcode)',
        exact: true,
      }),
    ).toHaveValue('13960262278')
    await expect(
      modal.getByRole('textbox', {
        name: 'Listed package contents quantity',
        exact: true,
      }),
    ).toHaveValue('13.5')
    await expect(
      modal.getByRole('textbox', {
        name: 'Listed package contents unit',
        exact: true,
      }),
    ).toHaveValue('lb')
    await expect(
      modal.getByRole('textbox', { name: 'SKU', exact: true }),
    ).toHaveValue('')
    await modal
      .getByRole('tab', { name: 'Purchase & Stock', exact: true })
      .click()
    await expect(
      modal.getByLabel('Cost per package', { exact: true }),
    ).toHaveValue('8.98')
    await expect(
      modal.getByText('Cost per g: $0.00147', { exact: true }),
    ).toBeVisible()
    await expect(
      modal.getByLabel('Supplier / vendor', { exact: true }),
    ).not.toHaveValue('')
    await page.screenshot({
      path: `docs/previews/ingredient-url-after-package-${width}.png`,
    })
    await modal.getByRole('tab', { name: 'Details', exact: true }).click()
    await expect(modal.getByLabel('Item name', { exact: true })).toHaveValue(
      baking.products[0].fields.name,
    )
    // Repeated imports and ordinary rerenders do not erase or reinitialize fields.
    await modal
      .getByLabel('Item name', { exact: true })
      .fill('Reviewed baking soda')
    await modal
      .getByRole('button', { name: 'Import details', exact: true })
      .click()
    await expect(modal.getByLabel('Item name', { exact: true })).toHaveValue(
      'Reviewed baking soda',
    )
    expect(await modal.evaluate((el, before) => el === before, original)).toBe(
      true,
    )
    expect(page.url()).toBe(location)
    expect(page.context().pages()).toHaveLength(1)
    expect(f.writes).toEqual([])
  })

  test(`manual fields stay intact and conflicts can be reviewed at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 })
    const f = await setup(page)
    const modal = await add(page)
    await modal.getByLabel('Item name', { exact: true }).fill('My baking soda')
    await modal.getByLabel('Brand', { exact: true }).fill('Manual brand')
    await modal
      .getByRole('tab', { name: 'Purchase & Stock', exact: true })
      .click()
    await modal.getByLabel('Purchase unit', { exact: true }).selectOption('bag')
    await modal.getByLabel('Stock unit', { exact: true }).selectOption('lb')
    await modal.getByLabel('Amount in each package', { exact: true }).fill('2')
    await modal.getByLabel('Cost per package', { exact: true }).fill('7.25')
    await modal.getByRole('tab', { name: 'Details', exact: true }).click()
    await modal
      .getByRole('button', { name: 'Import details', exact: true })
      .click()
    await modal
      .getByLabel('Choose the exact product / package / offer')
      .selectOption('1')
    await expect(modal.locator('.product-import-current').first()).toBeVisible()
    await modal.getByRole('checkbox', { name: 'Brand', exact: true }).check()
    await modal
      .getByRole('checkbox', { name: 'Amount in each package', exact: true })
      .check()
    await modal
      .getByRole('button', { name: 'Apply selected values', exact: true })
      .click()
    await expect(modal.getByLabel('Brand', { exact: true })).toHaveValue(
      'ARM & HAMMER',
    )
    await expect(modal.getByLabel('Item name', { exact: true })).toHaveValue(
      'My baking soda',
    )
    await modal
      .getByRole('tab', { name: 'Purchase & Stock', exact: true })
      .click()
    await expect(
      modal.getByRole('spinbutton', {
        name: 'Amount in each package',
        exact: true,
      }),
    ).toHaveValue('13.5')
    await expect(
      modal.getByLabel('Purchase unit', { exact: true }),
    ).toHaveValue('bag')
    await expect(
      modal.getByLabel('Cost per package', { exact: true }),
    ).toHaveValue('7.25')
    await expect(
      modal.getByLabel('Add what I already have on hand'),
    ).not.toBeChecked()
    expect(f.writes).toEqual([])
  })
}

test('separate flour URL retains its statement and Contains through all sections', async ({
  page,
}) => {
  const f = await setup(page, flour)
  const modal = await add(page, flourUrl)
  await modal
    .getByRole('button', { name: 'Import details', exact: true })
    .click()
  await expect(modal.getByLabel('Item name', { exact: true })).toHaveValue(
    flour.products[0].fields.name,
  )
  await modal
    .getByLabel('Choose the exact product / package / offer')
    .selectOption('0')
  await modal
    .getByRole('tab', { name: 'Ingredients & allergens', exact: true })
    .click()
  await expect(modal.getByLabel('Subingredients', { exact: true })).toHaveValue(
    flour.products[0].fields.subingredients,
  )
  await expect(
    modal.getByRole('textbox', {
      name: 'Source Contains statement',
      exact: true,
    }),
  ).toHaveValue('Contains wheat.')
  await expect(
    modal.getByLabel('May contain / facility statement', { exact: true }),
  ).toHaveValue('')
  await page.screenshot({
    path: 'docs/previews/ingredient-url-flour-regression.png',
  })
  await modal
    .getByRole('tab', { name: 'Purchase & Stock', exact: true })
    .click()
  await expect(
    modal.getByRole('spinbutton', {
      name: 'Amount in each package',
      exact: true,
    }),
  ).toHaveValue('11339.80925')
  await expect(
    modal.getByLabel('Cost per package', { exact: true }),
  ).toHaveValue('10.98')
  expect(f.urls).toEqual([flourUrl])
  expect(f.writes).toEqual([])
})

test('existing ingredient keeps identity, stock, manual values and reviewed wording', async ({
  page,
}) => {
  const f = await setup(page)
  const item = f.workspace.ingredients.find((i) => i.id === 'yeast')!
  item.brand = ''
  item.reviewed = true
  item.subingredients = 'Manually verified yeast'
  item.sourceMayContain = 'Manual facility advisory'
  const originalItem = structuredClone(item)
  await page.goto(workspaceFixtureUrl('Inventory/Ingredients'))
  await page.getByRole('textbox', { name: 'Search pantry' }).fill('yeast')
  await page
    .getByRole('button', { name: 'Edit Ingredient', exact: true })
    .click()
  const modal = page.getByRole('dialog')
  const original = await modal.elementHandle()
  await modal.getByLabel('Name', { exact: true }).fill('My existing ingredient')
  await modal.getByLabel('Product URL', { exact: true }).fill(bakingUrl)
  await modal
    .getByRole('button', { name: 'Import details', exact: true })
    .click()
  await expect(modal.getByLabel('Brand', { exact: true })).toHaveValue(
    'ARM & HAMMER',
  )
  await modal
    .getByLabel('Choose the exact product / package / offer')
    .selectOption('0')
  await expect(
    modal.getByRole('textbox', { name: 'Name', exact: true }),
  ).toHaveValue('My existing ingredient')
  await modal
    .getByRole('button', { name: 'Clear selection', exact: true })
    .click()
  await modal
    .getByRole('checkbox', { name: 'Source ingredient statement', exact: true })
    .check()
  await expect(
    modal.getByRole('button', { name: 'Apply selected values', exact: true }),
  ).toBeDisabled()
  await modal.getByLabel(/Replace existing reviewed ingredient/).check()
  await modal
    .getByRole('button', { name: 'Apply selected values', exact: true })
    .click()
  await modal.getByText('Label information & notes', { exact: true }).click()
  await expect(
    modal.getByRole('textbox', { name: 'Subingredients text', exact: true }),
  ).toHaveValue('Sodium Bicarbonate 100%')
  await expect(
    modal.getByRole('textbox', {
      name: 'Source May contain / facility statement',
      exact: true,
    }),
  ).toHaveValue('Manual facility advisory')
  await modal.getByText('Label information & notes', { exact: true }).click()
  await modal.getByText('Label information & notes', { exact: true }).click()
  await expect(
    modal.getByRole('textbox', { name: 'Subingredients text', exact: true }),
  ).toHaveValue('Sodium Bicarbonate 100%')
  expect(await modal.evaluate((el, before) => el === before, original)).toBe(
    true,
  )
  expect(f.writes).toEqual([])
  expect(f.workspace.ingredients.find((i) => i.id === item.id)).toEqual(
    originalItem,
  )
  await modal
    .getByRole('button', { name: 'Save changes', exact: true })
    .dblclick()
  await expect.poll(() => f.writes.length).toBe(1)
  expect(f.writes[0]).toMatchObject({
    action: 'ingredientUpdate',
    table: 'ingredients',
    data: {
      id: originalItem.id,
      name: 'My existing ingredient',
      brand: 'ARM & HAMMER',
    },
  })
})

test('partial extraction fills available fields and identifies missing ones', async ({
  page,
}) => {
  const partial = {
    products: [
      { ...baking.products[0], fields: { name: 'Partial baking soda' } },
    ],
  }
  const f = await setup(page, partial)
  const modal = await add(page)
  await modal
    .getByRole('button', { name: 'Import details', exact: true })
    .click()
  await expect(modal.getByLabel('Item name', { exact: true })).toHaveValue(
    'Partial baking soda',
  )
  await expect(modal.getByText(/Price unavailable/)).toBeVisible()
  await expect(
    modal.getByText(/Source Contains statement not available/),
  ).toBeVisible()
  await modal
    .getByRole('tab', { name: 'Purchase & Stock', exact: true })
    .click()
  await expect(
    modal.getByLabel('Cost per package', { exact: true }),
  ).toHaveValue('')
  await expect(
    modal.getByRole('spinbutton', {
      name: 'Amount in each package',
      exact: true,
    }),
  ).toHaveValue('')
  expect(f.writes).toEqual([])
})

for (const [label, payload, status] of [
  ['request failure', { error: 'Service temporarily unavailable' }, 503],
  [
    'extraction failure',
    { error: 'No product data in the retrieved page' },
    400,
  ],
  [
    'invalid response mapping',
    {
      products: [
        { ...baking.products[0], fields: { purchaseQuantity: 'bad' } },
      ],
    },
    200,
  ],
] as const) {
  test(`${label} preserves manual draft and popup`, async ({ page }) => {
    const f = await setup(page, payload, status)
    const modal = await add(page)
    await modal.getByLabel('Item name', { exact: true }).fill('Manual draft')
    await modal
      .getByRole('button', { name: 'Import details', exact: true })
      .click()
    await expect(modal.getByRole('alert').first()).toBeVisible()
    await expect(modal.getByLabel('Item name', { exact: true })).toHaveValue(
      'Manual draft',
    )
    await expect(modal.getByText(/fields filled in this form/)).toHaveCount(0)
    expect(f.writes).toEqual([])
  })
}

test('an image-only response and failed photo do not report applied fields', async ({
  page,
}) => {
  await setup(page, { products: [{ ...baking.products[0], fields: {} }] })
  await page.route('**/api/workspace?productImage=1', (route) =>
    route.fulfill({ status: 503, json: { error: 'Photo unavailable' } }),
  )
  const modal = await add(page)
  await modal
    .getByRole('button', { name: 'Import details', exact: true })
    .click()
  await expect(modal.getByText(/No new fields were filled/)).toBeVisible()
  await modal.getByLabel(/Import product photo/).check()
  await modal
    .getByRole('button', { name: 'Apply selected values', exact: true })
    .click()
  await expect(
    modal.getByText(
      'No usable fields were applied. Your entries are unchanged.',
    ),
  ).toBeVisible()
  await expect(modal.getByLabel('Item name', { exact: true })).toHaveValue('')
})

test('manual edits entered during the request are preserved', async ({
  page,
}) => {
  const f = await setup(page)
  f.delay()
  const modal = await add(page)
  await modal
    .getByRole('button', { name: 'Import details', exact: true })
    .click()
  await expect.poll(() => f.urls.length).toBe(1)
  await modal
    .getByLabel('Item name', { exact: true })
    .fill('Entered while loading')
  f.release()
  await expect(modal.getByLabel('Brand', { exact: true })).toHaveValue(
    'ARM & HAMMER',
  )
  await expect(modal.getByLabel('Item name', { exact: true })).toHaveValue(
    'Entered while loading',
  )
  expect(f.writes).toEqual([])
})
