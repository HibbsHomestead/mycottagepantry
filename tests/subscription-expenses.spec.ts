/* eslint-disable @typescript-eslint/no-explicit-any -- synthetic provider and Finance JSON fixtures */
import { test, expect } from '@playwright/test'
import { installWorkspaceFixture } from './workspace-fixture'
for (const width of [1440, 390])
  test(`subscription expense offer and review ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    await installWorkspaceFixture(page)
    await page.route('**/capture-subscription*', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><script type="module">import RefreshRuntime from "/@react-refresh";RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>(type)=>type;window.__vite_plugin_react_preamble_installed__=true;import("/src/test/capture-workspace.tsx").then(m=>m.mountSubscriptionExpenseFixture())</script></body></html>',
      }),
    )
    const payment = {
      id: '30000000-0000-4000-8000-000000000001',
      kind: 'payment',
      status: 'available',
      planName: 'Mixing Bowl',
      amountCents: 850,
      currency: 'USD',
      paidAt: '2026-11-15T12:00:00Z',
      payee: 'Cottage Pantry',
      description: 'Mixing Bowl subscription · prorated payment',
      invoiceReference: 'CP-REVIEW-001',
      invoiceDetails: { discounts: [{ amount: 200 }], tax: [{ amount: 50 }] },
      category: 'Software',
      account: '',
      dismissed: false,
    }
    let enabled = false
    const calls: any[] = []
    await page.route('**/api/stripe/billing', async (route) => {
      const body = route.request().postDataJSON()
      calls.push(body)
      if (body.action === 'expense_skip') payment.dismissed = true
      if (body.action === 'expense_record') {
        payment.status = body.draft ? 'review' : 'recorded'
        payment.account = body.account
      }
      if (body.action === 'expense_preferences') enabled = body.enabled
      return route.fulfill({
        json: {
          workspace: { name: 'Screenshot business' },
          expenses: {
            available: true,
            payments: [payment],
            preference: { enabled, account: '', category: 'Software' },
            accounts: ['Cash', 'Bank account'],
            categories: ['Software', 'Office expense'],
          },
        },
      })
    })
    await page.route('**/.netlify/identity/**', (route) =>
      route.fulfill({ status: 401, json: {} }),
    )
    await page.goto('/capture-subscription')
    await expect(
      page.getByRole('heading', {
        name: 'Add this to your business expenses?',
      }),
    ).toBeVisible()
    await page.screenshot({
      path: `docs/reviews/subscription-expenses/offer-${width}.png`,
      fullPage: true,
    })
    await page
      .getByRole('button', { name: 'Add to Finance', exact: true })
      .first()
      .click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(
      page.getByRole('combobox', { name: 'Payment account', exact: true }),
    ).toHaveValue('')
    await expect(
      page.getByLabel('Automatically record future subscription payments'),
    ).not.toBeChecked()
    await expect(
      page.getByRole('button', { name: 'Confirm and record' }),
    ).toBeDisabled()
    await page
      .getByRole('combobox', { name: 'Payment account', exact: true })
      .selectOption('Bank account')
    await page
      .getByLabel('I confirm this payment and account are correct.')
      .check()
    await page.screenshot({
      path: `docs/reviews/subscription-expenses/review-${width}.png`,
      fullPage: true,
    })
    await page.getByRole('button', { name: 'Confirm and record' }).click()
    await expect(page.getByRole('status')).toContainText('Recorded in Finance')
    await page
      .getByText('Subscription payment records & automatic tracking', {
        exact: true,
      })
      .click()
    await expect(
      page.getByLabel('Automatically record subscription payments', {
        exact: true,
      }),
    ).not.toBeChecked()
    await page
      .getByLabel('Default payment account')
      .selectOption('Bank account')
    await page
      .getByLabel('Automatically record subscription payments', { exact: true })
      .check()
    await page
      .getByRole('button', { name: 'Save tracking preferences' })
      .click()
    await page.screenshot({
      path: `docs/reviews/subscription-expenses/preferences-${width}.png`,
      fullPage: true,
    })
    expect(calls.filter((c) => c.action === 'expense_record')).toHaveLength(1)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
  })
