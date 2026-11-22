import { getDatabase } from '@netlify/database'
import {
  createDemo,
  demoBusiness,
  demoCookie,
  demoEnabled,
  demoRequested,
} from '../lib/demo-session'

export default async (request: Request) => {
  const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' }
  if (
    request.method === 'GET' &&
    !new URL(request.url).searchParams.has('session')
  )
    return Response.json({ enabled: demoEnabled() }, { headers })
  if (!demoEnabled())
    return Response.json(
      { error: 'Demo access is disabled on this deployment.' },
      { status: 404, headers },
    )
  if (!['GET', 'POST'].includes(request.method))
    return new Response(null, { status: 405, headers })
  const origin = request.headers.get('origin')
  if (origin && origin !== new URL(request.url).origin)
    return Response.json(
      { error: 'Use the demo on this site.' },
      { status: 403, headers },
    )
  const body =
    request.method === 'POST' ? await request.json().catch(() => null) : null
  if (
    request.method === 'POST' &&
    !['enter', 'reset', 'exit'].includes(body?.action)
  )
    return Response.json(
      { error: 'Choose a demo action.' },
      { status: 400, headers },
    )
  if (
    body?.action === 'enter' &&
    (body.username !== 'demo' || body.password !== 'demo')
  )
    return Response.json(
      { error: 'Use the public sandbox username demo and password demo.' },
      { status: 401, headers },
    )
  if (request.method === 'GET' && !demoRequested(request))
    return Response.json({ active: false }, { headers })
  let client:
    | Awaited<ReturnType<ReturnType<typeof getDatabase>['pool']['connect']>>
    | undefined
  try {
    client = await getDatabase().pool.connect()
    await client.query('BEGIN')
    const current = await demoBusiness(client, request)
    if (request.method === 'GET') {
      await client.query('COMMIT')
      return Response.json({ active: !!current }, { headers })
    }
    if (body.action === 'exit') {
      await client.query('COMMIT')
      return Response.json(
        { ok: true },
        {
          headers: { ...headers, 'Set-Cookie': demoCookie('', request, true) },
        },
      )
    }
    if (body.action === 'reset' && (!current || body.confirm !== true)) {
      await client.query('ROLLBACK')
      return Response.json(
        { error: 'Confirm reset in your active demo workspace.' },
        { status: 403, headers },
      )
    }
    if (current && body.action === 'enter') {
      await client.query('COMMIT')
      return Response.json({ ok: true }, { headers })
    }
    // Serialize provisioning across processes and bound anonymous workspaces.
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('preview-demo-provision',0))",
    )
    await client.query('SELECT purge_expired_preview_demos()')
    const count = (
      await client.query(
        'SELECT count(*)::int AS count FROM businesses WHERE identity_owner IS NULL AND session_hash IS NOT NULL AND expires_at>NOW()',
      )
    ).rows[0].count
    if (count >= 200) {
      await client.query('ROLLBACK')
      return Response.json(
        { error: 'The demo is busy. Try again later.' },
        { status: 429, headers },
      )
    }
    const created = await createDemo(
      client,
      body.action === 'reset' ? current : undefined,
    )
    await client.query('COMMIT')
    return Response.json(
      { ok: true },
      {
        headers: {
          ...headers,
          'Set-Cookie': demoCookie(created.token, request),
        },
      },
    )
  } catch {
    await client?.query('ROLLBACK').catch(() => {})
    console.warn(
      JSON.stringify({
        area: 'demo_access',
        stage: 'database',
        result: 'unavailable',
      }),
    )
    return Response.json(
      {
        error:
          'The preview database is unavailable. Demo workflows require a Netlify Deploy Preview with a database.',
      },
      { status: 503, headers },
    )
  } finally {
    client?.release()
  }
}
export const config = { path: '/api/demo' }
