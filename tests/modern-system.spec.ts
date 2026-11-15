import { test, expect } from '@playwright/test'
import { demoData } from '../src/lib/demo'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'
import { installPublicPlanFixture } from './public-plan-fixture'
import { bookSummary, planBookkeeping } from '../src/lib/checkbook'
import { writeFile } from 'node:fs/promises'
const phase = process.env.DESIGN_PHASE || 'after'
for (const width of [1440, 390])
  test(`modern system review ${width}`, async ({ page }) => {
    test.setTimeout(180000)
    await page.setViewportSize({ width, height: 1000 })
    await installWorkspaceFixture(page)
    const w = demoData()
    w.products.push({
      id: 'review-bag',
      name: 'Linen market bag',
      workflow: 'handmade',
      price: 35,
      quantity: 4,
      cost: 12,
      stockCostKnown: true,
      bom: {
        id: 'review-bom',
        output: 1,
        scrapPercent: 0,
        laborMinutes: 20,
        laborRate: 15,
        overhead: 2,
        lines: [],
      },
    })
    let sequence = 0
    for (const data of [
      {
        kind: 'contribution',
        name: 'Opening cash',
        amount: '100.00',
        account: 'Cash',
      },
      {
        kind: 'income',
        name: 'Saturday market',
        amount: '234.56',
        account: 'Cash',
        category: 'Sales',
        channel: 'Market',
      },
      {
        kind: 'expense',
        name: 'Market booth fee',
        amount: '25.00',
        account: 'Cash',
        category: 'Market/vendor fees',
      },
    ]) {
      const plan = planBookkeeping(
        w,
        'financeBookEntry',
        { ...data, date: '2026-11-15', requestId: `review-${++sequence}` },
        () => `review-${++sequence}`,
      )
      for (const write of plan.writes)
        (w[write.table] ||= []).push(write.record)
    }
    w.bookkeeping = [
      {
        ...bookSummary(w, '2026-01-01', '2026-12-31'),
        monthMoneyIn: 0,
        monthMoneyOut: 0,
        monthProfit: 0,
        yearProfit: 0,
      },
    ]
    await page.route('**/api/workspace*', (route) => {
      expect(route.request().method()).toBe('GET')
      if (route.request().url().includes('productCategories=1'))
        return route.fulfill({
          json: {
            categories: [],
            mappings: {},
            rates: [],
            products: w.products,
            revision: 1,
          },
        })
      return route.fulfill({
        json: { workspace: w, role: 'Owner', demo: true },
      })
    })
    const audits: unknown[] = []
    async function capture(name: string) {
      await page.screenshot({
        path: `docs/reviews/modern-system/${phase}-${name}-${width}.png`,
        fullPage: true,
        animations: 'disabled',
      })
      const audit = await page.locator('body').evaluate((body) =>
        [...body.querySelectorAll('*')]
          .filter(
            (el) =>
              el.getClientRects().length &&
              [...el.childNodes].some(
                (n) => n.nodeType === 3 && n.textContent?.trim(),
              ) &&
              !el.closest(
                'svg,.print-label,.studio-brand-preview,.font-picker-preview',
              ),
          )
          .map((el) => ({
            text: el.textContent?.trim().slice(0, 70),
            size: parseFloat(getComputedStyle(el).fontSize),
            font: getComputedStyle(el).fontFamily,
          }))
          .filter(
            (el) =>
              el.size < 14 ||
              /serif|monospace/i.test(el.font.replace('sans-serif', '')),
          ),
      )
      let contrast: unknown[] = []
      if (process.env.AXE_SCRIPT) {
        await page.addScriptTag({ path: process.env.AXE_SCRIPT })
        contrast = await page.evaluate(async () => {
          const axe = (
            window as unknown as {
              axe: {
                run: (
                  context: Document,
                  options: { runOnly: string[] },
                ) => Promise<{
                  violations: {
                    id: string
                    nodes: { target: string[]; failureSummary?: string }[]
                  }[]
                }>
              }
            }
          ).axe
          const result = await axe.run(document, {
            runOnly: ['color-contrast'],
          })
          return result.violations.map((v) => ({
            id: v.id,
            nodes: v.nodes.map((n) => ({
              target: n.target,
              summary: n.failureSummary,
            })),
          }))
        })
      }
      const smallControls = await page
        .locator(
          'input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]):not([type=hidden]),select,textarea',
        )
        .evaluateAll((elements) =>
          elements
            .filter(
              (el) =>
                el.getClientRects().length &&
                parseFloat(getComputedStyle(el).fontSize) < 16,
            )
            .map((el) => ({
              name: el.getAttribute('aria-label') || el.id,
              size: getComputedStyle(el).fontSize,
            })),
        )
      audits.push({ name, violations: audit, contrast, smallControls })
      if (phase === 'after')
        expect.soft(smallControls, name + ' input size').toEqual([])
      if (phase === 'after') {
        expect.soft(audit, name).toEqual([])
        expect.soft(contrast, name + ' contrast').toEqual([])
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth - innerWidth,
          ),
          name,
        ).toBeLessThanOrEqual(1)
      }
    }
    await page.goto(workspaceFixtureUrl('Dashboard'))
    await expect(page.locator('.page-heading')).toBeVisible()
    await capture('dashboard')
    if (process.env.EXTENDED_DESIGN_AUDIT) {
      await page.route('**/api/support*', (r) =>
        r.fulfill({
          status: 503,
          json: {
            error: 'AI is unavailable right now. Please contact support.',
          },
        }),
      )
      await page
        .getByRole('button', { name: 'Open assistant', exact: true })
        .click()
      await expect(
        page.getByRole('button', { name: 'Minimize assistant' }),
      ).toBeVisible()
      await capture('audit-assistant')
      await page.getByRole('button', { name: 'Minimize assistant' }).click()
    }
    await page.goto(workspaceFixtureUrl('Inventory/Ingredients'))
    await page
      .getByRole('textbox', { name: 'Search pantry' })
      .fill(w.ingredients[0].name)
    await page
      .getByRole('button', { name: 'View details', exact: true })
      .first()
      .click()
    await page
      .getByRole('button', { name: 'Edit Ingredient', exact: true })
      .click()
    await capture('ingredient-editor')
    await page.goto(
      workspaceFixtureUrl('Handmade/Products & Bills of Materials'),
    )
    await page
      .getByRole('button', { name: 'Linen market bag', exact: true })
      .click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await capture('handmade-popup')
    await page.goto(workspaceFixtureUrl('Finance/Register'))
    await expect(page.locator('.checkbook')).toBeVisible()
    await capture('finance-register')
    if (process.env.EXTENDED_DESIGN_AUDIT) {
      for (const section of [
        'Recipes',
        'Products & Pricing',
        'Settings/Business details',
        'Settings/Appearance',
        'Inventory/All items',
        'Production/Batch planner',
        'Reports',
      ]) {
        await page.goto(workspaceFixtureUrl(section))
        await expect(page.locator('.page-heading')).toBeVisible()
        await capture('audit-' + section.replaceAll('/', '-'))
      }
    }
    await installPublicPlanFixture(page)
    await page.goto('/pricing')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await capture('pricing')
    if (process.env.EXTENDED_DESIGN_AUDIT) {
      for (const path of [
        '/',
        '/features',
        '/signup',
        '/login',
        '/help',
        '/privacy',
        '/terms',
      ]) {
        await page.goto(path)
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
        await capture('audit-public-' + (path.slice(1) || 'home'))
      }
    }
    await writeFile(
      `docs/reviews/modern-system/${phase}-audit-${width}.json`,
      JSON.stringify(audits, null, 2),
    )
    await page.unrouteAll({ behavior: 'ignoreErrors' })
  })
