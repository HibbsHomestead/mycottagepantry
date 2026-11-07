import { test, expect, type Page } from '@playwright/test'
import { demoData } from '../src/lib/demo'
import { blankLabel, newElement } from '../src/lib/label-studio'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

// Simulate successive compiled releases without building or publishing the site.
// Only the bundled version constant and public metadata are intercepted; the
// workspace, update checks, refresh navigation, and unload guards are real UI.
async function setup(page: Page) {
  const deployment = {
    running: 'release-one',
    published: 'release-one',
    fail: false,
  }
  const workspace = demoData()
  workspace.settings[0].labelEditorScope = 'synthetic-update-test'
  workspace.label_recovery_drafts = []
  workspace.label_templates = [
    {
      ...blankLabel(),
      id: 'saved-label',
      name: 'Saved bread label',
      revision: 1,
      tags: [],
      elements: [newElement('text', 'Keep this editable label')],
    },
    {
      ...blankLabel(),
      id: 'saved-template',
      recordKind: 'template',
      name: 'Saved bread template',
      revision: 1,
      tags: [],
      elements: [newElement('text', 'Keep this editable template')],
    },
  ]
  const originalWorkspace = structuredClone(workspace)
  const writes: { action?: string }[] = []
  const documents: string[] = []
  await installWorkspaceFixture(page)
  await page.route(
    '**/src/components/app-update-notice.tsx*',
    async (route) => {
      const response = await route.fetch()
      const body = await response.text()
      const expression = /const bundledVersion =[^;]+;/
      expect(body).toMatch(expression)
      await route.fulfill({
        response,
        body: body.replace(
          expression,
          `const bundledVersion = ${JSON.stringify(deployment.running)};`,
        ),
      })
    },
  )
  await page.route('**/app-version.json*', (route) =>
    deployment.fail
      ? route.abort('internetdisconnected')
      : route.fulfill({
          json: { version: deployment.published },
          headers: { 'Cache-Control': 'no-store' },
        }),
  )
  await page.route('**/api/workspace*', async (route) => {
    if (route.request().method() === 'POST')
      writes.push(route.request().postDataJSON())
    await route.fulfill({ json: { workspace, role: 'Owner', demo: false } })
  })
  page.on('request', (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame())
      documents.push(request.url())
  })
  const notice = page.locator('.app-update-notice')
  return { deployment, workspace, originalWorkspace, writes, documents, notice }
}

for (const width of [1440, 390]) {
  test(`current → update → refresh → current → next update at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 950 })
    const state = await setup(page)
    await page.goto(workspaceFixtureUrl('Labels'))
    const studio = page.locator('.label-studio')
    await expect(studio).toBeVisible()
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            performance
              .getEntriesByType('resource')
              .filter((r) => r.name.includes('/app-version.json')).length,
        ),
      )
      .toBe(1)
    await expect(state.notice).toHaveCount(0)

    state.deployment.running = state.deployment.published = 'release-two'
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(state.notice).toBeVisible()
    expect(state.documents).toHaveLength(1)
    await state.notice.getByRole('button', { name: 'Refresh app' }).click()
    await expect.poll(() => state.documents.length).toBe(2)
    expect(new URL(state.documents[1]).searchParams.get('__app_update')).toBe(
      'release-two',
    )
    await expect(studio).toBeVisible()
    await expect(state.notice).toHaveCount(0)
    await expect(page).not.toHaveURL(/__app_update/)
    await expect(page).toHaveURL(/#Labels\/Saved%20Labels$/)

    await page.reload()
    await expect(studio).toBeVisible()
    await expect(state.notice).toHaveCount(0)
    await studio
      .getByRole('button', { name: 'Saved Labels', exact: true })
      .click()
    await expect(
      studio.getByRole('heading', { name: 'Saved bread label', exact: true }),
    ).toBeVisible()
    await studio.getByRole('button', { name: 'Templates', exact: true }).click()
    await expect(
      studio.getByRole('heading', {
        name: 'Saved bread template',
        exact: true,
      }),
    ).toBeVisible()
    expect(state.workspace).toEqual(state.originalWorkspace)
    expect(state.writes).toEqual([])

    state.deployment.running = state.deployment.published = 'release-three'
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(state.notice).toBeVisible()
    expect(state.documents).toHaveLength(3)
  })
}

test('failed and offline checks never announce an unconfirmed update', async ({
  page,
  context,
}) => {
  const state = await setup(page)
  state.deployment.fail = true
  await page.goto(workspaceFixtureUrl())
  await expect(
    page.getByRole('heading', { name: 'Your pantry, at a glance.' }),
  ).toBeVisible()
  await expect(state.notice).toHaveCount(0)
  state.deployment.fail = false
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(state.notice).toHaveCount(0)
  await context.setOffline(true)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(state.notice).toHaveCount(0)
  await context.setOffline(false)
  await expect(state.notice).toHaveCount(0)
  expect(state.documents).toHaveLength(1)
})

test('an unsaved template can cancel refresh and other open tabs do not reload', async ({
  page,
  context,
}) => {
  const state = await setup(page)
  const other = await context.newPage()
  const otherState = await setup(other)
  await other.goto(workspaceFixtureUrl())
  await page.goto(workspaceFixtureUrl('Labels'))
  const studio = page.locator('.label-studio')
  await studio.getByRole('button', { name: 'Templates', exact: true }).click()
  await studio
    .getByRole('button', { name: 'Open template', exact: true })
    .click()
  await studio.getByLabel('Template name').fill('Keep these unsaved edits')
  state.deployment.running = state.deployment.published = 'release-two'
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(state.notice).toBeVisible()
  const warning = page.waitForEvent('dialog')
  const click = state.notice
    .getByRole('button', { name: 'Refresh app' })
    .click({ noWaitAfter: true })
  const dialog = await warning
  expect(dialog.type()).toBe('beforeunload')
  await dialog.dismiss()
  await click
  await expect(studio.getByLabel('Template name')).toHaveValue(
    'Keep these unsaved edits',
  )
  await expect(state.notice).toBeVisible()
  expect(state.documents).toHaveLength(1)

  const acceptance = page.waitForEvent('dialog')
  const acceptClick = state.notice
    .getByRole('button', { name: 'Refresh app' })
    .click({ noWaitAfter: true })
  await (await acceptance).accept()
  await acceptClick
  await expect.poll(() => state.documents.length).toBe(2)
  await expect(studio).toBeVisible()
  await expect(state.notice).toHaveCount(0)
  expect(otherState.documents).toHaveLength(1)
  expect(state.workspace).toEqual(state.originalWorkspace)
  expect(
    state.writes.filter((write) => write.action !== 'labelDraftCheckpoint'),
  ).toEqual([])
  await other.close()
})

test('shared product forms warn before a normal browser refresh', async ({
  page,
}) => {
  await setup(page)
  await page.goto(workspaceFixtureUrl('Products & Pricing'))
  await page
    .getByRole('button', { name: 'Create product', exact: true })
    .first()
    .click()
  const modal = page.getByRole('dialog')
  await modal
    .getByLabel('Product name', { exact: true })
    .fill('Unsaved product')
  const warning = page.waitForEvent('dialog')
  const reload = page.reload({ timeout: 2000 }).catch(() => {})
  const dialog = await warning
  expect(dialog.type()).toBe('beforeunload')
  await dialog.dismiss()
  await reload
  await expect(modal.getByLabel('Product name', { exact: true })).toHaveValue(
    'Unsaved product',
  )
})
