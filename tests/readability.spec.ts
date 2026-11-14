import { test, expect, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { demoData } from '../src/lib/demo'
import { supportAiDefaults } from '../src/lib/support-ai'
import { launchPricing } from '../src/lib/launch-plans'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

test.setTimeout(30000)
test.beforeEach(({ page }) => {
  page.on('pageerror', (error) => console.log('Browser error:', error.message))
})
const phase = process.env.READABILITY_PHASE || 'after'
const directory = 'docs/reviews/readability'
// Transcribed visible rows from the supplied screenshot. These stay entirely
// inside browser API fixtures; no business record or stock operation is used.
const visibleRows = [
  ['ALDI Canned Pumpkin', 'Baking essentials', 0, 'can', 1.09, 0, 'Aldi'],
  ['Baking Soda', 'Baking essentials', 0, 'lb', 0.66518519, 0, 'Sam’s Club'],
  [
    'Clabber Girl Baking Powder, 22 oz., 2 pk.',
    'Baking essentials',
    0,
    'g',
    0.00311949,
    600,
    'Sam’s Club',
  ],
  ['Instant Dry Yeast', 'Baking essentials', 1, 'lb', 6.98, 1, 'Sam’s Club'],
  [
    'Mott’s Natural Applesauce, 3.9 oz., 36 ct.',
    'Baking essentials',
    0.30751659,
    'each',
    0.34611111,
    10,
    'Sam’s Club',
  ],
  ['Vegetable Oil', 'Baking essentials', 1, 'gallon', 12.34, 1, 'Walmart'],
  [
    'Premium Dark Chocolate Chunks',
    'Chocolate & add-ins',
    283.49523125,
    'g',
    0.01746061,
    100,
    'Aldi',
  ],
  [
    'Premium Semi-Sweet Chocolate Chunks',
    'Chocolate & add-ins',
    10,
    'oz',
    0.495,
    5,
    'Aldi',
  ],
  ['Asiago Cheese Wedge', 'Dairy & eggs', 8, 'oz', 0.62375, 0, 'HyVee'],
  [
    'Cage Free Grade AA Large White Eggs, 2 dozen',
    'Dairy & eggs',
    48,
    'each',
    0.20083333,
    12,
    'Sam’s Club',
  ],
  ['Milk - Whole', 'Dairy & eggs', 0.5, 'gallon', 7.94, 0.25, 'Walmart'],
  ['Parmesan Cheese Wedge', 'Dairy & eggs', 226, 'g', 0.01765487, 226, 'Aldi'],
] as const

async function appFixture(page: Page) {
  await installWorkspaceFixture(page)
  const workspace = demoData()
  const base = workspace.ingredients[0]
  workspace.ingredients = visibleRows.map(
    ([name, category, quantity, unit, cost, threshold, vendor], index) => ({
      ...base,
      id: `readability-${index}`,
      name,
      category,
      quantity,
      unit,
      storageUnit: unit,
      recipeUnit: unit,
      cost,
      currentCost: cost,
      threshold,
      vendor,
      usedAs: 'ingredient',
      conversions: [],
      purchaseQuantity: 1,
      purchaseUnit: unit,
      packagePrice: cost,
      needsCostSetup: false,
      importedDataNeedsReview: false,
    }),
  )
  workspace.settings[0].currentPantryView = 'table'
  workspace.settings[0].currentPantrySort = {
    key: 'category',
    direction: 'asc',
  }
  await page.route('**/api/workspace*', (route) =>
    route.fulfill({ json: { workspace, role: 'Owner', demo: false } }),
  )
}

async function audit(page: Page, name: string) {
  await page.evaluate(() =>
    Promise.race([
      document.fonts.ready,
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]),
  )
  const report = await page.evaluate(() => {
    const samples = Array.from(
      document.querySelectorAll<HTMLElement>(
        'body, .pantry-table th, .pantry-table td, .pantry-table td strong, .pantry-table td small, .status, .admin-panel p, .admin-panel label, .admin-badge, .support-message p, .support-message time, .studio-field, .studio-small-note, .studio-compact-number, .studio-control-unit, input, select, textarea, .cost-card small, .cost-card-label, [data-slot="dialog-description"]',
      ),
    )
      .filter(
        (el) => el.getClientRects().length && !el.closest('svg, .print-label'),
      )
      .map((el) => ({
        tag: el.tagName,
        inputType: el instanceof HTMLInputElement ? el.type : '',
        className: el.className,
        text: el.tagName === 'BODY' ? '' : el.textContent?.trim().slice(0, 80),
        size: getComputedStyle(el).fontSize,
        color: getComputedStyle(el).color,
      }))
    const underMinimum: { text: string; size: string }[] = []
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
    )
    while (walker.nextNode()) {
      const node = walker.currentNode,
        parent = node.parentElement
      if (
        !node.textContent?.trim() ||
        !parent ||
        !parent.checkVisibility() ||
        parent.closest(
          'svg, .print-label, .sr-only, script, style, option, .studio-brand-preview',
        )
      )
        continue
      const fontSize = getComputedStyle(parent).fontSize
      if (parseFloat(fontSize) < 14)
        underMinimum.push({
          text: node.textContent.trim().slice(0, 80),
          size: fontSize,
        })
    }
    const clippedControls = Array.from(
      document.querySelectorAll<HTMLElement>(
        'button, [data-slot="select-trigger"]',
      ),
    )
      .filter(
        (el) =>
          el.checkVisibility() &&
          el.textContent?.trim() &&
          !el.classList.contains('sr-only'),
      )
      .filter(
        (el) =>
          el.scrollHeight > el.clientHeight + 2 ||
          el.scrollWidth > el.clientWidth + 2,
      )
      .map((el) => el.textContent?.trim())
    const ancestors = []
    let el: HTMLElement | null = document.querySelector(
      '.pantry-table, .admin-main, [role="dialog"]',
    )
    while (el) {
      const css = getComputedStyle(el)
      ancestors.push({
        tag: el.tagName,
        className: el.className,
        fontSize: css.fontSize,
        zoom: css.zoom,
        transform: css.transform,
      })
      el = el.parentElement
    }
    return {
      viewport: { width: innerWidth, height: innerHeight },
      dpr: devicePixelRatio,
      visualScale: visualViewport?.scale,
      samples,
      underMinimum,
      clippedControls,
      ancestors,
      pageOverflow: document.documentElement.scrollWidth - innerWidth,
    }
  })
  await writeFile(
    `${directory}/${name}-${phase}.json`,
    JSON.stringify(report, null, 2),
  )
  await page.screenshot({
    path: `${directory}/${name}-${phase}.png`,
    animations: 'disabled',
  })
  if (phase === 'after') {
    expect(report.pageOverflow).toBeLessThanOrEqual(1)
    expect(report.underMinimum).toEqual([])
    expect(report.clippedControls).toEqual([])
    for (const el of report.samples)
      expect(
        parseFloat(el.size),
        `${el.tag} ${el.className}: ${el.text}`,
      ).toBeGreaterThanOrEqual(14)
    for (const el of report.samples.filter(
      (el) =>
        ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tag) &&
        !['checkbox', 'radio', 'range', 'color'].includes(el.inputType),
    ))
      expect(parseFloat(el.size)).toBe(16)
  }
}

