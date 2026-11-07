import { test, expect } from '@playwright/test'
import { demoData } from '../src/lib/demo'
import { settingsSections } from '../src/components/settings-workspace'
import { accessFixture } from './account-access-fixture'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

const sections = [
  'Dashboard',
  ...[
    'All items',
    'Ingredients',
    'Packaging',
    'Supplies',
    'Inventory ledger',
    'Vendors',
    'Purchase orders',
  ].map((s) => `Pantry/${s}`),
  'Recipes',
  'Products & Pricing',
  ...['Batch planner', 'Batch runs', 'Waste / adjustments', 'Label Studio'].map(
    (s) => `Production/${s}`,
  ),
  ...[
    'Overview',
    'Receipt inbox',
    'Money activity',
    'Consignment',
    'Sales',
    'Expenses',
    'Profit & loss',
    'Tax center',
  ].map((s) => `Finances/${s}`),
  'Reports',
  ...settingsSections.map((s) => `Settings/${s}`),
]
const captures: Record<string, string> = {
  Recipes: 'recipes',
  'Production/Batch runs': 'production',
  'Finances/Receipt inbox': 'receipt-inbox',
  'Settings/Appearance': 'appearance',
}

for (const width of [1440, 768, 390, 320]) {
  test(`all workspace sections share neutral surfaces and fit at ${width}px`, async ({
    page,
  }) => {
    test.setTimeout(180_000)
    await page.setViewportSize({ width, height: 1000 })
    await installWorkspaceFixture(page)
    const workspace = demoData()
    const phase = process.env.CAPTURE_ROLLOUT_PHASE || 'after'
    workspace.recipes[0].imageAssetId = 'recipe-preview'
    workspace.graphic_assets = [
      {
        id: 'recipe-preview',
        name: 'Demonstration recipe photo',
        fileUrl:
          'data:image/svg+xml,' +
          encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="#dce4ef"/><path d="M70 140V95a90 55 0 0 1 180 0v45z" fill="#ad7547"/></svg>',
          ),
      },
    ]
    await page.route('**/api/workspace*', (route) => {
      expect(route.request().method()).toBe('GET')
      return route.fulfill({ json: { workspace, role: 'Owner', demo: true } })
    })
    for (const section of phase === 'before'
      ? Object.keys(captures)
      : sections) {
      await page.goto(workspaceFixtureUrl(section))
      await expect(page.locator('.page-heading')).toBeVisible()
      await expect(page.locator('.app-shell')).toBeVisible()
      if (phase === 'after') {
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth - innerWidth,
          ),
          section,
        ).toBeLessThanOrEqual(1)
        expect(
          await page
            .locator('body')
            .evaluate((el) => getComputedStyle(el).backgroundColor),
        ).toBe('rgb(245, 246, 250)')
        const invalidSurfaces = await page
          .locator('.panel')
          .evaluateAll(
            (elements) =>
              elements.filter(
                (el) =>
                  getComputedStyle(el).backgroundColor !== 'rgb(255, 255, 255)',
              ).length,
          )
        expect(invalidSurfaces, section).toBe(0)
        if (section === 'Recipes') {
          await expect(
            page.getByAltText(`Photo of ${workspace.recipes[0].name}`),
          ).toBeVisible()
        }
      }
      if (captures[section] && (width === 1440 || width === 390)) {
        await page.screenshot({
          path: `docs/previews/${phase}-${captures[section]}-${width}.png`,
          fullPage: true,
          animations: 'disabled',
        })
      }
    }
  })
}

for (const width of [1440, 390]) {
  test(`public and account routes use the shared design at ${width}px`, async ({
    page,
  }) => {
    test.setTimeout(180_000)
    await page.setViewportSize({ width, height: 1000 })
    await page.route('**/api/account-access*', (route) =>
      route.fulfill({ json: accessFixture('signed_out') }),
    )
    await page.route('**/api/registration*', (route) =>
      route.fulfill({
        status: 401,
        json: { error: 'Sign in to view this page.' },
      }),
    )
    await page.route('**/api/support*', (route) =>
      route.fulfill({
        status: 401,
        json: { error: 'Sign in to view support.' },
      }),
    )
    await page.route('**/api/workspace*', (route) => {
      throw new Error(
        'Public design audit must not read business records: ' +
          route.request().method(),
      )
    })
    const phase = process.env.CAPTURE_ROLLOUT_PHASE || 'after'
    for (const path of phase === 'before'
      ? ['/', '/login']
      : [
          '/',
          '/features',
          '/pricing',
          '/help',
          '/privacy',
          '/terms',
          '/login',
          '/signup',
          '/onboarding',
          '/verify-email',
          '/recover',
          '/workspace/billing',
          '/support',
          '/platform-support',
          '/platform-registration',
        ]) {
      await page.goto(path, { waitUntil: 'networkidle' })
      await expect(page.locator('.public-site')).toBeVisible()
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      if (phase === 'after') {
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth - innerWidth,
          ),
          path,
        ).toBeLessThanOrEqual(1)
        expect(
          await page
            .locator('.public-site')
            .evaluate((el) => getComputedStyle(el).backgroundColor),
        ).toBe('rgb(245, 246, 250)')
        expect(
          await page
            .getByRole('heading', { level: 1 })
            .evaluate((el) => getComputedStyle(el).fontFamily),
        ).toContain('DM Sans')
      }
      if (path === '/' || path === '/login')
        await page.screenshot({
          path: `docs/previews/${phase}-${path === '/' ? 'home' : 'login'}-${width}.png`,
          fullPage: true,
          animations: 'disabled',
        })
    }
  })
}
