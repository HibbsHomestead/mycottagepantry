// @vitest-environment node
import { PGlite } from '@electric-sql/pglite'
import { createHmac, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { fixtureMigrationNames } from '../../tests/database-fixture-migrations'
import type { RegistrationClient } from '../../netlify/lib/registration-core'
const runtime = vi.hoisted(() => ({
  client: null as RegistrationClient | null,
}))
vi.mock('@netlify/database', () => ({
  getDatabase: () => ({ pool: { connect: async () => runtime.client } }),
}))
import { squareBillingWebhook } from '../../netlify/lib/square-webhook'
import {
  reconcileBusiness,
  runBillingReconciliation,
} from '../../netlify/lib/billing-service'
import {
  dispatchReconciliation,
  verifyReconciliationDispatch,
} from '../../netlify/lib/square-reconcile-dispatch'
const db = new PGlite()
const client: RegistrationClient = {
  query: (sql, params) => db.query(sql, params),
  release() {},
}
const origin = 'https://sync-preview--mycottagepantry.netlify.app'
const env: Record<string, string> = {
  CONTEXT: 'deploy-preview',
  DEPLOY_URL: origin,
  REGISTRATION_PRIVATE_TESTS_ENABLED: 'true',
  SQUARE_SANDBOX_ENABLED: 'true',
  SQUARE_SANDBOX_ACCESS_TOKEN: 'fixture-token',
  SQUARE_SANDBOX_API_VERSION: '2026-01-22',
  SQUARE_SANDBOX_MERCHANT_ID: 'MERCHANT',
  SQUARE_SANDBOX_LOCATION_ID: 'LOC',
  SQUARE_SANDBOX_WEBHOOK_URL: origin + '/api/square/sandbox/webhook',
  SQUARE_SANDBOX_WEBHOOK_SIGNATURE_KEY: 'fixture-signature',
  SQUARE_BILLING_ENCRYPTION_KEY: '34'.repeat(32),
}
beforeAll(async () => {
  const root = new URL('../../netlify/database/migrations/', import.meta.url)
  for (const name of await fixtureMigrationNames(root))
    await db.exec(
      await readFile(new URL(name + '/migration.sql', root), 'utf8'),
    )
  runtime.client = client
}, 30000)
beforeEach(async () => {
  await db.exec(
    'TRUNCATE workspace_billing,billing_attempts,billing_subscriptions,billing_invoices CASCADE',
  )
  await db.query('DELETE FROM billing_events')
  await db.query('DELETE FROM billing_sync_runs')
  runtime.client = client
  vi.stubGlobal('Netlify', { env: { get: (name: string) => env[name] } })
})
afterAll(async () => {
  await db.close()
  vi.unstubAllGlobals()
})
function webhook(
  id: string,
  overrides: Record<string, unknown> = {},
  signature = true,
  url = env.SQUARE_SANDBOX_WEBHOOK_URL,
) {
  const body = JSON.stringify({
    event_id: id,
    merchant_id: 'MERCHANT',
    type: 'subscription.updated',
    data: { id: 'SUB' },
    ...overrides,
  })
  return new Request(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-square-hmacsha256-signature': signature
        ? createHmac('sha256', 'fixture-signature')
            .update(url + body)
            .digest('base64')
        : 'invalid',
    },
    body,
  })
}
it('stores signed references exactly once and rejects forged/foreign/unsupported events', async () => {
  expect(
    (await squareBillingWebhook(webhook('event1'), 'sandbox')).status,
  ).toBe(200)
  expect(
    (await squareBillingWebhook(webhook('event1'), 'sandbox')).status,
  ).toBe(200)
  expect((await db.query('SELECT * FROM billing_events')).rows).toHaveLength(1)
  expect(
    (await squareBillingWebhook(webhook('bad', {}, false), 'sandbox')).status,
  ).toBe(403)
  expect(
    (
      await squareBillingWebhook(
        webhook('bad', { merchant_id: 'OTHER' }),
        'sandbox',
      )
    ).status,
  ).toBe(403)
  expect(
    (
      await squareBillingWebhook(
        webhook('bad', { type: 'customer.created' }),
        'sandbox',
      )
    ).status,
  ).toBe(400)
  expect(
    (
      await squareBillingWebhook(
        webhook('bad', {}, true, env.SQUARE_SANDBOX_WEBHOOK_URL + '?altered=1'),
        'sandbox',
      )
    ).status,
  ).toBe(403)
  expect(
    (await squareBillingWebhook(webhook('bad'), 'production')).status,
  ).toBe(503)
})
it('isolates environments and keeps uncorrelated or delayed events from granting access', async () => {
  await squareBillingWebhook(webhook('second'), 'sandbox')
  await squareBillingWebhook(webhook('first'), 'sandbox')
  await db.query(
    "INSERT INTO billing_events(id,merchant_id,kind,object_id,environment) VALUES('production:foreign','MERCHANT','subscription.updated','SUB','production')",
  )
  const transport = vi.fn(async () =>
    Response.json({}),
  ) as unknown as typeof fetch
  await db.query('BEGIN')
  const result = await runBillingReconciliation(
    client,
    transport,
    10,
    'sandbox',
  )
  await db.query('COMMIT')
  expect(result).toMatchObject({ checked: 2, processed: 0, failures: 0 })
  const events = (
    await db.query<{ environment: string; status: string }>(
      'SELECT environment,status FROM billing_events',
    )
  ).rows
  expect(
    events
      .filter((e) => e.environment === 'sandbox')
      .every((e) => e.status === 'needs_review'),
  ).toBe(true)
  expect(events.find((e) => e.environment === 'production')?.status).toBe(
    'pending',
  )
  expect(transport).not.toHaveBeenCalled()
  expect((await db.query('SELECT * FROM workspace_billing')).rows).toHaveLength(
    0,
  )
})
it('uses savepoints so a real SQL failure retries one event and commits another', async () => {
  await squareBillingWebhook(webhook('first'), 'sandbox')
  await squareBillingWebhook(webhook('second'), 'sandbox')
  let failed = false
  const faultClient: RegistrationClient = {
    ...client,
    query: async (sql, params) => {
      if (
        !failed &&
        sql.startsWith('SELECT business_id FROM billing_subscriptions')
      ) {
        failed = true
        return db.query('SELECT * FROM intentionally_missing_fixture_table')
      }
      return client.query(sql, params)
    },
  }
  await db.query('BEGIN')
  const result = await runBillingReconciliation(
    faultClient,
    fetch,
    10,
    'sandbox',
  )
  await db.query('COMMIT')
  expect(result.failures).toBe(1)
  const rows = (
    await db.query<{ status: string; attempts: number }>(
      'SELECT status,attempts FROM billing_events ORDER BY received_at',
    )
  ).rows
  expect(rows.map((r) => r.status).sort()).toEqual(['needs_review', 'retry'])
  expect(rows.every((r) => r.attempts === 1)).toBe(true)
})
it('authenticates background dispatch and rejects altered, expired and cross-host requests', async () => {
  let request: Request | undefined
  const transport: typeof fetch = async (url, init) => {
    request = new Request(String(url), init)
    return new Response(null, { status: 202 })
  }
  expect((await dispatchReconciliation('sandbox', transport)).status).toBe(204)
  const body = await request!.clone().json()
  expect(
    verifyReconciliationDispatch(request!, 'sandbox', body.timestamp),
  ).toBe(true)
  expect(
    verifyReconciliationDispatch(request!, 'production', body.timestamp),
  ).toBe(false)
  expect(
    verifyReconciliationDispatch(
      request!,
      'sandbox',
      String(Date.now() - 300000),
    ),
  ).toBe(false)
  expect(
    verifyReconciliationDispatch(
      new Request('https://foreign.test/path', { headers: request!.headers }),
      'sandbox',
      body.timestamp,
    ),
  ).toBe(false)
})

