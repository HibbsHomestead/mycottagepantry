import { test, expect } from '@playwright/test'
import sharp from 'sharp'
import { demoData } from '../src/lib/demo'
import { systemLabelTemplates } from '../src/lib/label-studio'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

// Screens are the real components with deterministic demo API responses.
// This is a capture harness, not an app route or authentication bypass.
test('captures current feature screens with demonstration records', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const workspace = demoData()
  Object.assign(workspace.settings[0], {
    name: 'Cottage Pantry Demo Kitchen',
    owner: 'Demonstration business',
    currentPantryView: 'table',
    email: 'demo@example.invalid',
    address: 'Demonstration address',
  })
  workspace.label_templates = [
    {
      ...structuredClone(systemLabelTemplates[0]),
      id: 'demo-loaf-label',
      name: 'White bread · demonstration design',
      isSystem: false,
      revision: 1,
    },
  ]
  await installWorkspaceFixture(page)
  await page.route('**/api/workspace*', (route) => {
    expect(route.request().method()).toBe('GET')
    return route.fulfill({ json: { workspace, role: 'Owner', demo: true } })
  })
  for (const width of [1440, 390]) {
    const mobile = width === 390
    await page.setViewportSize({ width, height: 1100 })
    for (const [name, section] of [
      ['costing', 'Recipes'],
      ['pantry', 'Inventory/Ingredients'],
      ['recipes', 'Recipes'],
      ['production', 'Production/Production Runs'],
      ['labels', 'Labels'],
      ['finances', 'Finances/Tax center'],
    ]) {
      await page.goto(workspaceFixtureUrl(section))
      await expect(page.locator('.app-shell')).toBeVisible()
      let target = page.locator('.page-heading')
      if (name === 'pantry') {
        target = page.locator('.pantry-v2')
      }
      if (name === 'costing') {
        await page
          .locator('.recipe-card')
          .filter({ hasText: 'Homestyle White Bread' })
          .click()
        await page
          .getByRole('dialog')
          .getByText('Cost breakdown', { exact: true })
          .click()
        target = page.getByRole('dialog')
      }
      if (name === 'labels') {
        await page
          .getByRole('button', { name: 'Saved Labels', exact: true })
          .click()
        await page.getByRole('button', { name: 'Open label' }).click()
        await expect(page.locator('.studio-editor')).toBeVisible()
        if (mobile) {
          await page
            .getByRole('button', { name: 'Zoom out', exact: true })
            .click()
          await page
            .getByRole('button', { name: 'Zoom out', exact: true })
            .click()
        }
        target = page.locator(mobile ? '.studio-stage-area' : '.studio-editor')
      }
      if (name === 'finances')
        await page
          .getByRole('combobox', { name: 'Tax reporting period', exact: true })
          .selectOption('Last month')
      if (mobile && name === 'pantry') target = page.locator('.pantry-table')
      if (mobile && name === 'recipes') target = page.locator('.recipe-grid')
      if (mobile && name === 'finances') target = page.locator('.tax-center-v2')
      if (mobile && name === 'production')
        target = page.locator('.production-layout')
      await page.evaluate(() => document.fonts.ready)
      await target.evaluate((el) => el.scrollIntoView({ block: 'start' }))
      if (name === 'labels') await page.evaluate(() => window.scrollBy(0, -150))
      const box = await target.boundingBox()
      expect(box).toBeTruthy()
      let clip = {
        x: Math.max(0, box!.x),
        y: Math.max(0, box!.y),
        width: width - box!.x - 20,
        height: 0,
      }
      if (mobile)
        clip = { x: 0, y: Math.max(0, box!.y), width: 390, height: 693 }
      else clip.height = clip.width * 0.75
      if (name === 'costing') {
        clip.x = box!.x
        clip.y = box!.y
        clip.width = box!.width
        clip.height = Math.min(box!.height, mobile ? 693 : box!.width * 0.75)
      }
      const screenshot = await page.screenshot({ clip, animations: 'disabled' })
      await sharp(screenshot)
        .resize(mobile ? 390 : 1000, mobile ? 693 : 750, {
          fit: 'contain',
          background: '#f5f6fa',
        })
        .webp({ quality: 90 })
        .toFile(
          `public/screenshots/features-${name}${mobile ? '-mobile' : ''}.webp`,
        )
    }
  }
})

for (const width of [1440, 390]) {
  test(`updated Features page and screenshot viewers fit at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 960 })
    let businessRequests = 0
    await page.route('**/api/workspace*', (route) => {
      businessRequests++
      return route.abort()
    })
    await page.goto('http://localhost:8889/features', {
      waitUntil: 'networkidle',
    })
    for (const section of await page.locator('.tour-section').all()) {
      const img = section.locator('.tour-expand img')
      await img.scrollIntoViewIfNeeded()
      await expect(img).toHaveJSProperty('complete', true)
      expect(
        await img.evaluate((el: HTMLImageElement) => ({
          loaded: el.naturalWidth > 0,
          mobile: el.currentSrc.includes('-mobile'),
        })),
      ).toEqual({ loaded: true, mobile: width < 780 })
      const trigger = section.getByRole('button', { name: /^Expand/ })
      await trigger.click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      const image = dialog.locator('img')
      await expect(image).toHaveJSProperty('complete', true)
      expect(
        await image.evaluate((el) => el.getBoundingClientRect().width),
      ).toBeLessThanOrEqual(width)
      expect(
        await dialog.evaluate((el) => el.scrollWidth - el.clientWidth),
      ).toBeLessThanOrEqual(1)
      await page.keyboard.press('Escape')
      await expect(trigger).toBeFocused()
    }
    expect(businessRequests).toBe(0)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1)
    await page.evaluate(() => {
      window.scrollTo(0, 0)
      ;(document.activeElement as HTMLElement)?.blur()
    })
    await page.screenshot({
      path: `docs/previews/features-refreshed-${width}.png`,
      fullPage: true,
      animations: 'disabled',
    })
    const box = await page.locator('#inventory').boundingBox()
    await sharp(`docs/previews/features-refreshed-${width}.png`)
      .extract({
        left: Math.round(box!.x),
        top: Math.round(box!.y),
        width: Math.floor(box!.width),
        height: Math.floor(box!.height),
      })
      .png()
      .toFile(`docs/previews/features-inventory-${width}.png`)
  })
}
