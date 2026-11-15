/* eslint-disable @typescript-eslint/no-explicit-any -- validated provider snapshots and existing Finance JSON records */
import { randomUUID } from 'node:crypto'
import type { RegistrationClient, RegistrationActor } from './registration-core'
import { currentMembership, RegistrationError } from './registration-core'
import { effectiveAccess, latestManualGrant } from './manual-access'
import { planIncludes, launchPricing } from '../../src/lib/launch-plans'
import {
  bookAccounts,
  bookCategories,
  planBookkeeping,
} from '../../src/lib/checkbook'
import type { Workspace, Item } from '../../src/lib/domain'
import { deploymentRuntime } from './runtime-environment'
import { stripeRequest, stripeSettings, openStripe } from './stripe-provider'

const idOf = (v: any) => (typeof v === 'string' ? v : v?.id)
const fail = (message: string): never => {
  throw new RegistrationError(409, 'EXPENSE_REVIEW_REQUIRED', message)
}
const money = (v: unknown): v is number =>
  Number.isSafeInteger(v) && Number(v) > 0 && Number(v) <= 100000000000
const iso = (v: number) => new Date(v * 1000).toISOString()
const allowedReceipt = (url: unknown) =>
  typeof url === 'string' &&
  /^https:\/\/(invoice\.stripe\.com|pay\.stripe\.com|receipts\.stripe\.com)\//.test(
    url,
  )
    ? url
    : null

async function financeAccess(c: RegistrationClient, business: string) {
  const billing = (
    await c.query('SELECT * FROM workspace_billing WHERE business_id=$1', [
      business,
    ])
  ).rows[0]
  const owner = (
    await c.query('SELECT identity_owner FROM businesses WHERE id=$1', [
      business,
    ])
  ).rows[0]
  const access = effectiveAccess(
    billing,
    await latestManualGrant(c, business),
    owner?.identity_owner,
  )
  return (
    !!access.access?.write &&
    !!access.plan &&
    planIncludes(access.plan, 'finance') &&
    access.plan !== 'free'
  )
}
async function state(
  c: RegistrationClient,
  business: string,
): Promise<Workspace> {
  const w: Workspace = {}
  for (const table of [
    'settings',
    'accounts',
    'journals',
    'finance_transactions',
    'finance_reviews',
  ])
    w[table] = (
      await c.query(
        `SELECT data FROM ${table} WHERE business_id=$1 ORDER BY created_at,id`,
        [business],
      )
    ).rows.map((r) => r.data)
  return w
}
const accounts = (w: Workspace) =>
  bookAccounts(w).filter(
    (a) =>
      a.active !== false &&
      !a.archived &&
      !a.disabled &&
      !(w.accounts || []).some(
        (x) =>
          x.name === a.name && (x.active === false || x.archived || x.disabled),
      ),
  )
const categories = (w: Workspace) =>
  bookCategories(w).filter(
    (a) =>
      a.type === 'expense' &&
      a.active !== false &&
      !a.archived &&
      !a.disabled &&
      !(w.accounts || []).some(
        (x) =>
          x.name === a.name && (x.active === false || x.archived || x.disabled),
      ),
  )
