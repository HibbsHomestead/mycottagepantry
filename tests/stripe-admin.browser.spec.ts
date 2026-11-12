import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { launchPricing } from '../src/lib/launch-plans'
const fixture = {
  rows: [
    {
      environment: 'test',
      fingerprint: null,
      configuration: {},
      checkout_enabled: false,
    },
  ],
  events: [],
  evidence: [],
  encryptionReady: true,
  tiers: launchPricing.plans,
  eventsRequired: [
    'checkout.session.completed',
    'invoice.paid',
    'invoice.payment_failed',
  ],
  endpoints: {
    test: 'https://mycottagepantry.com/api/stripe/test/webhook',
    live: 'https://mycottagepantry.com/api/stripe/live/webhook',
  },
}
for (const width of [390, 820, 1440]) {
  test(`Stripe admin secret clearing and setup controls at ${width}`, async ({
    page,
  }) => {
    await mkdir('docs/previews', { recursive: true })
    await page.setViewportSize({ width, height: 1000 })
    let saves = 0
    await page.route('**/api/admin*', async (route) => {
      const url = new URL(route.request().url()),
        action = url.searchParams.get('action')
      if (action === 'session')
        return route.fulfill({
          json: {
            stage: 'authenticated',
            identityId: 'disposable-admin',
            role: 'owner',
            expiresAt: '2027-01-01',
          },
        })
      if (action === 'stripe') {
        const body = route.request().postDataJSON()
        expect(body.environment).toBe('test')
        if (body.operation === 'save') {
          expect(body.key).toBe('sk_test_disposable_ui_fixture')
          expect(body.confirmation).toBe('SAVE TEST')
          saves++
        }
        return route.fulfill({
          json: {
            ...fixture,
            rows: [
              {
                ...fixture.rows[0],
                fingerprint: 'sha256:fixture',
                updated_at: '2026-11-12',
              },
            ],
          },
        })
      }
      return route.fulfill({
        json: {
          stripe: fixture,
          rows: [],
          events: [],
          connection: [],
          oauth: {},
          checks: [],
          mappings: [],
          syncRuns: [],
          webhookEvidence: [],
          total: 0,
          page: 1,
          pageSize: 25,
        },
      })
    })
    await page.goto('/admin?section=billing', { waitUntil: 'networkidle' })
    const settings = page.getByRole('region', {
      name: 'Stripe provider settings',
    })
    await expect(
      settings.getByRole('heading', { name: 'Provider settings · Stripe' }),
    ).toBeVisible()
    await settings
      .getByText('Credentials · save or rotate', { exact: true })
      .click()
    await settings
      .getByLabel('Stripe secret API key')
      .fill('sk_test_disposable_ui_fixture')
    await settings.getByLabel('Action confirmation').fill('SAVE TEST')
    await settings.getByRole('button', { name: 'Save credentials' }).click()
    await expect(settings.getByLabel('Stripe secret API key')).toHaveValue('')
    expect(saves).toBe(1)
    await expect(settings).toContainText('Not verified')
    await expect(settings).toContainText('sha256:fixture')
    await settings.getByText('Webhook setup', { exact: true }).click()
    await expect(settings.getByLabel('Stable webhook endpoint')).toHaveValue(
      fixture.endpoints.test,
    )
    await page.screenshot({
      path: `docs/previews/stripe-billing-settings-${width}.png`,
      fullPage: true,
    })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await settings
      .getByRole('combobox', { name: 'Environment', exact: true })
      .selectOption('live')
    await expect(settings.getByLabel('Stripe secret API key')).toHaveValue('')
    await expect(settings.getByLabel('Stable webhook endpoint')).toHaveValue(
      fixture.endpoints.live,
    )
  })
}
test('business owner launches only a server-authorized portal destination', async ({
  page,
}) => {
  const owner = {
    workspace: { id: 'disposable', name: 'Disposable subscription test' },
    billing: {
      plan: 'cottage-kitchen',
      provider: 'stripe_test',
      status: 'paid_active',
      paidThrough: '2026-12-01',
    },
    access: { plan: 'cottage-kitchen', source: 'stripe_test' },
    attempts: [],
    available: [],
  }
  await page.route('**/api/registration*', (route) =>
    route.fulfill({
      json: {
        workspace: { id: 'disposable', name: 'Disposable subscription test' },
        billing: {
          plan_id: 'cottage-kitchen',
          source: 'stripe_test',
          status: 'paid_active',
          environment: 'test',
          paid_through: '2026-12-01',
          hasSubscription: true,
        },
        accessSource: 'stripe_test',
        currentAccess: { planId: 'cottage-kitchen', kind: 'verified_paid' },
        attempts: [],
        invoices: [],
        purchasablePlans: [],
        checkoutEnabled: false,
        policies: { status: 'missing', items: [] },
      },
    }),
  )
  let portal = 0
  await page.route('**/api/stripe/billing', (route) => {
    if (route.request().method() === 'POST') {
      expect(route.request().postDataJSON()).toEqual({ action: 'portal' })
      portal++
      return route.fulfill({
        json: {
          url: 'https://billing.stripe.com/p/session/disposable-fixture',
        },
      })
    }
    return route.fulfill({ json: owner })
  })
  await page.route('https://billing.stripe.com/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: 'Disposable portal destination fixture',
    }),
  )
  await page.goto('/oven/billing', { waitUntil: 'networkidle' })
  await expect(
    page.getByRole('region', { name: 'Stripe subscription billing' }),
  ).toContainText('Disposable subscription test')
  await page.screenshot({
    path: 'docs/previews/stripe-owner-billing.png',
    fullPage: true,
  })
  await page.getByRole('button', { name: 'Manage billing with Stripe' }).click()
  await expect(page).toHaveURL(
    'https://billing.stripe.com/p/session/disposable-fixture',
  )
  expect(portal).toBe(1)
})

