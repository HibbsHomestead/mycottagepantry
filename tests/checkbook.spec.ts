import { test, expect } from '@playwright/test'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'
import { demoData } from '../src/lib/demo'
import { bookSummary, planBookkeeping } from '../src/lib/checkbook'
import { ovenToday } from '../src/lib/oven-dates'
for (const width of [1440, 390])
  test(`checkbook register, settings and money form ${width}`, async ({
    page,
  }) => {
    await installWorkspaceFixture(page)
    await page.setViewportSize({ width, height: 1000 })
    const w = demoData()
    for (const key of Object.keys(w)) if (key !== 'settings') w[key] = []
    const today = ovenToday(w.settings[0])
    let sequence = 0
    const id = () => `fixture-${++sequence}`
    function apply(action: string, data: any) {
      const plan = planBookkeeping(w, action, data, id)
      for (const x of plan.writes) {
        const rows = (w[x.table] ||= [])
        const i = rows.findIndex((r) => r.id === x.record.id)
        if (i < 0) rows.push(x.record)
        else rows[i] = x.record
      }
    }
    apply('financeBookEntry', {
      kind: 'contribution',
      name: 'Opening cash',
      amount: '100.00',
      date: today,
      account: 'Cash',
      requestId: id(),
    })
    apply('financeBookEntry', {
      kind: 'income',
      name: 'Saturday market',
      amount: '234.56',
      date: today,
      account: 'Cash',
      category: 'Sales',
      channel: 'Market',
      requestId: id(),
    })
    await page.route('**/api/workspace*', async (route) => {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON()
        apply(body.action, body.data)
      }
      const params = new URL(route.request().url()).searchParams
      const b = bookSummary(
        w,
        params.get('bookFrom') || today.slice(0, 7) + '-01',
        params.get('bookTo') || today,
      )
      w.bookkeeping = [
        {
          ...b,
          monthMoneyIn: b.moneyIn,
          monthMoneyOut: b.moneyOut,
          monthProfit: b.profit,
          yearProfit: b.profit,
        },
      ]
      await route.fulfill({ json: { workspace: w, role: 'Owner', demo: true } })
    })
    await page.goto(workspaceFixtureUrl('Finance/Overview'))
    const book = page.locator('.checkbook')
    await expect(book).toBeVisible()
    await expect(
      book.getByRole('button', { name: 'Bills', exact: true }),
    ).toHaveCount(0)
    await expect(
      book.getByRole('button', { name: 'Invoices', exact: true }),
    ).toHaveCount(0)
    await expect(
      book.getByText('Saturday market', { exact: true }),
    ).toBeVisible()
    expect(
      await book.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1)
    await page.screenshot({
      path: `docs/reviews/checkbook/overview-${width}.png`,
      fullPage: true,
    })
    await book.getByRole('button', { name: '+ Money out', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog
      .getByLabel('Payee / Customer', { exact: true })
      .fill('Market booth fee')
    await dialog.getByLabel('Amount ($)', { exact: true }).fill('12.34')
    await dialog
      .getByRole('combobox', { name: 'Category', exact: true })
      .selectOption('Market/vendor fees')
    await dialog
      .getByRole('button', { name: 'Confirm & save', exact: true })
      .click()
    await expect(dialog).toHaveCount(0)
    await expect(
      book.getByText('Market booth fee', { exact: true }),
    ).toBeVisible()
    await book.getByRole('button', { name: 'Register', exact: true }).click()
    await expect(
      book.getByRole('heading', { name: 'Register', exact: true }),
    ).toBeVisible()
    await expect(book.locator('.book-table thead')).toBeVisible()
    await page.screenshot({
      path: `docs/reviews/checkbook/register-${width}.png`,
      fullPage: true,
    })
    await book
      .getByRole('button', { name: 'Settings / Categories', exact: true })
      .click()
    await book.getByLabel('Turn on bill tracking', { exact: true }).click()
    await expect(
      book.getByRole('button', { name: 'Bills', exact: true }),
    ).toBeVisible()
    await expect(
      book.getByRole('button', { name: 'Invoices', exact: true }),
    ).toHaveCount(0)
    await page.unrouteAll({ behavior: 'ignoreErrors' })
  })
