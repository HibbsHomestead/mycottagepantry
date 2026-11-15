/* eslint-disable @typescript-eslint/no-explicit-any -- synthetic provider and Finance JSON fixtures */
// @vitest-environment node
import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
const provider = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('../../netlify/lib/stripe-provider', () => ({
  stripeRequest: provider.request,
  stripeSettings: async () => ({ ciphertext: 'synthetic' }),
  openStripe: () => ({ key: 'synthetic' }),
}))
vi.mock('../../netlify/lib/runtime-environment', () => ({
  deploymentRuntime: () => ({ context: 'production' }),
}))
import {
  subscriptionExpenseRequest,
  syncSubscriptionExpenses,
  verifiedSubscriptionCharge,
  synchronizeExpenseAttempt,
} from '../../netlify/lib/subscription-expenses'
const business = '10000000-0000-4000-8000-000000000001',
  other = '10000000-0000-4000-8000-000000000002',
  attemptId = '20000000-0000-4000-8000-000000000001'
const actor = {
  id: 'owner',
  email: 'owner@example.invalid',
  privateTest: false,
  platformAdmin: false,
  selectedWorkspaceId: business,
}
let db: PGlite
const c = {
  query: async (sql: string, values?: any[]) => db.query(sql, values),
  release: () => {},
}
const invoice = (patch: any = {}) => ({
  id: 'in_real',
  subscription: 'sub_real',
  status: 'paid',
  customer: 'cus_real',
  currency: 'usd',
  amount_paid: 850,
  subtotal: 1000,
  total: 850,
  total_discount_amounts: [{ amount: 200 }],
  total_tax_amounts: [{ amount: 50 }],
  status_transitions: { paid_at: Math.floor(Date.now() / 1000) },
  charge: 'ch_real',
  account_name: 'Cottage Pantry',
  number: 'CP-001',
  description: 'Prorated Mixing Bowl',
  lines: {
    data: [
      { price: { id: 'price_real' }, description: 'Mixing Bowl subscription' },
    ],
  },
  ...patch,
})
const charge = (patch: any = {}) => ({
  id: 'ch_real',
  paid: true,
  captured: true,
  status: 'succeeded',
  livemode: true,
  customer: 'cus_real',
  currency: 'usd',
  amount_captured: 850,
  amount_refunded: 0,
  created: Math.floor(Date.now() / 1000),
  ...patch,
})
const attempt = {
  id: attemptId,
  business_id: business,
  environment: 'live',
  customer_id: 'cus_real',
  subscription_id: 'sub_real',
  plan_id: 'mixing-bowl',
  price_id: 'price_real',
}
async function sync(
  inv = invoice(),
  ch = charge(),
  refunds: any[] = [],
  force = false,
) {
  provider.request.mockImplementation(async (_key: string, path: string) => {
    if (path === '/charges/ch_real') return ch
    if (path.startsWith('/refunds?')) return { data: refunds }
    throw new Error('Unexpected provider read: ' + path)
  })
  await db.exec('BEGIN')
  await syncSubscriptionExpenses(
    c,
    attempt,
    [inv],
    'not-a-credential',
    { price_real: 'mixing-bowl' },
    force ? inv.id : undefined,
  )
  await db.exec('COMMIT')
}
async function request(input: any, who = actor) {
  await db.exec('BEGIN')
  try {
    const result = await subscriptionExpenseRequest(c, who, input)
    await db.exec('COMMIT')
    return result.expenses as any
  } catch (e) {
    await db.exec('ROLLBACK')
    throw e
  }
}
beforeEach(async () => {
  db = new PGlite()
  await db.exec(`CREATE TABLE businesses(id uuid PRIMARY KEY,identity_owner text,business_name text);
    CREATE TABLE stripe_checkouts(id uuid PRIMARY KEY,business_id uuid,status text,subscription_id text,customer_id text,environment text,price_id text,plan_id text,created_at timestamp DEFAULT now());
    CREATE TABLE users(business_id uuid,identity_id text,role text,active boolean);
    CREATE TABLE stripe_subscription_changes(business_id uuid,subscription_id text,to_price text,to_plan text,confirmed_at timestamptz);
    CREATE TABLE workspace_billing(business_id uuid,plan_id text,status text,source text,paid_through timestamptz,environment text,entitlement_policy text);
    CREATE TABLE complimentary_grants(id uuid,business_id uuid,plan_id text,operation text,grant_source text,owner_identity text,actor_identity text,reason text,created_at timestamptz,expires_at timestamptz);
    ${['accounts', 'settings', 'journals', 'activity', 'finance_transactions'].map((t) => `CREATE TABLE ${t}(id text,business_id uuid,data jsonb,created_at timestamp DEFAULT now(),updated_at timestamp DEFAULT now(),UNIQUE(business_id,id));`).join('')}
    CREATE TABLE finance_reviews(id text,business_id uuid,transaction_id text,data jsonb,created_at timestamp DEFAULT now(),updated_at timestamp DEFAULT now(),UNIQUE(business_id,id));
    INSERT INTO businesses VALUES('${business}','owner','Own business'),('${other}','other-owner','Other business');
    INSERT INTO users VALUES('${business}','owner','Owner',true),('${other}','other-owner','Owner',true);
    INSERT INTO stripe_checkouts(id) VALUES('${attemptId}');
    INSERT INTO workspace_billing VALUES('${business}','mixing-bowl','paid_active','stripe_live','2099-01-01','live','kitchen-two-v1');
    INSERT INTO settings VALUES('settings','${business}','{"id":"settings","currency":"USD"}');`)
  await db.exec(
    await readFile(
      'netlify/database/migrations/20261214010000_add_subscription_expenses/migration.sql',
      'utf8',
    ),
  )
})
afterEach(async () => {
  await db.close()
  vi.clearAllMocks()
})
it('uses actual discounted, taxed proration; posting and refresh are idempotent; drafts never post', async () => {
  await sync()
  let view = await request({ action: 'expenses' })
  expect(view.payments[0]).toMatchObject({
    amountCents: 850,
    currency: 'USD',
    planName: 'Mixing Bowl',
    payee: 'Cottage Pantry',
    invoiceDetails: { discounts: [{ amount: 200 }], tax: [{ amount: 50 }] },
  })
  const paymentId = view.payments[0].id
  await request({ action: 'expense_record', paymentId, draft: true })
  expect((await db.query('SELECT * FROM journals')).rows).toHaveLength(0)
  expect(
    (await db.query('SELECT data FROM finance_transactions')).rows[0],
  ).toMatchObject({ data: { status: 'draft' } })
  await expect(
    request({
      action: 'expense_record',
      paymentId,
      account: 'Bank account',
      category: 'Software',
    }),
  ).rejects.toThrow(/confirm/)
  await request({
    action: 'expense_record',
    paymentId,
    confirmed: true,
    account: 'Bank account',
    category: 'Software',
  })
  await request({
    action: 'expense_record',
    paymentId,
    confirmed: true,
    account: 'Bank account',
    category: 'Software',
  })
  await sync()
  expect((await db.query('SELECT * FROM journals')).rows).toHaveLength(1)
  view = await request({ action: 'expenses' })
  expect(view.payments[0].status).toBe('recorded')
  const lines = (await db.query('SELECT data FROM journals')).rows[0] as any
  expect(lines.data.lines).toEqual([
    { account: 'Software', debit: 8.5, credit: 0 },
    { account: 'Bank account', debit: 0, credit: 8.5 },
  ])
})
it('ignores free/zero, unpaid, pending, abandoned and cross-customer/subscription evidence', async () => {
  for (const patch of [
    { amount_paid: 0 },
    { status: 'open' },
    { status: 'draft' },
    { customer: 'cus_other' },
    { subscription: 'sub_other' },
  ])
    await sync(invoice(patch))
  for (const patch of [
    { paid: false },
    { captured: false },
    { status: 'pending' },
    { currency: 'eur' },
    { livemode: false },
    { customer: 'cus_other' },
  ])
    await sync(invoice(), charge(patch))
  expect((await request({ action: 'expenses' })).payments).toHaveLength(0)
  await db.query(
    "UPDATE workspace_billing SET plan_id='free' WHERE business_id=$1",
    [business],
  )
  expect((await request({ action: 'expenses' })).available).toBe(false)
})
it('keeps skipped payments accessible; rejects other businesses and read-only roles', async () => {
  await sync()
  const paymentId = (await request({ action: 'expenses' })).payments[0].id
  await request({ action: 'expense_skip', paymentId })
  expect((await request({ action: 'expenses' })).payments[0].dismissed).toBe(
    true,
  )
  await db.query(
    "INSERT INTO workspace_billing VALUES($1,'mixing-bowl','paid_active','stripe_live','2099-01-01','live','kitchen-two-v1')",
    [other],
  )
  await expect(
    request(
      {
        action: 'expense_record',
        paymentId,
        confirmed: true,
        account: 'Bank account',
        category: 'Software',
      },
      { ...actor, id: 'other-owner', selectedWorkspaceId: other },
    ),
  ).rejects.toThrow(/not available|Finance/)
  expect((await db.query('SELECT * FROM journals')).rows).toHaveLength(0)
  await db.query(
    "UPDATE users SET role='Read-only Accountant' WHERE identity_id='owner'",
  )
  await expect(request({ action: 'expenses' })).rejects.toThrow(
    /Owner or Manager/,
  )
})
it('enforces tenant RLS and provider uniqueness at the database, including cross-business duplicates', async () => {
  await sync()
  await expect(
    db.query(
      `INSERT INTO subscription_expense_payments(id,business_id,data,environment,provider_id,invoice_id,attempt_id) VALUES('dup',$1,'{}','live','ch_real','in_real',$2)`,
      [other, attemptId],
    ),
  ).rejects.toThrow(/unique/)
  await db.exec(
    'CREATE ROLE expense_reader; GRANT SELECT ON subscription_expense_payments,subscription_expense_preferences TO expense_reader; SET ROLE expense_reader;',
  )
  await db.query("SELECT set_config('app.business_id',$1,false)", [other])
  expect(
    (await db.query('SELECT * FROM subscription_expense_payments')).rows,
  ).toHaveLength(0)
  await db.exec('RESET ROLE')
})
it('opt-in requires defaults, has no backfill, posts only future payments and stops when disabled', async () => {
  await expect(
    request({
      action: 'expense_preferences',
      enabled: true,
      account: '',
      category: 'Software',
    }),
  ).rejects.toThrow(/default payment account/)
  await sync(
    invoice({
      status_transitions: { paid_at: Math.floor(Date.now() / 1000) - 3600 },
    }),
  )
  await request({
    action: 'expense_preferences',
    enabled: true,
    account: 'Bank account',
    category: 'Software',
  })
  await sync()
  expect((await db.query('SELECT * FROM journals')).rows).toHaveLength(0)
  // Future event uses a real provider timestamp after the explicitly saved cutoff.
  await db.query(
    "UPDATE subscription_expense_preferences SET enabled_at=now()-interval '1 second'",
  )
  await db.query('DELETE FROM subscription_expense_payments')
  await sync()
  expect((await db.query('SELECT * FROM journals')).rows).toHaveLength(1)
  expect((await request({ action: 'expenses' })).payments[0]).toMatchObject({
    status: 'recorded',
    automatic: true,
  })
  await request({
    action: 'expense_preferences',
    enabled: false,
    account: 'Bank account',
    category: 'Software',
  })
  expect((await request({ action: 'expenses' })).preference.enabled).toBe(false)
})
it('inactive defaults leave review drafts and do not alter balances; mismatched currencies cannot post', async () => {
  await request({
    action: 'expense_preferences',
    enabled: true,
    account: 'Bank account',
    category: 'Software',
  })
  await db.query(
    "UPDATE subscription_expense_preferences SET enabled_at=now()-interval '1 second',account='Deleted account'",
  )
  await sync()
  const p = (await request({ action: 'expenses' })).payments[0]
  expect(p.status).toBe('review')
  expect((await db.query('SELECT * FROM journals')).rows).toHaveLength(0)
  await db.query(
    `UPDATE settings SET data='{"id":"settings","currency":"EUR"}'`,
  )
  await expect(
    request({
      action: 'expense_record',
      paymentId: p.id,
      confirmed: true,
      account: 'Bank account',
      category: 'Software',
    }),
  ).rejects.toThrow(/different currency/)
})
it('partial refunds use linked contra-expense journals, reject excess refunds, and never rewrite the payment', async () => {
  await sync()
  let v = await request({ action: 'expenses' })
  const payment = v.payments[0]
  await request({
    action: 'expense_record',
    paymentId: payment.id,
    confirmed: true,
    account: 'Bank account',
    category: 'Software',
  })
  const refund = {
    id: 're_one',
    status: 'succeeded',
    amount: 300,
    currency: 'usd',
    charge: 'ch_real',
    created: Math.floor(Date.now() / 1000),
  }
  await sync(invoice(), charge({ amount_refunded: 300 }), [refund], true)
  v = await request({ action: 'expenses' })
  const r = v.payments.find((p: any) => p.kind === 'refund')
  await request({
    action: 'expense_record',
    paymentId: r.id,
    confirmed: true,
    account: 'Bank account',
    category: 'Software',
  })
  await sync(invoice(), charge({ amount_refunded: 300 }), [refund], true)
  await request({
    action: 'expense_record',
    paymentId: r.id,
    confirmed: true,
    account: 'Bank account',
    category: 'Software',
  })
  expect((await db.query('SELECT * FROM journals')).rows).toHaveLength(2)
  expect(
    (
      await db.query(
        "SELECT data FROM finance_transactions WHERE data->>'kind'='expenseRefund'",
      )
    ).rows[0],
  ).toMatchObject({ data: { originalId: expect.any(String), amount: 3 } })
  expect(
    (await request({ action: 'expenses' })).payments.find(
      (p: any) => p.id === payment.id,
    ).amountCents,
  ).toBe(850)
  const huge = { ...refund, id: 're_two', amount: 800 }
  await sync(invoice(), charge({ amount_refunded: 850 }), [refund, huge], true)
  const second = (await request({ action: 'expenses' })).payments.find(
    (p: any) => p.amountCents === 800,
  )
  await expect(
    request({
      action: 'expense_record',
      paymentId: second.id,
      confirmed: true,
      account: 'Bank account',
      category: 'Software',
    }),
  ).rejects.toThrow(/exceed/)
})
it('bookkeeping failure rolls back only its savepoint while the already-confirmed billing remains committed', async () => {
  await db.exec('BEGIN')
  await db.query("UPDATE workspace_billing SET status='paid_active'")
  provider.request.mockRejectedValue(new Error('private provider failure'))
  await syncSubscriptionExpenses(
    c,
    attempt,
    [invoice()],
    'not-a-credential',
    {},
  )
  await db.query("UPDATE workspace_billing SET paid_through='2099-02-01'")
  await db.exec('COMMIT')
  expect(
    (await db.query('SELECT paid_through FROM workspace_billing')).rows[0],
  ).toBeDefined()
  expect(
    (await db.query('SELECT * FROM subscription_expense_payments')).rows,
  ).toHaveLength(0)
  expect((await db.query('SELECT * FROM activity')).rows).toHaveLength(1)
})
it('cash verification never turns an invoice credit into a payment', () => {
  expect(
    verifiedSubscriptionCharge(
      invoice({ amount_paid: 0 }),
      charge({ amount_captured: 0 }),
      'cus_real',
      'live',
    ),
  ).toBe(false)
  expect(
    verifiedSubscriptionCharge(invoice(), charge(), 'cus_real', 'live'),
  ).toBe(true)
})

