import { AsyncLocalStorage } from 'node:async_hooks'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { RegistrationError } from './registration-core'
import type { AdminClient } from './platform-admin-core'
import type { BillingEnvironment } from './square-billing'

type Connection = {
  environment: BillingEnvironment
  merchant_id: string
  location_id: string | null
  status: string
  expires_at: string
  token_ciphertext: string
}
type Tokens = { access_token: string; refresh_token: string }
const context = new AsyncLocalStorage<{
  client: AdminClient
  rows: Connection[]
}>()
export const squareOrigin = (e: BillingEnvironment) =>
  e === 'sandbox'
    ? 'https://connect.squareupsandbox.com'
    : 'https://connect.squareup.com'
export const squareSetting = (e: BillingEnvironment, name: string) =>
  `SQUARE_${e.toUpperCase()}_${name}`
export const squareEnv = (name: string) =>
  globalThis.Netlify?.env?.get(name) || ''
/** The registered notification URL is part of Square's signature. Derive only
 * from the trusted deployment origin, never from an incoming Host header. */
export function squareWebhookUrl(environment: BillingEnvironment) {
  const path = `/api/square/${environment}/webhook`
  const configured = squareEnv(squareSetting(environment, 'WEBHOOK_URL'))
  if (configured) {
    try {
      const url = new URL(configured)
      return url.protocol === 'https:' &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        url.pathname === path
        ? configured
        : ''
    } catch {
      return ''
    }
  }
  if (environment === 'sandbox' && squareEnv('CONTEXT') === 'deploy-preview') {
    const origin = squareEnv('DEPLOY_URL')
    return /^https:\/\/[a-z0-9-]+--mycottagepantry\.netlify\.app$/.test(origin)
      ? origin + path
      : ''
  }
  if (environment === 'production' && squareEnv('CONTEXT') === 'production')
    return 'https://admin.mycottagepantry.com' + path
  return ''
}

