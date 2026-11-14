// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AdminMetadata } from './platform-admin-types'
const fixture = vi.hoisted(() => ({
  context: 'production',
  settings: {} as AdminMetadata,
}))
vi.mock('../../netlify/lib/platform-admin-core', async (original) => ({
  ...(await original<typeof import('../../netlify/lib/platform-admin-core')>()),
  adminTransaction: (fn: (c: unknown) => Promise<unknown>) => fn({}),
}))
vi.mock('../../netlify/lib/stripe-provider', async (original) => ({
  ...(await original<typeof import('../../netlify/lib/stripe-provider')>()),
  stripeSettings: () => fixture.settings,
}))
import handler from '../../netlify/functions/stripe-billing.mts'
beforeEach(() =>
  vi.stubGlobal('Netlify', {
    env: {
      get: (key: string) => (key === 'CONTEXT' ? fixture.context : undefined),
    },
  }),
)
afterEach(() => {
  fixture.context = 'production'
  vi.unstubAllGlobals()
})
const settings = () => ({
  account_id: 'acct_fixture',
  validated_at: '2026-11-14',
  webhook_verified_at: '2026-11-14',
  checkout_enabled: true,
  configuration: {
    liveCheckoutApprovedAt: '2026-11-14T00:00:00Z',
    policy: {},
    mappings: {
      'mixing-bowl': {
        purchase: true,
        verifiedAt: '2026-11-14',
        account: 'acct_fixture',
      },
      'cottage-mercantile': {
        purchase: true,
        verifiedAt: '2026-11-14',
        account: 'acct_fixture',
      },
    },
  },
})
const available = async () => {
  const result = await handler(
    new Request(
      'https://mycottagepantry.com/api/stripe/billing?view=availability',
    ),
  )
  expect(result.status).toBe(200)
  expect(result.headers.get('cache-control')).toContain('no-store')
  return result.json()
}
it('keeps public presentation separate from live tier approval even with stale enabled mappings', async () => {
  fixture.settings = settings()
  expect(await available()).toEqual({ plans: ['mixing-bowl'] })
})
it('never advertises live checkout from a preview or incomplete provider configuration', async () => {
  fixture.settings = settings()
  fixture.context = 'deploy-preview'
  expect(await available()).toEqual({ plans: [] })
  fixture.context = 'production'
  for (const change of [
    { checkout_enabled: false },
    { validated_at: null },
    { webhook_verified_at: null },
    { configuration: { apiError: 'failed' } },
  ]) {
    fixture.settings = { ...settings(), ...change }
    expect(await available()).toEqual({ plans: [] })
  }
})
it('requires mappings verified for the connected Stripe account', async () => {
  fixture.settings = settings()
  fixture.settings.configuration.mappings['mixing-bowl'].account = 'acct_other'
  expect(await available()).toEqual({ plans: [] })
  fixture.settings = settings()
  delete fixture.settings.configuration.mappings['mixing-bowl'].verifiedAt
  expect(await available()).toEqual({ plans: [] })
})

it('never treats old automatic launch readiness as explicit live checkout approval', async () => {
  fixture.settings = settings()
  delete fixture.settings.configuration.liveCheckoutApprovedAt
  fixture.settings.configuration.hostedLaunchReady = true
  expect(await available()).toEqual({ plans: [] })
})