it('collects modern Stripe invoice payments only through committed checkout-to-business links', async () => {
  await db.query(
    "UPDATE stripe_checkouts SET business_id=$1,status='complete',subscription_id='sub_real',customer_id='cus_real',environment='live',price_id='price_real',plan_id='mixing-bowl' WHERE id=$2",
    [business, attemptId],
  )
  provider.request.mockImplementation(async (_key: string, path: string) => {
    if (path.startsWith('/invoices?'))
      return { data: [invoice({ charge: undefined })] }
    if (path.startsWith('/invoice_payments?'))
      return {
        data: [
          { payment: { type: 'payment_intent', payment_intent: 'pi_real' } },
        ],
      }
    if (path === '/payment_intents/pi_real')
      return {
        status: 'succeeded',
        customer: 'cus_real',
        latest_charge: 'ch_real',
      }
    if (path === '/charges/ch_real') return charge()
    throw new Error('Unexpected provider read')
  })
  await db.exec('BEGIN')
  await synchronizeExpenseAttempt(c, attemptId)
  await db.exec('COMMIT')
  expect((await request({ action: 'expenses' })).payments[0]).toMatchObject({
    amountCents: 850,
    planName: 'Mixing Bowl',
  })
  // No subscription mutation, charge creation, or provider POST is used.
  expect(provider.request.mock.calls.every((call) => call.length === 2)).toBe(
    true,
  )
})

