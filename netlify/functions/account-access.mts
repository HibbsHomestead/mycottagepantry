import { resolveAccountAccess } from '../lib/account-access'
import type { Config } from '@netlify/functions'
export default async (request: Request) => {
  const headers = {
    'Cache-Control': 'private, no-store',
    Vary: 'Cookie',
    'Referrer-Policy': 'no-referrer',
  }
  if (request.method !== 'GET')
    return Response.json(
      { error: 'Method not allowed.' },
      { status: 405, headers },
    )
  const access = await resolveAccountAccess(request)
  // States are a successful resolution contract; transport errors remain separate.
  return Response.json(access, {
    headers: { ...headers, 'X-Access-Trace': access.traceId },
  })
}
export const config: Config = { path: '/api/account-access' }
