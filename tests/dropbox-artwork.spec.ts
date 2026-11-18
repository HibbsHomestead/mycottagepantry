import { test, expect } from '@playwright/test'
import { createCanvas } from '@napi-rs/canvas'
import { imageSize } from 'image-size'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
const dir = 'docs/reviews/dropbox-artwork'
function images() {
  const base = createCanvas(1000, 1100),
    b = base.getContext('2d')
  b.fillStyle = '#faf3e6'
  b.fillRect(0, 0, 1000, 1100)
  b.strokeStyle = '#c9b48b'
  b.lineWidth = 45
  b.beginPath()
  b.ellipse(500, 270, 155, 185, 0, 0, Math.PI * 2)
  b.stroke()
  b.fillStyle = '#e4d2ac'
  b.beginPath()
  b.moveTo(180, 340)
  b.lineTo(820, 340)
  b.lineTo(860, 1000)
  b.lineTo(140, 1000)
  b.closePath()
  b.fill()
  for (let x = 150; x < 850; x += 4) {
    b.strokeStyle = 'rgba(127,104,68,0.07)'
    b.lineWidth = 1
    b.beginPath()
    b.moveTo(x, 350)
    b.lineTo(x, 990)
    b.stroke()
  }
  b.strokeStyle = '#c1a97b'
  b.lineWidth = 3
  b.strokeRect(205, 370, 590, 600)
  const art = createCanvas(500, 300),
    a = art.getContext('2d')
  a.fillStyle = '#654079'
  a.font = 'bold 56px serif'
  a.textAlign = 'center'
  a.fillText('PANTRY', 250, 130)
  a.font = '32px serif'
  a.fillText('made with care', 250, 190)
  return { base: base.toBuffer('image/png'), art: art.toBuffer('image/png') }
}
for (const width of [1440, 390])
  test(`Dropbox optimized copy fixture ${width}`, async ({ page }) => {
    test.setTimeout(60000)
    page.setDefaultTimeout(15000)
    mkdirSync(dir, { recursive: true })
    await page.setViewportSize({ width, height: 1000 })
    const files = images()
    await page.addInitScript(() => {
      let calls = 0
      window.Dropbox = {
        isBrowserSupported: () => true,
        choose: (options) => {
          if (++calls === 1) options.cancel()
          else
            options.success([
              {
                id: 'id:fixture',
                name: 'Synthetic-artwork.png',
                bytes: 100123456,
                thumbnailLink: 'https://www.dropbox.com/temp_thumb/synthetic',
              },
            ])
        },
      }
    })
    let assets: import('../src/lib/domain').Item[] = []
    const bytes = new Map<string, Buffer>()
    let fail = false
    await page.route('http://localhost:8889/**', async (route) => {
      const response = await route.fetch({
        url: route.request().url().replace('localhost:8889', 'localhost:3000'),
      })
      await route.fulfill({ response })
    })
    await page.route('**/mockup-review', (r) =>
      r.fulfill({
        contentType: 'text/html',
        body: '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">import RefreshRuntime from "/@react-refresh";RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>(type)=>type;window.__vite_plugin_react_preamble_installed__=true;import("/src/test/capture-mockup.tsx").then(m=>m.mountMockupReview())</script></body></html>',
      }),
    )
    await page.route('**/api/workspace*', async (route) => {
      const request = route.request(),
        url = new URL(request.url())
      if (url.searchParams.has('dropboxPreview')) {
        await route.fulfill({
          json: {
            data: files.art.toString('base64'),
            bytes: files.art.length,
            width: 500,
            height: 300,
            format: 'image/png',
            hasAlpha: true,
          },
        })
        return
      }
      if (url.searchParams.has('asset')) {
        await route.fulfill({
          contentType: 'image/png',
          body: bytes.get(url.searchParams.get('asset')!)!,
        })
        return
      }
      if (fail) {
        fail = false
        await route.fulfill({
          status: 503,
          json: { error: 'Upload interrupted. Try again.' },
        })
        return
      }
      const form = await new Request('http://fixture', {
        method: 'POST',
        headers: request.headers(),
        body: new Uint8Array(request.postDataBuffer()!),
      }).formData()
      const file = form.get('file') as File,
        id = String(assets.length + 1),
        extra = JSON.parse(String(form.get('mockup') || 'null')),
        imported = form.has('dropboxImport')
      const asset = {
        id,
        ...(imported ? { sourceMetadata: { provider: 'dropbox' } } : {}),
        name: extra?.name || file.name,
        fileUrl: `/api/workspace?asset=${id}`,
        widthPx: imageSize(new Uint8Array(await file.arrayBuffer())).width,
        heightPx: imageSize(new Uint8Array(await file.arrayBuffer())).height,
        ...(extra
          ? {
              mockup: extra.composition,
              productId: extra.productId,
              category: extra.template ? 'mockup-template' : 'product-mockup',
              inProductGallery: extra.gallery === true && !extra.template,
            }
          : {}),
      }
      bytes.set(id, Buffer.from(await file.arrayBuffer()))
      assets = [...assets, asset]
      await route.fulfill({
        json: { asset, workspace: { graphic_assets: assets } },
      })
    })
    page.on('pageerror', (e) => console.log('Browser error:', e.message))
    await page.goto('http://localhost:8889/mockup-review')
    await page
      .getByRole('button', { name: 'Create mockup', exact: true })
      .click()
    await page.getByLabel('Upload blank image', { exact: true }).setInputFiles({
      name: 'Cream tote.png',
      mimeType: 'image/png',
      buffer: files.base,
    })
    await expect(page.getByLabel('X', { exact: true })).toHaveValue('300')
    await expect(
      page.getByLabel('Upload artwork', { exact: true }),
    ).toBeEnabled()
    const choose = page.getByRole('button', {
      name: 'Choose from Dropbox',
      exact: true,
    })
    await expect(choose).toBeEnabled()
    await choose.click()
    await expect(
      page.getByText(
        'Selection cancelled. Your existing artwork is unchanged.',
      ),
    ).toBeVisible()
    await choose.click()
    await expect(
      page.getByRole('heading', { name: 'Review artwork', exact: true }),
    ).toBeVisible()
    await expect(page.getByText(/500 × 300 pixels/)).toBeVisible()
    await page.locator('.dropbox-review').evaluate((el) => {
      const banner = document.createElement('p')
      banner.textContent =
        'SYNTHETIC DROPBOX / STORAGE FIXTURE — no real large file tested'
      el.prepend(banner)
    })
    await page.locator('.dropbox-review').scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${dir}/review-${width}.png` })
    await page.getByLabel('I reviewed transparency and detail on this dark background.').check()
    await page.getByRole('button', { name: 'Use light review background' }).click()
    await page.getByLabel('I reviewed transparency and detail on this light background.').check()
    await page.getByLabel('I approve this copy for mockups.').check()
    fail = true
    await page
      .getByRole('button', { name: 'Save mockup copy', exact: true })
      .click()
    await expect(
      page.getByText('Upload interrupted. Try again.', { exact: true }),
    ).toBeVisible()
    await page
      .getByRole('button', { name: 'Save mockup copy', exact: true })
      .click()
    await expect(
      page.getByText('Ready to edit. The mockup copy is saved privately.'),
    ).toBeVisible()
    await expect(page.getByLabel('X', { exact: true })).toHaveValue('300')
    await page.getByLabel('Width', { exact: true }).fill('450')
    await page.getByLabel('Rotation (degrees)', { exact: true }).fill('7')
    await page
      .getByRole('button', { name: 'Center horizontally', exact: true })
      .click()
    await expect(page.getByLabel('X', { exact: true })).toHaveValue('275')
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(page.getByLabel('X', { exact: true })).toHaveValue('300')
    await page.getByRole('button', { name: 'Redo', exact: true }).click()
    await page
      .getByRole('button', { name: 'Center vertically', exact: true })
      .click()
    await page.locator('.mockup-layer').focus()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByLabel('X', { exact: true })).toHaveValue('276')
    const layer = page.locator('.mockup-layer')
    await layer.scrollIntoViewIfNeeded()
    const box = (await layer.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(
      box.x + box.width / 2 + 15,
      box.y + box.height / 2 + 10,
    )
    await page.mouse.up()
    await expect(page.getByLabel('X', { exact: true })).not.toHaveValue('276')
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(page.getByLabel('X', { exact: true })).toHaveValue('276')
    await layer.scrollIntoViewIfNeeded()
    const corner = (await page.locator('.corner-2').boundingBox())!
    await page.mouse.move(corner.x + 8, corner.y + 8)
    await page.mouse.down()
    await page.mouse.move(corner.x + 28, corner.y + 28)
    await page.mouse.up()
    await expect(page.getByLabel('Width', { exact: true })).not.toHaveValue(
      '450',
    )
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await page
      .getByRole('button', { name: 'Reset placement', exact: true })
      .click()
    await expect(page.getByLabel('Width', { exact: true })).toHaveValue('400')
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(page.getByLabel('Width', { exact: true })).toHaveValue('450')
    await page.locator('.mockup-editor').evaluate((el) => {
      el.scrollTop = 0
    })
    await page.screenshot({
      path: `${dir}/editor-${width}.png`,
      fullPage: true,
    })
    const dl = page.waitForEvent('download')
    await page
      .getByRole('button', { name: 'Download PNG', exact: true })
      .click()
    await (await dl).saveAs(`${dir}/export-${width}.png`)
    await expect(
      page.getByText('Low-resolution artwork:', { exact: false }),
    ).toBeVisible()
    const jpg = page.waitForEvent('download')
    await page
      .getByLabel('JPG background (required)', { exact: true })
      .fill('#ffffff')
    await page
      .getByRole('button', { name: 'Download JPG', exact: true })
      .click()
    await (await jpg).saveAs(`${dir}/export-${width}.jpg`)
    expect(imageSize(readFileSync(`${dir}/export-${width}.png`)).width).toBe(
      1600,
    )
    expect(imageSize(readFileSync(`${dir}/export-${width}.jpg`)).height).toBe(
      1760,
    )
    await page.getByLabel('Save to product gallery', { exact: true }).check()
    await expect(
      page.getByLabel('Set as primary product image', { exact: true }),
    ).not.toBeChecked()

    await page.getByRole('button', { name: 'Save mockup', exact: true }).click()
    await expect(
      page.getByRole('status').filter({ hasText: 'Mockup saved' }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(
      page.getByRole('region', { name: 'Product gallery', exact: true }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Edit mockup', exact: true }).click()
    await expect(page.getByLabel('X', { exact: true })).toHaveValue('276')
    await page.setViewportSize({
      width: width === 390 ? 1440 : 390,
      height: 1000,
    })
    await expect(page.getByLabel('X', { exact: true })).toHaveValue('276')
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await page.getByRole('button', { name: 'Edit mockup', exact: true }).click()
    await expect(page.getByLabel('X', { exact: true })).toHaveValue('276')
    await page
      .getByText('Placement area & physical calibration', { exact: true })
      .click()
    await expect(
      page.getByText('Visual placement only.', { exact: true }),
    ).toBeVisible()
    await page.getByLabel('Panel width (inches)', { exact: true }).fill('12')
    await page.getByLabel('Panel height (inches)', { exact: true }).fill('14')
    await page
      .getByRole('button', { name: 'Calibrate selected panel', exact: true })
      .click()
    await expect(
      page.getByLabel('Artwork width (inches)', { exact: true }),
    ).toHaveValue('5.4')
    await page
      .getByRole('button', { name: 'Save blank template', exact: true })
      .click()
    await expect(
      page.getByRole('status').filter({ hasText: 'Blank template saved' }),
    ).toBeVisible()
    await page
      .getByText('Crop one design from a gangsheet', { exact: true })
      .click()
    await page.getByRole('button', { name: 'Review crop', exact: true }).click()
    await expect(page.getByAltText('Review selected design crop')).toBeVisible()
    await page
      .getByRole('button', { name: 'Use reviewed crop', exact: true })
      .click()
    await expect(
      page.getByRole('button', { name: 'Use reviewed crop', exact: true }),
    ).toHaveCount(0)
    await expect(page.getByLabel('Width', { exact: true })).toBeEnabled()
    fail = true
    await page.getByRole('button', { name: 'Save mockup', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('Upload interrupted')
    await expect(page.getByLabel('X', { exact: true })).toHaveValue('276')
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(
      page.getByText('Discard unsaved mockup changes?', { exact: true }),
    ).toBeVisible()
    await page
      .getByRole('button', { name: 'Discard changes and close', exact: true })
      .click()
    await page
      .getByRole('button', { name: 'Duplicate mockup', exact: true })
      .click()
    await expect(
      page.getByLabel('Mockup / template name', { exact: true }),
    ).toHaveValue('New product mockup copy')
    fail = true
    await page.getByLabel('Upload artwork', { exact: true }).setInputFiles({
      name: 'Retry design.png',
      mimeType: 'image/png',
      buffer: files.art,
    })
    await expect(page.getByRole('alert')).toContainText('Upload interrupted')
    await expect(page.getByLabel('Width', { exact: true })).toHaveValue('450')
    for (const [kind, w, h] of [
      ['white', 100, 300],
      ['jpg', 400, 100],
      ['wide', 600, 100],
    ] as const) {
      const sourceDetails = page.locator('details').filter({
        has: page.locator('summary', {
          hasText: 'Source images & templates',
        }),
      })
      if (
        !(await sourceDetails.evaluate((el) => (el as HTMLDetailsElement).open))
      )
        await page
          .getByText('Source images & templates', { exact: true })
          .click()
      const image = createCanvas(w, h),
        ctx = image.getContext('2d')
      if (kind === 'jpg') {
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, w, h)
      }
      ctx.fillStyle = kind === 'white' ? '#ffffff' : '#663399'
      ctx.fillRect(10, 10, w - 20, h - 20)
      await page.getByLabel('Upload artwork', { exact: true }).setInputFiles({
        name: `${kind}.${kind === 'jpg' ? 'jpg' : 'png'}`,
        mimeType: kind === 'jpg' ? 'image/jpeg' : 'image/png',
        buffer:
          kind === 'jpg'
            ? image.toBuffer('image/jpeg')
            : image.toBuffer('image/png'),
      })
      await expect(page.getByLabel('Width', { exact: true })).toBeEnabled()
      await page.getByLabel('Width', { exact: true }).fill('300')
      await expect(page.getByLabel('Height', { exact: true })).toHaveValue(
        String((300 * h) / w),
      )
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    writeFileSync(
      `${dir}/verification.txt`,
      JSON.stringify(
        {
          evidence:
            'Synthetic Dropbox and storage fixtures only. No real large source file or live storage tested.',
          sourceBytes:
            'Unknown; the 100123456 value is fabricated fixture metadata',
          copyBytes: files.art.length,
          copyWidth: 500,
          copyHeight: 300,
          copyFormat: 'image/png',
          alpha: true,
          exportWidth: 1600,
          exportHeight: 1760,
        },
        null,
        2,
      ),
    )
  })
