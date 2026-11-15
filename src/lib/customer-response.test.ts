// @vitest-environment node
import { expect, it, vi } from 'vitest'
vi.mock('../../netlify/lib/account-access', () => ({
  resolveAccountAccess: vi.fn(async () => ({
    status: 'email_unverified',
    reason: 'EMAIL_UNVERIFIED',
    traceId: '00000000-0000-4000-8000-000000000001',
    membership: null,
    memberships: [],
    privateTest: false,
    events: [{ stage: 'session_verification', result: 'internal-evidence' }],
    environment: {
      origin: 'https://app.test',
      deploymentId: 'private-deployment',
      context: 'production',
    },
  })),
}))
import accountAccess from '../../netlify/functions/account-access.mts'
it('keeps verification routing while omitting internal evidence from the customer response', async () => {
  const response = await accountAccess(
    new Request('https://app.test/api/account-access'),
  )
  const body = await response.json()
  expect(body.status).toBe('email_unverified')
  expect(body.events).toEqual([])
  expect(body.reason).toBe('')
  expect(JSON.stringify(body)).not.toMatch(
    /EMAIL_UNVERIFIED|internal-evidence|private-deployment/,
  )
  expect(response.headers.get('cache-control')).toContain('no-store')
})
