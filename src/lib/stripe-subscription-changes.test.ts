// @vitest-environment node
import { PGlite } from '@electric-sql/pglite'
import { randomBytes, randomUUID } from 'node:crypto'
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
  client:
    null as unknown as import('../../netlify/lib/registration-core').RegistrationClient,
  identity: 'change-owner',
}))
vi.mock('@netlify/database', () => ({
  getDatabase: () => ({ pool: { connect: async () => runtime.client } }),
}))
vi.mock('../../netlify/lib/verified-session', async (original) => ({
  ...(await original<typeof import('../../netlify/lib/verified-session')>()),
  verifiedSession: async () => ({
    id: runtime.identity,
    email: 'changes@example.invalid',
    confirmedAt: '2026-01-01',
    roles: [],
  }),
}))
import handler from '../../netlify/functions/stripe-billing.mts'
import { sealStripe } from '../../netlify/lib/stripe-provider'
import { processStripeEvent } from '../../netlify/lib/stripe-subscriptions'
import { providerBilledAccess } from '../../netlify/lib/billing-entitlements'
import { planWriteAllowed } from '../../netlify/lib/billing-state'

const db = new PGlite(),
  root = randomBytes(32).toString('hex')
const origin = 'https://mycottagepantry.com'
const prices: Record<string, number> = {
  'mixing-bowl': 1000,
  'bakers-bench': 2000,
  'cottage-kitchen': 3000,
  'cottage-mercantile': 4000,
}
const priceId = (plan: string) => 'price_' + plan.replaceAll('-', '')
let business: string,
  other: string,
  attempt: string,
  now: number,
  periodEnd: number
let sub: AdminMetadata,
  schedule: AdminMetadata | null,
  invoices: AdminMetadata[],
  changeDue: number,
  deferPayment: boolean
let loseResponse: string | null, scheduleCreations: number
let writes: {
    path: string
    body: URLSearchParams
    idempotency: string | null
  }[],
  connectionBefore: unknown
