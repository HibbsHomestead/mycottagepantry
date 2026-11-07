import { getIdentityConfig, refreshSession } from '@netlify/identity'

export class SessionError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message)
  }
}

export function selectedWorkspace(request: Request) {
  const value = request.headers
    .get('cookie')
    ?.match(/(?:^|;\s*)cp_selected_workspace=([^;]*)/)?.[1]
  return value && /^[a-f0-9-]{36}$/i.test(value) ? value : undefined
}

export type SessionDiagnostic = {
  stage: 'refresh' | 'network' | 'http' | 'json' | 'response_shape'
  httpStatus?: number
  category?: 'timeout' | 'dns' | 'connection' | 'tls' | 'network' | 'unknown'
  attempt?: number
  elapsedMs?: number
  retrying?: boolean
  endpointHost?: string
}

/** A second route to this site's Identity, derived only from trusted runtime metadata. */
function identityAlternate(endpoint: URL, request: Request): URL | undefined {
  const context = globalThis.Netlify?.context
  const site = context?.site
  if (
    context?.deploy?.context !== 'production' ||
    !site?.name ||
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(site.name) ||
    !site.url ||
    endpoint.protocol !== 'https:' ||
    endpoint.pathname !== '/.netlify/identity/user' ||
    endpoint.hostname.endsWith('.netlify.app')
  )
    return
  // Do not redirect credentials from a distinct provider, another site, or a
  // preview to production. Only the site's own primary custom-domain route qualifies.
  if (
    endpoint.origin !== new URL(site.url).origin ||
    endpoint.origin !== new URL(request.url).origin
  )
    return
  return new URL(`https://${site.name}.netlify.app/.netlify/identity/user`)
}

// Read structured transport codes only. Error messages may contain private data.
export function verificationFailure(
  error: unknown,
  timedOut = false,
): NonNullable<SessionDiagnostic['category']> {
  if (timedOut) return 'timeout'
  let current = error as
    { code?: string; name?: string; cause?: unknown } | undefined
  for (let depth = 0; current && depth < 4; depth++) {
    const code = typeof current.code === 'string' ? current.code : ''
    if (['ENOTFOUND', 'EAI_AGAIN'].includes(code)) return 'dns'
    if (
      [
        'ECONNRESET',
        'ECONNREFUSED',
        'EPIPE',
        'ENETUNREACH',
        'EHOSTUNREACH',
        'UND_ERR_SOCKET',
      ].includes(code)
    )
      return 'connection'
    if (
      [
        'ETIMEDOUT',
        'UND_ERR_CONNECT_TIMEOUT',
        'UND_ERR_HEADERS_TIMEOUT',
        'UND_ERR_BODY_TIMEOUT',
      ].includes(code)
    )
      return 'timeout'
    if (
      code.startsWith('ERR_TLS_') ||
      code.startsWith('ERR_SSL_') ||
      code.startsWith('CERT_') ||
      [
        'DEPTH_ZERO_SELF_SIGNED_CERT',
        'SELF_SIGNED_CERT_IN_CHAIN',
        'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
        'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
      ].includes(code)
    )
      return 'tls'
    current = current.cause as typeof current
  }
  return error instanceof TypeError ? 'network' : 'unknown'
}

