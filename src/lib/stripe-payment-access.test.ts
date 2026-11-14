// @vitest-environment node
import { PGlite } from '@electric-sql/pglite'
import { randomBytes, randomUUID, createHmac } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import {
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  expect,
  it,
  vi,
} from 'vitest'
import { fixtureMigrationNames } from '../../tests/database-fixture-migrations'
import type { AdminMetadata } from './platform-admin-types'

const runtime = vi.hoisted(() => ({
  client: null as unknown as {
    query: (
      sql: string,
      values?: unknown[],
    ) => Promise<{ rows: AdminMetadata[] }>
    release: () => void
  },
  identity: 'payment-test-owner',
  workspace: undefined as string | undefined,
}))
vi.mock('@netlify/database', () => ({
  getDatabase: () => ({ pool: { connect: async () => runtime.client } }),
}))
vi.mock('../../netlify/lib/verified-session', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../netlify/lib/verified-session')
  >()),
  verifiedSession: async () => ({
    id: runtime.identity,
    email: 'billing@example.invalid',
    confirmedAt: '2026-01-01T00:00:00Z',
    roles: [],
  }),
}))

import billing from '../../netlify/functions/stripe-billing.mts'
import webhook from '../../netlify/functions/stripe-webhook.mts'
import {
  sealStripe,
  openStripe,
  stripeAdminAction,
  stripeEventsRequired,
} from '../../netlify/lib/stripe-provider'
import { adminTransaction } from '../../netlify/lib/platform-admin-core'
import { effectiveAccess } from '../../netlify/lib/manual-access'
import {
  enforceProviderBilledWrite,
  type BillingPolicyRow,
} from '../../netlify/lib/billing-entitlements'

const db = new PGlite()
const root = randomBytes(32).toString('hex')
const signing = 'whsec_' + randomBytes(32).toString('hex')
const tiers = [
  ['mixing-bowl', 1000, 1],
  ['bakers-bench', 2000, 1],
  ['cottage-kitchen', 3000, 2],
  ['cottage-mercantile', 4000, 6],
] as const
let business: string, other: string
let attempt: string, plan: string, cents: number
let complete: boolean, paid: boolean, wrongCustomer: boolean
let providerStatus: string
let through: number
let transport: ReturnType<typeof vi.fn>

beforeAll(async () => {
  const migrations = new URL(
    '../../netlify/database/migrations/',
    import.meta.url,
  )
  for (const name of await fixtureMigrationNames(migrations))
    await db.exec(
      await readFile(new URL(`${name}/migration.sql`, migrations), 'utf8'),
    )
  runtime.client = {
    query: (sql, values) => db.query<AdminMetadata>(sql, values),
    release() {},
  }
}, 30000)
afterAll(() => db.close())
afterEach(() => vi.unstubAllGlobals())

