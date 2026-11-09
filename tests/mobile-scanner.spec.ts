import { test, expect } from '@playwright/test'
test('camera denial, explicit Retry, detection, duplicate guard, cleanup and reopen', async ({
  page,
}) => {
  await page.route('**/camera-fixture', (r) =>
    r.fulfill({
      contentType: 'text/html',
      body: `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><script type="module">import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>(type)=>type;window.__vite_plugin_react_preamble_installed__=true;import('/src/test/capture-workspace.tsx').then(m=>m.mountScannerFixture())</script></body></html>`,
    }),
  )
  await page.addInitScript(() => {
    const w = window as any
    w.requests = 0
    w.stops = 0
    w.result = []
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: async (constraints: any) => {
          w.requests++
          w.constraints = constraints
          if (w.requests === 1)
            throw new DOMException('denied', 'NotAllowedError')
          const canvas = document.createElement('canvas')
          canvas.width = 320
          canvas.height = 240
          canvas.getContext('2d')!.fillRect(0, 0, 320, 240)
          const stream = canvas.captureStream(5)
          for (const track of stream.getTracks()) {
            const stop = track.stop.bind(track)
            track.stop = () => {
              w.stops++
              stop()
            }
          }
          return stream
        },
      },
    })
    w.BarcodeDetector = class {
      static async getSupportedFormats() {
        return ['upc_a', 'upc_e', 'ean_13', 'ean_8', 'code_128', 'qr_code']
      }
      async detect() {
        return w.result
      }
    }
  })
  await page.goto('http://localhost:8889/camera-fixture')
  await expect(
    page.getByRole('button', { name: 'Start rear camera' }),
  ).toBeVisible()
  expect(await page.evaluate(() => (window as any).requests)).toBe(0)
  await page.getByRole('button', { name: 'Start rear camera' }).click()
  await expect(page.getByRole('alert')).toContainText(
    'Camera permission was denied',
  )
  expect(await page.evaluate(() => (window as any).requests)).toBe(1)
  await page.getByRole('button', { name: 'Retry camera' }).click()
  await expect(page.getByRole('button', { name: 'Retry camera' })).toHaveCount(
    0,
  )
  expect(await page.evaluate(() => (window as any).constraints.audio)).toBe(
    false,
  )
  await page.evaluate(() => {
    ;(window as any).result = [{ rawValue: '036000291452', format: 'upc_a' }]
  })
  await expect(page.locator('body')).toHaveAttribute(
    'data-scanned',
    '036000291452',
  )
  expect(await page.evaluate(() => (window as any).stops)).toBeGreaterThan(0)
  await page.evaluate(async () => {
    ;(window as any).result = []
    const m = await import('/src/test/capture-workspace.tsx' as string)
    m.mountScannerFixture()
  })
  await page.getByRole('button', { name: 'Start rear camera' }).click()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).requests)).toBe(3)
  expect(await page.evaluate(() => (window as any).stops)).toBeGreaterThan(1)
})