async function verificationGet(
  request: Request,
  token: string | undefined,
  diagnose?: (diagnostic: SessionDiagnostic) => void,
) {
  // Use the same platform-discovered provider as SDK refresh, not a guessed host
  // or a browser-supplied endpoint. Do not read or log the config's operator token.
  const provider = getIdentityConfig()?.url
  let endpoint = provider
    ? new URL(provider.replace(/\/$/, '') + '/user')
    : new URL('/.netlify/identity/user', request.url)
  if (
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    (endpoint.protocol !== 'https:' &&
      !(endpoint.protocol === 'http:' && endpoint.hostname === 'localhost'))
  )
    throw new SessionError(
      503,
      'IDENTITY_UNAVAILABLE',
      'Account verification is temporarily unavailable.',
    )
  const started = performance.now()
  const deadline = started + 10000
  const alternate = identityAlternate(endpoint, request)
  for (let attempt = 1; attempt <= 2; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(
      () => controller.abort(),
      Math.min(4500, Math.max(1, deadline - performance.now())),
    )
    let stage: SessionDiagnostic['stage'] = 'network'
    let httpStatus: number | undefined
    try {
      const response = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal,
      })
      stage = 'http'
      httpStatus = response.status
      if (!response.ok) {
        await response.body?.cancel().catch(() => {})
        diagnose?.({ stage, httpStatus, endpointHost: endpoint.hostname })
        if (httpStatus === 401 || httpStatus === 403) return null
        throw new SessionError(
          503,
          'IDENTITY_UNAVAILABLE',
          'Your session could not be checked. Please retry on this site.',
        )
      }
      stage = 'json'
      const user = await response.json()
      stage = 'response_shape'
      if (!user || typeof user.id !== 'string' || !user.id)
        throw new Error('Invalid provider response')
      return user
    } catch (error) {
      if (error instanceof SessionError) throw error
      const category = verificationFailure(error, controller.signal.aborted)
      const retrying =
        attempt === 1 &&
        (stage === 'network' || (stage === 'json' && category === 'timeout')) &&
        ['timeout', 'dns', 'connection', 'network'].includes(category) &&
        performance.now() + 200 < deadline
      diagnose?.({
        stage,
        ...(httpStatus === undefined ? {} : { httpStatus }),
        category,
        attempt,
        elapsedMs: Math.round(performance.now() - started),
        retrying,
        endpointHost: endpoint.hostname,
      })
      if (!retrying)
        throw new SessionError(
          503,
          'IDENTITY_UNAVAILABLE',
          'Your session could not be checked. Please retry on this site.',
        )
      // The production incident exhausted two connections to the same route.
      // Keep the existing one-retry budget, but bypass that custom-domain route
      // for an explicitly classified transport failure. Never fail over on a
      // rejection, bad response, TLS failure, or unclassified fetch exception.
      if (
        alternate &&
        stage === 'network' &&
        ['timeout', 'dns', 'connection'].includes(category)
      )
        endpoint = alternate
    } finally {
      clearTimeout(timer)
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new SessionError(
    503,
    'IDENTITY_UNAVAILABLE',
    'Your session could not be checked. Please retry on this site.',
  )
}

/** Validate with the platform provider. Never treat provider outages as logout. */
export async function verifiedSession(
  request: Request,
  diagnose?: (diagnostic: SessionDiagnostic) => void,
) {
  const cookie = request.headers.get('cookie') || ''
  if (!/(?:^|;\s*)nf_jwt=/.test(cookie)) return null
  let token = cookie.match(/(?:^|;\s*)nf_jwt=([^;]*)/)?.[1]
  let httpStatus: number | undefined
  try {
    // The SDK refreshes near-expiry sessions and writes rotated cookies through Netlify.
    const refreshed = await refreshSession()
    if (refreshed) token = refreshed
  } catch (error) {
    // Never forward provider messages, bodies, headers, cookies, or identity data.
    const status = (error as { status?: unknown } | null)?.status
    if (
      typeof status === 'number' &&
      Number.isInteger(status) &&
      status >= 100 &&
      status <= 599
    )
      httpStatus = status
    diagnose?.({
      stage: 'refresh',
      ...(httpStatus === undefined ? {} : { httpStatus }),
      category: verificationFailure(error),
    })
    if ([400, 401, 403].includes((error as { status?: number }).status || 0))
      return null
    throw new SessionError(
      503,
      'IDENTITY_UNAVAILABLE',
      'Your session could not be checked. Please retry on this site.',
    )
  }
  const user = await verificationGet(request, token, diagnose)
  if (!user) return null
  return {
    id: user.id as string,
    email: typeof user.email === 'string' ? user.email : '',
    confirmedAt: user.confirmed_at as string | undefined,
    // A preference reference only; it never supplies price, role or entitlement.
    signupIntentId:
      typeof user.user_metadata?.cottage_signup_intent === 'string' &&
      /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(
        user.user_metadata.cottage_signup_intent,
      )
        ? (user.user_metadata.cottage_signup_intent as string)
        : undefined,
    roles: Array.isArray(user.app_metadata?.roles)
      ? user.app_metadata.roles
      : [],
  }
}
