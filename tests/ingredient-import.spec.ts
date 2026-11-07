import { test, expect } from '@playwright/test'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'
import { demoData } from '../src/lib/demo'

// Synthetic transport/database boundary: never writes customer records or simulates a real login.
for (const width of [1440, 390]) {
  test(`ingredient import selection, layout and save recovery ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await installWorkspaceFixture(page)
    const workspace = demoData()
    let saves = 0
    let fail = true
    const product = {
      title:
        "Member's Mark Bread & Pizza Flour, 25 lbs. " +
        'Long product name '.repeat(10),
      fields: {
        name: "Member's Mark Bread & Pizza Flour, 25 lbs.",
        brand: "Member's Mark",
        vendor: 'Samsclub.com',
        packageSize: '25 lbs',
        retailerSku: '000123',
        barcode: '001234567890',
        sourceContains: 'Contains wheat.',
        sourceMayContain: 'May contain soy.',
        purchaseQuantity: 25,
        purchaseUnit: 'lb',
        notes: 'Long description '.repeat(300),
        subingredients: 'Source statement requiring review '.repeat(150),
      },
      sourceUrl:
        'https://www.samsclub.com/ip/Member-s-Mark-Bread-Pizza-Flour-25-lbs/13909715756?tracking=' +
        'x'.repeat(900),
      imageUrl: 'https://fixture.example/flour.svg',
      checkedAt: '2026-11-01T12:00:00Z',
      warnings: ['Package size needs checking.'],
      conditions: [],
    }
    await page.route('https://fixture.example/**', (route) =>
      route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="tan"/></svg>',
      }),
    )
    await page.route('**/api/workspace*', async (route) => {
      if (route.request().url().includes('productImage')) {
        const asset = {
          id: 'copied-photo',
          name: 'Permitted test photo',
          fileUrl: product.imageUrl,
        }
        workspace.graphic_assets ||= []
        workspace.graphic_assets.push(asset)
        return route.fulfill({ json: { asset, workspace } })
      }
      if (route.request().url().includes('productVendors'))
        return route.fulfill({ json: { vendors: workspace.vendors } })
      if (route.request().url().includes('productImport'))
        return route.fulfill({ json: { products: [product] } })
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON()
        if (body.action === 'save' && body.table === 'ingredients') {
          saves++
          if (fail)
            return route.fulfill({
              status: 503,
              json: {
                error: 'Test database unavailable',
                code: 'WORKSPACE_SETUP_REQUIRED',
                traceId: 'test-reference',
              },
            })
          workspace.ingredients.push({
            ...body.data,
            unit: 'g',
            quantity: 11339.80925,
            cost: 0.001,
            currentCost: 0.001,
          })
        }
      }
      return route.fulfill({ json: { workspace, role: 'Owner', demo: false } })
    })
    await page.goto(workspaceFixtureUrl('Pantry'), {
      waitUntil: 'domcontentloaded',
    })
    await page
      .getByRole('button', { name: 'Add ingredient', exact: true })
      .first()
      .click()
    const modal = page.getByRole('dialog')
    await modal
      .getByRole('button', { name: 'Save ingredient', exact: true })
      .click()
    await expect(modal.getByText('Enter an ingredient name.')).toBeVisible()
    expect(saves).toBe(0)
    await modal.getByLabel('Product URL').fill(product.sourceUrl)
    await modal
      .getByRole('button', { name: 'Import details', exact: true })
      .click()
    await expect(
      modal.getByText(/Price unavailable—enter manually/),
    ).toBeVisible()
    await modal.getByRole('checkbox', { name: 'Name', exact: true }).check()
    await modal
      .getByRole('checkbox', { name: 'Purchase package quantity', exact: true })
      .check()
    await modal
      .getByRole('checkbox', { name: 'Purchase unit', exact: true })
      .check()
    await expect(modal.getByLabel('Existing vendor')).not.toHaveValue('')
    const selectedVendorId = await modal
      .getByLabel('Existing vendor')
      .inputValue()
    await modal.getByRole('checkbox', { name: 'Vendor', exact: true }).check()
    for (const name of [
      'Source ingredient statement',
      'Source Contains statement',
      'Source May contain statement',
    ])
      await modal.getByRole('checkbox', { name, exact: true }).check()
    await expect(
      modal.getByText('Source package size (confirm unit)', { exact: true }),
    ).toHaveCount(0)
    await expect(
      modal.getByText('Source details', { exact: true }).locator('..'),
    ).not.toHaveAttribute('open')
    await modal.getByText('Expand/Edit description', { exact: true }).click()
    await modal
      .getByLabel('Imported description / notes')
      .fill('Corrected short description')
    await modal
      .getByRole('checkbox', { name: 'Description / notes', exact: true })
      .check()
    await modal.getByText('Expand/Edit description', { exact: true }).click()
    await modal.getByText('Expand/Edit description', { exact: true }).click()
    await expect(modal.getByLabel('Imported description / notes')).toHaveValue(
      'Corrected short description',
    )
    await modal.getByText('Expand/Edit description', { exact: true }).click()
    await modal.getByText('Source details', { exact: true }).press('Enter')
    await expect(
      modal.getByText('Source details', { exact: true }).locator('..'),
    ).toHaveAttribute('open')
    await modal.getByText('Source details', { exact: true }).press('Enter')
    await modal
      .locator('.product-import-statements')
      .screenshot({ path: `/tmp/cottage-product-statements-${width}.png` })
    const metrics = await modal.evaluate((el) => {
      const review = el.querySelector('.product-import-review')!
      const button = Array.from(review.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === 'Apply selected fields',
      )!
      const fields = review.querySelector('.product-import-fields')!
      const footer = el.querySelector('.form-footer')!
      const body = el.querySelector('.ingredient-modal-body')!
      return {
        overflow: el.scrollWidth - el.clientWidth,
        columns: getComputedStyle(fields).gridTemplateColumns.split(' ').length,
        buttonWidth: button.getBoundingClientRect().width,
        buttonHeight: button.getBoundingClientRect().height,
        statementHeight: review
          .querySelector('textarea')!
          .getBoundingClientRect().height,
        sourceUrlVisible: Array.from(review.querySelectorAll('a')).some(
          (a) => a.textContent === a.href,
        ),
        footerVisible: footer.getBoundingClientRect().bottom <= innerHeight,
        bodyBottom: body.getBoundingClientRect().bottom,
        footerTop: footer.getBoundingClientRect().top,
      }
    })
    expect(metrics.overflow).toBeLessThanOrEqual(1)
    expect(metrics.columns).toBe(width === 390 ? 1 : 2)
    expect(metrics.buttonWidth).toBeGreaterThan(120)
    expect(metrics.buttonHeight).toBeLessThan(70)
    expect(metrics.statementHeight).toBeLessThan(160)
    expect(metrics.sourceUrlVisible).toBe(false)
    expect(metrics.footerVisible).toBe(true)
    expect(metrics.bodyBottom).toBeLessThanOrEqual(metrics.footerTop + 1)
    await modal
      .getByRole('button', { name: 'Apply selected fields', exact: true })
      .scrollIntoViewIfNeeded()
    await page.screenshot({
      path: `/tmp/ingredient-import-review-${width}.png`,
    })
    await modal.getByRole('checkbox', { name: /Import product photo/ }).check()
    await modal
      .getByRole('button', { name: 'Apply selected fields', exact: true })
      .click()
    expect(saves).toBe(0)
    await expect(modal.getByRole('status')).toContainText('not saved yet')
    await expect(modal.getByLabel('Brand', { exact: true })).toHaveValue('')
    await expect(
      modal.getByLabel('Package price', { exact: false }).first(),
    ).toHaveValue('')
    await modal
      .getByLabel('Package price', { exact: false })
      .first()
      .fill('10.95')
    await modal
      .getByRole('button', { name: 'Save ingredient', exact: true })
      .click()
    await expect(modal.locator('.ingredient-save-error')).toContainText(
      'HTTP 503',
    )
    await expect(modal.getByLabel('Ingredient / item name')).toHaveValue(
      product.fields.name,
    )
    fail = false
    await modal
      .getByRole('button', { name: 'Save ingredient', exact: true })
      .dblclick()
    await expect(modal).not.toBeVisible()
    expect(
      workspace.ingredients.find((i) => i.name === product.fields.name)
        ?.imageAssetId,
    ).toBe('copied-photo')
    expect(
      workspace.ingredients.find((i) => i.name === product.fields.name),
    ).toMatchObject({
      vendorId: selectedVendorId,
      subingredients: product.fields.subingredients,
      sourceContains: 'Contains wheat.',
      sourceMayContain: 'May contain soy.',
      reviewed: false,
      notes: 'Corrected short description',
    })
    expect(workspace.vendors).toHaveLength(demoData().vendors.length)
    expect(saves).toBe(2) // one failed request and one successful request, despite double click
    expect(
      workspace.ingredients.filter((i) => i.name === product.fields.name),
    ).toHaveLength(1)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(
      page.getByRole('button', { name: product.fields.name, exact: true }),
    ).toBeVisible()
    await page
      .getByRole('button', { name: product.fields.name, exact: true })
      .click()
    await expect(page.getByRole('dialog')).toContainText(product.fields.name)
    await page
      .getByRole('button', { name: 'Edit ingredient', exact: true })
      .first()
      .click()
    await page.getByText('Label information & notes', { exact: true }).click()
    await expect(page.getByLabel('Subingredients text')).toHaveValue(
      product.fields.subingredients,
    )
    await expect(
      page.getByRole('textbox', {
        name: 'Source Contains statement',
        exact: true,
      }),
    ).toHaveValue('Contains wheat.')
    await expect(
      page.getByRole('textbox', {
        name: 'Source May contain / facility statement',
        exact: true,
      }),
    ).toHaveValue('May contain soy.')
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(
      page
        .getByRole('dialog')
        .getByAltText(`Photo of ${product.fields.name}`)
        .first(),
    ).toBeVisible()
  })
}

for (const width of [1440, 390]) {
  test(`manual ingredient saves once without URL or photo and reloads ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await installWorkspaceFixture(page)
    const workspace = demoData()
    let saves = 0
    await page.route('**/api/workspace*', async (route) => {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON()
        if (body.action === 'save' && body.table === 'ingredients') {
          saves++
          workspace.ingredients.push({
            ...body.data,
            unit: 'g',
            quantity: 1000,
            cost: 0.005,
            currentCost: 0.005,
          })
        }
      }
      return route.fulfill({ json: { workspace, role: 'Owner', demo: false } })
    })
    await page.goto(workspaceFixtureUrl('Pantry'), {
      waitUntil: 'domcontentloaded',
    })
    await page
      .getByRole('button', { name: 'Add ingredient', exact: true })
      .first()
      .click()
    const modal = page.getByRole('dialog')
    await modal
      .getByLabel('Ingredient / item name')
      .fill('Manual persistence test flour')
    await modal.getByLabel('Package quantity', { exact: true }).fill('1')
    await modal
      .getByRole('combobox', { name: 'Purchase unit', exact: true })
      .selectOption('kg')
    await modal.getByLabel('Package price', { exact: false }).fill('5')
    await modal
      .getByRole('button', { name: 'Save ingredient', exact: true })
      .dblclick()
    await expect(modal).not.toBeVisible()
    expect(saves).toBe(1)
    expect(
      workspace.ingredients.filter(
        (i) => i.name === 'Manual persistence test flour',
      ),
    ).toHaveLength(1)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page
      .getByRole('button', {
        name: 'Manual persistence test flour',
        exact: true,
      })
      .click()
    await expect(page.getByRole('dialog')).toContainText(
      'Manual persistence test flour',
    )
  })
}
