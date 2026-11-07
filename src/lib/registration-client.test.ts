import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { readAccountAccess } from './account-access-client'
import { accessDestination } from './access-state'
import { accessFixture } from '../../tests/account-access-fixture'
const transport = vi.fn()
const reference = accessFixture('signed_out').traceId
beforeEach(() => {
  vi.stubGlobal('fetch', transport)
  transport.mockReset()
})
afterEach(() => vi.unstubAllGlobals())
it('sends same-origin cookies and a sanitized correlation reference without signup prices', async () => {
  transport.mockResolvedValue(Response.json(accessFixture('signed_out')))
  expect((await readAccountAccess(reference)).status).toBe('signed_out')
  expect(transport.mock.calls[0]).toEqual([
    '/api/account-access',
    {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'X-Access-Trace': reference },
    },
  ])
})
it.each(['workspace', 'workspace_selection'] as const)(
  'uses the authoritative %s decision',
  async (status) => {
    transport.mockResolvedValue(Response.json(accessFixture(status)))
    expect(accessDestination(await readAccountAccess(reference), 'login')).toBe(
      '/oven',
    )
  },
)
it('keeps a signed-out visitor on login without onboarding', async () => {
  transport.mockResolvedValue(Response.json(accessFixture('signed_out')))
  expect(
    accessDestination(await readAccountAccess(reference), 'login'),
  ).toBeNull()
})
it('does not interpret a failed membership lookup as no oven', async () => {
  transport.mockResolvedValue(Response.json(accessFixture('membership_error')))
  expect(
    accessDestination(await readAccountAccess(reference), 'login'),
  ).toBeNull()
})
it('rejects an HTTP failure or site-protection HTML instead of assigning a new-workspace state', async () => {
  transport.mockResolvedValue(
    new Response('<html>Login required</html>', {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    }),
  )
  await expect(readAccountAccess(reference)).rejects.toThrow(
    'ACCESS_TRANSPORT_FAILED',
  )
  transport.mockResolvedValue(new Response(null, { status: 503 }))
  await expect(readAccountAccess(reference)).rejects.toThrow(
    'ACCESS_TRANSPORT_FAILED',
  )
})
it('keeps network failure retryable', async () => {
  transport.mockRejectedValue(new Error('offline'))
  await expect(readAccountAccess(reference)).rejects.toThrow('offline')
})