const price = (plan: string) => ({
  id: priceId(plan),
  active: true,
  livemode: false,
  type: 'recurring',
  unit_amount: prices[plan],
  currency: 'usd',
  billing_scheme: 'per_unit',
  recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' },
  product: { active: true, metadata: { cottage_pantry_tier: plan } },
})
const invoice = (
  id: string,
  plan: string,
  paid: boolean,
  cents = prices[plan],
  start = now - 100,
  end = periodEnd,
) => ({
  id,
  status: paid ? 'paid' : 'open',
  currency: 'usd',
  amount_paid: paid ? cents : 0,
  customer: 'cus_changes',
  subscription: 'sub_changes',
  created: now,
  billing_reason:
    id === 'in_upgrade' ? 'subscription_update' : 'subscription_cycle',
  lines: [
    {
      amount: cents,
      pricing: { price_details: { price: priceId(plan) } },
      period: { start, end },
    },
  ],
})
const call = (body?: unknown, requestOrigin = origin) =>
  handler(
    new Request(origin + '/api/stripe/billing', {
      method: body ? 'POST' : 'GET',
      headers: { Origin: requestOrigin, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
  )
async function ok(body?: unknown) {
  const r = await call(body)
  const result = await r.json()
  expect(r.status, result.error).toBe(200)
  return result
}
async function preview(plan = 'cottage-mercantile') {
  return (await ok({ action: 'preview_change', plan })).preview
}
async function confirm(id: string) {
  return ok({ action: 'confirm_change', changeId: id, confirmed: true })
}

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
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
beforeEach(async () => {
  runtime.identity = 'change-owner'
  business = randomUUID()
  other = randomUUID()
  attempt = randomUUID()
  now = Math.floor(Date.now() / 1000)
  periodEnd = now + 86400
  schedule = null
  changeDue = 437
  deferPayment = false
  loseResponse = null
  scheduleCreations = 0
  writes = []
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
      [id, 'Disposable billing business', identity],
    )
    await db.query(
      "INSERT INTO users(id,business_id,identity_id,role,data) VALUES($1,$2,$3,'Owner','{}')",
      [randomUUID(), id, identity],
    )
  }
  const config = {
    liveCheckoutApprovedAt: '2026-11-15',
    policy: { portal: 'bpc_existing', changes: 'disabled' },
    mappings: Object.fromEntries(
      Object.keys(prices).map((plan) => [
        plan,
        {
          price: priceId(plan),
          verifiedAt: '2026-11-15',
          account: 'acct_changes',
          purchase: true,
        },
      ]),
    ),
  }
  for (const environment of ['test', 'live'])
    await db.query(
      'INSERT INTO stripe_provider_settings(environment,ciphertext,account_id,validated_at,webhook_verified_at,checkout_enabled,configuration) VALUES($1,$2,$3,now(),now(),true,$4)',
      [
        environment,
        sealStripe({ key: 'sk_test_synthetic', signing: '' }, environment),
        'acct_changes',
        config,
      ],
    )
  connectionBefore = (
    await db.query(
      'SELECT environment,checkout_enabled,configuration,ciphertext FROM stripe_provider_settings ORDER BY environment',
    )
  ).rows
  await db.query(
    "INSERT INTO stripe_checkouts(id,business_id,identity_id,environment,plan_id,price_id,session_id,customer_id,subscription_id,status) VALUES($1,$2,$3,'test','cottage-kitchen',$4,'cs_changes','cus_changes','sub_changes','complete')",
    [attempt, business, runtime.identity, priceId('cottage-kitchen')],
  )
  await db.query(
    "INSERT INTO workspace_billing(business_id,plan_id,source,status,environment,subscription_id,customer_id,plan_variation_id,provider_status,paid_from,paid_through) VALUES($1,'cottage-kitchen','stripe_test','paid_active','test','sub_changes','cus_changes',$2,'active',to_timestamp($3),to_timestamp($4))",
    [business, priceId('cottage-kitchen'), now - 100, periodEnd],
  )
  sub = {
    id: 'sub_changes',
    customer: 'cus_changes',
    livemode: false,
    status: 'active',
    metadata: { attempt_id: attempt },
    cancel_at_period_end: false,
    latest_invoice: 'in_initial',
    items: {
      data: [
        {
          id: 'si_changes',
          price: price('cottage-kitchen'),
          quantity: 1,
          current_period_start: now - 100,
          current_period_end: periodEnd,
        },
      ],
    },
  }
  invoices = [invoice('in_initial', 'cottage-kitchen', true)]
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options?: RequestInit) => {
      expect(url.startsWith('https://api.stripe.com/v1/')).toBe(true)
      const path = url.slice('https://api.stripe.com/v1'.length),
        body = options?.body as URLSearchParams | undefined
      if (options?.method === 'POST') {
        const respond = (value: unknown) => {
          if (loseResponse === path) {
            loseResponse = null
            throw new Error('Simulated lost TEST provider response')
          }
          return Response.json(value)
        }
        writes.push({
          path,
          body: new URLSearchParams(body),
          idempotency: new Headers(options.headers).get('Idempotency-Key'),
        })
        if (path === '/invoices/create_preview')
          return Response.json({
            amount_due: changeDue,
            total: changeDue,
            currency: 'usd',
            livemode: false,
          })
        if (path === '/subscriptions/sub_changes') {
          if (body?.has('cancel_at_period_end'))
            sub.cancel_at_period_end =
              body.get('cancel_at_period_end') === 'true'
          else {
            const plan = Object.keys(prices).find(
              (p) => priceId(p) === body?.get('items[0][price]'),
            )!
            if (deferPayment) sub.pending_update = { expires_at: periodEnd }
            else sub.items.data[0].price = price(plan)
            sub.latest_invoice = 'in_upgrade'
            invoices.unshift(
              invoice('in_upgrade', plan, !deferPayment, changeDue, now),
            )
          }
          return respond(sub)
        }
        if (path === '/subscription_schedules') {
          expect([...body!.keys()]).toEqual(['from_subscription'])
          if (schedule) return respond(schedule)
          scheduleCreations++
          sub.schedule = 'sub_sched_changes'
          schedule = {
            id: sub.schedule,
            livemode: false,
            subscription: sub.id,
            customer: sub.customer,
            metadata: {
              cottage_change_id: body?.get('metadata[cottage_change_id]'),
            },
            current_phase: { start_date: now - 100, end_date: periodEnd },
            phases: [
              {
                start_date: now - 100,
                end_date: periodEnd,
                items: [{ price: sub.items.data[0].price.id, quantity: 1 }],
                collection_method: 'charge_automatically',
                automatic_tax: { enabled: false },
              },
            ],
          }
          return respond(schedule)
        }
        if (path === '/subscription_schedules/sub_sched_changes') {
          schedule!.metadata.cottage_change_id = body?.get(
            'metadata[cottage_change_id]',
          )
          schedule!.end_behavior = body?.get('end_behavior')
          schedule!.phases.push({
            start_date: periodEnd,
            end_date: periodEnd + 30 * 86400,
            items: [
              { price: body?.get('phases[1][items][0][price]'), quantity: 1 },
            ],
          })
          return respond(schedule)
        }
        if (path === '/subscription_schedules/sub_sched_changes/release') {
          sub.schedule = null
          return Response.json({ ...schedule, status: 'released' })
        }
        throw new Error('Unexpected provider mutation')
      }
      if (path === '/subscriptions/sub_changes') return Response.json(sub)
      if (path === '/checkout/sessions/cs_changes')
        return Response.json({
          id: 'cs_changes',
          livemode: false,
          mode: 'subscription',
          status: 'complete',
          subscription: sub.id,
          customer: sub.customer,
          client_reference_id: attempt,
          metadata: { attempt_id: attempt },
        })
      if (path.startsWith('/prices/'))
        return Response.json(
          price(
            Object.keys(prices).find(
              (p) => priceId(p) === path.slice('/prices/'.length),
            )!,
          ),
        )
      if (path.startsWith('/invoices?'))
        return Response.json({ data: invoices })
      if (path.startsWith('/invoices/'))
        return Response.json({
          data:
            invoices.find((i) => path.includes('/' + i.id + '/'))?.lines || [],
          has_more: false,
        })
      if (path === '/subscription_schedules/sub_sched_changes')
        return Response.json(schedule)
      if (path.startsWith('/events/'))
        return Response.json({
          livemode: false,
          type: 'invoice.paid',
          data: { object: { subscription: sub.id } },
        })
      throw new Error('Unexpected provider request')
    }),
  )
})

