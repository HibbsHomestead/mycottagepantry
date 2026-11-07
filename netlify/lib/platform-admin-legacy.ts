import {
  AdminError,
  adminTransaction,
  audit,
  requireAdmin,
  requireAdminOrigin,
  requireRate,
  requestReference,
  sessionToken,
} from './platform-admin-core'

/** Existing privileged surfaces require the same verified portal session and grant. */
export async function requireLegacyAdmin(request: Request, identity: string) {
  requireAdminOrigin(request)
  await requireRate(
    sessionToken(request) || 'no-session',
    'legacy-admin',
    30,
    60,
  )
  await adminTransaction(async (c) => {
    const session = await requireAdmin(c, request)
    if (session.identity_id !== identity)
      throw new AdminError(
        403,
        'ADMIN_IDENTITY_MISMATCH',
        'Administrator identities do not match.',
      )
    await audit(
      c,
      identity,
      'legacy_admin_access',
      null,
      'success',
      requestReference(),
    )
  })
}
