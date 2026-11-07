import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'
import { test, expect } from '@playwright/test'
import { demoData } from '../src/lib/demo'
// UI fixtures keep browser layout/error checks independent of local DB provisioning.
// They do not verify persistence against the deployed database.
for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1024, height: 640 },
  { width: 390, height: 844 },
]) {
  test(`ingredient modal layout and error recovery ${viewport.width}`, async ({
    page,
  }) => {
    await installWorkspaceFixture(page)
    await page.setViewportSize(viewport)
    await page.route('**/api/workspace*', async (route) => {
      if (route.request().url().includes('productImport'))
        return route.fulfill({
          status: 401,
          contentType: 'text/html',
          body: '<!doctype html><title>Login Redirect</title>',
        })
      const workspace = demoData()
      if (viewport.width === 1024)
        workspace.settings[0].appearance = { theme: 'plum', mode: 'dark' }
      return route.fulfill({ json: { workspace, role: 'Owner', demo: true } })
    })
    await page.goto(workspaceFixtureUrl('Pantry'), {
      waitUntil: 'domcontentloaded',
    })
    await page
      .getByRole('button', { name: 'Add ingredient', exact: true })
      .first()
      .click()
    const modal = page.getByRole('dialog')
    await expect(
      modal.getByRole('heading', { name: 'Add ingredient', exact: true }),
    ).toBeVisible()
    await modal.getByLabel('Ingredient / item name').fill('Unsaved test flour')
    await modal
      .getByLabel('Product URL')
      .fill(
        'https://www.samsclub.com/ip/flour/13909715756?tracking=' +
          'x'.repeat(800),
      )
    await modal
      .getByRole('button', { name: 'Get product details', exact: true })
      .click()
    await expect(modal.getByRole('alert')).toContainText(
      'Site access or sign-in is required',
    )
    await expect(modal.getByLabel('Ingredient / item name')).toHaveValue(
      'Unsaved test flour',
    )
    await expect(
      modal.getByRole('button', { name: 'Get product details', exact: true }),
    ).toBeEnabled()
    const b = await modal.boundingBox()
    expect(b).toBeTruthy()
    expect(b!.x).toBeGreaterThan(5)
    expect(b!.y).toBeGreaterThan(5)
    expect(b!.y + b!.height).toBeLessThan(viewport.height - 5)
    expect(Math.abs(b!.x + b!.width / 2 - viewport.width / 2)).toBeLessThan(2)
    if (viewport.width === 1440) expect(b!.width).toBe(1040)
    const metrics = await modal.evaluate((el) => {
      const body = el.querySelector('.ingredient-modal-body')!,
        footer = el.querySelector('.form-footer')!
      const br = body.getBoundingClientRect(),
        fr = footer.getBoundingClientRect()
      return {
        bodyBottom: br.bottom,
        footerTop: fr.top,
        overflow: el.scrollWidth - el.clientWidth,
        scrollable: body.scrollHeight > body.clientHeight,
        lock: document.body.getAttribute('data-scroll-locked'),
      }
    })
    expect(metrics.bodyBottom).toBeLessThanOrEqual(metrics.footerTop + 1)
    expect(metrics.overflow).toBeLessThanOrEqual(1)
    expect(metrics.scrollable).toBe(true)
    expect(metrics.lock).toBeTruthy()
    await page.screenshot({ path: `/tmp/add-ingredient-${viewport.width}.png` })
    await modal
      .locator('.ingredient-modal-body')
      .evaluate((el) => (el.scrollTop = el.scrollHeight))
    await expect(
      modal.getByRole('button', { name: 'Save ingredient', exact: true }),
    ).toBeVisible()
    const last = modal
      .locator('.ingredient-flow > details')
      .last()
      .locator(':scope > summary')
    await last.scrollIntoViewIfNeeded()
    const lastBox = await last.boundingBox()
    const footerBox = await modal.locator('.form-footer').boundingBox()
    expect(lastBox!.y + lastBox!.height).toBeLessThanOrEqual(footerBox!.y)
    await modal.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(modal).toHaveCount(0)
    // Reopen Edit using the same shell and verify its actual viewport constraints.
    await page
      .getByRole('button', { name: 'Edit', exact: true })
      .first()
      .click()
    const edit = page.getByRole('dialog')
    await expect(edit).toHaveClass(/ingredient-modal-shell/)
    await expect(
      edit.getByRole('button', { name: 'Save changes', exact: true }),
    ).toBeVisible()
    const eb = await edit.boundingBox()
    expect(eb!.y).toBeGreaterThan(0)
    expect(eb!.y + eb!.height).toBeLessThan(viewport.height)
    expect(
      await edit.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1)
    await page.screenshot({
      path: `/tmp/ingredient-modal-${viewport.width}.png`,
    })
  })
}
