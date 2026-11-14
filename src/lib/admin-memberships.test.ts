// @vitest-environment node
import { expect, it, vi } from 'vitest'
vi.mock('@netlify/identity', () => ({
  admin: {
    getUser: vi.fn(async (id: string) => ({ id, confirmedAt: '2026-01-01' })),
  },
}))
import { adminMembership } from '../../netlify/lib/admin-memberships'
const id = '10000000-0000-4000-8000-000000000001'
function request(active = true, role = 'Manager') {
  return new Request('https://admin.mycottagepantry.com/api/admin', {
    method: 'POST',
    body: JSON.stringify({
      businessId: id,
      memberId: 'fixture-member',
      role,
      active,
      reason: 'Reviewed disposable membership',
      confirm: true,
    }),
  })
}
function client(primary = false, missing = false, reactivate = false) {
  return {
    release: vi.fn(),
    query: vi.fn(async (sql: string) => {
      if (sql.startsWith('SELECT id,identity_owner'))
        return { rows: [{ id, identity_owner: 'primary' }] }
      if (sql.startsWith('SELECT id,identity_id,role,active'))
        return {
          rows: missing
            ? []
            : [
                {
                  id: 'fixture-member',
                  identity_id: primary ? 'primary' : 'member',
                  role: primary ? 'Owner' : 'Production Staff',
                  active: !reactivate,
                },
              ],
        }
      if (sql.includes('count(*)::int')) return { rows: [{ count: 0 }] }
      if (sql.startsWith('SELECT plan_id,status'))
        return {
          rows: [
            {
              plan_id: 'cottage-kitchen',
              source: 'stripe_live',
              status: 'paid_active',
              paid_through: '2028-01-01',
              environment: 'live',
            },
          ],
        }
      if (sql.includes('count(DISTINCT')) return { rows: [{ count: 2 }] }
      return { rows: [] }
    }),
  }
}
const session = {
  role: 'owner',
  verified_at: new Date().toISOString(),
  verification_method: 'totp',
  mfa_at: '2026-11-12',
  identity_id: 'admin',
}
it('protects the primary/last required owner and rejects missing cross-business targets', async () => {
  for (const c of [client(true), client(false, true)]) {
    await expect(
      adminMembership(c, request(false), session, 'fixture'),
    ).rejects.toThrow()
    expect(
      c.query.mock.calls.some(([sql]) => sql.startsWith('UPDATE users')),
    ).toBe(false)
  }
})
it('checks the shared effective tier limit before reactivation and preserves existing members', async () => {
  const c = client(false, false, true)
  await expect(
    adminMembership(c, request(), session, 'fixture'),
  ).rejects.toThrow('member limit')
  expect(
    c.query.mock.calls.some(
      ([sql]) => sql.startsWith('UPDATE users') || sql.startsWith('DELETE'),
    ),
  ).toBe(false)
})
it('applies supported roles with an audit record rather than changing Identity ownership', async () => {
  const c = client()
  await expect(
    adminMembership(c, request(), session, 'fixture'),
  ).resolves.toEqual({ applied: true })
  expect(
    c.query.mock.calls.some(([sql]) => sql.startsWith('UPDATE users')),
  ).toBe(true)
  expect(
    c.query.mock.calls.some(([sql]) =>
      sql.startsWith('INSERT INTO platform_audit'),
    ),
  ).toBe(true)
})
