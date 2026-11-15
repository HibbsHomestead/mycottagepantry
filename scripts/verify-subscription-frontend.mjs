// Run against `netlify dev --port 8889`. Browser billing and Identity responses
// are fixtures; only production's public availability endpoint is read live.
/* global fetch, structuredClone, document, innerWidth, console, URL */
import { chromium } from '@playwright/test'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'

const origin = 'http://localhost:8889'
const availability = await fetch(
  'https://mycottagepantry.com/api/stripe/billing?view=availability',
).then((r) => r.json())
const plans = [
  'free',
  'mixing-bowl',
  'bakers-bench',
  'cottage-kitchen',
  'cottage-mercantile',
]
assert(
  availability.plans.includes('cottage-mercantile'),
  'Production Mercantile purchase availability must remain enabled',
)
const base = {
  workspace: { id: 'browser-test-business', name: 'Disposable Test Kitchen' },
  hasSubscription: true,
  seatUsage: 2,
  billing: {
    provider: 'stripe_test',
    plan: 'cottage-kitchen',
    status: 'paid_active',
    paidThrough: '2027-01-01',
    lastReconciled: '2026-12-01',
  },
  subscription: {
    plan: 'cottage-kitchen',
    monthlyCents: 3000,
    currency: 'usd',
    interval: 'month',
    intervalCount: 1,
    environment: 'test',
    status: 'active',
    renewsAt: '2027-01-01',
  },
  access: { plan: 'cottage-kitchen' },
  attempts: [],
  changes: [],
  available: [],
  changePlans: plans.map((id) => ({
    id,
    purchasable: id !== 'free',
    reason: 'Available monthly subscription.',
  })),
}
const preview = {
  id: '33333333-3333-4333-8333-333333333333',
  fromPlan: 'cottage-kitchen',
  toPlan: 'cottage-mercantile',
  fromMonthlyCents: 3000,
  toMonthlyCents: 4000,
  kind: 'upgrade',
  amountDue: 437,
  total: 437,
  fromUsers: 2,
  toUsers: 6,
  seatUsage: 2,
  added: ['resaleModule', 'consignment', 'resaleMerchandise'],
  removed: [],
  expiresAt: '2027-01-01',
  timing: 'Immediately, after Stripe confirms payment of any prorated amount.',
}
let owner = false,
  state = structuredClone(base)
const actions = [],
  errors = []
