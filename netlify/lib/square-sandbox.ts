import { createHmac, timingSafeEqual } from 'node:crypto'
import {
  RegistrationError,
  privateRegistrationEnabled,
} from './registration-core'

// Production URLs/credentials deliberately have no path through this adapter.
export function sandboxReady() {
  const env = globalThis.Netlify?.env
  return (
    privateRegistrationEnabled() &&
    env?.get('SQUARE_SANDBOX_ENABLED') === 'true'
  )
}
export function verifySquareSignature(
  body: string,
  signature: string | null,
  url: string,
  key: string,
) {
  if (!signature || !key || !url.startsWith('https://')) return false
  const expected = Buffer.from(
    createHmac('sha256', key)
      .update(url + body)
      .digest('base64'),
  )
  const received = Buffer.from(signature)
  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  )
}
export async function squareSandboxRequest(
  path: string,
  init: RequestInit = {},
  transport: typeof fetch = fetch,
) {
  const env = globalThis.Netlify?.env
  if (
    !sandboxReady() ||
    !env?.get('SQUARE_SANDBOX_ACCESS_TOKEN') ||
    !env.get('SQUARE_SANDBOX_API_VERSION')
  )
    throw new RegistrationError(
      503,
      'SANDBOX_NOT_CONFIGURED',
      'Square Sandbox is not configured. No live provider request was made.',
    )
  if (!/^\/v2\/[a-z0-9/_?=&.%:-]+$/i.test(path))
    throw new Error('Invalid Square resource path.')
  const response = await transport(
    'https://connect.squareupsandbox.com' + path,
    {
      ...init,
      signal: AbortSignal.timeout(15000),
      headers: {
        Authorization: `Bearer ${env.get('SQUARE_SANDBOX_ACCESS_TOKEN')}`,
        'Square-Version': env.get('SQUARE_SANDBOX_API_VERSION')!,
        'Content-Type': 'application/json',
      },
    },
  )
  if (!response.ok)
    throw new RegistrationError(
      502,
      'SQUARE_SANDBOX_REJECTED',
      'Square Sandbox could not complete this request. Refresh status before retrying.',
    )
  return response.json()
}
export async function retrieveSandboxObject(
  kind: string,
  id: string,
  transport: typeof fetch = fetch,
) {
  if (!/^[a-zA-Z0-9:_-]{1,180}$/.test(id))
    throw new Error('Invalid provider object reference.')
  const resource = kind.startsWith('invoice.')
    ? 'invoices'
    : kind.startsWith('payment.')
      ? 'payments'
      : kind.startsWith('subscription.')
        ? 'subscriptions'
        : kind.startsWith('refund.')
          ? 'refunds'
          : kind.startsWith('dispute.')
            ? 'disputes'
            : null
  if (!resource) throw new Error('Unsupported billing event.')
  return squareSandboxRequest(
    `/v2/${resource}/${encodeURIComponent(id)}`,
    {},
    transport,
  )
}
