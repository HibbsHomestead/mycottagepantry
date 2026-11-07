import { aiEnabled } from './feature-flags'
import { createHash } from 'node:crypto'
import type { Item } from '../../src/lib/domain'
import {
  assistantInput,
  assistantModel,
  type AssistantStatus,
} from '../../src/lib/cottage-assistant'
import {
  AssistantError,
  assistantFailure,
  gatewayConfigured,
  requestAssistant,
  reserveAssistant,
} from './cottage-assistant'

async function boundedJson(req: Request) {
  const reader = req.body?.getReader()
  if (!reader)
    throw new AssistantError(
      'Paste product information before requesting suggestions.',
      400,
      'INVALID_INPUT',
    )
  let size = 0
  const chunks: Uint8Array[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > 60000) {
      await reader.cancel()
      throw new AssistantError(
        'Use up to 12,000 characters of product information.',
        413,
        'INPUT_TOO_LARGE',
      )
    }
    chunks.push(value)
  }
  const body = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder().decode(body))
  } catch {
    throw new AssistantError(
      'Send valid product information to the assistant.',
      400,
      'INVALID_INPUT',
    )
  }
}
export async function handleCottageAssistant(
  req: Request,
  scope: {
    client: any
    org: string
    role: string
    userId?: string
    settings: Item
    deploymentId?: string
    save: (table: string, item: Item) => Promise<void>
  },
) {
  if (!aiEnabled())
    return Response.json(
      { error: 'This operation is unavailable.', code: 'FEATURE_UNAVAILABLE' },
      { status: 404, headers: { 'Cache-Control': 'private, no-store' } },
    )
  const {
    client,
    org,
    role,
    userId,
    settings,
    save,
    deploymentId = 'local',
  } = scope
  const headers = { 'Cache-Control': 'private, no-store' }
  try {
    if (!userId)
      throw new AssistantError(
        'Sign in to a private oven to use the assistant. AI requests are unavailable in the demo; manual entry remains available.',
        401,
        'SIGN_IN_REQUIRED',
      )
    if (!['Owner', 'Manager'].includes(role))
      throw new AssistantError(
        'Only an Owner or Manager can request ingredient suggestions or research.',
        403,
        'ASSISTANT_FORBIDDEN',
      )
    const actor = createHash('sha256').update(userId).digest('hex')
    const configured = gatewayConfigured()
    if (req.method === 'GET') {
      const saved = settings.assistantConnections?.[actor]
      const connection =
        saved?.deploymentId === deploymentId && saved?.model === assistantModel
          ? saved
          : null
      const status: AssistantStatus = {
        configured,
        model: assistantModel,
        status: !configured
          ? 'Unavailable'
          : connection?.status || 'Configured, not tested',
        checkedAt: configured ? connection?.checkedAt || null : null,
        sourcesReturned: configured
          ? (connection?.sourcesReturned ?? null)
          : null,
        message: !configured
          ? 'Gateway runtime configuration is unavailable. Manual entry remains available.'
          : connection?.message || null,
      }
      await client.query('COMMIT')
      return Response.json(status, { headers })
    }
    const parsed = assistantInput.safeParse(await boundedJson(req))
    if (!parsed.success)
      throw new AssistantError(
        'Choose paste or research and enter 10–12,000 characters of product information. Send only product information.',
        400,
        'INVALID_INPUT',
      )
    settings.assistantRequests = reserveAssistant(
      settings.assistantRequests || [],
      actor,
    )
    await save('settings', settings)
    // Commit the allowance reservation before external inference. Failures count,
    // and the workspace lock is released while waiting on the model.
    await client.query('COMMIT')
    let result, failure: AssistantError | undefined
    try {
      result = await requestAssistant(parsed.data)
    } catch (error) {
      failure = assistantFailure(error)
    }
    await client.query('BEGIN')
    await client.query("SELECT set_config('app.identity_id',$1,true)", [userId])
    await client.query("SELECT set_config('app.business_id',$1,true)", [org])
    await client.query('SELECT id FROM businesses WHERE id=$1 FOR UPDATE', [
      org,
    ])
    const current = await client.query(
      'SELECT data FROM settings WHERE business_id=$1 ORDER BY created_at,id',
      [org],
    )
    const latest: Item | undefined = current.rows[0]?.data
    if (!latest)
      throw new AssistantError(
        'Oven settings are unavailable. Suggestions were withheld.',
        503,
      )
    const activeActors = new Set(
      (latest.assistantRequests || [])
        .filter((entry: { at: number }) => Date.now() - entry.at < 86400000)
        .map((entry: { actor: string }) => entry.actor),
    )
    latest.assistantConnections = Object.fromEntries(
      Object.entries(latest.assistantConnections || {}).filter(([key]) =>
        activeActors.has(key),
      ),
    )
    latest.assistantConnections[actor] = {
      deploymentId,
      model: assistantModel,
      status: failure ? 'Last request failed' : 'Connection successful',
      checkedAt: new Date().toISOString(),
      sourcesReturned: result ? result.sources.length > 0 : false,
      message:
        failure?.message ||
        (parsed.data.mode === 'research'
          ? result!.sources.length
            ? 'Web research returned source metadata. Review source links and product matches.'
            : 'The model responded, but web sources were not returned.'
          : 'Pasted-text suggestions returned. Review each selected field before applying.'),
    }
    await save('settings', latest)
    await client.query('COMMIT')
    return failure
      ? Response.json(
          { error: failure.message, code: failure.code },
          { status: failure.status, headers },
        )
      : Response.json(result, { headers })
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    const failure = assistantFailure(error)
    return Response.json(
      { error: failure.message, code: failure.code },
      { status: failure.status, headers },
    )
  }
}
