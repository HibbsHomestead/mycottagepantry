import { expect, test } from '@playwright/test'
import { demoData } from '../src/lib/demo'
import { accessFixture } from './account-access-fixture'

// Opt-in inspection of the deployed client with a synthetic Owner workspace.
// API requests are intercepted; no live session, business data, or writes.
test('deployed Owner interface exposes the existing business disclaimer setting', async ({
  page,
}) => {
  test.skip(
    process.env.TEST_LIVE_DISCLAIMER !== '1',
    'Explicit live UI inspection only',
  )
  await page.setViewportSize({ width: 1440, height: 1000 })
  const workspace = demoData()
  workspace.settings[0].disclaimer = ''
  const externalWrites: string[] = []
  const access = accessFixture('workspace', {
    membership: { id: 'fixture-business', name: 'Fixture oven', role: 'Owner' },
  })
  await page.route('**/*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (
      url.pathname.startsWith('/api/') ||
      url.pathname.startsWith('/.netlify/')
    ) {
      if (request.method() !== 'GET') externalWrites.push(url.pathname)
      return route.fulfill({
        json:
          url.pathname === '/api/account-access'
            ? access
            : url.pathname === '/api/workspace'
              ? { workspace, role: 'Owner', demo: false }
              : {},
      })
    }
    if (!['GET', 'HEAD'].includes(request.method())) {
      externalWrites.push(url.pathname)
      return route.abort()
    }
    return route.continue()
  })
  await page.goto(
    'https://mycottagepantry.com/oven#Settings/Business%20Profile',
  )
  await page
    .getByRole('button', { name: 'Edit business profile', exact: true })
    .click()
  const dialog = page.getByRole('dialog')
  await expect(
    dialog.getByRole('heading', { name: 'Your business details', exact: true }),
  ).toBeVisible()
  const field = dialog.getByRole('textbox', {
    name: /^Cottage-food disclaimer/,
  })
  await field.scrollIntoViewIfNeeded()
  await expect(field).toBeVisible()
  await expect(field).toBeEditable()
  await expect(field).toHaveValue('')
  await expect(
    dialog.getByRole('button', { name: 'Save settings', exact: true }),
  ).toBeEnabled()
  await page.screenshot({
    path: 'docs/previews/business-disclaimer-live-owner-fixture.png',
    fullPage: true,
  })
  expect(externalWrites).toEqual([])
})