beforeEach(async () => {
  runtime.identity = 'payment-test-owner'
  runtime.workspace = undefined
  business = randomUUID()
  other = randomUUID()
  attempt = ''
  plan = 'cottage-kitchen'
  cents = 3000
  complete = false
  paid = false
  wrongCustomer = false
  providerStatus = 'active'
  through = Math.floor(Date.now() / 1000) + 86400
  vi.stubGlobal('Netlify', {
    env: {
      get: (name: string) =>
        name === 'STRIPE_BILLING_ENCRYPTION_KEY'
          ? root
          : name === 'CONTEXT'
            ? 'production'
            : '',
    },
  })
  await db.exec(
    'TRUNCATE businesses CASCADE; TRUNCATE stripe_provider_settings, stripe_events, registration_limits',
  )
  for (const [id, identity] of [
    [business, runtime.identity],
    [other, 'other-owner'],
  ]) {
    await db.query(
      'INSERT INTO businesses(id,business_name,identity_owner) VALUES($1,$2,$3)',
      [id, 'Isolated billing fixture', identity],
    )
    await db.query(
      "INSERT INTO users(id,business_id,identity_id,role,data) VALUES($1,$2,$3,'Owner','{}')",
      [randomUUID(), id, identity],
    )
    // An older account may already carry the legacy policy when it subscribes.
    await db.query(
      "INSERT INTO workspace_billing(business_id,plan_id,source,status,entitlement_policy) VALUES($1,'free','free_app','free_active','legacy')",
      [id],
    )
  }
  await db.query(
    `INSERT INTO stripe_provider_settings(environment,ciphertext,account_id,validated_at,webhook_verified_at,checkout_enabled,configuration)
    VALUES('test',$1,'acct_fixture',NOW(),NOW(),true,$2)`,
    [
      sealStripe({ key: 'sk_test_synthetic', signing }, 'test'),
      {
        policy: { portal: 'bpc_fixture' },
        mappings: Object.fromEntries(
          tiers.map(([id]) => [
            id,
            {
              price: 'price_' + id.replaceAll('-', ''),
              purchase: true,
              account: 'acct_fixture',
              verifiedAt: new Date().toISOString(),
            },
          ]),
        ),
      },
    ],
  )
  // A disposable TEST grant permits checkout; revoke it before testing billing access.
  await db.query(
    `INSERT INTO complimentary_grants(business_id,owner_identity,actor_identity,plan_id,reason,grant_source,created_at)
    VALUES($1,$2,'fixture-admin','cottage-mercantile','Isolated test only','test',NOW()-interval '1 minute')`,
    [business, runtime.identity],
  )
  transport = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.endsWith('/checkout/sessions') && options?.method === 'POST') {
      const body = options.body as URLSearchParams
      attempt = body.get('client_reference_id')!
      expect(body.get('metadata[attempt_id]')).toBe(attempt)
      expect(body.get('subscription_data[metadata][attempt_id]')).toBe(attempt)
      expect(body.get('line_items[0][quantity]')).toBe('1')
      expect(body.get('success_url')).toContain('checkout=verifying')
      return Response.json({
        id: 'cs_fixture',
        url: 'https://checkout.stripe.com/c/pay/fixture',
        expires_at: through,
        livemode: false,
        mode: 'subscription',
      })
    }
    const session = {
      id: 'cs_fixture',
      mode: 'subscription',
      livemode: false,
      status: complete ? 'complete' : 'open',
      customer: 'cus_fixture',
      subscription: complete ? 'sub_fixture' : null,
      client_reference_id: attempt,
      metadata: { attempt_id: attempt },
      url: 'https://checkout.stripe.com/c/pay/fixture',
    }
    if (url.endsWith('/checkout/sessions/cs_fixture'))
      return Response.json(session)
    if (url.includes('/checkout/sessions?subscription='))
      return Response.json({ data: [session] })
    if (url.includes('/prices/'))
      return Response.json({
        id: 'price_' + plan.replaceAll('-', ''),
        livemode: false,
        active: true,
        type: 'recurring',
        currency: 'usd',
        unit_amount: cents,
        billing_scheme: 'per_unit',
        recurring: {
          interval: 'month',
          interval_count: 1,
          usage_type: 'licensed',
        },
        product: { active: true, metadata: { cottage_pantry_tier: plan } },
      })
    if (url.endsWith('/subscriptions/sub_fixture'))
      return Response.json({
        id: 'sub_fixture',
        livemode: false,
        status: providerStatus,
        customer: wrongCustomer ? 'cus_other_business' : 'cus_fixture',
        metadata: { attempt_id: attempt },
        items: {
          data: [
            {
              price: { id: 'price_' + plan.replaceAll('-', '') },
              quantity: 1,
              current_period_end: through,
            },
          ],
        },
      })
    if (url.includes('/invoices?'))
      return Response.json({
        data: [
          {
            id: 'in_fixture',
            status: paid ? 'paid' : 'open',
            currency: 'usd',
            amount_paid: paid ? cents : 0,
            customer: 'cus_fixture',
          },
        ],
      })
    if (url.endsWith('/invoices/in_fixture/lines?limit=100'))
      return Response.json({
        has_more: false,
        data: [
          {
            amount: cents,
            pricing: {
              price_details: { price: 'price_' + plan.replaceAll('-', '') },
            },
            period: { start: through - 172800, end: through },
          },
        ],
      })
    if (url.includes('/events/'))
      return Response.json({
        livemode: false,
        type: 'invoice.paid',
        data: { object: { subscription: 'sub_fixture' } },
      })
    if (url.endsWith('/billing_portal/configurations/bpc_fixture'))
      return Response.json({
        active: true,
        livemode: false,
        features: {
          payment_method_update: { enabled: true },
          invoice_history: { enabled: true },
          subscription_update: { enabled: false },
          subscription_cancel: { enabled: false },
        },
      })
    if (url.endsWith('/billing_portal/sessions')) {
      expect((options?.body as URLSearchParams).get('customer')).toBe(
        'cus_fixture',
      )
      return Response.json({
        url: 'https://billing.stripe.com/p/session/fixture',
      })
    }
    throw new Error('Unexpected synthetic Stripe request')
  })
  vi.stubGlobal('fetch', transport)
})

