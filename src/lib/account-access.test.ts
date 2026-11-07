// @vitest-environment node
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
const runtime = vi.hoisted(() => ({
  user: null as any,
  failure: false,
  memberships: [] as any[],
  membershipFailure: false,
  diagnostic: null as { stage: string; httpStatus?: number } | null,
}))
vi.mock('../../netlify/lib/verified-session', () => ({
  verifiedSession: async (
    _request: Request,
    diagnose?: (value: any) => void,
  ) => {
    if (runtime.diagnostic) diagnose?.(runtime.diagnostic)
    if (runtime.failure) throw new Error('private provider details')
    return runtime.user
  },
  selectedWorkspace: () => undefined,
}))
vi.mock('../../netlify/lib/registration-core', () => ({
  privateRegistrationEnabled: () => false,
  registrationTransaction: async (_actor: any, callback: any) => callback({}),
  workspaceAccess: async () => {
    if (runtime.membershipFailure) throw new Error('private database details')
    return {
      membership:
        runtime.memberships.length === 1 ? runtime.memberships[0] : null,
      memberships: runtime.memberships,
      privateTest: false,
    }
  },
}))
import { resolveAccountAccess } from '../../netlify/lib/account-access'
const reference = 'b5b2cac8-b9a1-42e8-a8d7-318a6832c28b'
const request = () =>
  new Request('https://mycottagepantry.netlify.app/api/account-access', {
    headers: { 'X-Access-Trace': reference },
  })
beforeEach(() => {
  runtime.user = null
  runtime.failure = false
  runtime.diagnostic = null
  runtime.membershipFailure = false
  runtime.memberships = []
  vi.spyOn(console, 'info').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())
it('keeps signed out separate from provider and membership errors', async () => {
  expect((await resolveAccountAccess(request())).status).toBe('signed_out')
  runtime.failure = true
  expect((await resolveAccountAccess(request())).status).toBe('identity_error')
  runtime.failure = false
  runtime.user = {
    id: 'private-identity',
    email: 'private@example.invalid',
    confirmedAt: '2026-01-01T00:00:00Z',
    roles: [],
  }
  runtime.membershipFailure = true
  expect((await resolveAccountAccess(request())).status).toBe(
    'membership_error',
  )
})
it('keeps a genuinely unverified provider response in an explicit verification state', async () => {
  runtime.user = {
    id: 'private-identity',
    email: 'private@example.invalid',
    roles: [],
  }
  expect((await resolveAccountAccess(request())).status).toBe(
    'email_unverified',
  )
})
it('does not call malformed confirmation data an unverified account', async () => {
  runtime.user = {
    id: 'private-identity',
    email: 'private@example.invalid',
    roles: [],
    confirmedAt: 'invalid',
  }
  expect((await resolveAccountAccess(request())).status).toBe('identity_error')
})
it('resolves an ordinary Owner without a platform-admin or billing dependency', async () => {
  runtime.user = {
    id: 'private-identity',
    email: 'private@example.invalid',
    roles: [],
    confirmedAt: '2026-01-01T00:00:00Z',
  }
  runtime.memberships = [
    { id: 'private-workspace', name: 'Private Business', role: 'Owner' },
  ]
  const result = await resolveAccountAccess(request())
  expect(result.status).toBe('workspace')
  expect(result.traceId).toBe(reference)
  expect(result.events.map((e) => e.stage)).toEqual([
    'backend_identity',
    'membership_lookup',
    'membership_lookup',
    'workspace_resolution',
    'access_decision',
  ])
  const logs = JSON.stringify(vi.mocked(console.info).mock.calls)
  for (const privateValue of [
    'private-identity',
    'private-workspace',
    'private@example.invalid',
    'Private Business',
  ])
    expect(logs).not.toContain(privateValue)
})
it('keeps no membership distinct from multiple memberships', async () => {
  runtime.user = {
    id: 'private-identity',
    email: 'private@example.invalid',
    roles: [],
    confirmedAt: '2026-01-01T00:00:00Z',
  }
  expect((await resolveAccountAccess(request())).status).toBe('no_workspace')
  runtime.memberships = [{ id: 'one' }, { id: 'two' }]
  expect((await resolveAccountAccess(request())).status).toBe(
    'workspace_selection',
  )
})
it('replaces untrusted correlation input without logging it', async () => {
  const result = await resolveAccountAccess(
    new Request('https://example.test/api/account-access', {
      headers: { 'X-Access-Trace': 'private-untrusted-value' },
    }),
  )
  expect(result.traceId).not.toBe('private-untrusted-value')
  expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain(
    'private-untrusted-value',
  )
})

it('correlates safe session diagnostics while keeping provider failures denied', async () => {
  runtime.failure = true
  runtime.diagnostic = { stage: 'http', httpStatus: 503 }
  const result = await resolveAccountAccess(request())
  expect(result.status).toBe('identity_error')
  expect(result.reason).toBe('IDENTITY_UNAVAILABLE')
  expect(result.events[0]).toEqual({
    stage: 'session_verification',
    result: 'http_failed',
    httpStatus: 503,
  })
  expect(JSON.stringify(vi.mocked(console.info).mock.calls)).toContain(
    reference,
  )
  expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain(
    'private provider details',
  )
  expect(result.membership).toBeNull()
})
