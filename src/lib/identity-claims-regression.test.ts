// @vitest-environment node
import { getUser } from '@netlify/identity'
import { afterEach, expect, it, vi } from 'vitest'
afterEach(() => vi.unstubAllGlobals())
it('demonstrates that SDK claims-only fallback does not establish email verification status', async () => {
  vi.stubGlobal('netlifyIdentityContext', {
    user: { sub: 'synthetic-verified-context', app_metadata: { roles: [] } },
  })
  const user = await getUser()
  expect(user?.id).toBe('synthetic-verified-context')
  expect(user).not.toHaveProperty('confirmedAt')
  // The superseded guard interpreted this unknown value as false.
  expect(!user?.confirmedAt).toBe(true)
})
