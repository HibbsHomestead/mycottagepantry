// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { aiEnabled } from '../../netlify/lib/feature-flags'
const dependencies = vi.hoisted(() => ({
  database: vi.fn(),
  identity: vi.fn(),
  inference: vi.fn(),
}))
vi.mock('@netlify/database', () => ({ getDatabase: dependencies.database }))
vi.mock('@netlify/identity', () => ({ getUser: dependencies.identity }))
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: dependencies.inference }
  },
}))
import handler from '../../netlify/functions/workspace.mts'
import { requestAssistant } from '../../netlify/lib/cottage-assistant'
import { handleCottageAssistant } from '../../netlify/lib/cottage-assistant-handler'
import { extractRecipeDocument } from '../../netlify/lib/recipe-import'
import { extractReceipt } from '../../netlify/lib/receipt-extraction'
import { handlePackagePhotos } from '../../netlify/lib/package-photo-handler'
afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})
it('enforces the photo kill switch on every route and role before database or provider calls', async () => {
  vi.stubGlobal('Netlify', {
    env: {
      get: (key: string) =>
        key === 'PACKAGE_PHOTO_PILOT_ENABLED' ? 'false' : undefined,
    },
  })
  for (const path of ['/api/workspace', '/.netlify/functions/workspace']) {
    const response = await handler(
      new Request('https://fixture.test' + path + '?packagePhotos=1', {
        method: 'POST',
      }),
      {} as never,
    )
    expect(response.status).toBe(404)
  }
  for (const role of ['Owner', 'Manager', 'Production Staff']) {
    const response = await handlePackagePhotos(
      new Request('https://fixture.test', { method: 'POST' }),
      { client: { query: async () => ({ rows: [] }) }, org: 'fixture', role },
    )
    expect(response.status).toBe(404)
  }
  expect(dependencies.database).not.toHaveBeenCalled()
  expect(dependencies.inference).not.toHaveBeenCalled()
})
it.each([undefined, '', 'false', 'TRUE', '1', ' true '])(
  'blocks inference and OCR before provider calls with flag %s',
  async (value) => {
    vi.stubGlobal('Netlify', {
      env: {
        get: (name: string) =>
          name === 'AI_ENABLED'
            ? value
            : name === 'RECEIPT_READING_ENABLED'
              ? 'false'
              : undefined,
      },
    })
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    expect(aiEnabled()).toBe(false)
    await expect(
      requestAssistant({ mode: 'research', text: '100g flour' }),
    ).rejects.toMatchObject({ code: 'FEATURE_UNAVAILABLE' })
    await expect(
      extractRecipeDocument(Buffer.from('fixture'), 'application/pdf'),
    ).rejects.toThrow('unavailable')
    await expect(
      extractReceipt(Buffer.from('fixture'), 'application/pdf'),
    ).rejects.toThrow('unavailable')
    expect(dependencies.inference).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
  },
)
it('defaults off without the runtime', () => {
  vi.stubGlobal('Netlify', undefined)
  expect(aiEnabled()).toBe(false)
})
it('rejects direct assistant status, tests, research and draft suggestions before DB, auth, usage or inference', async () => {
  vi.stubGlobal('Netlify', { env: { get: () => undefined } })
  for (const path of ['/api/workspace', '/.netlify/functions/workspace'])
    for (const method of ['GET', 'POST']) {
      const response = await handler(
        new Request('https://fixture.test' + path + '?assistant=1', {
          method,
          ...(method === 'POST'
            ? { body: JSON.stringify({ mode: 'research', text: 'flour' }) }
            : {}),
        }),
        {} as never,
      )
      expect(response.status).toBe(404)
      expect(await response.json()).toMatchObject({
        code: 'FEATURE_UNAVAILABLE',
      })
    }
  const direct = await handleCottageAssistant(
    new Request('https://fixture.test'),
    {} as never,
  )
  expect(direct.status).toBe(404)
  expect(dependencies.database).not.toHaveBeenCalled()
  expect(dependencies.identity).not.toHaveBeenCalled()
  expect(dependencies.inference).not.toHaveBeenCalled()
})

it('rejects explicitly disabled receipt extraction without provisioning an oven or recording a quota attempt', async () => {
  vi.stubGlobal('Netlify', {
    env: {
      get: (name: string) =>
        name === 'RECEIPT_READING_ENABLED' ? 'false' : undefined,
    },
  })
  const response = await handler(
    new Request('https://fixture.test/api/workspace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'receiptExtract',
        data: { id: 'receipt' },
      }),
    }),
    {} as never,
  )
  expect(response.status).toBe(404)
  expect(dependencies.database).not.toHaveBeenCalled()
  expect(dependencies.identity).not.toHaveBeenCalled()
  expect(dependencies.inference).not.toHaveBeenCalled()
})