async function audit(
  c: RegistrationClient,
  business: string,
  actor: string,
  name: string,
  detail: any,
) {
  await c.query('INSERT INTO activity(id,business_id,data) VALUES($1,$2,$3)', [
    randomUUID(),
    business,
    JSON.stringify({
      name,
      detail: JSON.stringify(detail),
      actor,
      date: new Date().toISOString().slice(0, 10),
      type: 'subscriptionExpense',
    }),
  ])
}
async function saveWrites(
  c: RegistrationClient,
  business: string,
  writes: { table: string; record: Item }[],
  actor: string,
) {
  for (const { table, record } of writes) {
    if (
      !['finance_transactions', 'journals', 'finance_reviews'].includes(table)
    )
      fail('This entry needs support review.')
    const data = {
      ...record,
      createdBy: record.createdBy || actor,
      updatedBy: actor,
      updatedAt: new Date().toISOString(),
    }
    if (table === 'finance_reviews')
      await c.query(
        'INSERT INTO finance_reviews(id,business_id,data,transaction_id) VALUES($1,$2,$3,$4) ON CONFLICT(business_id,id) DO UPDATE SET data=$3,transaction_id=$4,updated_at=now()',
        [record.id, business, JSON.stringify(data), record.transactionId],
      )
    else
      await c.query(
        `INSERT INTO ${table}(id,business_id,data) VALUES($1,$2,$3) ON CONFLICT(business_id,id) DO UPDATE SET data=$3,updated_at=now()`,
        [record.id, business, JSON.stringify(data)],
      )
  }
}
async function preference(c: RegistrationClient, business: string) {
  return (
    (
      await c.query(
        'SELECT * FROM subscription_expense_preferences WHERE business_id=$1',
        [business],
      )
    ).rows[0] || {
      enabled: false,
      category: 'Software',
      account: '',
      enabled_at: null,
    }
  )
}
async function updatePayment(
  c: RegistrationClient,
  business: string,
  row: any,
  data: any,
  transaction: string | null = row.transaction_id,
) {
  await c.query(
    'UPDATE subscription_expense_payments SET data=$3,transaction_id=$4,updated_at=now() WHERE business_id=$1 AND id=$2',
    [business, row.id, JSON.stringify(data), transaction],
  )
}

/** Only provider-confirmed cash payments qualify. Invoice credits never become expenses. */
export function verifiedSubscriptionCharge(
  invoice: any,
  charge: any,
  customer: string,
  environment: string,
) {
  return (
    invoice.status === 'paid' &&
    money(invoice.amount_paid) &&
    idOf(invoice.customer) === customer &&
    charge.paid === true &&
    charge.captured === true &&
    charge.status === 'succeeded' &&
    charge.livemode === (environment === 'live') &&
    idOf(charge.customer) === customer &&
    charge.currency === invoice.currency &&
    money(charge.amount_captured) &&
    charge.amount_captured <= invoice.amount_paid &&
    Number.isSafeInteger(charge.created) &&
    Number.isSafeInteger(invoice.status_transitions?.paid_at)
  )
}

async function stripeList(key: string, path: string) {
  const rows: any[] = []
  let cursor = ''
  for (let page = 0; page < 10; page++) {
    const result = await stripeRequest(
      key,
      path + (cursor ? '&starting_after=' + encodeURIComponent(cursor) : ''),
    )
    if (!Array.isArray(result.data))
      fail('Payment details could not be checked. Please retry later.')
    rows.push(...result.data)
    if (!result.has_more) return rows
    cursor = result.data.at(-1)?.id
    if (!cursor) break
  }
  return fail('This payment has many records and needs support review.')
}

async function captureRefunds(
  c: RegistrationClient,
  attempt: any,
  row: any,
  charge: any,
  key: string,
) {
  if (!charge.amount_refunded) return
  const refunds = await stripeList(
    key,
    '/refunds?charge=' + charge.id + '&limit=100',
  )
  for (const refund of refunds) {
    if (
      refund.status !== 'succeeded' ||
      !money(refund.amount) ||
      refund.currency !== charge.currency ||
      idOf(refund.charge) !== charge.id ||
      refund.amount > charge.amount_captured
    )
      continue
    const refundData = {
      ...row.data,
      kind: 'refund',
      status: 'review',
      amountCents: refund.amount,
      paidAt: iso(refund.created),
      originalPaymentId: row.id,
      description: 'Subscription refund · ' + row.data.description,
      receiptUrl: null,
    }
    await c.query(
      'INSERT INTO subscription_expense_payments(id,business_id,data,environment,provider_id,invoice_id,attempt_id) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(environment,provider_id) DO NOTHING',
      [
        randomUUID(),
        attempt.business_id,
        JSON.stringify(refundData),
        attempt.environment,
        refund.id,
        row.invoice_id,
        attempt.id,
      ],
    )
  }
}

