import { test, expect } from '@playwright/test'
import { demoData } from '../src/lib/demo'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'
import { PDFDocument } from 'pdf-lib'
import { readFile } from 'node:fs/promises'

for (const width of [390, 412, 820, 1440]) {
  test(`inventory mobile audit and shelf label preview (${width})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 })
    await installWorkspaceFixture(page)
    const workspace = demoData()
    let posts = 0
    await page.route('**/api/workspace*', async (route) => {
      if (route.request().method() === 'POST') posts++
      await route.fulfill({ json: { workspace, role: 'Owner', demo: false } })
    })
    for (const section of [
      'Pantry',
      'Recipes',
      'Products',
      'Production',
      'Labels',
      'Finances',
    ]) {
      await page.goto(workspaceFixtureUrl(section), {
        waitUntil: 'networkidle',
      })
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
        `${section} has page overflow at ${width}`,
      ).toBe(true)
    }
    await page.goto(workspaceFixtureUrl('Pantry'), { waitUntil: 'networkidle' })
    await page
      .getByRole('button', { name: 'Scan barcode', exact: true })
      .click()
    const scanner = page.getByRole('dialog')
    await expect(
      scanner.getByRole('heading', { name: 'Scan barcode' }),
    ).toBeVisible()
    await scanner
      .getByRole('textbox')
      .fill('https://untrusted.example/no-navigation')
    await scanner.getByRole('button', { name: 'Use entered code' }).click()
    const unknown = page.getByRole('dialog')
    await expect(
      unknown.getByRole('heading', { name: 'Unknown barcode' }),
    ).toBeVisible()
    await expect(page).toHaveURL(/capture-fixture/)
    expect(posts).toBe(0)
    await unknown
      .getByRole('button', { name: 'Close', exact: true })
      .first()
      .click()
    const name = workspace.ingredients[0].name
    await page
      .getByRole('button', { name: `Actions for ${name}`, exact: true })
      .click()
    await page
      .getByRole('menuitem', { name: 'Print shelf/bin label', exact: true })
      .click()
    const dialog = page.getByRole('dialog')
    await expect(
      dialog.getByRole('heading', { name: 'Shelf / bin / location labels' }),
    ).toBeVisible()
    await expect(
      dialog.getByRole('img', { name: `Shelf label for ${name}` }),
    ).toBeVisible()
    await expect(
      dialog.getByRole('button', { name: 'Export actual-size PDF' }),
    ).toBeDisabled()
    await dialog
      .getByLabel(
        'I checked media size, supported margins and preview for this printer.',
      )
      .check()
    await page.screenshot({
      path: `/tmp/inventory-label-preview-${width}.png`,
      fullPage: false,
    })
    const downloading = page.waitForEvent('download')
    await dialog.getByRole('button', { name: 'Export actual-size PDF' }).click()
    const download = await downloading,
      path = await download.path()
    const doc = await PDFDocument.load(await readFile(path!))
    expect(doc.getPages()).toHaveLength(1)
    expect(doc.getPage(0).getWidth()).toBeCloseTo((60 / 25.4) * 72, 2)
    expect(doc.getPage(0).getHeight()).toBeCloseTo((20 / 25.4) * 72, 2)
    expect(posts).toBe(0)
  })
}

test('scanning chooses ambiguous packages and a failed receipt retains its draft and operation ID', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await installWorkspaceFixture(page)
  const workspace = demoData(),
    item = workspace.ingredients[0]
  item.barcode = '036000291452'
  workspace.ingredients[1].barcode = '0036000291452'
  const writes: any[] = []
  await page.route('**/api/workspace*', async (route) => {
    if (route.request().method() === 'POST') {
      writes.push(route.request().postDataJSON())
      if (writes.length === 1)
        return route.fulfill({
          status: 503,
          contentType: 'text/html',
          body: '<!doctype html><title>Temporary failure</title>',
        })
    }
    await route.fulfill({ json: { workspace, role: 'Owner', demo: false } })
  })
  await page.goto(workspaceFixtureUrl('Pantry'), { waitUntil: 'networkidle' })
  await page
    .getByRole('button', { name: 'Scan to receive', exact: true })
    .click()
  await page.getByRole('dialog').getByRole('textbox').fill('0036000291452')
  await page.getByRole('button', { name: 'Use entered code' }).click()
  await expect(
    page.getByText('Multiple matches: choose the correct item and package.'),
  ).toBeVisible()
  expect(writes).toHaveLength(0)
  await page.getByRole('checkbox', { name: /checked the variant/ }).check()
  await page
    .getByRole('button', { name: new RegExp(item.name + ' .*Item barcode') })
    .click()
  const dialog = page.getByRole('dialog')
  await expect(
    dialog.getByLabel('Purchase quantity', { exact: true }),
  ).toHaveValue('')
  await expect(
    dialog.getByLabel('Price paid ($)', { exact: true }),
  ).toHaveValue('')
  await dialog.getByLabel('Purchase quantity', { exact: true }).fill('0.5')
  await dialog.getByLabel('Price paid ($)', { exact: true }).fill('4.25')
  await dialog
    .getByRole('button', {
      name: /Record receipt|Receive stock|Save receipt|Confirm receipt/,
    })
    .click()
  await expect(
    dialog.getByText(/oven returned an unreadable response/),
  ).toBeVisible()
  await expect(
    dialog.getByLabel('Purchase quantity', { exact: true }),
  ).toHaveValue('0.5')
  await expect(
    dialog.getByLabel('Price paid ($)', { exact: true }),
  ).toHaveValue('4.25')
  await dialog
    .getByRole('button', {
      name: /Record receipt|Receive stock|Save receipt|Confirm receipt/,
    })
    .click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(writes).toHaveLength(2)
  expect(writes[0].data.operationId).toBeTruthy()
  expect(writes[0].data.operationId).toBe(writes[1].data.operationId)
  expect(writes[0].data.quantity).toBe(0.5)
})
