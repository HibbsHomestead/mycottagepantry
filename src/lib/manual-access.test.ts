// @vitest-environment node
import { expect, it } from 'vitest'
import {
  effectiveAccess,
  assignableTierIssue,
  type ManualGrant,
} from '../../netlify/lib/manual-access'
import { planWriteAllowed } from '../../netlify/lib/billing-state'
const grant: ManualGrant = {
  id: 'test',
  plan_id: 'cottage-kitchen',
  operation: 'grant',
  grant_source: 'test',
  owner_identity: 'owner',
  actor_identity: 'admin',
  reason: 'Disposable access check',
  created_at: '2026-01-01',
  expires_at: '2027-01-01',
}
const billing = {
  plan_id: 'mixing-bowl' as const,
  status: 'paid_active',
  source: 'square_sandbox',
  paid_through: '2028-01-01',
  environment: 'sandbox',
  entitlement_policy: 'kitchen-two-v1' as const,
}
it('uses manual precedence without modifying billing, and restores fallback on expiration, revocation and owner mismatch', () => {
  const before = JSON.stringify(billing),
    now = Date.parse('2026-11-10')
  const active = effectiveAccess(billing, grant, 'owner', now)
  expect(active.plan).toBe('cottage-kitchen')
  expect(active.source).toBe('test')
  expect(planWriteAllowed(active.access!, 'resaleModule')).toBe(false)
  expect(
    effectiveAccess(billing, { ...grant, operation: 'revoke' }, 'owner', now)
      .plan,
  ).toBe('mixing-bowl')
  expect(
    effectiveAccess(billing, grant, 'owner', Date.parse('2027-02-01')).plan,
  ).toBe('mixing-bowl')
  expect(effectiveAccess(billing, grant, 'other', now).plan).toBe('mixing-bowl')
  expect(
    effectiveAccess({ ...billing, status: 'suspended' }, grant, 'owner', now)
      .access?.write,
  ).toBe(false)
  expect(JSON.stringify(billing)).toBe(before)
  expect(effectiveAccess(null, null, 'owner', now)).toMatchObject({
    plan: null,
    legacy: true,
    source: 'unassigned',
  })
  expect(
    effectiveAccess(null, { ...grant, operation: 'revoke' }, 'owner', now).plan,
  ).toBeNull()
  expect(assignableTierIssue('cottage-mercantile')).toMatch(/configuration/)
})