await mkdir('docs/previews', { recursive: true })
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  page.on('pageerror', (error) => errors.push(error.name))
  // Use current frontend source even when a previous generated handler exists.
  // API fixtures below still run on the Netlify development origin.
  await page.route(origin + '/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.startsWith('/api/') || path.startsWith('/.netlify/'))
      return route.fallback()
    const response = await route.fetch({
      url: route.request().url().replace('localhost:8889', 'localhost:3000'),
    })
    return route.fulfill({ response })
  })
  await page.route('**/.netlify/identity/**', (route) =>
    route.fulfill({
      status: 401,
      json: { code: 401, msg: 'No test Identity session' },
    }),
  )
  await page.route('**/api/registration?view=policies', (route) =>
    route.fulfill({ json: { policy: null } }),
  )
  await page.route('**/api/account-access', (route) =>
    route.fulfill({
      json: {
        status: 'signed_out',
        traceId: route.request().headers()['x-access-trace'],
        memberships: [],
        membership: null,
        events: [],
        privateTest: false,
        reason: 'signed_out',
        environment: {},
      },
    }),
  )
  await page.route('**/api/stripe/billing**', (route) => {
    if (route.request().url().includes('view=availability'))
      return route.fulfill({ json: availability })
    if (!owner)
      return route.fulfill({
        status: 401,
        json: { code: 'SIGN_IN_REQUIRED', error: 'Log in to continue.' },
      })
    const body = route.request().postDataJSON()
    if (body) actions.push(body.action)
    if (body?.action === 'preview_change')
      return route.fulfill({ json: { preview } })
    if (body?.action === 'confirm_change')
      state.changes = [{ ...preview, status: 'pending' }]
    return route.fulfill({ json: state })
  })
  await page.goto(origin + '/pricing', { waitUntil: 'domcontentloaded' })
  await page
    .getByRole('link', { name: 'Choose Cottage Mercantile', exact: true })
    .waitFor()
  for (const [name, dollars, users] of [
    ['Free', 0, 1],
    ['Mixing Bowl', 10, 1],
    ['Baker’s Bench', 20, 1],
    ['Cottage Kitchen', 30, 2],
    ['Cottage Mercantile', 40, 6],
  ]) {
    const card = page
      .getByRole('article')
      .filter({ has: page.getByRole('heading', { name, exact: true }) })
    assert((await card.innerText()).includes('$' + dollars))
    assert((await card.innerText()).includes(`${users} total user`))
  }
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    true,
    'Pricing must not overflow the mobile viewport',
  )
  await page.screenshot({ path: 'docs/previews/plans-pricing-390.png' })
  const table = page.getByRole('region', { name: 'A closer look at each plan' })
  await table.scrollIntoViewIfNeeded()
  const firstLabel = table.locator('thead th').first()
  const before = (await firstLabel.boundingBox()).x
  await table.evaluate((el) => {
    el.scrollLeft = 450
    el.scrollTop = 300
  })
  assert(
    Math.abs((await firstLabel.boundingBox()).x - before) < 2,
    'The feature-label column stays visible during horizontal scroll',
  )
  await page.screenshot({ path: 'docs/previews/plan-comparison-390.png' })
  await page
    .getByRole('link', { name: 'Choose Cottage Mercantile', exact: true })
    .click()
  await page.getByRole('radio', { name: /Cottage Mercantile/ }).waitFor()
  assert(
    await page.getByRole('radio', { name: /Cottage Mercantile/ }).isChecked(),
    'Plan choice must carry to signup',
  )
  assert.equal(
    await page.getByText('Choose your intended plan', { exact: true }).count(),
    0,
  )
  owner = true
  await page.goto(origin + '/pricing', { waitUntil: 'domcontentloaded' })
  await page
    .getByRole('link', { name: 'Upgrade to Cottage Mercantile' })
    .waitFor()
  assert.equal(
    await page
      .getByRole('button', { name: 'Current plan', exact: true })
      .count(),
    1,
  )
  await page
    .getByRole('link', { name: 'Upgrade to Cottage Mercantile' })
    .click()
  await page.getByRole('button', { name: 'Review plan change' }).waitFor()
  assert.equal(
    await page.getByRole('button', { name: /hosted checkout/ }).count(),
    0,
  )
  await page.getByRole('button', { name: 'Review plan change' }).click()
  const dialog = page.getByRole('dialog', {
    name: 'Review subscription change',
  })
  await dialog.waitFor()
  assert((await dialog.innerText()).includes('$4.37 USD'))
  assert((await dialog.innerText()).includes('2 → 6 total users'))
  await page.screenshot({ path: 'docs/previews/subscription-review-390.png' })
  await dialog.getByRole('checkbox').check()
  await dialog
    .getByRole('button', { name: 'Confirm subscription change' })
    .click()
  await page.getByText(/The change is awaiting Stripe confirmation/).waitFor()
  assert.equal(
    await page
      .getByText('Stripe confirmed the plan change.', { exact: true })
      .count(),
    0,
  )
  assert(
    !actions.includes('checkout'),
    'Existing subscriber must never call new checkout',
  )
  state = {
    ...base,
    billing: { ...base.billing, plan: 'cottage-mercantile' },
    subscription: {
      ...base.subscription,
      plan: 'cottage-mercantile',
      monthlyCents: 4000,
    },
    access: { plan: 'cottage-mercantile' },
    changes: [{ ...preview, status: 'applied' }],
  }
  await page.getByRole('button', { name: 'Refresh verified billing' }).click()
  await page
    .getByText('$40.00 USD per business / month', { exact: true })
    .waitFor()
  await page.goto(origin + '/oven/billing?checkout=verifying', {
    waitUntil: 'domcontentloaded',
  })
  await page
    .getByText('$40.00 USD per business / month', { exact: true })
    .waitFor()
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.screenshot({ path: 'docs/previews/subscription-billing-1440.png' })
  assert.equal(errors.length, 0, 'No browser page errors')
  console.log(
    JSON.stringify({
      productionPurchasableTiers: availability.plans,
      mobilePricing: 'PASS',
      comparisonStickyLabels: 'PASS',
      signupSelection: 'PASS',
      existingSubscriberRouting: 'PASS',
      reviewedUpgrade: 'PASS (TEST response fixtures)',
      pendingPayment: 'PASS',
      portalReturnRefresh: 'PASS',
      pageErrors: 0,
      realChargesOrSubscriptionChanges: 0,
    }),
  )
} finally {
  await browser.close()
}
