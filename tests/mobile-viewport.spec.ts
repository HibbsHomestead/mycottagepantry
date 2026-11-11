import { test, expect } from '@playwright/test'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'
import { demoData } from '../src/lib/demo'
test('long recipe, linked ingredient, draft resizing and background lock', async ({
  page,
}) => {
  await installWorkspaceFixture(page)
  const workspace = demoData()
  workspace.recipes[0].instructions = Array.from(
    { length: 35 },
    (_, i) => `Step ${i + 1}: Mix and rest the dough before shaping.`,
  )
  await page.route('**/api/workspace*', (r) =>
    r.fulfill({ json: { workspace, role: 'Owner', demo: true } }),
  )
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(workspaceFixtureUrl('Recipes'))
  await page.locator('.recipe-card').first().click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  const y = await page.evaluate(() => window.scrollY)
  await page.mouse.move(5, 400)
  await page.mouse.wheel(0, 800)
  expect(await page.evaluate(() => window.scrollY)).toBe(y)
  await dialog
    .getByRole('button', { name: 'Edit Recipe', exact: true })
    .scrollIntoViewIfNeeded()
  await expect(
    dialog.getByRole('button', { name: 'Edit Recipe', exact: true }),
  ).toBeInViewport()
  await dialog.evaluate((el) => (el.scrollTop = 0))
  await dialog.getByRole('button', { name: 'Bread flour', exact: true }).click()
  await expect(
    dialog.getByRole('heading', { name: 'Bread flour', exact: true }),
  ).toBeVisible()
  await dialog
    .getByRole('button', { name: 'Edit Ingredient', exact: true })
    .click()
  const name = dialog.getByLabel('Name', { exact: true })
  await name.fill('Unsaved mobile draft')
  await page.setViewportSize({ width: 844, height: 390 })
  await expect(name).toHaveValue('Unsaved mobile draft')
  const box = await dialog.boundingBox()
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.y + box!.height).toBeLessThanOrEqual(390)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(name).toHaveValue('Unsaved mobile draft')
  await name.focus()
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport, 'height', {
      configurable: true,
      value: 360,
    })
    window.visualViewport!.dispatchEvent(new Event('resize'))
  })
  await expect(page.locator('html')).toHaveClass(/workspace-keyboard/)
  await expect(
    dialog.getByRole('button', { name: 'Save changes', exact: true }),
  ).toBeInViewport()
  const keyboardBox = await dialog.boundingBox()
  expect(keyboardBox!.y + keyboardBox!.height).toBeLessThanOrEqual(360)
  await expect(name).toHaveValue('Unsaved mobile draft')
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport, 'height', {
      configurable: true,
      value: 844,
    })
    window.visualViewport!.dispatchEvent(new Event('resize'))
  })
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('body')).not.toHaveAttribute('data-scroll-locked')
  await page.locator('.recipe-card').first().click()
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
})