it('previews actual proration, updates the same subscription once, and preserves LIVE/provider configuration and checkout history', async () => {
  const change = await preview()
  expect(change).toMatchObject({
    fromPlan: 'cottage-kitchen',
    toPlan: 'cottage-mercantile',
    amountDue: 437,
    toMonthlyCents: 4000,
    fromUsers: 5,
    toUsers: 6,
    kind: 'upgrade',
  })
  expect(
    writes.filter((w) => w.path === '/subscriptions/sub_changes'),
  ).toHaveLength(0)
  const result = await confirm(change.id)
  expect(result.billing).toMatchObject({
    plan: 'cottage-mercantile',
    provider: 'stripe_test',
    status: 'paid_active',
  })
  expect(result.changes[0].status).toBe('applied')
  expect(result.subscription.monthlyCents).toBe(4000)
  expect(planWriteAllowed(result.access.access, 'resaleModule')).toBe(true)
  await confirm(change.id)
  const updates = writes.filter((w) => w.path === '/subscriptions/sub_changes')
  expect(updates).toHaveLength(1)
  expect(updates[0].body.get('payment_behavior')).toBe('pending_if_incomplete')
  expect(updates[0].body.get('proration_behavior')).toBe('always_invoice')
  expect(updates[0].body.get('proration_date')).toBe(
    String(change.prorationDate),
  )
  expect(writes.some((w) => w.path === '/checkout/sessions')).toBe(false)
  expect(
    (
      await db.query(
        'SELECT subscription_id,plan_id,price_id FROM stripe_checkouts WHERE business_id=$1',
        [business],
      )
    ).rows,
  ).toEqual([
    {
      subscription_id: sub.id,
      plan_id: 'cottage-kitchen',
      price_id: priceId('cottage-kitchen'),
    },
  ])
  expect(
    (
      await db.query(
        'SELECT environment,checkout_enabled,configuration,ciphertext FROM stripe_provider_settings ORDER BY environment',
      )
    ).rows,
  ).toEqual(connectionBefore)
})

