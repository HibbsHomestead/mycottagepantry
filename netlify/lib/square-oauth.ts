import { z } from 'zod'
import {
  AdminError,
  hash,
  opaqueToken,
  type AdminClient,
} from './platform-admin-core'
import type { AdminMetadata } from '../../src/lib/platform-admin-types'
import { privateRegistrationEnabled } from './registration-core'
import type { BillingEnvironment } from './square-billing'
import {
  encryptionConfigured,
  openSquare,
  sealSquare,
  squareEnv,
  squareOAuthRequest,
  squareOrigin,
  squareSetting,
  squareWebhookUrl,
} from './square-credentials'

// Permissions used by the existing catalog, hosted checkout, cancellation and canonical-read paths.
export const squareBillingScopes = [
  'MERCHANT_PROFILE_READ',
  'ITEMS_READ',
  'ITEMS_WRITE',
  'ORDERS_READ',
  'ORDERS_WRITE',
  'PAYMENTS_READ',
  'PAYMENTS_WRITE',
  'SUBSCRIPTIONS_READ',
  'SUBSCRIPTIONS_WRITE',
  'INVOICES_READ',
  'DISPUTES_READ',
] as const
export const squareWebhookEvents = [
  'subscription.created',
  'subscription.updated',
  'invoice.payment_made',
  'invoice.scheduled_charge_failed',
  'invoice.updated',
  'payment.updated',
  'refund.updated',
  'dispute.created',
  'dispute.state.updated',
] as const
const cookieName = '__Host-cp_square_oauth'
export function squareStateCookie(token: string, maxAge = 600) {
  return `${cookieName}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`
}
export function squareState(request: Request) {
  const value =
    request.headers
      .get('cookie')
      ?.split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith(cookieName + '='))
      ?.slice(cookieName.length + 1) || ''
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : ''
}
export function requireSquareOwner(session: AdminMetadata) {
  if (session.role !== 'owner')
    throw new AdminError(
      403,
      'BILLING_OWNER_REQUIRED',
      'An authenticated platform owner session is required for Square billing setup.',
    )
}
export function oauthSetup(environment: BillingEnvironment, origin: string) {
  return {
    callbackUrl: origin + '/api/admin/square/callback',
    webhookUrl:
      squareWebhookUrl(environment) ||
      origin + `/api/square/${environment}/webhook`,
    missing: [
      squareSetting(environment, 'APPLICATION_ID'),
      squareSetting(environment, 'APPLICATION_SECRET'),
      squareSetting(environment, 'API_VERSION'),
    ]
      .filter((name) => !squareEnv(name))
      .concat(encryptionConfigured() ? [] : ['SQUARE_BILLING_ENCRYPTION_KEY']),
    events: squareWebhookEvents,
  }
}
export async function beginSquareOAuth(
  c: AdminClient,
  session: AdminMetadata,
  environment: BillingEnvironment,
) {
  requireSquareOwner(session)
  if (
    (environment === 'sandbox' && !privateRegistrationEnabled()) ||
    (environment === 'production' &&
      (squareEnv('CONTEXT') !== 'production' ||
        session.origin !== 'https://admin.mycottagepantry.com'))
  )
    throw new AdminError(
      403,
      'SQUARE_CONTEXT_FORBIDDEN',
      'Use a private test deployment for Sandbox and the deployed admin host for Production authorization.',
    )
  const setup = oauthSetup(environment, session.origin)
  if (setup.missing.length)
    throw new AdminError(
      503,
      'SQUARE_SETUP_REQUIRED',
      'Missing secure settings: ' + setup.missing.join(', '),
    )
  const state = opaqueToken()
  await c.query(
    'DELETE FROM square_billing_oauth_states WHERE expires_at < NOW() OR session_hash=$1',
    [session.token_hash],
  )
  await c.query(
    "INSERT INTO square_billing_oauth_states(state_hash,session_hash,identity_id,environment,origin,expires_at) VALUES($1,$2,$3,$4,$5,NOW()+INTERVAL '10 minutes')",
    [
      hash(state),
      session.token_hash,
      session.identity_id,
      environment,
      session.origin,
    ],
  )
  const url = new URL('/oauth2/authorize', squareOrigin(environment))
  url.search = new URLSearchParams({
    client_id: squareEnv(squareSetting(environment, 'APPLICATION_ID')),
    scope: squareBillingScopes.join(' '),
    state,
    redirect_uri: setup.callbackUrl,
    session: 'false',
  }).toString()
  return { url: url.toString(), cookie: squareStateCookie(state) }
}
type Location = {
  id: string
  name: string
  status: string
  currency: string
  country: string
  capabilities: string[]
}
type Candidate = {
  tokens: {
    access_token: string
    refresh_token: string
    expires_at: string
    merchant_id: string
  }
  merchant: { id: string; business_name: string }
  scopes: string[]
  locations: Location[]
}
export function safeCandidate(candidate: Candidate) {
  return {
    merchantId: candidate.merchant.id,
    merchantName: candidate.merchant.business_name,
    locations: candidate.locations,
    permissionsVerified: squareBillingScopes.every((s) =>
      candidate.scopes.includes(s),
    ),
  }
}
async function boundState(
  c: AdminClient,
  session: AdminMetadata,
  state: string,
) {
  requireSquareOwner(session)
  const row = (
    await c.query(
      'SELECT * FROM square_billing_oauth_states WHERE state_hash=$1 AND session_hash=$2 AND identity_id=$3 AND origin=$4 AND expires_at>NOW() FOR UPDATE',
      [hash(state), session.token_hash, session.identity_id, session.origin],
    )
  ).rows[0]
  if (!state || !row)
    throw new AdminError(
      409,
      'SQUARE_STATE_EXPIRED',
      'Square authorization expired or belongs to another session. Start Connect Square again.',
    )
  return row
}
/** Callback saves an encrypted code only. Token exchange requires a same-origin,
 * owner-authenticated POST with the original Strict admin session cookie. */
