import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useRegistrationPolicy } from './registration-policy-client'
import { registrationRequest } from './registration-client'
afterEach(() => vi.unstubAllGlobals())

it('distinguishes unpublished policies from a failed or malformed check and retries without caching failure', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ policy: null }))
    .mockResolvedValueOnce(
      new Response('<html>Unavailable</html>', {
        headers: { 'content-type': 'text/html' },
      }),
    )
    .mockResolvedValueOnce(
      Response.json({
        policy: {
          revision: 'fixture-v2',
          terms: 'Synthetic Terms',
          privacy: 'Synthetic Privacy',
        },
      }),
    )
  vi.stubGlobal('fetch', fetch)
  const { result } = renderHook(useRegistrationPolicy)
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.policy).toBeNull()
  expect(result.current.error).toBe('')
  act(() => result.current.retry())
  await waitFor(() =>
    expect(result.current.error).toContain('could not be checked'),
  )
  act(() => result.current.retry())
  await waitFor(() =>
    expect(result.current.policy?.revision).toBe('fixture-v2'),
  )
  expect(result.current.error).toBe('')
  expect(fetch.mock.calls[0]).toEqual([
    '/api/registration?view=policies',
    expect.objectContaining({
      credentials: 'same-origin',
      cache: 'no-store',
      signal: expect.any(AbortSignal),
    }),
  ])
})

it('returns field validation errors and makes timeouts actionable', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json(
        {
          code: 'INVALID_REGISTRATION_INPUT',
          error: 'Check your business details.',
          fields: { 'profile.timezone': 'Choose a valid timezone.' },
        },
        { status: 400 },
      ),
    )
    .mockRejectedValueOnce(new DOMException('Timed out', 'TimeoutError'))
  vi.stubGlobal('fetch', fetch)
  await expect(registrationRequest('free', {})).rejects.toMatchObject({
    code: 'INVALID_REGISTRATION_INPUT',
    status: 400,
    fields: { 'profile.timezone': 'Choose a valid timezone.' },
  })
  await expect(registrationRequest('policies')).rejects.toThrow(
    'Retry; your entered details are preserved',
  )
})