it('retains the old paid tier for a pending/declined payment and applies the new tier only after provider confirmation', async () => {
  deferPayment = true
  const change = await preview(),
    pending = await confirm(change.id)
  expect(pending.billing.plan).toBe('cottage-kitchen')
  expect(pending.changes[0].status).toBe('pending')
  expect(pending.subscription.pendingUpdate).toBe(true)
  sub.items.data[0].price = price('cottage-mercantile')
  sub.pending_update = null
  invoices[0].status = 'paid'
  invoices[0].amount_paid = changeDue
  const refreshed = await ok({ action: 'refresh' })
  expect(refreshed.billing.plan).toBe('cottage-mercantile')
  expect(refreshed.changes[0].status).toBe('applied')
})

it('does not grant an upgraded tier from an open invoice even if the provider item changes', async () => {
  deferPayment = true
  const change = await preview()
  await confirm(change.id)
  sub.items.data[0].price = price('cottage-mercantile')
  sub.pending_update = null
  const result = await ok({ action: 'refresh' })
  expect(result.access.plan).toBe('cottage-kitchen')
  expect(result.changes[0].status).toBe('pending')
})

it('recovers a lost pending-payment response and allows a fresh preview after the payment expires', async () => {
  deferPayment = true
  const change = await preview()
  loseResponse = '/subscriptions/sub_changes'
  expect(
    (
      await call({
        action: 'confirm_change',
        changeId: change.id,
        confirmed: true,
      })
    ).status,
  ).toBe(502)
  const pending = await ok({ action: 'refresh' })
  expect(pending.changes[0].status).toBe('pending')
  expect(pending.access.plan).toBe('cottage-kitchen')
  sub.pending_update = null
  const failed = await ok({ action: 'refresh' })
  expect(failed.changes[0].status).toBe('failed')
  expect(failed.access.plan).toBe('cottage-kitchen')
  expect((await preview()).kind).toBe('upgrade')
  expect(
    writes.filter((w) => w.path === '/subscriptions/sub_changes'),
  ).toHaveLength(1)
})

it('rejects a changed amount or expired preview without changing the subscription', async () => {
  const change = await preview()
  changeDue++
  const result = await call({
    action: 'confirm_change',
    changeId: change.id,
    confirmed: true,
  })
  expect(result.status).toBe(409)
  expect((await result.json()).code).toBe('PREVIEW_CHANGED')
  await db.query(
    "UPDATE stripe_subscription_changes SET expires_at=now()-interval '1 minute' WHERE id=$1",
    [change.id],
  )
  changeDue--
  expect(
    (
      await call({
        action: 'confirm_change',
        changeId: change.id,
        confirmed: true,
      })
    ).status,
  ).toBe(409)
  expect(
    writes.filter((w) => w.path === '/subscriptions/sub_changes'),
  ).toHaveLength(0)
})

it('schedules a downgrade at renewal, retains paid access, caps new seats and allows cancelling the schedule', async () => {
  await confirm((await preview()).id)
  const change = await preview('cottage-kitchen')
  expect(change).toMatchObject({ amountDue: 0, kind: 'downgrade', toUsers: 5 })
  const result = await confirm(change.id)
  expect(result.billing.plan).toBe('cottage-mercantile')
  expect(result.changes[0].status).toBe('scheduled')
  const scheduleWrite = writes.find(
    (w) => w.path === '/subscription_schedules/sub_sched_changes',
  )!
  expect(scheduleWrite.body.get('phases[0][end_date]')).toBe(String(periodEnd))
  expect(scheduleWrite.body.get('phases[1][start_date]')).toBe(
    String(periodEnd),
  )
  expect(scheduleWrite.body.get('phases[1][items][0][price]')).toBe(
    priceId('cottage-kitchen'),
  )
  expect(scheduleWrite.body.get('proration_behavior')).toBe('none')
  await db.query(
    "INSERT INTO users(id,business_id,identity_id,role,data) VALUES('seat2',$1,'seat2','Manager','{}')",
    [business],
  )
  for (let i = 3; i <= 5; i++)
    await db.query(
      "INSERT INTO users(id,business_id,identity_id,role,data) VALUES($1,$2,$1,'Manager','{}')",
      ['seat' + i, business],
    )
  await expect(
    db.query(
      "INSERT INTO users(id,business_id,identity_id,role,data) VALUES('seat6',$1,'seat6','Manager','{}')",
      [business],
    ),
  ).rejects.toThrow(/scheduled plan allows 5/)
  const cancelled = await ok({ action: 'cancel_pending', confirmed: true })
  expect(cancelled.changes[0].status).toBe('cancelled')
  expect(sub.schedule).toBeNull()
  expect(cancelled.billing.plan).toBe('cottage-mercantile')
})

