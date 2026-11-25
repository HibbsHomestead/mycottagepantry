import { mkdir, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { expect, test, type Page } from '@playwright/test'
import { PDFDocument } from 'pdf-lib'
import { handleAssortmentLabel } from '../netlify/lib/assortment-label-handler'
import { assortmentFixture } from '../src/test/fixtures/assortment'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

const output = '.netlify/basket-assortment-screenshots'
test.use({
  launchOptions: {
    args: [
      '--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessPermissionPrompt',
    ],
  },
})
async function setup(page: Page) {
  await mkdir(output, { recursive: true })
  await installWorkspaceFixture(page)
  const fixture = assortmentFixture()
  const { workspace } = fixture
  await page.route('**/api/workspace*', async (route) => {
    if (route.request().method() === 'POST') {
      const { action, data } = route.request().postDataJSON()
      if (action === 'assortmentLabel') {
        try {
          await handleAssortmentLabel(
            workspace,
            data,
            'Fixture owner',
            async (table, item) => {
              expect(table).toBe('label_print_jobs')
              workspace.label_print_jobs!.push(structuredClone(item))
            },
          )
        } catch (error) {
          return route.fulfill({
            status: 400,
            json: { error: (error as Error).message },
          })
        }
      }
    }
    return route.fulfill({ json: { workspace, role: 'Owner', demo: false } })
  })
  return fixture
}

for (const width of [1440, 390]) {
  test(`basket card, details and canonical history at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1050 })
    const { basket, flavors } = await setup(page)
    await page.goto(workspaceFixtureUrl('Products/Baskets'))
    await expect(
      page.getByRole('article', { name: basket.name }),
    ).toContainText('Cost per basket')
    const card = page.getByRole('article', { name: basket.name })
    await expect(card).toContainText('$10.50')
    await expect(card).not.toContainText(/\bkit\b/i)
    await card.screenshot({ path: `${output}/basket-card-${width}.png` })
    await card.getByRole('button', { name: basket.name, exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('Cost per basket')
    await expect(dialog).toContainText('$10.50')
    await expect(dialog).toContainText('Current bill of materials estimate')
    await expect(dialog).toContainText('Average inventory cost')
    await expect(dialog).toContainText(
      'Recorded stock basis: $8.00 per package',
    )
    await expect(dialog).not.toContainText(/Connected recipe|\bkit\b/i)
    await dialog.screenshot({ path: `${output}/basket-details-${width}.png` })
    const contents = dialog.getByRole('region', { name: 'Included products' })
    await contents.screenshot({
      path: `${output}/basket-components-${width}.png`,
    })
    await page.evaluate((id) => {
      location.hash = `Products/Kits?product=${id}&search=breakfast&context=fixture`
    }, basket.id)
    await expect(page).toHaveURL(
      /#Products\/Baskets\?product=breakfast-fixture&search=breakfast&context=fixture$/,
    )
    await expect(dialog).toBeVisible()
    await page.reload()
    await expect(dialog).toBeVisible()
    await page.goBack()
    await expect(page).toHaveURL(/#Products\/Baskets$/)
    await expect(dialog).not.toBeVisible()
    await page.goForward()
    await expect(dialog).toBeVisible()
    await expect(page).toHaveURL(/#Products\/Baskets\?product=/)
    if (width === 1440) {
      await writeFile(`${output}/canonical-address.txt`, `${page.url()}\n`)
      if (process.env.CAPTURE_BROWSER_CHROME === '1')
        execFileSync('import', [
          '-window',
          'root',
          `${output}/browser-address.png`,
        ])
    }
    flavors[0].ingredient.cost = 0.1
    await page.reload()
    await expect(dialog).toContainText('$12.50')
    await dialog.getByText('Close', { exact: true }).click()
    await expect(card).toContainText('$12.50')
    flavors[0].ingredient.reviewed = false
    Object.assign(flavors[0].ingredient, { needsCostSetup: true })
    await page.reload()
    await expect(dialog).toContainText('Known included-product subtotal')
    await expect(dialog).toContainText(/Blueberry muffins:.*missing cost/)
    await expect(
      dialog.getByRole('button', { name: 'Review Blueberry muffins' }),
    ).toBeVisible()
    expect(
      await contents.evaluate(
        (element) => element.scrollWidth - element.clientWidth,
      ),
    ).toBeLessThanOrEqual(1)
  })
}

test('checks small stock, prints actual PDF pages and tracks printed versus applied copies', async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 900 })
  const { workspace, spec } = await setup(page)
  workspace.label_print_jobs!.push({
    id: 'fixture-fixed',
    name: spec.name,
    createdAt: '2026-11-25T00:00:00.000Z',
    assortmentKind: 'fixed',
    assortmentSpec: spec,
  })
  const stock = JSON.stringify([
    workspace.ingredients,
    workspace.products,
    workspace.ledger,
  ])
  await context.addInitScript(() => {
    window.print = () => {}
  })
  await page.goto(workspaceFixtureUrl('Labels/Assortments'))
  await expect(
    page.getByRole('heading', { name: 'Assortment labels' }),
  ).toBeVisible()
  await page.getByLabel('Saved fixed assortment').selectOption('fixture-fixed')
  await page.getByLabel('Label stock size').selectOption('small-stock')
  await page.getByRole('button', { name: 'Build actual-size preview' }).click()
  await expect(page.getByRole('alert')).toContainText(
    'Content overflows this stock',
  )
  await expect(
    page.getByRole('button', { name: 'Approve label job' }),
  ).toBeDisabled()
  await page.getByLabel('Label stock size').selectOption('larger-stock')
  await page.getByRole('button', { name: 'Build actual-size preview' }).click()
  const preview = page.frameLocator(
    'iframe[title="Actual-size assortment label"]',
  )
  await expect(
    preview.getByText('Chocolate blend', { exact: false }),
  ).toContainText('chips (sugar, milk)')
  await page
    .getByLabel('I reviewed the actual contents', { exact: false })
    .check()
  await page.getByRole('button', { name: 'Approve label job' }).click()
  await expect(
    page.getByText('2 approved · 0 printed', { exact: false }),
  ).toBeVisible()
  const popupPromise = page.waitForEvent('popup')
  await page.getByRole('button', { name: 'Print approved copies' }).click()
  const popup = await popupPromise
  await expect(popup.locator('article')).toHaveCount(2)
  await popup.emulateMedia({ media: 'print' })
  await popup
    .locator('article')
    .first()
    .screenshot({ path: `${output}/assortment-print.png` })
  const pdf = await PDFDocument.load(
    await popup.pdf({
      path: `${output}/assortment-print.pdf`,
      preferCSSPageSize: true,
    }),
  )
  expect(pdf.getPages().map((sheet) => sheet.getSize())).toEqual([
    { width: 288, height: 432 },
    { width: 288, height: 432 },
  ])
  await popup.close()
  await expect(
    page.getByRole('button', { name: 'Confirm applied / verified' }),
  ).toBeDisabled()
  await page.getByRole('button', { name: 'Confirm printed' }).click()
  await expect(page.getByRole('button', { name: 'Reprint' })).toBeVisible()
  await page.getByRole('button', { name: 'Confirm applied / verified' }).click()
  await expect(
    page.getByText(
      '2 approved · 2 printed (including reprints) · 2 applied / verified',
      { exact: false },
    ),
  ).toBeVisible()
  await page.getByLabel('Product / flavor').nth(2).selectOption('tea')
  await page.getByRole('button', { name: 'Build actual-size preview' }).click()
  await expect(page.getByRole('alert')).toContainText(
    'Tea tin: ingredient statement is missing',
  )
  await expect(
    page.getByRole('button', { name: 'Approve label job' }),
  ).toBeDisabled()
  expect(
    JSON.stringify([
      workspace.ingredients,
      workspace.products,
      workspace.ledger,
    ]),
  ).toBe(stock)
})
