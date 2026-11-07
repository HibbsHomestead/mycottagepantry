import type { AccountAccess, AccessStatus } from '../src/lib/access-state'
export function accessFixture(
  status: AccessStatus,
  patch: Partial<AccountAccess> = {},
): AccountAccess {
  return {
    status,
    reason: 'TEST',
    traceId: 'b5b2cac8-b9a1-42e8-a8d7-318a6832c28b',
    membership: null,
    memberships: [],
    privateTest: false,
    events: [],
    environment: {
      origin: 'https://example.test',
      deploymentId: null,
      context: null,
    },
    ...patch,
  }
}
