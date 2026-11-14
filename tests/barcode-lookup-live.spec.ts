import { test, expect } from '@playwright/test'
import { handleCatalog } from '../netlify/lib/catalog-handler'
import { fetchProductDetails } from '../netlify/lib/product-import'
import { demoData } from '../src/lib/demo'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

// Opt-in: real provider requests, isolated workspace and quota records.
test.describe('reported marmalade barcode with live providers', () => {
  test.skip(
    !process.env.TEST_BARCODE_LIVE,
    'Requires configured provider runtime.',
  )
  for (const width of [390, 1440])
    test(`scanner to product review ${width}`, async ({ page }) => {
      test.setTimeout(120000)
      globalThis.Netlify = {
        env: { get: (key: string) => process.env[key] },
      } as typeof globalThis.Netlify
      const workspace = demoData()
      let writes = 0
      await installWorkspaceFixture(page)
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'mediaDevices', {
          value: {
            getUserMedia: async () => {
              const canvas = document.createElement('canvas')
              canvas.width = 320
              canvas.height = 240
              canvas.getContext('2d')!.fillRect(0, 0, 320, 240)
              return canvas.captureStream(5)
            },
          },
        })
        Object.assign(window, {
          BarcodeDetector: class {
            static async getSupportedFormats() {
              return [
                'upc_a',
                'upc_e',
                'ean_13',
                'ean_8',
                'code_128',
                'qr_code',
              ]
            }
            async detect() {
              return [{ rawValue: '051500141335', format: 'upc_a' }]
            }
          },
        })
      })
      await page.route('**/api/workspace*', async (route) => {
        const url = route.request().url()
        if (url.includes('catalog=1')) {
          const body = route.request().postDataJSON()
          expect(body.query).toBe('051500141335')
          const result = await handleCatalog(
            new Request(url, { method: 'POST', body: JSON.stringify(body) }),
            {
              client: { query: async () => ({ rows: [] }) },
              org: 'isolated-browser-fixture',
              actor: 'fixture-owner',
              role: 'Owner',
              state: workspace,
            },
          )
          const data = await result.json()
          console.log(
            'Live barcode lookup',
            JSON.stringify({ status: result.status, ...data }),
          )
          return route.fulfill({ status: result.status, json: data })
        }
        if (url.includes('productImport=1')) {
          const { url: source } = route.request().postDataJSON()
          try {
            const products = await fetchProductDetails(source)
            console.log(
              'Live product fields',
              JSON.stringify(
                products.map((p) => ({
                  title: p.title,
                  fields: p.fields,
                  photoAvailable: !!p.imageUrl,
                })),
              ),
            )
            return route.fulfill({ json: { products } })
          } catch (error) {
            return route.fulfill({
              status: 422,
              json: {
                error: error instanceof Error ? error.message : 'Import failed',
              },
            })
          }
        }
        if (route.request().method() === 'POST') writes++
        return route.fulfill({
          json: { workspace, role: 'Owner', demo: false },
        })
      })
      await page.setViewportSize({ width, height: 900 })
      await page.goto(workspaceFixtureUrl('Inventory/Ingredients'), {
        waitUntil: 'domcontentloaded',
      })
      await page
        .getByRole('button', { name: 'Add Item', exact: true })
        .first()
        .click()
      let modal = page.getByRole('dialog')
      await modal.getByLabel('Item name', { exact: true }).fill('Keep my draft')
      await modal
        .getByRole('button', { name: 'Scan Barcode', exact: true })
        .click()
      await page.getByRole('button', { name: 'Start rear camera' }).click()
      modal = page.getByRole('dialog')
      await expect(modal.getByLabel('Item name', { exact: true })).toHaveValue(
        'Keep my draft',
      )
      await expect(modal.getByLabel('Barcode', { exact: true })).toHaveValue(
        '051500141335',
      )
      const candidates = modal
        .locator('.catalog-result')
        .filter({ hasText: 'Unverified candidate' })
      await expect(candidates.first()).toBeVisible({ timeout: 40000 })
      const official = candidates.filter({ hasText: /smuckers\.com/i }).first()
      await ((await official.count()) ? official : candidates.first())
        .getByRole('button', { name: 'Use this product page' })
        .click()
      await modal
        .getByRole('button', { name: 'Import details', exact: true })
        .click()
      await expect(
        modal.getByText(/fields filled in this form|No new fields were filled/),
      ).toBeVisible({ timeout: 45000 })
      await expect(modal.getByLabel('Item name', { exact: true })).toHaveValue(
        'Keep my draft',
      )
      await expect(
        modal.getByRole('checkbox', { name: /Import product photo/ }),
      ).toBeVisible()
      await expect(
        modal.getByRole('checkbox', { name: /Import product photo/ }),
      ).not.toBeChecked()
      await modal
        .getByRole('button', { name: 'Apply selected values', exact: true })
        .click()
      await expect(modal.getByLabel('Item name', { exact: true })).toHaveValue(
        'Keep my draft',
      )
      await expect(modal.getByLabel('Brand', { exact: true })).toHaveValue(
        "SMUCKER'S",
      )
      await expect(modal.getByLabel('Barcode', { exact: true })).toHaveValue(
        '051500141335',
      )
      expect(writes).toBe(0)
      const bounds = await modal.boundingBox()
      expect(bounds!.x).toBeGreaterThanOrEqual(0)
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1)
    })
})