export async function completeSquareOAuth(
  c: AdminClient,
  session: AdminMetadata,
  state: string,
  transport: typeof fetch = fetch,
) {
  const row = await boundState(c, session, state)
  if (!row.callback_at || row.consumed_at || !row.code_ciphertext)
    throw new AdminError(
      409,
      'SQUARE_STATE_USED',
      'Start a fresh Square authorization.',
    )
  await c.query(
    'UPDATE square_billing_oauth_states SET consumed_at=NOW(),code_ciphertext=NULL WHERE state_hash=$1',
    [row.state_hash],
  )
  try {
    const environment = row.environment as BillingEnvironment
    const tokens = await squareOAuthRequest(
      environment,
      '/oauth2/token',
      {
        client_id: squareEnv(squareSetting(environment, 'APPLICATION_ID')),
        client_secret: squareEnv(
          squareSetting(environment, 'APPLICATION_SECRET'),
        ),
        grant_type: 'authorization_code',
        code: openSquare<string>(row.code_ciphertext, row.state_hash),
        redirect_uri: oauthSetup(environment, session.origin).callbackUrl,
      },
      transport,
    )
    if (
      !tokens.access_token ||
      !tokens.refresh_token ||
      !tokens.merchant_id ||
      !Number.isFinite(Date.parse(tokens.expires_at))
    )
      throw new Error('Invalid token response')
    const get = async (path: string, method = 'GET') => {
      const response = await transport(squareOrigin(environment) + path, {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          'Square-Version': squareEnv(
            squareSetting(environment, 'API_VERSION'),
          ),
        },
      })
      if (!response.ok) throw new Error('Verification failed')
      return response.json()
    }
    const status = await get('/oauth2/token/status', 'POST')
    const merchant = (await get('/v2/merchants/me')).merchant
    const locations = (await get('/v2/locations')).locations
    if (
      merchant?.id !== tokens.merchant_id ||
      !Array.isArray(locations) ||
      !Array.isArray(status.scopes) ||
      !squareBillingScopes.every((s) => status.scopes.includes(s))
    )
      throw new Error('Merchant or scope verification failed')
    const candidate: Candidate = {
      tokens: {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: tokens.expires_at,
        merchant_id: tokens.merchant_id,
      },
      merchant: {
        id: merchant.id,
        business_name: String(merchant.business_name || merchant.id).slice(
          0,
          200,
        ),
      },
      scopes: status.scopes,
      locations: locations
        .filter(
          (l: Location & { merchant_id?: string }) =>
            !l.merchant_id || l.merchant_id === merchant.id,
        )
        .map((l: Location) => ({
          id: l.id,
          name: l.name,
          status: l.status,
          currency: l.currency,
          country: l.country,
          capabilities: l.capabilities || [],
        })),
    }
    await c.query(
      'UPDATE square_billing_oauth_states SET candidate_ciphertext=$2 WHERE state_hash=$1',
      [row.state_hash, sealSquare(candidate, row.state_hash)],
    )
    return { ok: true, candidate: safeCandidate(candidate) }
  } catch {
    // Commit consumed state even if provider exchange fails. Never echo provider bodies.
    return {
      ok: false,
      error:
        'Square authorization could not be verified. Start Connect Square again; the existing billing connection was preserved.',
    }
  }
}
export async function confirmSquareConnection(
  c: AdminClient,
  session: AdminMetadata,
  state: string,
  input: unknown,
) {
  const data = z
    .object({
      locationId: z.string().min(1).max(120),
      confirm: z.literal(true),
    })
    .strict()
    .parse(input)
  const row = await boundState(c, session, state)
  if (!row.candidate_ciphertext || !row.consumed_at)
    throw new AdminError(
      409,
      'SQUARE_CONFIRMATION_UNAVAILABLE',
      'Authorize Square before confirming the merchant and location.',
    )
  const candidate = openSquare<Candidate>(
    row.candidate_ciphertext,
    row.state_hash,
  )
  const location = candidate.locations.find((l) => l.id === data.locationId)
  if (
    !location ||
    location.status !== 'ACTIVE' ||
    location.currency !== 'USD' ||
    !location.capabilities.includes('CREDIT_CARD_PROCESSING')
  )
    throw new AdminError(
      400,
      'SQUARE_LOCATION_INVALID',
      'Choose an active USD location with card processing.',
    )
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
    'square-connection:' + row.environment,
  ])
  const current = (
    await c.query(
      'SELECT merchant_id,location_id FROM square_billing_connections WHERE environment=$1 FOR UPDATE',
      [row.environment],
    )
  ).rows[0]
  // Existing env-token installations also count as existing merchant/location bindings.
  const oldMerchant =
    current?.merchant_id ||
    squareEnv(squareSetting(row.environment, 'MERCHANT_ID'))
  const oldLocation =
    current?.location_id ||
    squareEnv(squareSetting(row.environment, 'LOCATION_ID'))
  const changed =
    (oldMerchant && oldMerchant !== candidate.merchant.id) ||
    (oldLocation && oldLocation !== location.id)
  if (changed) {
    await c.query("SELECT set_config('app.platform_read','true',true)")
    const affected = (
      await c.query(
        "SELECT (SELECT count(*) FROM billing_subscriptions WHERE environment=$1) + (SELECT count(*) FROM billing_attempts WHERE environment=$1 AND status IN ('checkout_pending','payment_processing','unknown')) AS count",
        [row.environment],
      )
    ).rows[0]
    if (Number(affected?.count))
      throw new AdminError(
        409,
        'SQUARE_EXISTING_BILLING_REVIEW',
        'Existing subscriptions or open checkouts use this billing account/location. Replacement requires an account impact review; no connection was changed.',
      )
    // New merchant/location invalidates mappings and all old readiness evidence.
    await c.query("SELECT set_config('app.billing_worker','true',true)")
    await c.query('DELETE FROM billing_plan_mappings WHERE environment=$1', [
      row.environment,
    ])
    await c.query(
      'DELETE FROM billing_connection_checks WHERE environment=$1',
      [row.environment],
    )
    await c.query('DELETE FROM billing_sync_runs WHERE environment=$1', [
      row.environment,
    ])
    await c.query("SELECT set_config('app.billing_worker','false',true)")
  }
  await c.query(
    `INSERT INTO square_billing_connections(environment,merchant_id,merchant_name,token_ciphertext,expires_at,scopes,locations,location_id,status,connected_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,'connected',$9) ON CONFLICT(environment) DO UPDATE SET merchant_id=EXCLUDED.merchant_id,merchant_name=EXCLUDED.merchant_name,token_ciphertext=EXCLUDED.token_ciphertext,expires_at=EXCLUDED.expires_at,scopes=EXCLUDED.scopes,locations=EXCLUDED.locations,location_id=EXCLUDED.location_id,status='connected',connected_by=EXCLUDED.connected_by,verified_at=NOW(),updated_at=NOW()`,
    [
      row.environment,
      candidate.merchant.id,
      candidate.merchant.business_name,
      sealSquare(candidate.tokens, row.environment),
      candidate.tokens.expires_at,
      JSON.stringify(candidate.scopes),
      JSON.stringify(candidate.locations),
      location.id,
      session.identity_id,
    ],
  )
  await c.query('DELETE FROM square_billing_oauth_states WHERE state_hash=$1', [
    row.state_hash,
  ])
  return {
    ok: true,
    environment: row.environment,
    merchantName: candidate.merchant.business_name,
    locationName: location.name,
  }
}
export async function squareOAuthAdminStatus(
  c: AdminClient,
  session: AdminMetadata,
) {
  const rows = (
    await c.query(
      'SELECT environment,merchant_id,merchant_name,location_id,locations,scopes,status,expires_at,verified_at FROM square_billing_connections ORDER BY environment',
    )
  ).rows
  const pending = (
    await c.query(
      'SELECT state_hash,environment,callback_at,consumed_at,candidate_ciphertext FROM square_billing_oauth_states WHERE session_hash=$1 AND expires_at>NOW() ORDER BY expires_at DESC LIMIT 1',
      [session.token_hash],
    )
  ).rows[0]
  return {
    connections: rows.map((r) => ({
      ...r,
      permissionsVerified: squareBillingScopes.every((s) =>
        r.scopes.includes(s),
      ),
    })),
    setup: (['sandbox', 'production'] as const).map((e) => ({
      environment: e,
      ...oauthSetup(e, session.origin),
    })),
    pending: pending
      ? {
          environment: pending.environment,
          callbackReady: !!pending.callback_at && !pending.consumed_at,
          candidate: pending.candidate_ciphertext
            ? safeCandidate(
                openSquare<Candidate>(
                  pending.candidate_ciphertext,
                  pending.state_hash,
                ),
              )
            : null,
        }
      : null,
  }
}