async function checkoutFixture(plan: string, amount: number) {
  const business = randomUUID(),
    attempt = randomUUID()
  await db.query('INSERT INTO businesses(id,business_name) VALUES($1,$2)', [
    business,
    'Billing fixture',
  ])
  await db.query(
    "INSERT INTO workspace_billing(business_id,plan_id,source,status,billing_owner_identity) VALUES($1,'free','free_app','free_active','fixture-owner')",
    [business],
  )
  await db.query(
    "INSERT INTO billing_attempts(id,business_id,identity_id,plan_id,idempotency_key,environment,amount_cents,plan_variation_id,provider_order_id,provider_link_id,expires_at) VALUES($1,$2,'fixture-owner',$3,$1,'sandbox',$4,'VAR','ORDER','LINK',NOW()+INTERVAL '1 day')",
    [attempt, business, plan, amount],
  )
  return { business, attempt }
}
function billingProvider(amount: number) {
  const today = new Date().toISOString().slice(0, 10)
  const state = { paid: true, failed: false, version: 2, cancelled: false }
  const transport: typeof fetch = async (url, init) => {
    const path = new URL(String(url)).pathname
    const subscription = {
      id: 'SUB',
      customer_id: 'CUSTOMER',
      location_id: 'LOC',
      plan_variation_id: 'VAR',
      created_at: new Date().toISOString(),
      status: state.cancelled ? 'CANCELED' : 'ACTIVE',
      canceled_date: state.cancelled ? today : undefined,
      version: state.version,
      invoice_ids: ['INVOICE'],
    }
    if (path === '/v2/orders/ORDER')
      return Response.json({
        order: { id: 'ORDER', tenders: [{ payment_id: 'PAYMENT' }] },
      })
    if (path === '/v2/payments/PAYMENT')
      return Response.json({
        payment: {
          id: 'PAYMENT',
          order_id: 'ORDER',
          customer_id: 'CUSTOMER',
          status: state.failed
            ? 'FAILED'
            : state.paid
              ? 'COMPLETED'
              : 'APPROVED',
          updated_at: new Date().toISOString(),
        },
      })
    if (path === '/v2/subscriptions/search')
      return Response.json({ subscriptions: [subscription] })
    if (path === '/v2/subscriptions/SUB') return Response.json({ subscription })
    if (path === '/v2/invoices/INVOICE')
      return Response.json({
        invoice: {
          id: 'INVOICE',
          subscription_id: 'SUB',
          version: state.version,
          status: state.paid ? 'PAID' : 'FAILED',
          sale_or_service_date: today,
          payment_requests: [
            {
              computed_amount_money: { amount, currency: 'USD' },
              total_completed_amount_money: {
                amount: state.paid ? amount : 0,
                currency: 'USD',
              },
            },
          ],
        },
      })
    if (
      path === '/v2/online-checkout/payment-links/LINK' &&
      init?.method === 'DELETE'
    )
      return Response.json({})
    throw new Error('Unexpected fixture request')
  }
  return { state, transport }
}
it.each([
  ['mixing-bowl', 1000],
  ['bakers-bench', 2000],
  ['cottage-kitchen', 3000],
  ['cottage-mercantile', 4000],
] as const)(
  'links %s to the correct workspace only after a canonical settled invoice',
  async (plan, amount) => {
    const { business } = await checkoutFixture(plan, amount)
    const { state, transport } = billingProvider(amount)
    state.paid = false
    expect(await reconcileBusiness(client, business, transport)).toMatchObject({
      linked: false,
    })
    expect(
      (
        await db.query<{ plan_id: string }>(
          'SELECT plan_id FROM workspace_billing WHERE business_id=$1',
          [business],
        )
      ).rows[0].plan_id,
    ).toBe('free')
    await db.query(
      "UPDATE billing_attempts SET status='needs_review',error_code='CORRELATION_REVIEW' WHERE business_id=$1",
      [business],
    )
    state.paid = true
    expect(await reconcileBusiness(client, business, transport)).toMatchObject({
      linked: true,
      state: 'paid_active',
    })
    expect(
      (
        await db.query<{ plan_id: string; source: string }>(
          'SELECT plan_id,source FROM workspace_billing WHERE business_id=$1',
          [business],
        )
      ).rows[0],
    ).toEqual({ plan_id: plan, source: 'square_sandbox' })
    expect(
      (
        await db.query(
          'SELECT * FROM billing_subscriptions WHERE business_id=$1',
          [business],
        )
      ).rows,
    ).toHaveLength(1)
    // A stale provider version cannot revoke the verified paid period.
    state.version = 1
    state.paid = false
    expect(await reconcileBusiness(client, business, transport)).toMatchObject({
      stale: true,
    })
    expect(
      (
        await db.query<{ status: string }>(
          'SELECT status FROM workspace_billing WHERE business_id=$1',
          [business],
        )
      ).rows[0].status,
    ).toBe('paid_active')
    state.version = 3
    state.paid = true
    state.cancelled = true
    expect(await reconcileBusiness(client, business, transport)).toMatchObject({
      state: 'cancelled',
    })
    expect(
      (await db.query('SELECT * FROM businesses WHERE id=$1', [business])).rows,
    ).toHaveLength(1)
  },
)
it('invalidates the failed checkout before allowing a retry and never grants failed-payment access', async () => {
  const { business } = await checkoutFixture('mixing-bowl', 1000)
  const { state, transport } = billingProvider(1000)
  state.paid = false
  state.failed = true
  await reconcileBusiness(client, business, transport)
  expect(
    (
      await db.query<{ status: string }>(
        'SELECT status FROM billing_attempts WHERE business_id=$1',
        [business],
      )
    ).rows[0].status,
  ).toBe('failed')
  expect(
    (
      await db.query(
        'SELECT * FROM billing_subscriptions WHERE business_id=$1',
        [business],
      )
    ).rows,
  ).toHaveLength(0)
  expect(
    (
      await db.query<{ plan_id: string }>(
        'SELECT plan_id FROM workspace_billing WHERE business_id=$1',
        [business],
      )
    ).rows[0].plan_id,
  ).toBe('free')
})

