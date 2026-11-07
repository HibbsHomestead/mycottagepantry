import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'
import { test, expect } from '@playwright/test'
import { demoData } from '../src/lib/demo'
import { systemLabelTemplates } from '../src/lib/label-studio'

test('captures actual app views using only deterministic demonstration records', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 960 })
  const workspace = demoData()
  Object.assign(workspace.settings[0], {
    name: 'Cottage Pantry Demo Kitchen',
    owner: 'Demonstration business',
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
  await page.route('**/api/workspace*', (route) => {
    expect(route.request().method()).toBe('GET')
    expect(route.request().url()).not.toMatch(/assistant|priceSearch/)
    return route.fulfill({ json: { workspace, role: 'Owner', demo: true } })
  })
  await installWorkspaceFixture(page)
  for (const [name, section] of [
    ['recipes', 'Recipes'],
    ['pantry', 'Pantry'],
    ['costing', 'Recipes'],
    ['production', 'Production'],
    ['labels', 'Labels'],
    ['finances', 'Finances/Tax center'],
  ]) {
    await page.goto(workspaceFixtureUrl(section), { waitUntil: 'networkidle' })
    await expect(page.locator('.app-shell')).toBeVisible()
    if (name === 'costing') {
      await page
        .locator('.recipe-card')
        .filter({ hasText: 'Homestyle White Bread' })
        .click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await page.getByText('Cost breakdown', { exact: true }).click()
    }
    if (name === 'labels') {
      await page
        .getByRole('button', { name: 'Saved Labels', exact: true })
        .click()
      await page.getByRole('button', { name: 'Open label' }).click()
      await expect(page.locator('.studio-editor')).toBeVisible()
    }
    await page.screenshot({
      path: `/tmp/cottage-${name}.png`,
      animations: 'disabled',
    })
  }
})

test('public pages disclose plan availability and expose no workspace data or checkout controls', async ({
  page,
}) => {
  let workspaceRequests = 0
  await page.route('**/api/workspace*', (route) => {
    workspaceRequests++
    return route.abort()
  })
  for (const width of [1440, 820, 390]) {
    await page.setViewportSize({ width, height: 960 })
    for (const path of [
      '/',
      '/features',
      '/pricing',
      '/help',
      '/signup',
      '/privacy',
      '/terms',
      '/workspace',
    ]) {
      await page.goto('http://localhost:8889' + path, {
        waitUntil: 'networkidle',
      })
      await expect(page.locator('.public-site')).toBeVisible()
      await expect(page.locator('.app-shell')).toHaveCount(0)
      for (const img of await page.locator('img[src^="/screenshots/"]').all()) {
        await img.scrollIntoViewIfNeeded()
        await expect(img).toHaveJSProperty('complete', true)
        expect(
          await img.evaluate((el: HTMLImageElement) => el.naturalWidth),
        ).toBeGreaterThan(0)
      }
      await expect(page.locator('body')).not.toContainText(
        /SerpApi|Compare store prices|Cottage Pantry Assistant|unlimited AI|Most popular|\$12|\$24|\$39/,
      )
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - innerWidth,
        ),
      ).toBeLessThanOrEqual(1)
      if (path === '/features') {
        await expect(
          page
            .getByRole('navigation', { name: 'Product tour sections' })
            .locator('a'),
        ).toHaveCount(6)
        const open = page.getByRole('button', {
          name: 'Expand Costing screenshot',
        })
        await open.click()
        await expect(
          page.getByRole('dialog', { name: 'Costing' }),
        ).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(open).toBeFocused()
        await page.evaluate(() => {
          window.scrollTo(0, 0)
          ;(document.activeElement as HTMLElement)?.blur()
        })
        await page.screenshot({
          path: `/tmp/cottage-features-${width}.png`,
          fullPage: true,
          animations: 'disabled',
        })
      }
      if (path === '/pricing') {
        await expect(
          page.getByRole('heading', {
            name: 'Your business, in good order.',
            exact: true,
          }),
        ).toBeVisible()
        await expect(
          page.getByText(
            /Your chosen plan is saved; registration collects no payment/,
          ),
        ).toBeVisible()
        await expect(page.locator('.plan-card')).toHaveCount(5)
        await expect(page.locator('main')).toContainText('Cottage Mercantile')
        await expect(page.locator('main')).toContainText(
          'Paid plans are not yet available for purchase',
        )
        await expect(
          page.locator('main a[href="/signup"]').first(),
        ).toBeVisible()
        await expect(page.locator('main a[href="/login"]')).toBeVisible()
        await expect(page.locator('a[href*="checkout"]')).toHaveCount(0)
        await page.evaluate(() => {
          window.scrollTo(0, 0)
          ;(document.activeElement as HTMLElement)?.blur()
        })
        await page.screenshot({
          path: `/tmp/cottage-pricing-${width}.png`,
          fullPage: true,
          animations: 'disabled',
        })
      }
      if (path === '/')
        await page.screenshot({
          path: `/tmp/cottage-home-${width}.png`,
          fullPage: true,
          animations: 'disabled',
        })
    }
  }
  expect(workspaceRequests).toBe(0)
})
