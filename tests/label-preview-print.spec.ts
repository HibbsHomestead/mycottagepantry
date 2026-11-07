import { test, expect } from '@playwright/test'
import { demoData } from '../src/lib/demo'
import {
  blankLabel,
  newElement,
  resolveLabelData,
} from '../src/lib/label-studio'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

test('previews and prints the same product in one app tab, retaining context after cancellation', async ({
  page,
  context,
}) => {
  const workspace = demoData(),
    product = workspace.products[0]
  const doc = {
    ...blankLabel(),
    id: 'sample-label',
    name: 'Sample product label',
    revision: 1,
    width: 216,
    height: 144,
    elements: [
      {
        ...newElement('text', '', 'product.name'),
        x: 18,
        y: 18,
        width: 160,
        height: 30,
        rotation: 12,
      },
      {
        ...newElement('image'),
        assetId: 'sample-image',
        x: 120,
        y: 65,
        width: 48,
        height: 48,
        rotation: -10,
      },
    ],
  }
  product.labelDesignId = doc.id
  product.imageAssetId = 'sample-image'
  workspace.graphic_assets = [
    {
      id: 'sample-image',
      name: 'Sample logo',
      fileUrl: '/brand/cottage-pantry-logo.webp',
    },
  ]
  workspace.label_templates = [doc]
  workspace.label_print_jobs = []
  const writes: string[] = []
  await page.route('**/api/workspace*', async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON()
      writes.push(body.action)
      expect(body.action).toBe('labelPrint')
      expect(body.data).toMatchObject({
        templateId: doc.id,
        source: { kind: 'product', id: product.id },
      })
      workspace.label_print_jobs.push({
        id: `sample-job-${writes.length}`,
        name: doc.name,
        documentSnapshot: doc,
        renderedDataSnapshot: resolveLabelData(
          workspace,
          body.data.source,
          workspace.brand_kits?.[0],
        ),
      })
    }
    await route.fulfill({ json: { workspace, role: 'Owner', demo: false } })
  })
  // Native print dialogs cannot be controlled by Playwright. Capture the actual
  // iframe's print invocation and simulate its afterprint event (including cancel).
  await page.addInitScript(() => {
    window.print = () => {
      const app = window.parent as Window & { labelPrints?: unknown[] }
      app.labelPrints ||= []
      app.labelPrints.push({
        sameTab: window !== window.parent,
        html: document.documentElement.outerHTML,
        text: [...document.querySelectorAll('svg tspan')]
          .map((span) => span.textContent)
          .join(' '),
        fonts: [...document.fonts].map((f) => f.status),
        images: [...document.querySelectorAll('svg image')].map((img) =>
          img.getAttribute('href'),
        ),
      })
      window.dispatchEvent(new Event('afterprint'))
    }
  })
  await installWorkspaceFixture(page)
  await page.goto(workspaceFixtureUrl('Products/Food'))
  const card = page.getByRole('article', { name: product.name })
  await card.getByRole('button', { name: 'View details', exact: true }).click()
  const detail = page.getByRole('dialog', { name: product.name, exact: true })
  await expect(detail.locator('.product-detail-photo img')).toHaveAttribute(
    'src',
    '/brand/cottage-pantry-logo.webp',
  )
  await detail.getByRole('button', { name: 'Print Label', exact: true }).click()
  const preview = page.getByRole('dialog', {
    name: `Preview Label · ${product.name}`,
    exact: true,
  })
  await expect(
    preview.getByAltText(`Populated label for ${product.name}`),
  ).toBeVisible()
  await page.screenshot({
    path: '/tmp/cottage-label-preview.png',
    animations: 'disabled',
  })
  expect(writes).toEqual([])
  const review = preview.getByRole('checkbox', { name: /I reviewed/ })
  if (await review.count()) await review.check()
  await preview.getByLabel('Number of products', { exact: true }).fill('7')
  await preview.getByLabel('Output layout').selectOption('sheet')
  await preview.getByRole('button', { name: 'Zoom in' }).click()
  for (let n = 1; n <= 2; n++) {
    await preview
      .getByRole('button', { name: 'Print Label', exact: true })
      .click()
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as Window & { labelPrints?: unknown[] }).labelPrints
              ?.length || 0,
        ),
      )
      .toBe(n)
    await expect(preview).toBeVisible()
    await expect(
      preview.getByRole('button', { name: 'Print Label', exact: true }),
    ).toBeEnabled()
    expect(context.pages()).toHaveLength(1)
  }
  const printed = await page.evaluate(
    () =>
      (
        window as Window & {
          labelPrints?: {
            sameTab: boolean
            html: string
            text: string
            fonts: string[]
            images: string[]
          }[]
        }
      ).labelPrints![0],
  )
  expect(printed.sameTab).toBe(true)
  expect(printed.html.match(/class="label"/g)).toHaveLength(7)
  expect(printed.html.match(/class="page"/g)).toHaveLength(2)
  expect(printed.html.includes('width:216pt;height:144pt')).toBe(true)
  expect(printed.html.includes('rotate(12')).toBe(true)
  expect(printed.html.includes('rotate(-10')).toBe(true)
  expect(printed.text).toContain(product.name)
  expect(
    /<button|data-editor-only|label-preview-toolbar/.test(printed.html),
  ).toBe(false)
  expect(printed.fonts.length).toBeGreaterThan(0)
  expect(printed.fonts.every((status) => status === 'loaded')).toBe(true)
  expect(
    printed.images.every((src) => src.startsWith('data:image/png;base64,')),
  ).toBe(true)
  await preview
    .getByRole('button', { name: 'Close', exact: true })
    .first()
    .click()
  await expect(detail).toBeVisible()
  await detail
    .getByRole('button', { name: 'Preview Label', exact: true })
    .click()
  await expect(preview).toBeVisible()
  expect(writes).toEqual(['labelPrint', 'labelPrint'])
  await preview.getByRole('button', { name: 'Edit Label', exact: true }).click()
  await expect(page.getByLabel('Label name', { exact: true })).toHaveValue(
    doc.name,
  )
  await expect(
    page.getByRole('combobox', { name: 'Choose record', exact: true }),
  ).toHaveValue(product.id)
})

