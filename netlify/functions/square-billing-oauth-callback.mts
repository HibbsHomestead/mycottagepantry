import type { Config, Context } from '@netlify/functions'
import { z } from 'zod'
import {
  adminOrigin,
  adminTransaction,
  clientAddress,
  hash,
  requireRate,
} from '../lib/platform-admin-core'
import { sealSquare, squareEnv } from '../lib/square-credentials'
import { squareState, squareStateCookie } from '../lib/square-oauth'

/** Cross-site callback never exchanges a code or grants billing access. The Lax
 * binding cookie and DB session are checked before staging the encrypted code. */
export default async (request: Request, context: Context) => {
  const headers = new Headers({
    'Cache-Control': 'private, no-store',
    'Netlify-CDN-Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  })
  const url = new URL(request.url)
  const preview =
    squareEnv('CONTEXT') === 'deploy-preview' &&
    url.origin === squareEnv('DEPLOY_URL') &&
    /^https:\/\/[a-z0-9-]+--mycottagepantry\.netlify\.app$/.test(url.origin)
  if (request.method !== 'GET' || (url.origin !== adminOrigin && !preview))
    return new Response('Not found', { status: 404, headers })
  try {
    await requireRate(clientAddress(context), 'square-callback', 20, 60)
    const cookie = squareState(request)
    const state = url.searchParams.get('state') || ''
    if (!cookie || state !== cookie) throw new Error('State mismatch')
    const code = z.string().min(1).max(4096).parse(url.searchParams.get('code'))
    await adminTransaction(async (c) => {
      const row = (
        await c.query(
          `SELECT o.state_hash FROM square_billing_oauth_states o
        JOIN platform_sessions s ON s.token_hash=o.session_hash JOIN platform_admins a ON a.identity_id=s.identity_id
        WHERE o.state_hash=$1 AND o.origin=$2 AND o.expires_at>NOW() AND o.callback_at IS NULL AND o.consumed_at IS NULL
        AND s.expires_at>NOW() AND s.origin=o.origin AND s.epoch=a.epoch AND a.enabled=true AND a.role='owner' FOR UPDATE OF o`,
          [hash(state), url.origin],
        )
      ).rows[0]
      if (!row) throw new Error('Invalid authorization')
      await c.query(
        'UPDATE square_billing_oauth_states SET callback_at=NOW(),code_ciphertext=$2 WHERE state_hash=$1',
        [row.state_hash, sealSquare(code, row.state_hash)],
      )
    })
    headers.set('Location', url.origin + '/admin?section=billing&square=return')
    return new Response(null, { status: 303, headers })
  } catch {
    headers.set('Set-Cookie', squareStateCookie('', 0))
    headers.set('Location', url.origin + '/admin?section=billing&square=failed')
    return new Response(null, { status: 303, headers })
  }
}
export const config: Config = { path: '/api/admin/square/callback' }
