import { test, expect } from '@playwright/test'
import { demoData } from '../src/lib/demo'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'
for (const width of [1440, 1024, 768, 390]) {
  test(`Stage 1 dashboard actions and responsive navigation ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await installWorkspaceFixture(page)
    const workspace = demoData()
    await page.route('**/api/workspace*', async (route) => {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON()
        expect(body.action).toBe('pantryNavigation')
        return route.fulfill({ json: { expanded: body.data.expanded } })
      }
      return route.fulfill({ json: { workspace, role: 'Owner', demo: true } })
    })
    await page.goto(workspaceFixtureUrl())
    await expect(
      page.getByRole('heading', { name: 'Your pantry, at a glance.' }),
    ).toBeVisible()
    await expect(page.locator('.dashboard-metric')).toHaveCount(4)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1)
    const add = page.getByRole('button', {
      name: 'Add ingredient',
      exact: true,
    })
    await add.focus()
    await expect(add).toBeFocused()
    expect(await add.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe(
      'solid',
    )
    await add.press('Enter')
    await expect(page.getByRole('dialog')).toBeVisible()
    const name = page.getByRole('textbox', {
      name: 'Ingredient / item name',
      exact: true,
    })
    await name.fill('Pending ingredient edits')
    await expect(name).toHaveValue('Pending ingredient edits')
    page.once('dialog', (dialog) => dialog.accept())
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Cancel', exact: true })
      .click()
    await page
      .getByRole('button', { name: 'Open Label Studio', exact: true })
      .click()
    if (width < 1025)
      await page
        .getByRole('button', { name: 'Open navigation', exact: true })
        .click()
    const nav = page.getByRole('navigation', {
      name: 'Primary navigation',
      exact: true,
    })
    await expect(
      nav.getByRole('button', { name: 'Label Studio', exact: true }),
    ).toHaveAttribute('aria-current', 'page')
    await expect(
      nav.getByRole('button', { name: 'Label Studio', exact: true }),
    ).toBeVisible()
    await nav.getByRole('button', { name: 'Dashboard', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Your pantry, at a glance.' }),
    ).toBeVisible()
    await page.screenshot({
      path: `/tmp/dashboard-stage1-${width}.png`,
      fullPage: true,
      animations: 'disabled',
    })
  })
}
test('dashboard loading, error and empty workspace never show preview business records', async ({
  page,
}) => {
  await installWorkspaceFixture(page)
  await page.route('**/api/workspace*', (route) =>
    route.fulfill({
      status: 503,
      json: { error: 'Private records are temporarily unavailable.' },
    }),
  )
  await page.goto(workspaceFixtureUrl())
  await expect(
    page.getByRole('heading', { name: 'Workspace unavailable' }),
  ).toBeVisible()
  await expect(page.getByText('Hibbs Homestead Market')).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'Retry workspace access' }),
  ).toBeVisible()
  await page.unroute('**/api/workspace*')
  const w = demoData()
  for (const key of Object.keys(w)) if (key !== 'settings') w[key] = []
  w.settings[0].name = 'Empty private pantry'
  await page.route('**/api/workspace*', (route) =>
    route.fulfill({
      json: { workspace: w, role: 'Read-only Accountant', demo: false },
    }),
  )
  await page.reload()
  await expect(
    page.getByText(/No inventory movements recorded yet/),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Add ingredient', exact: true }),
  ).toHaveCount(0)
  await expect(page.locator('.dashboard-sales')).toHaveCount(0)
})
