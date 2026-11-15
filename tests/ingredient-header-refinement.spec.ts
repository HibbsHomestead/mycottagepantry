import { test, expect } from '@playwright/test'
import { demoData } from '../src/lib/demo'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'
for (const width of [1440, 1044, 390])
  test(`ingredient editor header ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : width === 1440 ? 900 : 1177 })
    await installWorkspaceFixture(page)
    const workspace = demoData()
    const original = structuredClone(workspace)
    const writes: any[] = []
    let rejectSave = true
    await page.route('**/api/workspace*', (route) => {
      if (route.request().method() === 'POST') {
        writes.push(route.request().postDataJSON())
        if (rejectSave)
          return route.fulfill({
            status: 409,
            json: { error: 'Review this ingredient before retrying.' },
          })
      }
      return route.fulfill({ json: { workspace, role: 'Owner', demo: false } })
    })
    await page.goto(workspaceFixtureUrl('Inventory/Ingredients'))
    await page
      .getByRole('textbox', { name: 'Search pantry' })
      .fill(workspace.ingredients[0].name)
    await page
      .getByRole('button', { name: 'View details', exact: true })
      .first()
      .click()
    const d = page.getByRole('dialog')
    await d
      .getByRole('button', { name: 'Edit Ingredient', exact: true })
      .click()
    await expect(d.getByLabel('Name', { exact: true })).toBeVisible()
    const phase = process.env.CAPTURE_PHASE || 'after'
    await page.screenshot({
      path: `docs/reviews/ingredient-side-by-side/${phase}-${width}.png`,
      animations: 'disabled',
    })
    if (phase === 'before') {
      await page.unrouteAll({ behavior: 'ignoreErrors' })
      return
    }
    await expect(d.getByLabel('Inventory group', { exact: true })).toHaveCount(
      0,
    )
    await expect(d.getByLabel('Category', { exact: true })).toHaveCount(1)
    const header = d.locator('.ingredient-detail-header')
    if (width > 900) {
      const title = await header.getByRole('heading').boundingBox()
      const tabs = await header.getByRole('tablist').boundingBox()
      expect(tabs!.x).toBeGreaterThan(title!.x + title!.width)
      const left = await d.locator('.ingredient-edit-general').boundingBox()
      const right = await d
        .locator('.ingredient-edit-primary > section')
        .first()
        .boundingBox()
      expect(right!.x).toBeGreaterThan(left!.x + left!.width)
      expect(Math.abs(right!.y - left!.y)).toBeLessThan(2)
    }
    await header
      .getByRole('tab', { name: 'Details & Costing', exact: true })
      .focus()
    await page.keyboard.press('ArrowRight')
    await expect(
      header.getByRole('tab', { name: 'Images & Label Info', exact: true }),
    ).toBeFocused()
    await page.keyboard.press('Home')
    await expect(
      header.getByRole('tab', { name: 'Details & Costing', exact: true }),
    ).toBeVisible()
    await d
      .getByLabel('Name', { exact: true })
      .fill('Long unsaved ingredient name for header review')
    for (const name of [
      'Images & Label Info',
      'Stock & Other Details',
      'Unit Conversions',
      'Details & Costing',
    ]) {
      await header.getByRole('tab', { name, exact: true }).click()
      expect(await d.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
        true,
      )
    }
    await expect(d.getByLabel('Name', { exact: true })).toHaveValue(
      'Long unsaved ingredient name for header review',
    )
    await d
      .locator('summary')
      .filter({ hasText: /^Find product details$/ })
      .click()
    await expect(d.getByLabel('Product URL', { exact: true })).toBeVisible()
    if (width > 900) {
      const left = await d.locator('.ingredient-edit-general').boundingBox()
      const right = await d
        .locator('.ingredient-edit-primary > section')
        .first()
        .boundingBox()
      expect(right!.x).toBeGreaterThan(left!.x + left!.width)
      expect(Math.abs(right!.y - left!.y)).toBeLessThan(2)
    }
    await d
      .getByLabel('Product URL', { exact: true })
      .fill('https://example.invalid/ingredient')
    await page.screenshot({
      path: `docs/reviews/ingredient-side-by-side/lookup-${width}.png`,
      animations: 'disabled',
    })
    await d
      .locator('summary')
      .filter({ hasText: /^Find product details$/ })
      .click()
    const body = d.locator('.ingredient-detail-body')
    const headerBefore = await header.boundingBox()
    await body.evaluate((el) => {
      el.scrollTop = el.scrollHeight
    })
    expect((await header.boundingBox())?.y).toBe(headerBefore?.y)
    if (width === 390)
      await page.screenshot({
        path: 'docs/reviews/ingredient-side-by-side/costing-390.png',
        animations: 'disabled',
      })
    await expect(
      d.getByRole('button', { name: 'Save changes', exact: true }),
    ).toBeInViewport()
    await d
      .getByLabel('Name', { exact: true })
      .fill(original.ingredients[0].name)
    await d.getByRole('button', { name: 'Save changes', exact: true }).click()
    await expect(d.getByRole('alert')).toContainText(
      'Review this ingredient before retrying.',
    )
    await expect(d.getByRole('alert')).toBeInViewport()
    rejectSave = false
    await d.getByRole('button', { name: 'Save changes', exact: true }).click()
    expect(writes.at(-1).action).toBe('ingredientUpdate')
    expect(workspace).toEqual(original)
    await page.unrouteAll({ behavior: 'ignoreErrors' })
  })