it('does not post to an inactive default account', async () => {
  await request({
    action: 'expense_preferences',
    enabled: true,
    account: 'Bank account',
    category: 'Software',
  })
  await db.query(
    "UPDATE subscription_expense_preferences SET enabled_at=now()-interval '1 second'",
  )
  await db.query('INSERT INTO accounts(id,business_id,data) VALUES($1,$2,$3)', [
    'inactive',
    business,
    {
      id: 'inactive',
      name: 'Bank account',
      type: 'asset',
      bookAccount: true,
      active: false,
    },
  ])
  await sync()
  expect((await request({ action: 'expenses' })).payments[0].status).toBe(
    'review',
  )
  expect((await db.query('SELECT * FROM journals')).rows).toHaveLength(0)
})
it('a full cash refund offsets the expense without removing either original record', async () => {
  await sync()
  const p = (await request({ action: 'expenses' })).payments[0]
  await request({
    action: 'expense_record',
    paymentId: p.id,
    account: 'Bank account',
    category: 'Software',
    confirmed: true,
  })
  await sync(
    invoice(),
    charge({ amount_refunded: 850 }),
    [
      {
        id: 're_full',
        amount: 850,
        charge: 'ch_real',
        currency: 'usd',
        status: 'succeeded',
        created: Math.floor(Date.now() / 1000),
      },
    ],
    true,
  )
  const r = (await request({ action: 'expenses' })).payments.find(
    (x: any) => x.kind === 'refund',
  )
  await request({
    action: 'expense_record',
    paymentId: r.id,
    account: 'Bank account',
    category: 'Software',
    confirmed: true,
  })
  const rows = (await db.query('SELECT data FROM journals')).rows as {
    data: { lines: { account: string; debit: number; credit: number }[] }
  }[]
  expect(rows).toHaveLength(2)
  expect(
    rows
      .flatMap((x) => x.data.lines)
      .filter((l) => l.account === 'Bank account')
      .reduce((n, l) => n + l.debit - l.credit, 0),
  ).toBe(0)
  expect(
    (await db.query('SELECT * FROM finance_transactions')).rows,
  ).toHaveLength(2)
})
it('lets an authorized owner turn tracking off after Finance access ends', async () => {
  await request({
    action: 'expense_preferences',
    enabled: true,
    account: 'Bank account',
    category: 'Software',
  })
  await db.query("UPDATE workspace_billing SET plan_id='free'")
  expect((await request({ action: 'expenses' })).preference).toMatchObject({
    enabled: true,
    configured: true,
  })
  expect(
    (await request({ action: 'expense_preferences', enabled: false }))
      .preference.enabled,
  ).toBe(false)
  expect((await db.query('SELECT * FROM journals')).rows).toHaveLength(0)
})
it('preserves foreign-currency minor units in review without mixing them into USD balances', async () => {
  await sync(invoice({ currency: 'jpy' }), charge({ currency: 'jpy' }))
  const p = (await request({ action: 'expenses' })).payments[0]
  await request({ action: 'expense_record', paymentId: p.id, draft: true })
  expect(
    (await db.query('SELECT data FROM finance_transactions')).rows[0],
  ).toMatchObject({ data: { amount: 850, currency: 'JPY', status: 'draft' } })
  await expect(
    request({
      action: 'expense_record',
      paymentId: p.id,
      account: 'Bank account',
      category: 'Software',
      confirmed: true,
    }),
  ).rejects.toThrow(/different currency/)
  expect((await db.query('SELECT * FROM journals')).rows).toHaveLength(0)
})
