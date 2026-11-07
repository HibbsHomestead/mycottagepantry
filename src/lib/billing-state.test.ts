// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import {
  resolveBillingAccess,
  billingFeatureAllowed,
  type PaidEvidence,
} from '../../netlify/lib/billing-state'
import {
  squareSandboxRequest,
  verifySquareSignature,
} from '../../netlify/lib/square-sandbox'
const now = Date.parse('2026-11-15T00:00:00Z')
const evidence: PaidEvidence = {
  environment: 'sandbox',
  workspaceId: 'workspace-a',
  subscriptionId: 'sub-a',
  planId: 'mixing-bowl',
  invoiceId: 'invoice-a',
  invoiceStatus: 'PAID',
  paymentStatus: 'COMPLETED',
  currency: 'USD',
  chargedCents: 1000,
  requiredCents: 1000,
  periodFrom: '2026-11-01T00:00:00Z',
  periodThrough: '2026-12-01T00:00:00Z',
  verifiedAt: '2026-11-14T00:00:00Z',
  correlationVerified: true,
  periodVerified: true,
  refundedCents: 0,
  disputed: false,
}
const base = {
  workspaceId: 'workspace-a',
  ownerIdentity: 'owner-a',
  emailVerified: true,
  setupComplete: true,
}
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('Real provider requests are forbidden in tests')
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())
it('does not activate from plan intent, redirect or an ACTIVE subscription', () => {
  expect(resolveBillingAccess(base, now).write).toBe(false)
  expect(
    resolveBillingAccess({ ...base, pending: 'payment_processing' }, now).state,
  ).toBe('payment_processing')
  expect(
    resolveBillingAccess(
      { ...base, evidence: { ...evidence, invoiceStatus: 'ACTIVE' } },
      now,
    ).write,
  ).toBe(false)
})
it.each([
  { currency: 'CAD' },
  { paymentStatus: 'PENDING' },
  { invoiceStatus: 'UNPAID' },
  { workspaceId: 'workspace-b' },
  { chargedCents: 999 },
  { requiredCents: 0 },
  { correlationVerified: false },
  { periodVerified: false },
  { disputed: true },
  { refundedCents: 1 },
  { periodThrough: 'invalid' },
  { verifiedAt: 'invalid' },
  { verifiedAt: '2027-01-01' },
])('rejects incomplete or foreign payment evidence %j', (change) => {
  expect(
    resolveBillingAccess({ ...base, evidence: { ...evidence, ...change } }, now)
      .write,
  ).toBe(false)
})
it('activates only settled period coverage and preserves access through confirmed cancellation', () => {
  expect(resolveBillingAccess({ ...base, evidence }, now).state).toBe(
    'paid_active',
  )
  const result = resolveBillingAccess(
    { ...base, evidence, cancelled: true },
    now,
  )
  expect(result.state).toBe('cancelled')
  expect(result.write).toBe(true)
  expect(
    resolveBillingAccess(
      { ...base, evidence, cancelled: true },
      Date.parse('2026-12-02'),
    ).write,
  ).toBe(false)
})
it('uses seven days of grace only after a verified paid period', () => {
  expect(
    resolveBillingAccess({ ...base, evidence }, Date.parse('2026-12-03')).state,
  ).toBe('past_due')
  expect(
    resolveBillingAccess({ ...base, evidence }, Date.parse('2026-12-08')).write,
  ).toBe(false)
  expect(
    resolveBillingAccess(
      { ...base, evidence: { ...evidence, paymentStatus: 'FAILED' } },
      Date.parse('2026-12-03'),
    ).write,
  ).toBe(false)
})
it('never bypasses verification or setup and keeps Free cardless', () => {
  expect(
    resolveBillingAccess(
      { ...base, emailVerified: false, freeActivated: true },
      now,
    ).state,
  ).toBe('email_unverified')
  expect(
    resolveBillingAccess(
      { ...base, setupComplete: false, freeActivated: true },
      now,
    ).state,
  ).toBe('setup_incomplete')
  expect(
    resolveBillingAccess({ ...base, freeActivated: true }, now),
  ).toMatchObject({ state: 'free_active', plan: 'free' })
  expect(fetch).not.toHaveBeenCalled()
})
it('complimentary access survives billing failures only for the verified oven and Owner', () => {
  const grant = {
    workspaceId: 'workspace-a',
    ownerIdentity: 'owner-a',
    plan: 'cottage-kitchen' as const,
    administratorVerified: true,
  }
  const result = resolveBillingAccess(
    {
      ...base,
      grant,
      pending: 'payment_processing',
      evidence: { ...evidence, paymentStatus: 'FAILED' },
    },
    now,
  )
  expect(result.state).toBe('complimentary')
  expect(billingFeatureAllowed(result, 'invitations', 'write')).toBe(false)
  expect(billingFeatureAllowed(result, 'periodComparisons', 'write')).toBe(
    false,
  )
  expect(
    resolveBillingAccess(
      { ...base, grant: { ...grant, ownerIdentity: 'other-owner' } },
      now,
    ).write,
  ).toBe(false)
  expect(
    resolveBillingAccess(
      { ...base, grant: { ...grant, administratorVerified: false } },
      now,
    ).write,
  ).toBe(false)
  expect(fetch).not.toHaveBeenCalled()
})
it('keeps historical reads/export after expiry while denying new writes', () => {
  const result = resolveBillingAccess(
    { ...base, evidence },
    Date.parse('2027-01-01'),
  )
  expect(billingFeatureAllowed(result, 'recipeCosting', 'write')).toBe(false)
  expect(billingFeatureAllowed(result, 'finance', 'read')).toBe(true)
  expect(billingFeatureAllowed(result, 'dataExport', 'export')).toBe(true)
})
it('validates exact Square URL/body signatures and rejects malformed signatures', () => {
  const body = '{"event_id":"fixture"}',
    url = 'https://fixture.netlify.app/api/square/sandbox/webhook',
    key = 'development-fixture'
  const signature = createHmac('sha256', key)
    .update(url + body)
    .digest('base64')
  expect(verifySquareSignature(body, signature, url, key)).toBe(true)
  expect(verifySquareSignature(body + ' ', signature, url, key)).toBe(false)
  expect(verifySquareSignature(body, signature, url + '/changed', key)).toBe(
    false,
  )
  expect(verifySquareSignature(body, 'short', url, key)).toBe(false)
})
it('blocks all Square traffic when Sandbox configuration is absent, including production contexts', async () => {
  vi.stubGlobal('Netlify', { env: { get: () => undefined } })
  await expect(
    squareSandboxRequest('/v2/subscriptions/fixture'),
  ).rejects.toMatchObject({ code: 'SANDBOX_NOT_CONFIGURED' })
  expect(fetch).not.toHaveBeenCalled()
})
it('does not abandon unresolved paid collection when selecting Free', () => {
  const failed = { ...evidence, paymentStatus: 'FAILED' }
  expect(
    resolveBillingAccess(
      { ...base, evidence: failed, freeActivated: true },
      now,
    ).write,
  ).toBe(false)
  expect(
    resolveBillingAccess(
      {
        ...base,
        evidence: failed,
        freeActivated: true,
        providerCollectionResolved: true,
      },
      now,
    ).state,
  ).toBe('free_active')
})
it('uses only the Sandbox origin with an injected transport and supports encoded invoice references', async () => {
  const values: Record<string, string> = {
    CONTEXT: 'deploy-preview',
    REGISTRATION_PRIVATE_TESTS_ENABLED: 'true',
    SQUARE_SANDBOX_ENABLED: 'true',
    SQUARE_SANDBOX_ACCESS_TOKEN: 'development-fixture-only',
    SQUARE_SANDBOX_API_VERSION: '2026-01-22',
  }
  vi.stubGlobal('Netlify', { env: { get: (name: string) => values[name] } })
  const transport = vi
    .fn()
    .mockResolvedValue(
      Response.json({ invoice: { id: 'inv:fixture', status: 'UNPAID' } }),
    )
  await squareSandboxRequest('/v2/invoices/inv%3Afixture', {}, transport)
  expect(transport.mock.calls[0][0]).toBe(
    'https://connect.squareupsandbox.com/v2/invoices/inv%3Afixture',
  )
  expect(fetch).not.toHaveBeenCalled()
})
