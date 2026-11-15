// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ events: [] as string[], sync: vi.fn() }))
vi.mock('../../netlify/lib/platform-admin-core', () => ({
  adminTransaction: async (fn: (c: unknown) => Promise<unknown>) => {
    state.events.push('begin')
    try {
      const result = await fn({
        query: async (sql: string) => ({
          rows: sql.startsWith('SELECT * FROM stripe_events')
            ? [
                {
                  id: 'evt_fixture',
                  kind: 'invoice.paid',
                  environment: 'live',
                  status: 'pending',
                },
              ]
            : [],
        }),
      })
      state.events.push('commit')
      return result
    } catch (error) {
      state.events.push('rollback')
      throw error
    }
  },
}))
vi.mock('../../netlify/lib/stripe-provider', () => ({
  stripeSettings: async () => ({
    ciphertext: 'fixture',
    validated_at: '2026-01-01',
  }),
  openStripe: () => ({ signing: 'fixture' }),
  verifyStripeSignature: () => true,
}))
vi.mock('../../netlify/lib/stripe-subscriptions', () => ({
  processStripeEvent: async () => [{ id: 'attempt-fixture' }],
}))
vi.mock('../../netlify/lib/subscription-expenses', () => ({
  synchronizeExpenseAttempt: state.sync,
}))
import webhook from '../../netlify/functions/stripe-webhook.mts'
beforeEach(() => {
  state.events = []
  state.sync.mockReset()
})
it('commits paid access before bookkeeping and acknowledges successful billing when bookkeeping fails', async () => {
  state.sync.mockImplementation(async () => {
    expect(state.events).toEqual(['begin', 'commit', 'begin'])
    throw new Error('Synthetic bookkeeping outage')
  })
  const result = await webhook(
    new Request('https://example.invalid/api/stripe/live/webhook', {
      method: 'POST',
      body: JSON.stringify({
        id: 'evt_fixture',
        type: 'invoice.paid',
        livemode: true,
      }),
    }),
  )
  expect(result.status).toBe(200)
  expect(await result.json()).toEqual({ status: 'ok' })
  expect(state.events).toEqual(['begin', 'commit', 'begin', 'rollback'])
})