it('keeps a manual override intact through signed webhook reconciliation while updating only billing state', async () => {
  const { business } = await checkoutFixture('mixing-bowl', 1000)
  await db.query('UPDATE businesses SET identity_owner=$2 WHERE id=$1', [
    business,
    'manual-fixture-owner',
  ])
  await db.query(
    "INSERT INTO complimentary_grants(business_id,owner_identity,actor_identity,plan_id,grant_source,reason) VALUES($1,'manual-fixture-owner','fixture-platform-admin','cottage-kitchen','test','Disposable billing separation test')",
    [business],
  )
  const before = (
    await db.query('SELECT * FROM complimentary_grants WHERE business_id=$1', [
      business,
    ])
  ).rows
  const { state, transport } = billingProvider(1000)
  await reconcileBusiness(client, business, transport)
  state.version++
  expect(
    (
      await squareBillingWebhook(
        webhook('manual-override-preserved'),
        'sandbox',
      )
    ).status,
  ).toBe(200)
  await db.query('BEGIN')
  await runBillingReconciliation(client, transport, 10, 'sandbox')
  await db.query('COMMIT')
  expect(
    (
      await db.query(
        'SELECT * FROM complimentary_grants WHERE business_id=$1',
        [business],
      )
    ).rows,
  ).toEqual(before)
  const { effectiveAccess, latestManualGrant } =
    await import('../../netlify/lib/manual-access')
  const billing = (
    await db.query(
      'SELECT plan_id,status,source,paid_through,environment,entitlement_policy FROM workspace_billing WHERE business_id=$1',
      [business],
    )
  ).rows[0]
  const grant = await latestManualGrant(client, business)
  expect(
    effectiveAccess(billing as never, grant, 'manual-fixture-owner'),
  ).toMatchObject({ plan: 'cottage-kitchen', source: 'test' })
  expect(
    effectiveAccess(
      billing as never,
      { ...grant!, operation: 'revoke' },
      'manual-fixture-owner',
    ).plan,
  ).toBe('mixing-bowl')
})
