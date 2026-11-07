// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
const provider = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('../../netlify/lib/cottage-assistant', async (original) => ({
  ...(await original<typeof import('../../netlify/lib/cottage-assistant')>()),
  gatewayConfigured: () => true,
  requestAssistant: provider.request,
}))
import { handleCottageAssistant } from '../../netlify/lib/cottage-assistant-handler'
beforeEach(() => {
  provider.request.mockReset()
})
const actor = createHash('sha256').update('verified-user').digest('hex')
function setup(role = 'Owner', userId: string | undefined = 'verified-user') {
  const store = { settings: { id: 'business', name: 'Bakery' } as any }
  const client = {
    query: vi.fn(async (sql: string) => ({
      rows: sql.startsWith('SELECT data FROM settings')
        ? [{ data: structuredClone(store.settings) }]
        : [],
    })),
  }
  const save = vi.fn(async (_table: string, item: any) => {
    store.settings = structuredClone(item)
  })
  return {
    store,
    client,
    scope: {
      client,
      org: 'verified-business',
      role,
      userId: userId as string | undefined,
      settings: store.settings,
      save,
    },
    save,
  }
}
function req(input: any = { mode: 'paste', text: 'Bread flour 5 lb bag' }) {
  return new Request('https://pantry.test/api/workspace?assistant=1', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}
const result = {
  mode: 'paste',
  model: 'perplexity/sonar',
  fields: { name: 'Bread flour' },
  evidence: { name: 'Bread flour' },
  sources: [],
  warnings: [],
  answer: '',
  checkedAt: '2026-10-31T04:00:00Z',
  usage: { costUsd: null, totalTokens: 100 },
}
it.each(['Production Staff', 'Read-only Accountant'])(
  'denies %s before requesting inference',
  async (role) => {
    const { scope, save } = setup(role)
    const response = await handleCottageAssistant(req(), scope)
    expect(response.status).toBe(403)
    expect(provider.request).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
  },
)
it('denies anonymous demo usage and client-controlled ownership', async () => {
  const demo = setup()
  demo.scope.userId = undefined
  expect((await handleCottageAssistant(req(), demo.scope)).status).toBe(401)
  const { scope } = setup()
  expect(
    (
      await handleCottageAssistant(
        req({
          mode: 'paste',
          text: 'Bread flour 5 lb bag',
          businessId: 'other',
        }),
        scope,
      )
    ).status,
  ).toBe(400)
  expect(provider.request).not.toHaveBeenCalled()
})
it('reserves usage durably before inference, releases the oven lock, and preserves concurrent settings', async () => {
  const { scope, store, save, client } = setup()
  provider.request.mockImplementation(async () => {
    expect(store.settings.assistantRequests).toHaveLength(1)
    expect(client.query.mock.calls.at(-1)?.[0]).toBe('COMMIT')
    store.settings.newConcurrentPreference = 'preserved'
    return result
  })
  const response = await handleCottageAssistant(req(), scope)
  expect(response.status).toBe(200)
  expect(store.settings.newConcurrentPreference).toBe('preserved')
  expect(store.settings.assistantConnections[actor].status).toBe(
    'Connection successful',
  )
  expect(save.mock.calls.every(([table]) => table === 'settings')).toBe(true)
  expect(store.settings).not.toHaveProperty('text')
  expect(JSON.stringify(store.settings)).not.toContain('Bread flour')
  expect(client.query.mock.calls).toContainEqual([
    'SELECT id FROM businesses WHERE id=$1 FOR UPDATE',
    ['verified-business'],
  ])
})
it('counts failed requests and persists only a sanitized failure status', async () => {
  const { scope, store } = setup()
  provider.request.mockRejectedValue({
    status: 401,
    message: 'private provider credentials',
  })
  const response = await handleCottageAssistant(req(), scope)
  expect(response.status).toBe(503)
  expect(store.settings.assistantRequests).toHaveLength(1)
  expect(store.settings.assistantConnections[actor].status).toBe(
    'Last request failed',
  )
  expect(JSON.stringify(store.settings)).not.toContain(
    'private provider credentials',
  )
  const next = { ...scope, settings: store.settings }
  expect((await handleCottageAssistant(req(), next)).status).toBe(429)
  expect(provider.request).toHaveBeenCalledTimes(1)
})
it('status does not make a paid request or expose other users status', async () => {
  const { scope } = setup()
  scope.settings.assistantConnections = {
    other: { status: 'Connection successful' },
  }
  const response = await handleCottageAssistant(
    new Request('https://pantry.test/api/workspace?assistant=1'),
    scope,
  )
  expect(await response.json()).toMatchObject({
    status: 'Configured, not tested',
    checkedAt: null,
  })
  expect(provider.request).not.toHaveBeenCalled()
})
it('requires a successful request in this deployment and model before showing tested AI status', async () => {
  const { scope, store } = setup()
  provider.request.mockResolvedValue(result)
  await handleCottageAssistant(req(), { ...scope, deploymentId: 'deploy-a' })
  const check = async (deploymentId: string) =>
    (
      await handleCottageAssistant(
        new Request('https://pantry.test/api/workspace?assistant=1'),
        { ...scope, settings: store.settings, deploymentId },
      )
    ).json()
  expect(await check('deploy-a')).toMatchObject({
    status: 'Connection successful',
    model: 'perplexity/sonar',
  })
  expect(await check('deploy-b')).toMatchObject({
    status: 'Configured, not tested',
    checkedAt: null,
  })
  store.settings.assistantConnections[actor].model = 'different-model'
  expect(await check('deploy-a')).toMatchObject({
    status: 'Configured, not tested',
    checkedAt: null,
  })
  expect(provider.request).toHaveBeenCalledTimes(1)
})

beforeEach(() =>
  vi.stubGlobal('Netlify', {
    env: {
      get: (name: string) => (name === 'AI_ENABLED' ? 'true' : undefined),
    },
  }),
)
