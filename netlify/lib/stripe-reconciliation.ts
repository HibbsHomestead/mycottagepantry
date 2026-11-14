import { createHmac, timingSafeEqual } from 'node:crypto'
import { getDatabase } from '@netlify/database'
import type { AdminClient } from './platform-admin-core'
import {
  processStripeEvent,
  reconcileStripeCheckout,
} from './stripe-subscriptions'
import { stripeEncryptionReady, stripeSettings } from './stripe-provider'

const env = (name: string) => globalThis.Netlify?.env?.get(name) || ''
const path = '/.netlify/functions/stripe-test-reconcile-background'
function signature(origin: string, timestamp: string) {
  return createHmac(
    'sha256',
    Buffer.from(env('STRIPE_BILLING_ENCRYPTION_KEY'), 'hex'),
  )
    .update(`stripe-test-reconcile:v1:${origin}:${timestamp}`)
    .digest('hex')
}
export function verifyStripeDispatch(request: Request, timestamp: string) {
  if (
    !stripeEncryptionReady() ||
    !/^\d{13}$/.test(timestamp) ||
    Math.abs(Date.now() - Number(timestamp)) > 120000
  )
    return false
  const expected = Buffer.from(
    signature(new URL(request.url).origin, timestamp),
  )
  const received = Buffer.from(
    request.headers.get('x-cp-stripe-signature') || '',
  )
  return (
    received.length === expected.length && timingSafeEqual(received, expected)
  )
}
export async function dispatchStripeTestReconciliation(transport = fetch) {
  if (!stripeEncryptionReady() || env('CONTEXT') !== 'production')
    return new Response(null, { status: 204 })
  const origin = 'https://mycottagepantry.com'
  const timestamp = String(Date.now())
  const response = await transport(origin + path, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
    headers: {
      'Content-Type': 'application/json',
      'x-cp-stripe-signature': signature(origin, timestamp),
    },
    body: JSON.stringify({ timestamp }),
  })
  return new Response(null, { status: response.ok ? 204 : 503 })
}

/** Canonical reads only. Never activates checkout or touches live provider records. */
export async function reconcileStripeTestBatch(c: AdminClient) {
  await c.query("SELECT set_config('app.billing_worker','true',true)")
  const settings = await stripeSettings(c, 'test')
  if (!settings?.ciphertext || !settings.validated_at)
    return { processed: 0, failed: 0 }
  let processed = 0,
    failed = 0
  const events = (
    await c.query(
      "SELECT * FROM stripe_events WHERE environment='test' AND status IN ('pending','failed') ORDER BY attempts,received_at LIMIT 5 FOR UPDATE SKIP LOCKED",
    )
  ).rows
  for (const event of events) {
    await c.query('SAVEPOINT stripe_retry')
    try {
      await processStripeEvent(c, event)
      processed++
      await c.query('RELEASE SAVEPOINT stripe_retry')
    } catch {
      await c.query('ROLLBACK TO SAVEPOINT stripe_retry')
      await c.query(
        "UPDATE stripe_events SET status='failed',attempts=attempts+1,error_code='RECONCILIATION_REQUIRED' WHERE id=$1",
        [event.id],
      )
      await c.query('RELEASE SAVEPOINT stripe_retry')
      failed++
    }
  }
  const attempts = (
    await c.query(
      "SELECT * FROM stripe_checkouts WHERE environment='test' AND session_id IS NOT NULL AND status IN ('creating','open','complete','cancelled') AND (reconciled_at IS NULL OR reconciled_at < NOW() - INTERVAL '1 hour') ORDER BY reconciled_at NULLS FIRST,created_at LIMIT 5 FOR UPDATE SKIP LOCKED",
    )
  ).rows
  for (const attempt of attempts) {
    await c.query('SAVEPOINT stripe_sweep')
    try {
      await reconcileStripeCheckout(c, attempt)
      await c.query(
        'UPDATE stripe_checkouts SET reconciled_at=NOW(),error_code=NULL WHERE id=$1',
        [attempt.id],
      )
      await c.query('RELEASE SAVEPOINT stripe_sweep')
      processed++
    } catch {
      await c.query('ROLLBACK TO SAVEPOINT stripe_sweep')
      // Track the attempt time so one broken link cannot starve the sweep.
      await c.query(
        "UPDATE stripe_checkouts SET reconciled_at=NOW(),error_code='RECONCILIATION_REQUIRED' WHERE id=$1",
        [attempt.id],
      )
      await c.query('RELEASE SAVEPOINT stripe_sweep')
      failed++
    }
  }
  return { processed, failed }
}
export async function stripeTestReconciliationWorker() {
  const client = await getDatabase().pool.connect()
  try {
    await client.query('BEGIN')
    // Avoid overlapping jobs and lock-order inversions with checkout/webhook work.
    await client.query("SET LOCAL lock_timeout='2s'")
    const lock = await client.query(
      'SELECT pg_try_advisory_xact_lock(717, 280) AS acquired',
    )
    if (!lock.rows[0]?.acquired) {
      await client.query('ROLLBACK')
      return
    }
    await reconcileStripeTestBatch(client)
    await client.query('COMMIT')
  } catch {
    await client.query('ROLLBACK')
    throw new Error('STRIPE_TEST_RECONCILIATION_RETRY')
  } finally {
    client.release()
  }
}
