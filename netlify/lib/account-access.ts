import { randomUUID } from 'node:crypto'
import { verifiedSession, selectedWorkspace } from './verified-session'
import {
  privateRegistrationEnabled,
  registrationTransaction,
  workspaceAccess,
  type RegistrationActor,
} from './registration-core'
import {
  tracePattern,
  type AccountAccess,
  type AccessEvent,
  type AccessStatus,
} from '../../src/lib/access-state'

/** Read-only account resolution, shared by every account entry page. */
export async function resolveAccountAccess(
  request: Request,
): Promise<AccountAccess> {
  const supplied = request.headers.get('X-Access-Trace')
  const traceId =
    supplied && tracePattern.test(supplied) ? supplied : randomUUID()
  const deploy = globalThis.Netlify?.context?.deploy
  const result: AccountAccess = {
    status: 'signed_out',
    reason: 'SIGN_IN_REQUIRED',
    traceId,
    membership: null,
    memberships: [],
    privateTest: false,
    events: [],
    environment: {
      origin: new URL(request.url).origin,
      deploymentId: deploy?.id || null,
      context: deploy?.context || null,
    },
  }
  function event(
    stage: AccessEvent['stage'],
    outcome: string,
    httpStatus?: number,
    diagnostic: Pick<
      AccessEvent,
      'category' | 'attempt' | 'elapsedMs' | 'retrying' | 'endpointHost'
    > = {},
  ) {
    const details = {
      ...diagnostic,
      ...(httpStatus === undefined ? {} : { httpStatus }),
    }
    result.events.push({ stage, result: outcome, ...details })
    // Allowlisted diagnostics and endpoint hostname only. No identity data or credentials.
    console.info(
      JSON.stringify({
        area: 'account_access',
        traceId,
        deploymentId: deploy?.id || null,
        context: deploy?.context || null,
        stage,
        result: outcome,
        ...details,
      }),
    )
  }
  function finish(status: AccessStatus, reason: string) {
    result.status = status
    result.reason = reason
    event('access_decision', status + ':' + reason)
    return result
  }
  let user
  try {
    user = await verifiedSession(
      request,
      ({ stage, httpStatus, ...diagnostic }) => {
        event('session_verification', stage + '_failed', httpStatus, diagnostic)
      },
    )
  } catch {
    event('backend_identity', 'provider_error')
    return finish('identity_error', 'IDENTITY_UNAVAILABLE')
  }
  if (!user) {
    event('backend_identity', 'signed_out')
    return finish('signed_out', 'SIGN_IN_REQUIRED')
  }
  event('backend_identity', 'authenticated')
  // This is the full provider /user response, never the SDK's claims-only fallback.
  if (!user.confirmedAt) return finish('email_unverified', 'EMAIL_UNVERIFIED')
  if (!Number.isFinite(Date.parse(user.confirmedAt)))
    return finish('identity_error', 'IDENTITY_RESPONSE_INVALID')
  const platformAdmin = user.roles.includes('platform_admin')
  const actor: RegistrationActor = {
    id: user.id,
    email: user.email,
    platformAdmin,
    privateTest: platformAdmin && privateRegistrationEnabled(),
    selectedWorkspaceId: selectedWorkspace(request),
  }
  event('membership_lookup', 'loading')
  try {
    const access = await registrationTransaction(actor, (client) =>
      workspaceAccess(client, actor),
    )
    result.membership = access.membership
    result.memberships = access.memberships
    result.privateTest = access.privateTest
    event('membership_lookup', access.memberships.length ? 'found' : 'none')
    if (access.membership) {
      event('workspace_resolution', 'authorized')
      return finish('workspace', 'ACTIVE_MEMBERSHIP')
    }
    if (access.memberships.length) {
      event('workspace_resolution', 'selection_required')
      return finish('workspace_selection', 'WORKSPACE_SELECTION_REQUIRED')
    }
    return finish(
      'no_workspace',
      actor.privateTest ? 'PRIVATE_SETUP_AVAILABLE' : 'FREE_SETUP_AVAILABLE',
    )
  } catch (error) {
    if ((error as { code?: string }).code === 'MEMBERSHIP_INACTIVE') {
      event('membership_lookup', 'inactive')
      return finish('access_denied', 'MEMBERSHIP_INACTIVE')
    }
    event('membership_lookup', 'error')
    return finish('membership_error', 'MEMBERSHIP_UNAVAILABLE')
  }
}