function ownerRequest(body?: Record<string, unknown>) {
  const request = new Request(
    'https://mycottagepantry.com/api/stripe/billing',
    body
      ? {
          method: 'POST',
          headers: {
            origin: 'https://mycottagepantry.com',
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
        }
      : undefined,
  )
  if (runtime.workspace)
    request.headers.set('cookie', `cp_selected_workspace=${runtime.workspace}`)
  return billing(request)
}
const start = () =>
  ownerRequest({
    action: 'checkout',
    environment: 'test',
    plan,
    confirmed: true,
  })
async function deliver(id = 'evt_fixture', livemode = false) {
  const body = JSON.stringify({
    id,
    type: 'invoice.paid',
    livemode,
    data: { object: { id: 'in_fixture' } },
  })
  const timestamp = Math.floor(Date.now() / 1000)
  const signature = createHmac('sha256', signing)
    .update(timestamp + '.' + body)
    .digest('hex')
  return webhook(
    new Request('https://mycottagepantry.com/api/stripe/test/webhook', {
      method: 'POST',
      headers: { 'stripe-signature': `t=${timestamp},v1=${signature}` },
      body,
    }),
  )
}
async function savedAccess(now?: number) {
  const row = (
    await db.query<AdminMetadata & BillingPolicyRow>(
      'SELECT * FROM workspace_billing WHERE business_id=$1',
      [business],
    )
  ).rows[0]
  return { row, resolved: effectiveAccess(row, null, runtime.identity, now) }
}

it.each(tiers)(
  'links a %s payment only to its owner business and enforces %i-cent pricing with %i seats',
  async (id, amount, seats) => {
    plan = id
    cents = amount
    const checkout = await start()
    expect(checkout.status, JSON.stringify(await checkout.clone().json())).toBe(
      200,
    )
    expect(await checkout.json()).toEqual({
      url: 'https://checkout.stripe.com/c/pay/fixture',
    })
    const started = await start()
    expect(started.status, JSON.stringify(await started.clone().json())).toBe(
      200,
    )
    expect(
      transport.mock.calls.filter(
        ([url, options]) =>
          url.endsWith('/checkout/sessions') && options?.method === 'POST',
      ),
    ).toHaveLength(1)
    await db.query(
      `INSERT INTO complimentary_grants(business_id,owner_identity,actor_identity,plan_id,reason,grant_source,operation)
    VALUES($1,'payment-test-owner','fixture-admin','cottage-mercantile','Use billing access for isolated verification','test','revoke')`,
      [business],
    )
    // Returning to the app before verified invoice evidence cannot activate a plan.
    expect((await ownerRequest({ action: 'refresh' })).status).toBe(200)
    expect((await savedAccess()).resolved.plan).toBe('free')
    complete = true
    paid = true
    expect((await deliver()).status).toBe(200)
    const { row, resolved } = await savedAccess()
    expect(row).toMatchObject({
      plan_id: id,
      source: 'stripe_test',
      billing_owner_identity: runtime.identity,
      customer_id: 'cus_fixture',
      subscription_id: 'sub_fixture',
      entitlement_policy: 'kitchen-two-v1',
    })
    expect(resolved.plan).toBe(id)
    expect(
      (
        await db.query<AdminMetadata>(
          'SELECT * FROM workspace_billing WHERE business_id=$1',
          [other],
        )
      ).rows[0],
    ).toMatchObject({ plan_id: 'free', subscription_id: null })
    const calls = transport.mock.calls.length
    expect((await deliver()).status).toBe(200)
    expect(transport.mock.calls).toHaveLength(calls)
    expect(
      (await db.query('SELECT * FROM stripe_checkouts')).rows,
    ).toHaveLength(1)
    for (let member = 1; member < seats; member++)
      await db.query(
        "INSERT INTO users(id,business_id,identity_id,role,data) VALUES($1,$2,$1,'Manager','{}')",
        [randomUUID(), business],
      )
    await expect(
      db.query(
        "INSERT INTO users(id,business_id,identity_id,role,data) VALUES($1,$2,$1,'Manager','{}')",
        [randomUUID(), business],
      ),
    ).rejects.toThrow(/total business users/)
    const resale = enforceProviderBilledWrite({
      client: runtime.client,
      org: business,
      row,
      method: 'POST',
      url: new URL('https://mycottagepantry.com/api/workspace'),
      body: {
        action: 'save',
        table: 'products',
        data: { name: 'Mug', workflow: 'resale' },
      },
    })
    if (id === 'cottage-mercantile') await expect(resale).resolves.toBeTruthy()
    else await expect(resale).rejects.toThrow(/not included/)
    expect((await ownerRequest({ action: 'portal' })).status).toBe(200)
    expect((await ownerRequest({ action: 'refresh' })).status).toBe(200)
    const evidence = (
      await db.query<AdminMetadata>('SELECT * FROM stripe_checkouts')
    ).rows[0]
    expect(evidence.access_verified_at).toBeTruthy()
    expect(evidence.portal_launched_at).toBeTruthy()
    expect(evidence.reconciled_at.getTime()).toBeGreaterThanOrEqual(
      evidence.portal_launched_at.getTime(),
    )
    // Failed renewal retains paid coverage, then loses paid scope without extra grace.
    paid = false
    providerStatus = 'past_due'
    expect((await deliver('evt_failedrenewal')).status).toBe(200)
    expect((await savedAccess()).resolved.plan).toBe(id)
    expect((await savedAccess(through * 1000)).resolved.plan).toBe('free')
  },
)

async function shareOwnerMembership() {
  await db.query('UPDATE users SET identity_id=$1 WHERE business_id=$2', [
    runtime.identity,
    other,
  ])
}

it('keeps billing separate when one account has Owner memberships in two businesses', async () => {
  await shareOwnerMembership()
  runtime.workspace = business
  expect((await start()).status).toBe(200)
  await db.query(
    `INSERT INTO complimentary_grants(business_id,owner_identity,actor_identity,plan_id,reason,grant_source,operation)
    VALUES($1,'payment-test-owner','fixture-admin','cottage-mercantile','Verify selected business billing access','test','revoke')`,
    [business],
  )
  // Asynchronous payment delivery follows its trusted checkout, even after switching ovens.
  runtime.workspace = other
  complete = true
  paid = true
  expect((await deliver()).status).toBe(200)
  expect((await savedAccess()).resolved.plan).toBe(plan)
  const otherView = await ownerRequest()
  expect(otherView.status).toBe(200)
  expect(await otherView.json()).toMatchObject({
    workspace: { id: other },
    billing: { plan: 'free' },
    access: { plan: 'free' },
    attempts: [],
    historicalInvoices: [],
  })
  const calls = transport.mock.calls.length
  const wrongPortal = await ownerRequest({ action: 'portal' })
  expect(wrongPortal.status).toBe(409)
  expect(await wrongPortal.json()).toMatchObject({ code: 'NO_STRIPE_BILLING' })
  expect(transport.mock.calls).toHaveLength(calls)
  runtime.workspace = business
  const paidView = await ownerRequest()
  expect(paidView.status).toBe(200)
  const view = await paidView.json()
  expect(view).toMatchObject({
    workspace: { id: business },
    billing: { plan },
    access: { plan },
  })
  expect(view.attempts).toHaveLength(1)
  expect(view.attempts[0].subscription_id).toBe('sub_fixture')
  expect((await ownerRequest({ action: 'portal' })).status).toBe(200)
  expect(
    (
      await db.query<AdminMetadata>(
        'SELECT * FROM workspace_billing WHERE business_id=$1',
        [other],
      )
    ).rows[0],
  ).toMatchObject({
    plan_id: 'free',
    subscription_id: null,
    customer_id: null,
  })
})

it.each(['missing', 'unrelated'])(
  'requires a valid business selection when a shared owner selection is %s',
  async (selection) => {
    await shareOwnerMembership()
    runtime.workspace = selection === 'unrelated' ? randomUUID() : undefined
    for (const response of [
      await ownerRequest(),
      await start(),
      await ownerRequest({ action: 'portal' }),
    ]) {
      expect(response.status).toBe(409)
      expect(await response.json()).toMatchObject({
        code: 'WORKSPACE_SELECTION_REQUIRED',
      })
    }
    expect(transport).not.toHaveBeenCalled()
    expect(
      (await db.query('SELECT * FROM stripe_checkouts')).rows,
    ).toHaveLength(0)
  },
)

it('denies another member, forged business selection, LIVE checkout and a LIVE event at the TEST endpoint', async () => {
  expect(
    (
      await ownerRequest({
        action: 'checkout',
        environment: 'test',
        plan,
        confirmed: true,
        businessId: other,
      })
    ).status,
  ).toBe(400)
  await db.query("UPDATE users SET role='Manager' WHERE business_id=$1", [
    business,
  ])
  expect((await start()).status).toBe(403)
  await db.query("UPDATE users SET role='Owner' WHERE business_id=$1", [
    business,
  ])
  expect(
    (
      await ownerRequest({
        action: 'checkout',
        environment: 'live',
        plan,
        confirmed: true,
      })
    ).status,
  ).toBe(409)
  expect((await deliver('evt_wrongmode', true)).status).toBe(400)
  expect(transport).not.toHaveBeenCalled()
  expect((await db.query('SELECT * FROM stripe_events')).rows).toHaveLength(0)
})

it.each([false, true])(
  'does not grant paid access with wrong customer=%s or an unpaid invoice',
  async (mismatch) => {
    const started = await start()
    expect(started.status, JSON.stringify(await started.clone().json())).toBe(
      200,
    )
    await db.query(
      `INSERT INTO complimentary_grants(business_id,owner_identity,actor_identity,plan_id,reason,grant_source,operation)
    VALUES($1,'payment-test-owner','fixture-admin','cottage-mercantile','Use billing access for isolated verification','test','revoke')`,
      [business],
    )
    complete = true
    wrongCustomer = mismatch
    paid = mismatch
    expect((await deliver()).status).toBe(mismatch ? 503 : 200)
    expect((await savedAccess()).resolved.plan).toBe('free')
    if (mismatch)
      expect(
        (await db.query<AdminMetadata>('SELECT * FROM stripe_events')).rows[0],
      ).toMatchObject({
        status: 'failed',
        error_code: 'RECONCILIATION_REQUIRED',
      })
  },
)

it('preserves an existing subscription policy during subsequent reconciliation', async () => {
  expect((await start()).status).toBe(200)
  complete = true
  paid = true
  expect((await deliver()).status).toBe(200)
  await db.query(
    "UPDATE workspace_billing SET entitlement_policy='legacy' WHERE business_id=$1",
    [business],
  )
  expect((await deliver('evt_historicalpolicy')).status).toBe(200)
  expect((await savedAccess()).row.entitlement_policy).toBe('legacy')
})

const setupRequest = () =>
  new Request('https://admin.mycottagepantry.com/api/admin?action=stripe', {
    method: 'POST',
    body: JSON.stringify({ environment: 'test', operation: 'setup' }),
  })

it.each([false, true])(
  'sets up an unvalidated saved TEST connection with manual signing=%s and never enables checkout',
  async (manualSigning) => {
    const key = 'sk_test_synthetic'
    await db.query(
      `UPDATE stripe_provider_settings SET ciphertext=$1,validated_at=NULL,webhook_verified_at=NULL,
    checkout_enabled=false,configuration='{}' WHERE environment='test'`,
      [sealStripe({ key, signing: manualSigning ? signing : '' }, 'test')],
    )
    const portal = {
      id: 'bpc_fixture',
      active: true,
      livemode: false,
      features: {
        payment_method_update: { enabled: true },
        invoice_history: { enabled: true },
        subscription_update: { enabled: false },
        subscription_cancel: { enabled: false },
      },
    }
    const destination = {
      id: 'we_fixture',
      url: 'https://mycottagepantry.com/api/stripe/test/webhook',
      livemode: false,
      status: 'enabled',
      enabled_events: [...stripeEventsRequired, 'product.updated'],
    }
    const resources = vi.fn(async (url: string, options?: RequestInit) => {
      const path = new URL(url).pathname.replace('/v1', '')
      if (path === '/account') return Response.json({ id: 'acct_fixture' })
      if (url.includes('/webhook_endpoints?'))
        return Response.json({ data: [destination] })
      if (path === '/webhook_endpoints' && options?.method === 'POST')
        return Response.json({ ...destination, secret: signing })
      if (
        path === '/billing_portal/configurations' &&
        options?.method === 'POST'
      )
        return Response.json(portal)
      const selected = tiers.find(
        ([id]) =>
          url.includes(id.replaceAll('-', '_')) ||
          url.includes('price_' + id.replaceAll('-', '')),
      )
      if (path === '/prices' && selected)
        return Response.json({
          data: [{ id: 'price_' + selected[0].replaceAll('-', '') }],
        })
      if (path.startsWith('/prices/') && selected)
        return Response.json({
          active: true,
          livemode: false,
          type: 'recurring',
          billing_scheme: 'per_unit',
          currency: 'usd',
          unit_amount: selected[1],
          recurring: {
            interval: 'month',
            interval_count: 1,
            usage_type: 'licensed',
          },
          product: {
            id: 'prod_fixture',
            active: true,
            metadata: { cottage_pantry_tier: selected[0] },
          },
        })
      if (path === '/products/prod_fixture') return Response.json({})
      if (options?.method === 'GET') return Response.json({ data: [] })
      throw new Error('Unexpected setup request')
    })
    vi.stubGlobal('fetch', resources)
    await adminTransaction((c) =>
      stripeAdminAction(
        c,
        setupRequest(),
        {
          role: 'owner',
          identity_id: 'fixture-admin',
          mfa_at: new Date().toISOString(),
        },
        randomUUID(),
      ),
    )
    const row = (
      await db.query<AdminMetadata>(
        "SELECT * FROM stripe_provider_settings WHERE environment='test'",
      )
    ).rows[0]
    expect(row.validated_at).toBeTruthy()
    expect(row.checkout_enabled).toBe(false)
    expect(row.webhook_verified_at).toBeNull()
    expect(row.configuration.hostedSetupComplete).toBe(true)
    expect(row.configuration.webhookEndpoint).toBe('we_fixture')
    expect(Object.keys(row.configuration.mappings)).toHaveLength(4)
    expect(openStripe(row.ciphertext, 'test')).toEqual({ key, signing })
    expect(
      (
        await db.query(
          "SELECT * FROM stripe_provider_settings WHERE environment='live'",
        )
      ).rows,
    ).toHaveLength(0)
    expect(
      resources.mock.calls.some(
        ([url, options]) =>
          url.endsWith('/webhook_endpoints') && options?.method === 'POST',
      ),
    ).toBe(!manualSigning)
  },
)

it('keeps administrator reverification required for TEST setup', async () => {
  await expect(
    adminTransaction((c) =>
      stripeAdminAction(
        c,
        setupRequest(),
        {
          role: 'owner',
          mfa_at: new Date(Date.now() - 11 * 60000).toISOString(),
        },
        randomUUID(),
      ),
    ),
  ).rejects.toMatchObject({ code: 'RECENT_AUTH_REQUIRED' })
  expect(transport).not.toHaveBeenCalled()
})