test('paid preference resumes through existing verified business setup without granting paid access', async ({
  page,
}) => {
  const { accessFixture } = await import('./account-access-fixture')
  await page.setViewportSize({ width: 390, height: 950 })
  await page.route('**/api/account-access', (route) =>
    route.fulfill({ json: accessFixture('no_workspace') }),
  )
  await page.route('**/api/signup-plan', (route) =>
    route.fulfill({
      json: {
        selection: {
          planId: 'cottage-kitchen',
          name: 'Cottage Kitchen',
          monthlyUsd: 30,
          currency: 'USD',
          interval: 'month',
          paidActivationAvailable: false,
        },
      },
    }),
  )
  let created = 0
  await page.route('**/api/registration*', (route) => {
    const url = new URL(route.request().url())
    if (url.searchParams.get('view') === 'policies')
      return route.fulfill({ json: { policy: null } })
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON()
      expect(body.action).toBe('createFreeWorkspace')
      expect(body.profile.name).toBe('Disposable subscription onboarding')
      created++
      return route.fulfill({
        json: { workspaceId: 'disposable', existing: false },
      })
    }
    return route.fulfill({
      json: {
        workspace: {
          id: 'disposable',
          name: 'Disposable subscription onboarding',
        },
        billing: null,
        attempts: [],
        invoices: [],
        purchasablePlans: [],
        checkoutEnabled: false,
        policies: { status: 'missing', items: [] },
      },
    })
  })
  await page.route('**/api/stripe/billing*', (route) =>
    route.fulfill({
      json: new URL(route.request().url()).searchParams.has('view')
        ? { plans: [] }
        : {
            workspace: {
              id: 'disposable',
              name: 'Disposable subscription onboarding',
            },
            billing: null,
            access: { source: 'unassigned', plan: null },
            attempts: [],
            available: [],
          },
    }),
  )
  await page.goto('/onboarding?plan=cottage-kitchen', {
    waitUntil: 'networkidle',
  })
  await expect(
    page.getByRole('heading', { name: 'Create your business' }),
  ).toBeVisible()
  await page
    .getByLabel('Business/display name')
    .fill('Disposable subscription onboarding')
  await page.screenshot({
    path: 'docs/previews/stripe-onboarding-390.png',
    fullPage: true,
  })
  await page
    .getByRole('button', { name: 'Create your business', exact: true })
    .click()
  await expect(page).toHaveURL(/\/oven\/billing/)
  await expect(
    page.getByRole('region', { name: 'Stripe subscription billing' }),
  ).toContainText('Unassigned')
  expect(created).toBe(1)
})

test('existing member role changes require a reason and explicit confirmation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 950 })
  const id = '10000000-0000-4000-8000-000000000001'
  const data = {
    oven: {
      id,
      business_name: 'Disposable membership test',
      identity_owner: 'primary',
    },
    memberships: [
      {
        id: 'member-fixture',
        identity_id: 'disposable-member',
        role: 'Production Staff',
        active: true,
      },
    ],
    effective: { source: 'unassigned', plan: null, legacy: true },
    manualHistory: [],
    accessAudit: [],
    activity: [],
    manualGrant: null,
    billing: null,
    tierCatalog: launchPricing.plans,
  }
  let changed = false
  await page.route('**/api/admin*', (route) => {
    const action = new URL(route.request().url()).searchParams.get('action')
    if (action === 'session')
      return route.fulfill({
        json: {
          stage: 'authenticated',
          identityId: 'disposable-admin',
          role: 'owner',
        },
      })
    if (action === 'membership') {
      const body = route.request().postDataJSON()
      expect(body).toMatchObject({
        businessId: id,
        memberId: 'member-fixture',
        role: 'Manager',
        active: true,
        confirm: true,
        reason: 'Disposable role acceptance',
      })
      changed = true
      return route.fulfill({ json: { applied: true } })
    }
    return route.fulfill({ json: data })
  })
  await page.goto('/admin?section=customers&id=' + id, {
    waitUntil: 'networkidle',
  })
  await page.getByRole('tab', { name: 'Members', exact: true }).click()
  await page
    .getByRole('combobox', { name: 'Member', exact: true })
    .selectOption('member-fixture')
  await page
    .getByRole('combobox', { name: 'Role', exact: true })
    .selectOption('Manager')
  await expect(
    page.getByRole('button', { name: 'Apply membership change' }),
  ).toBeDisabled()
  await page
    .getByLabel('Reason', { exact: true })
    .fill('Disposable role acceptance')
  await page
    .getByRole('checkbox', { name: /Confirm this member receives/ })
    .check()
  await page.screenshot({
    path: 'docs/previews/stripe-admin-members.png',
    fullPage: true,
  })
  await page.getByRole('button', { name: 'Apply membership change' }).click()
  await expect(page.getByRole('status')).toContainText(
    'Membership updated and audited',
  )
  expect(changed).toBe(true)
})