/** Runs after paid access reconciliation; every failure is rolled back to its own savepoint. */
export async function syncSubscriptionExpenses(
  c: RegistrationClient,
  attempt: any,
  invoices: any[],
  key: string,
  plans: Record<string, string>,
  refundInvoiceId?: string,
) {
  await c.query('SAVEPOINT subscription_expense_sync')
  try {
    await c.query("SELECT set_config('app.business_id',$1,true)", [
      attempt.business_id,
    ])
    await c.query('SELECT id FROM businesses WHERE id=$1 FOR UPDATE', [
      attempt.business_id,
    ])
    const pref = await preference(c, attempt.business_id)
    if (refundInvoiceId && !invoices.some((i) => i.id === refundInvoiceId))
      invoices = [
        ...invoices,
        await stripeRequest(key, '/invoices/' + refundInvoiceId),
      ]
    for (const invoice of invoices) {
      const known = (
        await c.query(
          'SELECT * FROM subscription_expense_payments WHERE business_id=$1 AND environment=$2 AND invoice_id=$3',
          [attempt.business_id, attempt.environment, invoice.id],
        )
      ).rows
      if (known.length && invoice.id !== refundInvoiceId) {
        for (const original of known.filter((r) => r.data.kind === 'payment')) {
          const charge = await stripeRequest(
            key,
            '/charges/' + original.provider_id,
          )
          if (
            verifiedSubscriptionCharge(
              invoice,
              charge,
              attempt.customer_id,
              attempt.environment,
            )
          )
            await captureRefunds(c, attempt, original, charge, key)
        }
        continue
      }
      if (
        invoice.status !== 'paid' ||
        !money(invoice.amount_paid) ||
        idOf(invoice.customer) !== attempt.customer_id
      )
        continue
      const subscription = idOf(
        invoice.parent?.subscription_details?.subscription ||
          invoice.subscription,
      )
      if (subscription !== attempt.subscription_id) continue
      const payments = invoice.charge
        ? [{ payment: { type: 'charge', charge: invoice.charge } }]
        : await stripeList(
            key,
            `/invoice_payments?invoice=${encodeURIComponent(invoice.id)}&limit=100`,
          )
      if (!Array.isArray(payments)) continue
      for (const payment of payments) {
        let chargeId = idOf(payment.payment?.charge)
        if (payment.payment?.type === 'payment_intent') {
          const pi = await stripeRequest(
            key,
            '/payment_intents/' + idOf(payment.payment.payment_intent),
          )
          if (
            pi.status !== 'succeeded' ||
            idOf(pi.customer) !== attempt.customer_id
          )
            continue
          chargeId = idOf(pi.latest_charge)
        }
        if (!/^ch_[A-Za-z0-9]+$/.test(chargeId || '')) continue
        const charge = await stripeRequest(key, '/charges/' + chargeId)
        if (
          !verifiedSubscriptionCharge(
            invoice,
            charge,
            attempt.customer_id,
            attempt.environment,
          )
        )
          continue
        // A successful charge must belong to this invoice's payment relationship.
        if (invoice.charge && idOf(invoice.charge) !== charge.id) continue
        const lineItems = invoice.lines?.data || []
        const billedLine =
          lineItems
            .filter(
              (l: any) =>
                l.amount > 0 &&
                plans[l.pricing?.price_details?.price || idOf(l.price)],
            )
            .at(-1) ||
          lineItems.find(
            (l: any) => plans[l.pricing?.price_details?.price || idOf(l.price)],
          )
        const price =
          billedLine?.pricing?.price_details?.price || idOf(billedLine?.price)
        const planId = plans[price] || null
        const snapshot = {
          kind: 'payment',
          status: 'available',
          amountCents: charge.amount_captured,
          currency: String(charge.currency).toUpperCase(),
          paidAt: iso(invoice.status_transitions.paid_at),
          planName:
            launchPricing.plans.find((p) => p.id === planId)?.name ||
            'Cottage Pantry subscription',
          payee: String(invoice.account_name || 'Cottage Pantry').slice(0, 200),
          description: String(
            invoice.description ||
              lineItems
                .map((l: any) => l.description)
                .filter(Boolean)
                .join('; ') ||
              'Cottage Pantry subscription',
          ).slice(0, 2000),
          invoiceReference: String(invoice.number || invoice.id),
          receiptUrl: allowedReceipt(
            invoice.hosted_invoice_url || charge.receipt_url,
          ),
          invoiceDetails: {
            subtotal: invoice.subtotal,
            total: invoice.total,
            amountPaid: invoice.amount_paid,
            discounts: invoice.total_discount_amounts || [],
            tax: invoice.total_taxes || invoice.total_tax_amounts || [],
            taxCents: invoice.tax ?? null,
          },
          category: 'Software',
          account: '',
          automatic: false,
        }
        await c.query(
          'INSERT INTO subscription_expense_payments(id,business_id,data,environment,provider_id,invoice_id,attempt_id) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(environment,provider_id) DO NOTHING',
          [
            randomUUID(),
            attempt.business_id,
            JSON.stringify(snapshot),
            attempt.environment,
            charge.id,
            invoice.id,
            attempt.id,
          ],
        )
        let row = (
          await c.query(
            'SELECT * FROM subscription_expense_payments WHERE business_id=$1 AND environment=$2 AND provider_id=$3 FOR UPDATE',
            [attempt.business_id, attempt.environment, charge.id],
          )
        ).rows[0]
        if (!row) fail('This payment needs support review.')
        // Refreshes and opt-in never backfill older payments. A previously seen manual
        // payment is not automatically reclassified when preferences change.
        if (
          pref.enabled &&
          Date.parse(snapshot.paidAt) > Date.parse(pref.enabled_at) &&
          row.data.status === 'available' &&
          !row.data.dismissed
        ) {
          await automaticRecord(c, attempt.business_id, row, pref)
          row = (
            await c.query(
              'SELECT * FROM subscription_expense_payments WHERE business_id=$1 AND id=$2',
              [attempt.business_id, row.id],
            )
          ).rows[0]
        }
        await captureRefunds(c, attempt, row, charge, key)
      }
    }
    await c.query('RELEASE SAVEPOINT subscription_expense_sync')
    return true
  } catch {
    await c.query('ROLLBACK TO SAVEPOINT subscription_expense_sync')
    await c.query('RELEASE SAVEPOINT subscription_expense_sync')
    // No billing data or provider exception is logged. A later verified refresh
    // retries the independent read; access activation is already complete.
    console.error('Subscription expense synchronization requires retry')
    await c.query('SAVEPOINT subscription_expense_diagnostic')
    try {
      await c.query("SELECT set_config('app.business_id',$1,true)", [
        attempt.business_id,
      ])
      await audit(
        c,
        attempt.business_id,
        'subscription-tracking',
        'Subscription expense sync needs retry',
        { attemptId: attempt.id },
      )
      await c.query('RELEASE SAVEPOINT subscription_expense_diagnostic')
    } catch {
      await c.query('ROLLBACK TO SAVEPOINT subscription_expense_diagnostic')
      await c.query('RELEASE SAVEPOINT subscription_expense_diagnostic')
    }
    return false
  }
}