for (const workflow of ['food', 'handmade', 'resale']) {
  test(`${workflow} product detail preserves its existing editor and responsive photo placement`, async ({
    page,
  }) => {
    const workspace = demoData(),
      product = workspace.products[0]
    product.workflow = workflow
    workspace.products = [product]
    product.imageAssetId = 'sample-image'
    workspace.graphic_assets = [
      {
        id: 'sample-image',
        name: 'Sample photo',
        fileUrl: '/brand/cottage-pantry-logo.webp',
      },
    ]
    let writes = 0
    await page.route('**/api/workspace*', async (route) => {
      if (route.request().method() !== 'GET') writes++
      await route.fulfill({ json: { workspace, role: 'Owner', demo: false } })
    })
    await installWorkspaceFixture(page)
    await page.setViewportSize({ width: 1440, height: 960 })
    const section =
      workflow === 'food'
        ? 'Food'
        : workflow === 'handmade'
          ? 'Handmade'
          : 'Resale'
    await page.goto(workspaceFixtureUrl(`Products/${section}`))
    await page
      .getByRole('article', { name: product.name })
      .getByRole('button', { name: 'View details', exact: true })
      .click()
    const detail = page.getByRole('dialog', { name: product.name, exact: true })
    const photo = detail.locator('.product-detail-photo'),
      info = detail.locator('.product-detail-information')
    const desktop = {
      photo: (await photo.boundingBox())!,
      info: (await info.boundingBox())!,
    }
    expect(desktop.photo.x).toBeGreaterThan(desktop.info.x)
    await expect
      .poll(async () =>
        Math.abs(
          (await photo.boundingBox())!.y - (await info.boundingBox())!.y,
        ),
      )
      .toBeLessThan(2)
    await expect(photo.locator('img')).toHaveCSS('object-fit', 'contain')
    await page.setViewportSize({ width: 390, height: 844 })
    const mobile = {
      photo: (await photo.boundingBox())!,
      info: (await info.boundingBox())!,
    }
    expect(mobile.photo.y).toBeLessThan(mobile.info.y)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    if (workflow === 'food')
      await page.screenshot({
        path: '/tmp/cottage-product-detail-mobile.png',
        animations: 'disabled',
      })
    await detail
      .getByRole('button', { name: 'Edit Product', exact: true })
      .click()
    await expect(
      page.getByRole('dialog', { name: 'Edit Product', exact: true }),
    ).toBeVisible()
    await expect(page.getByLabel('Product name', { exact: true })).toHaveValue(
      product.name,
    )
    expect(writes).toBe(0)
  })
}
