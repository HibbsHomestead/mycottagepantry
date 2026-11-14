/* eslint-disable @typescript-eslint/no-explicit-any -- historical billing row fixtures */
import { describe, expect, it, vi } from 'vitest'
import {
  enforceProviderBilledWrite,
  providerBilledAccess,
  isProviderBilled,
} from '../../netlify/lib/billing-entitlements'

describe.each([
  ['square_sandbox', 'sandbox'],
  ['square_production', 'production'],
  ['stripe_test', 'test'],
  ['stripe_live', 'live'],
])('server-side entitlements for %s', (source, environment) => {
  const now = Date.parse('2026-11-20T00:00:00Z')
  const row = (plan: string, status = 'paid_active') => ({
    plan_id: plan as any,
    status,
    source,
    environment,
    paid_through: '2026-12-06T00:00:00Z',
  })
  const client = (stored?: any) => ({
    query: vi.fn(async () => ({ rows: stored ? [{ data: stored }] : [] })),
  })
  const resaleSave = {
    action: 'save',
    table: 'products',
    data: { id: 'p1', workflow: 'resale', name: 'Mug', price: 1 },
  }
  it('recognizes the saved provider and preserves verified paid coverage', () => {
    expect(isProviderBilled(row('cottage-kitchen'))).toBe(true)
    expect(providerBilledAccess(row('cottage-kitchen'), now)).toMatchObject({
      plan: 'cottage-kitchen',
      write: true,
      paidThrough: '2026-12-06T00:00:00.000Z',
    })
  })
  it('denies a resale write on a lower plan through the direct API', async () => {
    await expect(
      enforceProviderBilledWrite({
        client: client(),
        org: 'oven-a',
        row: row('mixing-bowl'),
        method: 'POST',
        url: new URL('https://x.test/api/workspace'),
        body: resaleSave,
        now,
      }),
    ).rejects.toThrow(/not included in this oven’s current plan/)
  })
  it('allows it on Cottage Mercantile while paid', async () => {
    await expect(
      enforceProviderBilledWrite({
        client: client(),
        org: 'oven-a',
        row: row('cottage-mercantile'),
        method: 'POST',
        url: new URL('https://x.test/api/workspace'),
        body: resaleSave,
        now,
      }),
    ).resolves.toMatchObject({ plan: 'cottage-mercantile' })
  })
  it('classifies from the stored record so a forged body cannot bypass the gate', async () => {
    const c = client({ id: 'p1', workflow: 'resale' })
    await expect(
      enforceProviderBilledWrite({
        client: c,
        org: 'oven-a',
        row: row('mixing-bowl'),
        method: 'POST',
        url: new URL('https://x.test/api/workspace'),
        body: { ...resaleSave, data: { id: 'p1', name: 'Mug' } },
        now,
      }),
    ).rejects.toThrow()
    // Lookups are always scoped to the requesting oven.
    expect((c.query as any).mock.calls[0][1]).toEqual(['oven-a', 'p1'])
  })
  it('keeps refunds and reversals available after a lapse', async () => {
    const lapsed = row('cottage-mercantile', 'expired')
    expect(providerBilledAccess(lapsed, now).plan).toBe('free')
    await expect(
      enforceProviderBilledWrite({
        client: client(),
        org: 'oven-a',
        row: lapsed,
        method: 'POST',
        url: new URL('https://x.test/api/workspace'),
        body: { action: 'refund', table: 'sales', data: { id: 's' } },
        now,
      }),
    ).resolves.toBeTruthy()
  })
  it('does not give paid access for an unpaid pending checkout', () => {
    expect(
      providerBilledAccess(
        { ...row('cottage-kitchen', 'payment_processing'), paid_through: null },
        now,
      ).plan,
    ).toBe('free')
  })
})
