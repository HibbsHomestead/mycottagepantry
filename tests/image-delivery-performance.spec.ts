import { test, expect } from '@playwright/test'
import { createServer } from 'node:http'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import sharp from 'sharp'
import { deliverGraphic } from '../netlify/lib/graphic-delivery'
import { demoData } from '../src/lib/demo'

test('compare real thumbnail handlers with the same photographed product cards', async ({
  browser,
}) => {
  test.setTimeout(180000)
  const originals = ['bread', 'cookies'].map(
    (n) =>
      new Uint8Array(readFileSync(`src/test/fixtures/photos/${n}.jpg`)).buffer,
  )
  const variants = new Map<string, ArrayBuffer>() // Test-only Blob adapter.
  let mode = 'before',
    requests = 0,
    bytes = 0,
    originalReads = 0,
    transforms = 0
  const workspace = demoData()
  workspace.products = Array.from({ length: 6 }, (_, i) => ({
    ...workspace.products[i % 2],
    id: `product-${i}`,
    name:
      i % 2
        ? `Chocolate Chip Cookies ${i + 1}`
        : `Homestyle White Bread ${i + 1}`,
    imageAssetId: `photo-${i}`,
  }))
  workspace.graphic_assets = workspace.products.map((_, i) => ({
    id: `photo-${i}`,
    name: 'Demo photograph',
    fileUrl: `http://localhost:8890/photo?asset=${i}&imageWidth=480`,
  }))
  const server = createServer(async (req, res) => {
    if (req.url!.startsWith('/capture-fixture')) {
      res.writeHead(200, {
        'Content-Type': 'text/html',
        'Cache-Control': 'no-store',
      })
      res.end(
        '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><script type="module">import RefreshRuntime from "/@react-refresh";RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>(type)=>type;window.__vite_plugin_react_preamble_installed__=true;import("/src/test/capture-workspace.tsx").then(m=>m.mountScreenshotWorkspace())</script></body></html>',
      )
      return
    }
    if (req.url!.startsWith('/api/workspace')) {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      })
      res.end(JSON.stringify({ workspace, role: 'Owner', demo: true }))
      return
    }
    if (!req.url!.startsWith('/photo?')) {
      const response = await fetch('http://localhost:3000' + req.url)
      res.writeHead(response.status, {
        'Content-Type':
          response.headers.get('content-type') || 'application/octet-stream',
        'Cache-Control': 'no-store',
      })
      res.end(Buffer.from(await response.arrayBuffer()))
      return
    }
    if (!req.headers.cookie?.includes('test_photo_access=yes')) {
      res.writeHead(401)
      res.end()
      return
    }
    const url = new URL(req.url!, 'http://localhost:8890')
    const index = Number(url.searchParams.get('asset'))
    if (!Number.isInteger(index) || index < 0 || index > 5) {
      res.writeHead(404)
      res.end()
      return
    }
    requests++
    let response: Response
    const request = new Request(url, {
      headers: req.headers as Record<string, string>,
    })
    if (mode === 'before') {
      originalReads++
      transforms++
      const output = await sharp(Buffer.from(originals[index % 2]))
        .rotate()
        .resize({
          width: 480,
          height: 480,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: 85 })
        .toBuffer()
      response = new Response(new Uint8Array(output), {
        headers: {
          'Content-Type': 'image/webp',
          'Cache-Control': 'private, no-store',
        },
      })
    } else {
      response = await deliverGraphic({
        request,
        org: 'fixture',
        asset: { id: String(index), fileType: 'image/jpeg' },
        store: {
          get: async (key) => {
            if (key.includes('/previews/')) return variants.get(key) || null
            originalReads++
            return originals[index % 2]
          },
          set: async (key, value) => {
            transforms++
            variants.set(key, value)
          },
        },
      })
    }
    const body = Buffer.from(await response.arrayBuffer())
    bytes += body.byteLength
    res.writeHead(response.status, {
      ...Object.fromEntries(response.headers),
      'Timing-Allow-Origin': '*',
      'Access-Control-Allow-Origin': 'http://localhost:8889',
    })
    res.end(body)
  })
  await new Promise<void>((resolve) => server.listen(8890, resolve))
  const results: unknown[] = []
  try {
    for (const phase of ['before', 'after']) {
      mode = phase
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
        permissions: ['local-network-access'],
      })
      await context.addCookies([
        {
          name: 'test_photo_access',
          value: 'yes',
          domain: 'localhost',
          path: '/',
        },
      ])
      const page = await context.newPage()
      await page.addInitScript(() => {
        performance.setResourceTimingBufferSize(10000)
        const ready: number[] = []
        ;(window as unknown as { photoReady: number[] }).photoReady = ready
        document.addEventListener(
          'load',
          (event) => {
            const image = event.target
            if (
              image instanceof HTMLImageElement &&
              image.src.includes(':8890/photo?')
            )
              void image.decode().then(() => ready.push(performance.now()))
          },
          true,
        )
      })
      for (const load of ['cold', 'repeat']) {
        requests = bytes = originalReads = transforms = 0
        if (load === 'cold')
          await page.goto(
            'http://localhost:8890/capture-fixture#Products/All%20Products',
          )
        else await page.reload()
        await expect(page.locator('.app-shell')).toBeVisible()
        const photos = page.locator('.product-card .photo-foreground')
        await expect(photos).toHaveCount(6)
        for (const photo of await photos.all()) {
          await photo.scrollIntoViewIfNeeded()
          await expect
            .poll(() =>
              photo.evaluate(
                (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
              ),
            )
            .toBe(true)
        }
        await expect
          .poll(() =>
            page.evaluate(
              () =>
                (window as unknown as { photoReady: number[] }).photoReady
                  .length,
            ),
          )
          .toBeGreaterThanOrEqual(6)
        const timing = await page.evaluate(() => {
          const entries = performance
            .getEntriesByType('resource')
            .filter((e) =>
              e.name.startsWith('http://localhost:8890/photo?'),
            ) as PerformanceResourceTiming[]
          const ready = (window as unknown as { photoReady: number[] })
            .photoReady
          return {
            resourceRequests: entries.length,
            transferredBytes: entries.reduce((n, e) => n + e.transferSize, 0),
            imagesReadyMs: Math.round(Math.max(...ready)),
          }
        })
        console.log(phase, load, timing, {
          requests,
          bytes,
          originalReads,
          transforms,
        })
        results.push({
          phase,
          load,
          serverRequests: requests,
          responseImageBytes: bytes,
          originalReads,
          transforms,
          ...timing,
        })
        if (phase === 'after' && load === 'repeat') {
          expect(bytes).toBe(0)
          expect(originalReads).toBe(0)
          expect(transforms).toBe(0)
        }
      }
      // Filtering/remounting and navigation preserve browser assets; access is revalidated.
      const snapshot = bytes
      const search = page.getByRole('textbox', {
        name: /search products|find.*product/i,
      })
      if (await search.count()) {
        await search.fill('Bread')
        await search.fill('')
      }
      await page
        .getByRole('navigation', { name: 'Primary navigation' })
        .getByRole('link', { name: 'Dashboard', exact: true })
        .click()
      await page
        .getByRole('navigation', { name: 'Primary navigation' })
        .getByRole('link', { name: 'Products', exact: true })
        .click()
      await expect(
        page.locator('.product-card .photo-foreground').first(),
      ).toBeVisible()
      if (phase === 'after')
        results.push({
          phase,
          load: 'filter-and-navigation',
          additionalImageBytes: bytes - snapshot,
        })
      await context.clearCookies()
      expect(
        (
          await context.request.get(
            'http://localhost:8890/photo?asset=0&imageWidth=480',
          )
        ).status(),
      ).toBe(401)
      await context.close()
    }
    mkdirSync('docs/reviews/public-composition', { recursive: true })
    writeFileSync(
      'docs/reviews/public-composition/image-measurements.json',
      JSON.stringify(
        {
          conditions:
            'Local Chromium, desktop 1440x1000, unthrottled localhost. Six unique assets made from two real photos at 1200px. Actual old Sharp algorithm versus new delivery helper, synthetic cookie authorization and memory Blob adapter. Workspace API supplied by an isolated fixture proxy; no production database, Identity or Blob latency included.',
          results,
        },
        null,
        2,
      ),
    )
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