/** Separate transaction from access activation: only committed checkout links qualify. */
export async function synchronizeExpenseAttempt(
  c: RegistrationClient,
  attemptId: string,
  refundInvoiceId?: string,
) {
  await c.query("SELECT set_config('app.billing_worker','true',true)")
  const attempt = (
    await c.query(
      "SELECT * FROM stripe_checkouts WHERE id=$1 AND status IN ('complete','cancelled') AND subscription_id IS NOT NULL AND customer_id IS NOT NULL",
      [attemptId],
    )
  ).rows[0]
  if (
    !attempt ||
    (attempt.environment === 'live' &&
      deploymentRuntime().context !== 'production')
  )
    return
  await c.query("SELECT set_config('app.business_id',$1,true)", [
    attempt.business_id,
  ])
  const settings = await stripeSettings(c, attempt.environment)
  const { key } = openStripe(settings.ciphertext, attempt.environment)
  const invoices = await stripeRequest(
    key,
    '/invoices?subscription=' +
      encodeURIComponent(attempt.subscription_id) +
      '&limit=100',
  )
  const changes = (
    await c.query(
      'SELECT to_price,to_plan FROM stripe_subscription_changes WHERE business_id=$1 AND subscription_id=$2 AND confirmed_at IS NOT NULL',
      [attempt.business_id, attempt.subscription_id],
    )
  ).rows
  return syncSubscriptionExpenses(
    c,
    attempt,
    invoices.data || [],
    key,
    {
      [attempt.price_id]: attempt.plan_id,
      ...Object.fromEntries(
        changes.map((change) => [change.to_price, change.to_plan]),
      ),
    },
    refundInvoiceId,
  )
}

