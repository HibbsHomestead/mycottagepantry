// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
const fixtures = vi.hoisted(() => ({ query: vi.fn(), setup: vi.fn() }))
vi.mock('../../netlify/lib/platform-admin-core', () => ({
  adminTransaction: (fn: (c: unknown) => Promise<unknown>) =>
    fn({ query: fixtures.query }),
}))
vi.mock('../../netlify/lib/stripe-provider', () => ({
  stripeSettings: async () => ({
    ciphertext: 'fixture',
    account_id: 'acct_fixture',
    validated_at: new Date(),
    webhook_verified_at: new Date(),
    configuration: { hostedLaunchReady: true },
  }),
  openStripe: () => ({ key: 'fixture' }),
  stripeRequest: async () => ({ id: 'acct_fixture' }),
}))
vi.mock('../../netlify/lib/stripe-setup', () => ({
  setupStripeBilling: fixtures.setup,
}))
vi.mock('../../netlify/lib/runtime-environment', () => ({
  deploymentRuntime: () => ({ context: 'production' }),
  serverEnvironment: () => 'fixture',
}))
import { prepareHostedStripeLaunch } from '../../netlify/lib/stripe-launch'
afterEach(() => vi.clearAllMocks())
it('recovers connection setup with signed delivery present without approving purchases', async () => {
  fixtures.query.mockResolvedValue({ rows: [] })
  await prepareHostedStripeLaunch()
  expect(fixtures.setup).toHaveBeenCalledOnce()
  const statements = fixtures.query.mock.calls.map(([sql]) => sql).join(' ')
  expect(statements).toContain('checkout_enabled=false')
  expect(statements).not.toContain('checkout_enabled=true')
})