export function encryptionConfigured() {
  return /^[a-f\d]{64}$/i.test(squareEnv('SQUARE_BILLING_ENCRYPTION_KEY'))
}
function encryptionKey() {
  if (!encryptionConfigured())
    throw new RegistrationError(
      503,
      'SQUARE_ENCRYPTION_MISSING',
      'Secure Square token storage is not configured.',
    )
  return Buffer.from(squareEnv('SQUARE_BILLING_ENCRYPTION_KEY'), 'hex')
}
export function sealSquare(value: unknown, binding: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  cipher.setAAD(Buffer.from('square-billing:v1:' + binding))
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final(),
  ])
  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.')
}
export function openSquare<T>(value: string, binding: string): T {
  const [version, iv, tag, encrypted] = value.split('.')
  if (version !== 'v1') throw new Error('Unsupported Square credential record')
  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    Buffer.from(iv, 'base64url'),
  )
  decipher.setAAD(Buffer.from('square-billing:v1:' + binding))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(encrypted, 'base64url')),
      decipher.final(),
    ]).toString('utf8'),
  )
}
export async function withBillingWorker<T>(
  client: AdminClient,
  fn: () => Promise<T>,
) {
  const previous =
    (
      await client.query(
        "SELECT current_setting('app.billing_worker',true) AS value",
      )
    ).rows[0]?.value || ''
  await client.query("SELECT set_config('app.billing_worker','true',true)")
  try {
    return await fn()
  } finally {
    await client.query("SELECT set_config('app.billing_worker',$1,true)", [
      previous,
    ])
  }
}
/** Per-request DB context, never a process-global merchant/token cache. */
export async function withSquareConnections<T>(
  client: AdminClient,
  fn: () => Promise<T>,
) {
  const rows = await withBillingWorker(
    client,
    async () =>
      (
        await client.query(
          'SELECT environment,merchant_id,location_id,status,expires_at,token_ciphertext FROM square_billing_connections',
        )
      ).rows as Connection[],
  )
  return context.run({ client, rows }, fn)
}
export function currentSquareConnection(environment: BillingEnvironment) {
  return context.getStore()?.rows.find((r) => r.environment === environment)
}
/** OAuth errors are reduced to fixed codes; response bodies are never surfaced. */
export async function squareOAuthRequest(
  environment: BillingEnvironment,
  path: string,
  body: object,
  transport: typeof fetch = fetch,
) {
  const response = await transport(squareOrigin(environment) + path, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
    headers: {
      'Content-Type': 'application/json',
      'Square-Version': squareEnv(squareSetting(environment, 'API_VERSION')),
    },
    body: JSON.stringify(body),
  })
  if (!response.ok)
    throw new RegistrationError(
      502,
      [400, 401, 403].includes(response.status)
        ? 'SQUARE_AUTHORIZATION_FAILED'
        : 'SQUARE_AUTHORIZATION_UNAVAILABLE',
      'Square authorization failed. Reconnect the platform billing account.',
    )
  return response.json()
}
export async function squareAccessToken(
  environment: BillingEnvironment,
  transport: typeof fetch = fetch,
) {
  let row = currentSquareConnection(environment)
  if (!row) return squareEnv(squareSetting(environment, 'ACCESS_TOKEN'))
  const store = context.getStore()!
  if (row.status !== 'connected')
    throw new RegistrationError(
      503,
      'SQUARE_RECONNECT_REQUIRED',
      'Reconnect Square in Admin Billing. No paid access was changed.',
    )
  if (Date.parse(row.expires_at) < Date.now() + 24 * 3600000) {
    // Serialize refresh across concurrent function instances and re-read after locking.
    row = await withBillingWorker(
      store.client,
      async () =>
        (
          await store.client.query(
            'SELECT * FROM square_billing_connections WHERE environment=$1 FOR UPDATE',
            [environment],
          )
        ).rows[0] as Connection,
    )
    if (row.status !== 'connected')
      throw new RegistrationError(
        503,
        'SQUARE_RECONNECT_REQUIRED',
        'Reconnect Square in Admin Billing.',
      )
    if (Date.parse(row.expires_at) < Date.now() + 24 * 3600000) {
      const old = openSquare<Tokens>(row.token_ciphertext, environment)
      const tokens = await squareOAuthRequest(
        environment,
        '/oauth2/token',
        {
          client_id: squareEnv(squareSetting(environment, 'APPLICATION_ID')),
          client_secret: squareEnv(
            squareSetting(environment, 'APPLICATION_SECRET'),
          ),
          grant_type: 'refresh_token',
          refresh_token: old.refresh_token,
        },
        transport,
      ).catch(async (error) => {
        if (
          error instanceof RegistrationError &&
          error.code === 'SQUARE_AUTHORIZATION_FAILED'
        )
          await markSquareReconnect(environment)
        throw error
      })
      if (
        !tokens.access_token ||
        !tokens.refresh_token ||
        tokens.merchant_id !== row.merchant_id ||
        !Number.isFinite(Date.parse(tokens.expires_at))
      )
        throw new RegistrationError(
          502,
          'SQUARE_REFRESH_INVALID',
          'Square token refresh needs administrator review.',
        )
      row.token_ciphertext = sealSquare(
        {
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
        },
        environment,
      )
      row.expires_at = tokens.expires_at
      await withBillingWorker(store.client, () =>
        store.client.query(
          'UPDATE square_billing_connections SET token_ciphertext=$2,expires_at=$3,updated_at=NOW() WHERE environment=$1',
          [environment, row!.token_ciphertext, row!.expires_at],
        ),
      )
    }
    store.rows = store.rows.map((r) =>
      r.environment === environment ? row! : r,
    )
  }
  return openSquare<Tokens>(row.token_ciphertext, environment).access_token
}
export async function markSquareReconnect(environment: BillingEnvironment) {
  const store = context.getStore()
  if (!store || !currentSquareConnection(environment)) return
  await withBillingWorker(store.client, () =>
    store.client.query(
      "UPDATE square_billing_connections SET status='reconnect_required',updated_at=NOW() WHERE environment=$1",
      [environment],
    ),
  )
  store.rows = store.rows.map((r) =>
    r.environment === environment ? { ...r, status: 'reconnect_required' } : r,
  )
}