async function record(
  c: RegistrationClient,
  business: string,
  row: any,
  input: any,
  actor: string,
) {
  if (row.data.status === 'recorded') return
  if (row.environment !== 'live' && !input.privateTest)
    fail('Test payments can only be recorded in private test workspaces.')
  if (!(await financeAccess(c, business)))
    fail('Finance is not available for this business’s current plan.')
  if (
    row.environment === 'live' &&
    deploymentRuntime().context !== 'production'
  )
    fail('Record live payments from the main site.')
  const w = await state(c, business),
    p = row.data
  const category = input.category || p.category || 'Software'
  const account = input.account || ''
  const transactionId = row.transaction_id || randomUUID()
  const data = { ...p, category, account }
  if (input.draft) {
    if (row.data.kind === 'refund') {
      await updatePayment(c, business, row, { ...data, status: 'review' })
      return
    }
    await saveWrites(
      c,
      business,
      [
        {
          table: 'finance_transactions',
          record: {
            id: transactionId,
            name: p.payee,
            kind: 'expense',
            date: p.paidAt.slice(0, 10),
            amount:
              p.amountCents /
              10 **
                (new Intl.NumberFormat('en-US', {
                  style: 'currency',
                  currency: p.currency,
                }).resolvedOptions().maximumFractionDigits ?? 2),
            currency: p.currency,
            category,
            account,
            notes: p.description,
            bookkeeping: true,
            status: 'draft',
            subscriptionPaymentId: row.id,
          },
        },
      ],
      actor,
    )
    await updatePayment(
      c,
      business,
      row,
      { ...data, status: 'review' },
      transactionId,
    )
    await audit(c, business, actor, 'Subscription payment saved for review', {
      payment: row.id,
    })
    return
  }
  if (!input.confirmed) fail('Review the payment and confirm before posting.')
  if (!accounts(w).some((a) => a.name === account))
    fail('Choose an available payment account, or save for review.')
  if (!categories(w).some((a) => a.name === category))
    fail('Choose an available expense category.')
  if (p.currency !== (w.settings[0]?.currency || 'USD'))
    fail(
      'This payment uses a different currency. Save it for review; currency conversion is not supported.',
    )
  let plan
  if (p.kind === 'refund') {
    const original = (
      await c.query(
        'SELECT * FROM subscription_expense_payments WHERE business_id=$1 AND id=$2',
        [business, p.originalPaymentId],
      )
    ).rows[0]
    if (!original || original.data.status !== 'recorded')
      fail('Record the original payment before recording its refund.')
    const originalTx = w.finance_transactions.find(
      (t) => t.id === original.transaction_id,
    )
    if (account !== originalTx?.account || category !== originalTx?.category)
      fail(
        'Use the original expense’s payment account and category for this refund.',
      )
    plan = planBookkeeping(
      w,
      'financeBookRefund',
      {
        id: original.transaction_id,
        amount: (p.amountCents / 100).toFixed(2),
        date: p.paidAt.slice(0, 10),
        requestId: 'subscription:' + row.id,
        reason: p.description,
      },
      randomUUID,
    )
  } else {
    plan = planBookkeeping(
      w,
      'financeBookEntry',
      {
        kind: 'expense',
        name: p.payee,
        amount: (p.amountCents / 100).toFixed(2),
        date: p.paidAt.slice(0, 10),
        account,
        category,
        notes: p.description,
        requestId: 'subscription:' + row.id,
      },
      () => randomUUID(),
    )
  }
  const tx = plan.writes.find((x) => x.table === 'finance_transactions')
  if (!tx) return fail('This payment needs review before recording.')
  tx.record = {
    ...tx.record,
    currency: p.currency,
    subscriptionPaymentId: row.id,
    invoiceReference: p.invoiceReference,
    invoiceDetails: p.invoiceDetails,
    receiptUrl: p.receiptUrl,
  }
  await saveWrites(c, business, plan.writes, actor)
  if (row.transaction_id && row.transaction_id !== tx.record.id) {
    // Draft is retained as an auditable link, with no balance impact.
    const draft = w.finance_transactions.find(
      (t) => t.id === row.transaction_id,
    )
    if (draft)
      await saveWrites(
        c,
        business,
        [
          {
            table: 'finance_transactions',
            record: {
              ...draft,
              status: 'superseded',
              postedTransactionId: tx.record.id,
            },
          },
        ],
        actor,
      )
  }
  await updatePayment(
    c,
    business,
    row,
    { ...data, status: 'recorded', automatic: input.automatic === true },
    tx.record.id,
  )
  await audit(
    c,
    business,
    actor,
    p.kind === 'refund'
      ? 'Subscription refund recorded'
      : 'Subscription payment recorded',
    {
      payment: row.id,
      transaction: tx.record.id,
      automatic: input.automatic === true,
    },
  )
}
async function automaticRecord(
  c: RegistrationClient,
  business: string,
  row: any,
  pref: any,
) {
  await c.query('SAVEPOINT subscription_expense_post')
  try {
    await record(
      c,
      business,
      row,
      {
        category: pref.category,
        account: pref.account,
        confirmed: true,
        automatic: true,
      },
      'subscription-tracking',
    )
    await c.query('RELEASE SAVEPOINT subscription_expense_post')
  } catch {
    await c.query('ROLLBACK TO SAVEPOINT subscription_expense_post')
    await c.query('RELEASE SAVEPOINT subscription_expense_post')
    await c.query('SAVEPOINT subscription_expense_draft')
    try {
      await record(
        c,
        business,
        row,
        { category: pref.category, account: pref.account, draft: true },
        'subscription-tracking',
      )
      await c.query('RELEASE SAVEPOINT subscription_expense_draft')
    } catch {
      await c.query('ROLLBACK TO SAVEPOINT subscription_expense_draft')
      await c.query('RELEASE SAVEPOINT subscription_expense_draft')
      await updatePayment(c, business, row, {
        ...row.data,
        status: 'review',
        notice:
          'Choose an available account and category to finish recording this payment.',
      })
    }
  }
}
export async function subscriptionExpenseRequest(
  c: RegistrationClient,
  actor: RegistrationActor,
  input: any,
) {
  const member = await currentMembership(c, actor)
  if (!member || !['Owner', 'Manager'].includes(member.role))
    throw new RegistrationError(
      403,
      'FINANCE_PERMISSION_REQUIRED',
      'Only an Owner or Manager can record business expenses.',
    )
  // Match the workspace accounting lock so statements and corrections serialize.
  await c.query('SELECT id FROM businesses WHERE id=$1 FOR UPDATE', [member.id])
  if (!(await financeAccess(c, member.id))) {
    const old = await preference(c, member.id)
    if (input.action === 'expense_preferences' && input.enabled === false) {
      await c.query(
        'UPDATE subscription_expense_preferences SET enabled=false,updated_by=$2,updated_at=now() WHERE business_id=$1',
        [member.id, actor.id],
      )
      await audit(
        c,
        member.id,
        actor.id,
        'Subscription expense preference changed',
        { before: { enabled: old.enabled }, after: { enabled: false } },
      )
      old.enabled = false
    } else if (input.action !== 'expenses')
      fail('Finance is not available for this business’s current plan.')
    return {
      workspace: { name: member.business_name },
      expenses: {
        available: false,
        preference: { configured: !!old.business_id, enabled: old.enabled },
      },
    }
  }
  let synchronizationPending = false
  if (input.action === 'expenses') {
    const attempts = (
      await c.query(
        "SELECT id FROM stripe_checkouts WHERE business_id=$1 AND status IN ('complete','cancelled') ORDER BY created_at DESC LIMIT 1",
        [member.id],
      )
    ).rows
    for (const attempt of attempts) {
      await c.query('SAVEPOINT subscription_expense_load')
      try {
        synchronizationPending =
          (await synchronizeExpenseAttempt(c, attempt.id)) === false
        await c.query('RELEASE SAVEPOINT subscription_expense_load')
      } catch {
        await c.query('ROLLBACK TO SAVEPOINT subscription_expense_load')
        await c.query('RELEASE SAVEPOINT subscription_expense_load')
        synchronizationPending = true
        console.error('Subscription expense load requires retry')
      }
    }
  }
  const w = await state(c, member.id)
  if (input.action === 'expense_preferences') {
    const enabled = input.enabled === true
    if (
      enabled &&
      (!accounts(w).some((a) => a.name === input.account) ||
        !categories(w).some((a) => a.name === input.category))
    )
      fail(
        'Choose an available default payment account and expense category before turning on automatic recording.',
      )
    const old = await preference(c, member.id)
    await c.query(
      `INSERT INTO subscription_expense_preferences(business_id,enabled,category,account,enabled_at,updated_by) VALUES($1,$2,$3,$4,CASE WHEN $2 THEN now() ELSE NULL END,$5) ON CONFLICT(business_id) DO UPDATE SET enabled=$2,category=$3,account=$4,enabled_at=CASE WHEN $2 AND NOT subscription_expense_preferences.enabled THEN now() ELSE subscription_expense_preferences.enabled_at END,updated_by=$5,updated_at=now()`,
      [
        member.id,
        enabled,
        input.category || old.category,
        input.account || '',
        actor.id,
      ],
    )
    await audit(
      c,
      member.id,
      actor.id,
      'Subscription expense preference changed',
      {
        before: {
          enabled: old.enabled,
          account: old.account,
          category: old.category,
        },
        after: { enabled, account: input.account, category: input.category },
      },
    )
  }
  if (input.action === 'expense_record' || input.action === 'expense_skip') {
    const row = (
      await c.query(
        'SELECT * FROM subscription_expense_payments WHERE business_id=$1 AND id=$2 FOR UPDATE',
        [member.id, input.paymentId],
      )
    ).rows[0]
    if (!row) fail('This payment is not available for this business.')
    if (input.action === 'expense_skip') {
      await updatePayment(c, member.id, row, { ...row.data, dismissed: true })
      await audit(
        c,
        member.id,
        actor.id,
        'Subscription expense offer dismissed',
        { payment: row.id },
      )
    } else
      await record(
        c,
        member.id,
        row,
        { ...input, privateTest: actor.privateTest },
        actor.id,
      )
  }
  const payments = (
    await c.query(
      "SELECT id,data,transaction_id FROM subscription_expense_payments WHERE business_id=$1 AND (environment='live' OR $2) ORDER BY created_at DESC",
      [member.id, actor.privateTest],
    )
  ).rows.map((r) => ({ id: r.id, ...r.data, transactionId: r.transaction_id }))
  const pref = await preference(c, member.id)
  return {
    workspace: { name: member.business_name },
    expenses: {
      available: true,
      notice: synchronizationPending
        ? 'Some payment records could not be refreshed. Try again later. Your subscription and access are unchanged.'
        : '',
      payments,
      preference: {
        enabled: pref.enabled,
        category: pref.category,
        account: pref.account,
      },
      accounts: accounts(w).map((a) => a.name),
      categories: categories(w).map((a) => a.name),
    },
  }
}
