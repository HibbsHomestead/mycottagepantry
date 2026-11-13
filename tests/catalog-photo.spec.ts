import { test, expect } from '@playwright/test'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'
import { demoData } from '../src/lib/demo'
for (const width of [1440, 390])
  test(`catalog and separate package photo review preserve one draft ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 })
    await installWorkspaceFixture(page)
    const workspace = demoData()
    workspace.settings[0].packagePhotoExtractionAllowed = true
    workspace.settings[0].packagePhotoProcessingReady = true
    let saves = 0,
      lookups = 0,
      failed = true,
      photos = 0
    const product = {
      id: 'test-catalog-flour',
      revisionId: 'r1',
      status: 'active',
      kind: 'ingredient',
      entryType: 'branded',
      fields: {
        name: 'Test catalog baking flour',
        brand: 'Cottage Pantry Test Mill',
        barcode: '036000291452',
        subingredients:
          'Wheat (flour, malt). ' +
          'Additional full package ingredient wording. '.repeat(15),
        sourceContains: 'Contains wheat.',
        sourceMayContain: 'May contain soy.',
      },
      reviewScope: 'Synthetic package identity and separate statements checked',
      reviewedAt: '2026-11-07',
      sources: [],
    }
    await page.route('**/api/workspace*', async (route) => {
      const url = route.request().url()
      if (url.includes('catalog')) {
        const input = route.request().postDataJSON()
        lookups++
        if (input.operation === 'lookup' && input.query === '4006381333931')
          return route.fulfill({
            json: {
              version: 1,
              existing: [
                {
                  id: workspace.ingredients[0].id,
                  name: workspace.ingredients[0].name,
                },
              ],
            },
          })
        if (input.operation === 'internet')
          return route.fulfill({
            json: {
              version: 1,
              candidates: [
                {
                  title: 'Unverified flour package page',
                  url: 'https://example.org/unsupported',
                  domain: 'example.org',
                  confirmed: false,
                },
              ],
            },
          })
        if (input.operation === 'lookup' && input.query === '9780201379624')
          return route.fulfill({ json: { version: 1, results: [] } })
        if (failed) {
          failed = false
          return route.fulfill({
            status: 503,
            json: {
              error: 'Synthetic lookup failure; retry preserves your draft.',
            },
          })
        }
        return route.fulfill({ json: { version: 1, results: [product] } })
      }
      if (url.includes('packagePhotos')) {
        photos++
        return route.fulfill({
          json: {
            version: 1,
            fields: [
              {
                field: 'name',
                value: 'Photo baking flour',
                photoId: 'back',
                quote: 'Baking Flour',
                uncertain: false,
              },
              {
                field: 'brand',
                value: 'Uncertain photographed mill',
                photoId: 'back',
                quote: 'Unclear mill name',
                uncertain: true,
              },
              {
                field: 'sourceContains',
                value: 'Contains wheat.',
                photoId: 'back',
                quote: 'Contains wheat.',
                uncertain: false,
              },
            ],
            warnings: ['Check uncertain text against the label.'],
            usage: { inputTokens: 4000, outputTokens: 1000 },
          },
        })
      }
      if (url.includes('productVendors'))
        return route.fulfill({ json: { vendors: workspace.vendors } })
      if (url.includes('productImport'))
        return route.fulfill({
          status: 422,
          json: {
            error:
              'This test page is unsupported. Complete the draft manually.',
          },
        })
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON()
        if (body.action === 'save' && body.table === 'ingredients') {
          saves++
          workspace.ingredients.push({ ...body.data, quantity: 0, cost: 0 })
        }
      }
      return route.fulfill({ json: { workspace, role: 'Owner', demo: false } })
    })
    await page.goto(workspaceFixtureUrl('Inventory/Ingredients'), {
      waitUntil: 'domcontentloaded',
    })
    await page
      .getByRole('button', { name: 'Add Item', exact: true })
      .first()
      .click()
    const modal = page.getByRole('dialog')
    const name = modal.getByLabel('Item name', { exact: true })
    await name.fill('Keep my manual flour')
    await page.screenshot({
      path: `docs/reviews/photo-box/catalog-controls-${width}.png`,
    })
    const barcode = modal.getByLabel('Scan or enter barcode')
    await barcode.fill('4006381333931')
    await barcode.press('Enter')
    await expect(modal.getByText(/Already in your account/)).toBeVisible()
    await modal.getByRole('button', { name: 'Open existing item' }).click()
    await expect(
      modal.getByRole('region', { name: 'Existing item' }),
    ).toBeVisible()
    await modal.getByRole('button', { name: 'Return to draft' }).click()
    await expect(name).toHaveValue('Keep my manual flour')
    expect(saves).toBe(0)
    await barcode.fill('036000291452')
    await barcode.press('Enter')
    await expect(modal.getByRole('alert')).toHaveText(
      /Synthetic lookup failure/,
    )
    await expect(name).toHaveValue('Keep my manual flour')
    await modal.getByRole('button', { name: 'Look up barcode' }).click()
    await expect(modal.getByRole('alert')).toHaveCount(0)
    await modal
      .getByRole('button', { name: 'Review for my ingredients' })
      .click()
    const review = modal.getByRole('region', { name: 'Review imported fields' })
    await expect(
      review.getByRole('checkbox', { name: /Name:/ }),
    ).not.toBeChecked()
    await review
      .getByRole('button', { name: 'Show full text', exact: true })
      .click()
    await review.getByRole('button', { name: 'Show less', exact: true }).click()
    await review.scrollIntoViewIfNeeded()
    await page.screenshot({
      path: `docs/reviews/photo-box/catalog-review-${width}.png`,
    })
    await review.getByRole('button', { name: 'Apply selected values' }).click()
    await expect(name).toHaveValue('Keep my manual flour')
    expect(saves).toBe(0)
    await modal.getByText(/^Read package photos(?: \(optional\))?$/).click()
    await modal
      .getByLabel('Back / label photo', { exact: true })
      .setInputFiles('src/test/fixtures/package-label.png')
    await expect(modal.getByAltText('Back / label photo preview')).toBeVisible()
    await modal
      .getByRole('button', { name: 'Rotate Back / label photo', exact: true })
      .click()
    await expect(
      modal.getByRole('button', { name: 'Extract from photos' }),
    ).toBeEnabled()
    await modal.getByRole('button', { name: 'Extract from photos' }).click()
    await expect(
      modal.getByText('Check uncertain text against the label.'),
    ).toBeVisible()
    await expect(
      modal.getByRole('checkbox', { name: /Brand: Uncertain/ }),
    ).not.toBeChecked()
    await page.screenshot({
      path: `docs/reviews/photo-box/package-photo-review-${width}.png`,
    })
    await expect(name).toHaveValue('Keep my manual flour')
    expect(photos).toBe(1)
    expect(saves).toBe(0)
    await modal
      .getByRole('button', { name: 'Remove Back / label photo' })
      .click()
    await expect(
      modal.getByRole('region', { name: 'Review imported fields' }),
    ).toHaveCount(0)
    await barcode.fill('9780201379624')
    await barcode.press('Enter')
    await modal.getByRole('button', { name: 'Search the internet' }).click()
    await expect(
      modal.getByText('example.org · Unverified candidate'),
    ).toBeVisible()
    await modal.getByRole('button', { name: 'Use this product page' }).click()
    await expect(modal.getByLabel('Product URL', { exact: true })).toHaveValue(
      'https://example.org/unsupported',
    )
    await modal
      .getByRole('button', { name: 'Import details', exact: true })
      .click()
    await expect(modal.getByRole('alert')).toHaveText(/unsupported/)
    await expect(name).toHaveValue('Keep my manual flour')
    const bounds = await modal.evaluate((el) => ({
      scroll: el.scrollWidth,
      width: el.clientWidth,
    }))
    expect(bounds.scroll).toBeLessThanOrEqual(bounds.width + 1)
    expect(lookups).toBe(5)
    expect(saves).toBe(0)
  })