it('blocks an over-seat downgrade without removing users or records', async () => {
  await confirm((await preview()).id)
  for (let i = 2; i <= 6; i++)
    await db.query(
      "INSERT INTO users(id,business_id,identity_id,role,data) VALUES($1,$2,$1,'Manager','{}')",
      ['seat' + i, business],
    )
  const result = await call({
    action: 'preview_change',
    plan: 'cottage-kitchen',
  })
  expect(result.status).toBe(409)
  expect((await result.json()).code).toBe('SEAT_LIMIT')
  expect(
    (
      await db.query(
        'SELECT id FROM users WHERE business_id=$1 AND active=true',
        [business],
      )
    ).rows,
  ).toHaveLength(6)
  expect(
    writes.filter((w) => w.path === '/subscription_schedules'),
  ).toHaveLength(0)
})

it('schedules cancellation to Free at renewal and resumes without creating a subscription', async () => {
  const change = await preview('free')
  expect(change.kind).toBe('cancel')
  const result = await confirm(change.id)
  expect(result.billing.plan).toBe('cottage-kitchen')
  expect(result.subscription.cancelAtPeriodEnd).toBe(true)
  expect(result.subscription.endsAt).toBe(
    new Date(periodEnd * 1000).toISOString(),
  )
  expect(
    (await ok({ action: 'cancel_pending', confirmed: true })).subscription
      .cancelAtPeriodEnd,
  ).toBe(false)
  expect(writes.filter((w) => w.path === '/checkout/sessions')).toHaveLength(0)
})

it('reconciles the scheduled lower tier from a paid renewal webhook, not from the schedule alone', async () => {
  await confirm((await preview()).id)
  await confirm((await preview('cottage-kitchen')).id)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date((periodEnd + 1) * 1000))
  sub.items.data[0].price = price('cottage-kitchen')
  sub.items.data[0].current_period_end = now + 2 * 86400
  sub.latest_invoice = 'in_renewal'
  invoices.unshift(
    invoice(
      'in_renewal',
      'cottage-kitchen',
      true,
      3000,
      periodEnd,
      now + 2 * 86400,
    ),
  )
  await db.query(
    "INSERT INTO stripe_events(id,environment,kind) VALUES('evt_changes','test','invoice.paid')",
  )
  await db.exec('BEGIN')
  try {
    await processStripeEvent(runtime.client, {
      id: 'evt_changes',
      environment: 'test',
      kind: 'invoice.paid',
    })
    await db.exec('COMMIT')
  } catch (e) {
    await db.exec('ROLLBACK')
    throw e
  }
  const result = await ok()
  expect(result.billing.plan).toBe('cottage-kitchen')
  expect(result.changes[0].status).toBe('applied')
  expect(planWriteAllowed(result.access.access, 'resaleModule')).toBe(false)
  expect(sub.schedule).toBeNull()
  expect(result.changeBlockedReason).toBe('')
  expect((await preview('cottage-mercantile')).kind).toBe('upgrade')
  const row = (
    await db.query<AdminMetadata>(
      'SELECT * FROM workspace_billing WHERE business_id=$1',
      [business],
    )
  ).rows[0]
  expect(
    providerBilledAccess(row as Parameters<typeof providerBilledAccess>[0])
      .plan,
  ).toBe('cottage-kitchen')
})

it('blocks unauthorized members, foreign-business previews, forged ownership, wrong origins and missing confirmation server-side', async () => {
  const change = await preview()
  const foreign = randomUUID()
  await db.query(
    'UPDATE stripe_subscription_changes SET business_id=$1 WHERE id=$2',
    [other, change.id],
  )
  expect(
    (
      await call({
        action: 'confirm_change',
        changeId: change.id,
        confirmed: true,
      })
    ).status,
  ).toBe(409)
  expect(
    (
      await call({
        action: 'confirm_change',
        changeId: foreign,
        confirmed: true,
      })
    ).status,
  ).toBe(409)
  expect(
    (
      await call({
        action: 'preview_change',
        plan: 'cottage-mercantile',
        businessId: other,
      })
    ).status,
  ).toBe(400)
  expect(
    (
      await call(
        { action: 'preview_change', plan: 'cottage-mercantile' },
        'https://foreign.invalid',
      )
    ).status,
  ).toBe(403)
  expect(
    (await call({ action: 'confirm_change', changeId: change.id })).status,
  ).toBe(400)
  await db.query("UPDATE users SET role='Manager' WHERE business_id=$1", [
    business,
  ])
  for (const body of [
    { action: 'preview_change', plan: 'cottage-mercantile' },
    { action: 'confirm_change', changeId: change.id, confirmed: true },
    { action: 'cancel_pending', confirmed: true },
    { action: 'portal' },
  ]) {
    const response = await call(body)
    expect(response.status).toBe(403)
    expect((await response.json()).code).toBe('OWNER_REQUIRED')
  }
  expect(
    writes.some(
      (w) =>
        w.path === '/subscriptions/sub_changes' ||
        w.path === '/checkout/sessions',
    ),
  ).toBe(false)
})