for (const width of [1657, 820, 390]) {
  test(`inventory and ingredient popup ${width}`, async ({ page }) => {
    // The supplied image is 1657px wide, with 1262px of web content below browser chrome.
    await page.setViewportSize({ width, height: width === 1657 ? 1262 : 900 })
    await appFixture(page)
    await page.goto(workspaceFixtureUrl('Inventory/Overview'))
    await expect(page.locator('.pantry-table tbody tr')).toHaveCount(12)
    // Use the reference's category sort through the existing control.
    await page.locator('.pantry-table').screenshot({
      path: `${directory}/inventory-table-${width}-${phase}.png`,
    })
    await audit(page, `inventory-${width}`)
    await page
      .locator('.pantry-table .item-name')
      .filter({ hasText: 'Instant Dry Yeast' })
      .click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await audit(page, `ingredient-popup-${width}`)
    await page
      .getByRole('button', { name: 'Edit Ingredient', exact: true })
      .click()
    await expect(page.getByLabel('Name', { exact: true })).toBeVisible()
    await audit(page, `ingredient-editor-${width}`)
  })
}

for (const width of [1440, 820, 390]) {
  test(`admin billing ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await installWorkspaceFixture(page)
    await page.route('**/api/admin*', (route) => {
      if (
        new URL(route.request().url()).searchParams.get('action') === 'session'
      )
        return route.fulfill({
          json: {
            stage: 'authenticated',
            identityId: 'demo-admin',
            role: 'owner',
            expiresAt: '2027-01-01',
          },
        })
      return route.fulfill({
        json: {
          rows: [],
          total: 0,
          page: 1,
          pageSize: 25,
          events: [],
          connection: [],
          checks: [],
          mappings: [],
          syncRuns: [],
          webhookEvidence: [],
          oauth: {},
          stripe: {
            rows: [
              {
                environment: 'test',
                configuration: {},
                checkout_enabled: false,
              },
            ],
            evidence: [],
            events: [],
            encryptionReady: true,
            tiers: launchPricing.plans,
            endpoints: {
              test: 'https://example.test/api/stripe/test/webhook',
              live: 'https://example.test/api/stripe/live/webhook',
            },
          },
        },
      })
    })
    await page.goto('/admin?section=billing')
    await expect(
      page.getByRole('heading', { name: 'Provider settings · Stripe' }),
    ).toBeVisible()
    await audit(page, `admin-billing-${width}`)
    await page
      .getByText('Credentials · save or rotate', { exact: true })
      .click()
    await audit(page, `admin-billing-controls-${width}`)
  })
}

for (const width of [1440, 390]) {
  test(`product popup and Label Studio ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await installWorkspaceFixture(page)
    const workspace = demoData()
    await page.route('**/api/workspace*', (route) =>
      route.fulfill({ json: { workspace, role: 'Owner', demo: false } }),
    )
    await page.goto(workspaceFixtureUrl('Products'))
    await page
      .getByRole('button', { name: workspace.products[0].name, exact: true })
      .click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await audit(page, `product-popup-${width}`)
    await page.goto(workspaceFixtureUrl('Labels'))
    await page
      .getByRole('button', { name: 'Create label', exact: true })
      .click()
    await expect(page.locator('.studio-editor')).toBeVisible()
    await page.getByRole('button', { name: 'Static text', exact: true }).click()
    await audit(page, `label-studio-${width}`)
    // Isolate the actual rendered SVG at an integer position so fixed mobile
    // navigation and subpixel page offsets cannot contaminate the comparison.
    await page
      .locator('svg.studio-label-svg')
      .last()
      .evaluate((svg) => {
        const clone = svg.cloneNode(true) as SVGSVGElement
        clone.dataset.readabilityArtwork = 'true'
        Object.assign(clone.style, {
          position: 'fixed',
          left: '0',
          top: '0',
          width: '384px',
          height: '576px',
          background: 'white',
          zIndex: '2147483647',
        })
        document.body.append(clone)
      })
    await page
      .locator('[data-readability-artwork]')
      .screenshot({ path: `${directory}/label-artwork-${width}-${phase}.png` })
    await page
      .locator('[data-readability-artwork]')
      .evaluate((el) => el.remove())
    const artwork = await page
      .locator('svg.studio-label-svg')
      .last()
      .evaluate((svg) => ({
        viewBox: svg.getAttribute('viewBox'),
        geometry: Array.from(
          svg.querySelectorAll('text, line, rect, path, g'),
        ).map((el) =>
          Array.from(el.attributes)
            .filter((a) => !['id', 'data-element-id'].includes(a.name))
            .map((a) => [
              a.name,
              a.value.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, 'element-id'),
            ]),
        ),
        text: Array.from(svg.querySelectorAll('text')).map((el) => ({
          content: el.textContent,
          fontSize: el.getAttribute('font-size'),
          fontFamily: el.getAttribute('font-family'),
          transform: el.getAttribute('transform'),
          x: el.getAttribute('x'),
          y: el.getAttribute('y'),
        })),
      }))
    await writeFile(
      `${directory}/label-artwork-${width}-${phase}.json`,
      JSON.stringify(artwork, null, 2),
    )
  })
}

