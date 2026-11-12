// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { randomBytes, createHmac } from 'node:crypto'
const state = vi.hoisted(() => ({
  queries: [] as { sql: string; params: unknown[] }[],
  settings: null as unknown,
  record: null as unknown,
}))
vi.mock('../../netlify/lib/platform-admin-core', () => ({
  AdminError: class extends Error {
    constructor(
      public status: number,
      public code: string,
      message: string,
    ) {
      super(message)
    }
  },
  adminTransaction: async (fn: (c: unknown) => Promise<unknown>) =>
    fn({
      query: async (sql: string, params: unknown[] = []) => {
        state.queries.push({ sql, params })
        if (sql.startsWith('SELECT * FROM stripe_provider_settings'))
          return { rows: [state.settings] }
        if (sql.startsWith('SELECT * FROM stripe_events'))
          return { rows: [state.record] }
        return { rows: [] }
      },
    }),
}))
import webhook from '../../netlify/functions/stripe-webhook.mts'
import { sealStripe } from '../../netlify/lib/stripe-provider'
const root = randomBytes(32).toString('hex'),
  signing = randomBytes(32).toString('hex')
beforeEach(() => {
  vi.stubGlobal('Netlify', { env: { get: () => root } })
  state.queries = []
  state.settings = {
    validated_at: new Date().toISOString(),
    ciphertext: sealStripe({ key: 'sk_test_fixture', signing }, 'test'),
  }
  state.record = {
    id: 'evt_fixture',
    kind: 'invoice.paid',
    environment: 'test',
    status: 'pending',
  }
})
afterEach(() => vi.unstubAllGlobals())
function request(body: string, signature?: string) {
  const t = Math.floor(Date.now() / 1000)
  return new Request('https://mycottagepantry.com/api/stripe/test/webhook', {
    method: 'POST',
    headers: {
      'stripe-signature':
        signature ??
        `t=${t},v1=${createHmac('sha256', signing)
          .update(t + '.' + body)
          .digest('hex')}`,
    },
    body,
  })
}
it('rejects invalid signatures and live/test mismatch before recording events', async () => {
  expect((await webhook(request('{}', 't=0,v1=invalid'))).status).toBe(400)
  expect(
    (
      await webhook(
        request(
          JSON.stringify({
            id: 'evt_fixture',
            type: 'invoice.paid',
            livemode: true,
          }),
        ),
      )
    ).status,
  ).toBe(400)
  expect(state.queries.some((q) => q.sql.startsWith('INSERT'))).toBe(false)
})
it('acknowledges duplicate processed events without reprocessing or fetching provider data', async () => {
  state.record = {
    id: 'evt_fixture',
    environment: 'test',
    kind: 'invoice.paid',
    status: 'processed',
  }
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  expect(
    (
      await webhook(
        request(
          JSON.stringify({
            id: 'evt_fixture',
            type: 'invoice.paid',
            livemode: false,
          }),
        ),
      )
    ).status,
  ).toBe(200)
  expect(fetcher).not.toHaveBeenCalled()
})
it('retains signed delivery evidence and a sanitized retriable processing error', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response('{}', { status: 503 })),
  )
  expect(
    (
      await webhook(
        request(
          JSON.stringify({
            id: 'evt_fixture',
            type: 'invoice.paid',
            livemode: false,
          }),
        ),
      )
    ).status,
  ).toBe(503)
  expect(
    state.queries.some((q) =>
      q.sql.startsWith(
        'UPDATE stripe_provider_settings SET webhook_verified_at',
      ),
    ),
  ).toBe(true)
  expect(
    state.queries.some(
      (q) => q.sql === 'ROLLBACK TO SAVEPOINT stripe_processing',
    ),
  ).toBe(true)
  expect(
    state.queries.some((q) =>
      q.sql.includes("error_code='RECONCILIATION_REQUIRED'"),
    ),
  ).toBe(true)
  expect(JSON.stringify(state.queries)).not.toContain(signing)
})
