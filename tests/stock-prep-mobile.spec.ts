import { expect, test, type Page } from '@playwright/test'
import { breadBaseFixture } from '../src/test/fixtures/bread-base'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

async function openPantry(page: Page) {
  await installWorkspaceFixture(page)
  const workspace = breadBaseFixture()
  const food = {
    id: 'prep-food-fixture',
    name: 'Fixture apples',
    usedAs: 'ingredient',
    unit: 'each',
    quantity: 20,
    cost: 0.5,
    threshold: 0,
  }
  workspace.ingredients.push(
    food,
    {
      ...food,
      id: 'prep-ribbon-fixture',
      name: 'Fixture ribbon',
      usedAs: 'material',
      unit: 'yd',
    },
    {
      ...food,
      id: 'prep-empty-fixture',
      name: 'Fixture empty boxes',
      usedAs: 'packaging',
      quantity: 0,
    },
  )
  workspace.settings[0].currentPantryView = 'cards'
  const writes: string[] = []
  await page.route('**/api/workspace*', async (route) => {
    if (route.request().method() === 'POST')
      writes.push(route.request().postDataJSON().action)
    await route.fulfill({ json: { workspace, role: 'Owner', demo: false } })
  })
  await page.goto(workspaceFixtureUrl('Inventory'))
  return writes
}

for (const width of [360, 390, 430, 1440]) {
  test.describe(`${width}px`, () => {
    test.use({
      viewport: { width, height: width === 1440 ? 900 : 780 },
      isMobile: width !== 1440,
      hasTouch: width !== 1440,
    })

    test('keeps dates and calculated errors inside the prep dialog', async ({
      page,
    }, testInfo) => {
      const writes = await openPantry(page)
      await page
        .getByRole('button', { name: 'Actions for Fixture apples' })
        .click()
      await page
        .getByRole('menuitem', { name: 'Prep / portion stock', exact: true })
        .click()
      const dialog = page.getByRole('dialog', { name: 'Prep / portion stock' })
      const prepDate = dialog.getByLabel('Prep date', { exact: true })
      const bestBefore = dialog.getByLabel('Best-before (optional)', {
        exact: true,
      })
      const review = dialog.getByRole('button', { name: 'Review prep' })
      await expect(bestBefore).toBeEmpty()
      await bestBefore.scrollIntoViewIfNeeded()
      for (const el of [prepDate, bestBefore]) {
        expect(
          await el.evaluate((input) => input.getBoundingClientRect().height),
        ).toBeGreaterThanOrEqual(44)
        expect(
          await el.evaluate((input) => input.getBoundingClientRect().height),
        ).toBeCloseTo((await prepDate.boundingBox())!.height, 0)
      }
      const dates = dialog.getByText(
        'Leave blank if no best-before date applies.',
      )
      await expect(dates).toBeVisible()
      const overflowing = () =>
        dialog.evaluate((element) =>
          [
            element,
            ...element.querySelectorAll(
              '.stock-prep-body, form, fieldset, .form-grid, .field, .stock-prep-actions',
            ),
          ]
            .filter((node) => node.scrollWidth > node.clientWidth + 1)
            .map((node) => ({
              element: node.className || node.tagName,
              scrollWidth: node.scrollWidth,
              width: node.clientWidth,
            })),
        )
      expect(await overflowing()).toEqual([])
      await page.screenshot({
        path: testInfo.outputPath(`dates-empty-${width}.png`),
      })
      await bestBefore.fill('2099-12-31')
      await expect(bestBefore).toHaveValue('2099-12-31')
      expect(await overflowing()).toEqual([])
      if (width === 390)
        await page.screenshot({
          path: testInfo.outputPath('dates-filled-390.png'),
        })

      await review.click()
      await expect(dialog.getByRole('alert')).toContainText('Source quantity')
      for (const [label, value] of [
        ['Quantity used (each)', '4'],
        ['Number of portions', '2'],
        ['Measured amount per portion (optional)', '4'],
        ['Preparation method', 'Chopped'],
        ['Destination storage location', 'Cooler drawer'],
      ])
        await dialog.getByLabel(label, { exact: true }).fill(value)
      await review.click()
      const alert = dialog.getByRole('alert')
      await expect(alert).toContainText(
        'Difference: 4 each over the source after loss',
      )
      await expect(alert).toBeInViewport({ ratio: 1 })
      await expect(review).toBeInViewport({ ratio: 1 })
      expect(await overflowing()).toEqual([])
      await page.screenshot({
        path: testInfo.outputPath(`validation-${width}.png`),
      })
      await dialog.getByLabel('Portion unit').selectOption('cup')
      await review.click()
      await expect(alert).toContainText('Choose a matching unit (each)')
      await dialog.getByLabel('Portion unit').selectOption('each')
      await dialog
        .getByLabel('Measured amount per portion (optional)')
        .fill('1')
      await dialog.getByText('Record measured prep loss (optional)').click()
      await dialog.getByLabel('Measured loss (each)').fill('2')
      await dialog.getByLabel('Loss reason').fill('Discarded bruised pieces')
      await review.click()
      await expect(
        dialog.getByRole('button', { name: 'Confirm prep' }),
      ).toBeInViewport()
      await expect(
        dialog.getByText('2 each · Discarded bruised pieces'),
      ).toBeVisible()
      expect(writes).toEqual([])
    })
  })
}

test('offers prep from the inventory table and details, and disables empty stock', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 780 })
  const writes = await openPantry(page)
  await page
    .getByRole('button', { name: 'Actions for Fixture empty boxes' })
    .click()
  await expect(
    page.getByRole('menuitem', {
      name: /Prep \/ portion stock.*no stock on hand/,
    }),
  ).toBeDisabled()
  await page.keyboard.press('Escape')
  await page
    .getByRole('group', { name: 'Pantry display' })
    .getByRole('button', { name: 'Table', exact: true })
    .click()
  await page.getByRole('button', { name: 'Actions for Fixture ribbon' }).click()
  await page
    .getByRole('menuitem', { name: 'Prep / portion stock', exact: true })
    .click()
  const dialog = page.getByRole('dialog', { name: 'Prep / portion stock' })
  const handling = dialog.getByLabel('Preparation / handling (optional)')
  await handling.scrollIntoViewIfNeeded()
  await expect(handling).toBeInViewport({ ratio: 1 })
  await expect(dialog.getByLabel(/Best-before/)).toHaveCount(0)
  await expect(
    page.getByText('Saved to your oven.', { exact: true }),
  ).toHaveCount(0, { timeout: 10000 })
  await page.screenshot({ path: testInfo.outputPath('ribbon-390.png') })
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await page
    .getByRole('button', { name: 'Fixture ribbon', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Prep / portion stock', exact: true })
    .click()
  await expect(dialog).toBeVisible()
  expect(writes.filter((action) => /^stockPrep/.test(action))).toEqual([])
})
