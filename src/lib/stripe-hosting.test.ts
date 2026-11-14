// @vitest-environment node
import { randomBytes } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import {
  sealStripe,
  openStripe,
  stripeSettings,
} from '../../netlify/lib/stripe-provider'
import { stripeEncryptionStatus } from '../../netlify/lib/runtime-environment'
const bootstrap = vi.hoisted(() => vi.fn())
vi.mock('../../netlify/lib/stripe-setup', () => ({
  setupStripeBilling: bootstrap,
}))
afterEach(() => {
  bootstrap.mockClear()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})
it('recovers a misplaced credential using authenticated encryption without exposing root material', () => {
  vi.stubGlobal('Netlify', undefined)
  const value = 'sk_test_' + randomBytes(24).toString('hex')
  vi.stubEnv('STRIPE_BILLING_ENCRYPTION_KEY', value)
  const encrypted = sealStripe({ key: 'fixture', signing: '' }, 'test')
  expect(stripeEncryptionStatus().ready).toBe(true)
  expect(JSON.stringify(stripeEncryptionStatus())).not.toContain(value)
  expect(openStripe(encrypted, 'test').key).toBe('fixture')
  expect(() => openStripe(encrypted, 'live')).toThrow()
  vi.stubEnv(
    'STRIPE_BILLING_ENCRYPTION_KEY',
    'sk_test_' + randomBytes(24).toString('hex'),
  )
  expect(() => openStripe(encrypted, 'test')).toThrow()
})
it.each([
  { ciphertext: 'existing' },
  { configuration: { hostingImportDisabled: true } },
])(
  'never replaces existing credentials or reconnects an explicitly disconnected account',
  async (row) => {
    const query = vi.fn().mockResolvedValue({ rows: [row] })
    const transport = vi.fn()
    vi.stubGlobal('fetch', transport)
    expect(await stripeSettings({ query }, 'live')).toBe(row)
    expect(query).toHaveBeenCalledTimes(1)
    expect(transport).not.toHaveBeenCalled()
  },
)
it.each(['', 'production'])(
  'imports matching hosting credentials and bootstraps only trusted deployments (%s)',
  async (context) => {
    vi.stubEnv('CONTEXT', context)
    vi.stubGlobal('Netlify', undefined)
    vi.stubEnv('STRIPE_BILLING_ENCRYPTION_KEY', randomBytes(32).toString('hex'))
    const key = 'sk_live_' + randomBytes(24).toString('hex')
    vi.stubEnv('STRIPE_LIVE_SECRET_KEY', key)
    vi.stubEnv('STRIPE_LIVE_WEBHOOK_SECRET', '')
    let row: Record<string, unknown> = { environment: 'live' }
    const query = vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.startsWith('UPDATE'))
        row = { ...row, ciphertext: params[1], account_id: params[3] }
      return { rows: [row] }
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        Response.json(
          url.endsWith('/account') ? { id: 'acct_fixture' } : { data: [] },
        ),
      ),
    )
    const result = await stripeSettings({ query }, 'live')
    expect(result.account_id).toBe('acct_fixture')
    expect(result.ciphertext).not.toContain(key)
    expect(openStripe(result.ciphertext, 'live').key).toBe(key)
    expect(bootstrap).toHaveBeenCalledTimes(context === 'production' ? 1 : 0)
  },
)