for (const width of [1440, 390]) {
  test(`support inbox ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await installWorkspaceFixture(page)
    await page.route('**/api/admin*', (route) =>
      route.fulfill({
        json: {
          stage: 'authenticated',
          identityId: 'demo-admin',
          role: 'admin',
          expiresAt: '2027-01-01',
        },
      }),
    )
    const ticket = {
      id: '20000000-0000-4000-8000-000000000001',
      number: 17,
      subject: 'Recipe method question',
      category: 'Question',
      status: 'in_progress',
      requesterEmail: 'demo-maker@example.test',
      createdAt: '2026-11-14T04:12:00Z',
      updatedAt: '2026-11-14T05:18:00Z',
      diagnostics: {},
    }
    await page.route('**/api/support*', (route) => {
      const url = new URL(route.request().url())
      if (url.searchParams.has('ai'))
        return route.fulfill({
          json: {
            policy: supportAiDefaults,
            usage: [],
            conversations: [],
            actions: [],
          },
        })
      if (url.searchParams.has('ticket'))
        return route.fulfill({
          json: {
            ticket,
            messages: [
              {
                id: 'message',
                kind: 'customer',
                own: false,
                body: 'Where can I update the method for my sourdough recipe?',
                createdAt: ticket.createdAt,
                attachments: [],
              },
            ],
            notifications: [],
          },
        })
      if (route.request().method() === 'POST')
        return route.fulfill({ json: { tickets: [ticket], hasMore: false } })
      return route.fulfill({ json: { staff: true, admin: true } })
    })
    await page.goto('/platform-support#ticket=' + ticket.id)
    await expect(
      page.getByRole('heading', { name: ticket.subject }),
    ).toBeVisible()
    await audit(page, `support-inbox-${width}`)
  })
}

test('narrow layout and 200 percent text enlargement keep inventory usable', async ({
  page,
}) => {
  test.skip(
    phase === 'before',
    'Regression check for the new readable controls',
  )
  await page.setViewportSize({ width: 320, height: 900 })
  await appFixture(page)
  await page.goto(workspaceFixtureUrl('Inventory/Overview'))
  await expect(page.locator('.pantry-table tbody tr')).toHaveCount(12)
  await audit(page, 'inventory-320')
  await page.setViewportSize({ width: 820, height: 900 })
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%'
  })
  const result = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - innerWidth,
    values: Array.from(document.querySelectorAll('.pantry-table td')).map(
      (el) => parseFloat(getComputedStyle(el).fontSize),
    ),
    clippedButtons: Array.from(document.querySelectorAll<HTMLElement>('button'))
      .filter(
        (el) =>
          el.checkVisibility() &&
          el.textContent?.trim() &&
          (el.scrollHeight > el.clientHeight + 2 ||
            el.scrollWidth > el.clientWidth + 2),
      )
      .map((el) => el.textContent?.trim()),
    tableScrollable:
      document.querySelector('.pantry-table .table-wrap')!.scrollWidth >
      document.querySelector('.pantry-table .table-wrap')!.clientWidth,
  }))
  expect(result.overflow).toBeLessThanOrEqual(1)
  expect(Math.min(...result.values)).toBeGreaterThanOrEqual(30)
  expect(result.clippedButtons).toEqual([])
  expect(result.tableScrollable).toBe(true)
  await page.screenshot({
    path: `${directory}/inventory-text-200-percent.png`,
    animations: 'disabled',
  })
})