it.each([
  '/subscriptions/sub_changes',
  '/subscription_schedules',
  '/subscription_schedules/sub_sched_changes',
])(
  'recovers a lost TEST response from %s without duplicate subscriptions or schedules',
  async (path) => {
    if (path !== '/subscriptions/sub_changes')
      await confirm((await preview()).id)
    const change = await preview(
      path === '/subscriptions/sub_changes'
        ? 'cottage-mercantile'
        : 'cottage-kitchen',
    )
    loseResponse = path
    expect(
      (
        await call({
          action: 'confirm_change',
          changeId: change.id,
          confirmed: true,
        })
      ).status,
    ).toBe(502)
    const reserved = (
      await db.query<AdminMetadata>(
        'SELECT status FROM stripe_subscription_changes WHERE id=$1',
        [change.id],
      )
    ).rows[0]
    expect(reserved.status).toBe('applying')
    const recovered = await confirm(change.id)
    expect(recovered.changes[0].status).toBe(
      path === '/subscriptions/sub_changes' ? 'applied' : 'scheduled',
    )
    expect(
      writes.filter(
        (w) =>
          w.path === '/subscriptions/sub_changes' &&
          w.body.has('items[0][price]'),
      ),
    ).toHaveLength(1)
    expect(scheduleCreations).toBe(
      path === '/subscriptions/sub_changes' ? 0 : 1,
    )
    expect(writes.some((w) => w.path === '/checkout/sessions')).toBe(false)
  },
)

it('requires review when a confirmed downgrade schedule is edited outside the app', async () => {
  await confirm((await preview()).id)
  await confirm((await preview('cottage-kitchen')).id)
  schedule!.phases[1].items[0].quantity = 2
  const response = await call({ action: 'refresh' })
  expect(response.status).toBe(409)
  expect((await response.json()).code).toBe('SCHEDULE_REVIEW_REQUIRED')
  expect((await ok()).billing.plan).toBe('cottage-mercantile')
})

it('withholds paid features when a scheduled downgrade renewal remains unpaid', async () => {
  await confirm((await preview()).id)
  await confirm((await preview('cottage-kitchen')).id)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date((periodEnd + 1) * 1000))
  sub.items.data[0].price = price('cottage-kitchen')
  sub.items.data[0].current_period_end = periodEnd + 86400
  sub.status = 'past_due'
  invoices.unshift(
    invoice(
      'in_unpaid_renewal',
      'cottage-kitchen',
      false,
      3000,
      periodEnd,
      periodEnd + 86400,
    ),
  )
  const result = await ok({ action: 'refresh' })
  expect(result.access.plan).toBe('free')
  expect(result.changes[0].status).toBe('scheduled')
  expect(planWriteAllowed(result.access.access, 'resaleModule')).toBe(false)
})

it('explains linked cancelled coverage rather than offering duplicate checkout', async () => {
  sub.status = 'canceled'
  sub.canceled_at = now
  const result = await ok({ action: 'refresh' })
  expect(result.hasSubscription).toBe(false)
  expect(result.checkoutBlockedReason).toContain('verified paid coverage ends')
  expect(result.access.plan).toBe('cottage-kitchen')
  const response = await call({
    action: 'checkout',
    environment: 'test',
    plan: 'cottage-mercantile',
    confirmed: true,
  })
  expect(response.status).toBe(409)
  expect((await response.json()).code).toBe('EXISTING_SUBSCRIPTION')
  expect(writes.some((w) => w.path === '/checkout/sessions')).toBe(false)
})
