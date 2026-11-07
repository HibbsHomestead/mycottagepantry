// @vitest-environment node
import sharp from 'sharp'
import { afterEach, expect, it, vi } from 'vitest'
const sdk = vi.hoisted(() => ({ generate: vi.fn(), options: vi.fn() }))
vi.mock('../../netlify/lib/feature-flags', async (original) => ({
  ...(await original<typeof import('../../netlify/lib/feature-flags')>()),
  packagePhotoPilotApproved: () => true,
}))
vi.mock('openai', () => ({
  default: class {
    constructor(options: unknown) {
      sdk.options(options)
    }
    chat = {
      completions: {
        create: async (request: unknown) => {
          const response = await sdk.generate(request)
          return {
            id: 'provider-fixture',
            model: 'gpt-4.1-mini-2025-04-14',
            choices: [
              { finish_reason: 'stop', message: { content: response.text } },
            ],
            usage: {
              prompt_tokens: response.usageMetadata?.promptTokenCount ?? 4000,
              completion_tokens:
                response.usageMetadata?.candidatesTokenCount ?? 800,
              completion_tokens_details: {
                reasoning_tokens:
                  response.usageMetadata?.thoughtsTokenCount ?? 0,
              },
            },
          }
        },
      },
    }
  },
}))
import { PHOTO_ACCOUNT, PHOTO_WORKSPACE } from '../../netlify/lib/photo-pilot'
import {
  readPackagePhotos,
  handlePackagePhotos,
} from '../../netlify/lib/package-photo-handler'
afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})
const readable = {
  fields: [
    {
      field: 'name',
      value: 'Package flour',
      photoId: 'back',
      quote: 'Package flour',
      uncertain: false,
    },
    {
      field: 'subingredients',
      value: 'Wheat (flour, malt)',
      photoId: 'back',
      quote: 'Wheat (flour, malt)',
      uncertain: false,
    },
  ],
  warnings: [],
}
const photo = () =>
  sharp({
    create: { width: 40, height: 80, channels: 3, background: '#ede9db' },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer()
it('accepts either side alone, normalizes rotation, strips EXIF and records content-free usage metadata', async () => {
  sdk.generate.mockResolvedValue({
    text: JSON.stringify(readable),
    usageMetadata: {
      promptTokenCount: 4000,
      candidatesTokenCount: 800,
      thoughtsTokenCount: 0,
    },
  })
  const result = await readPackagePhotos([{ id: 'back', bytes: await photo() }])
  expect(result.fields).toEqual(readable.fields)
  expect(result.usage).toEqual({
    inputTokens: 4000,
    outputTokens: 800,
    thoughtTokens: 0,
  })
  const parts = sdk.generate.mock.calls[0][0].messages[0].content
  const sent = parts.find((p: { image_url?: unknown }) => p.image_url).image_url
  const meta = await sharp(
    Buffer.from(sent.url.split(',')[1], 'base64'),
  ).metadata()
  expect(meta).toMatchObject({ width: 80, height: 40 })
  expect(meta.exif).toBeUndefined()
  expect(meta.orientation).toBeUndefined()
  expect(sdk.generate).toHaveBeenCalledTimes(1)
  expect(sdk.options).toHaveBeenCalledWith({ maxRetries: 0, timeout: 45000 })
  expect(sdk.generate.mock.calls[0][0]).toMatchObject({
    model: 'gpt-4.1-mini',
    max_completion_tokens: 6000,
    store: false,
  })
})
it('preserves conflicting evidence separately and marks an invalid barcode as uncertain', async () => {
  sdk.generate.mockResolvedValue({
    text: JSON.stringify({
      fields: [
        {
          field: 'subingredients',
          value: 'Wheat, salt',
          photoId: 'back',
          quote: 'Wheat, salt',
          uncertain: false,
        },
        {
          field: 'subingredients',
          value: 'Wheat, milk',
          photoId: 'front',
          quote: 'Wheat, milk',
          uncertain: true,
        },
        {
          field: 'barcode',
          value: '036000291453',
          photoId: 'front',
          quote: '036000291453',
          uncertain: false,
        },
      ],
      warnings: ['Photos may show different package variants.'],
    }),
  })
  const bytes = await photo(),
    result = await readPackagePhotos([
      { id: 'front', bytes },
      { id: 'back', bytes },
    ])
  expect(
    result.fields
      .filter((f) => f.field === 'subingredients')
      .map((f) => f.value),
  ).toEqual(['Wheat, salt', 'Wheat, milk'])
  expect(result.fields.find((f) => f.field === 'barcode')?.uncertain).toBe(true)
})
it('refuses unsupported bytes, invented photo evidence, private fields and nutrition output', async () => {
  await expect(
    readPackagePhotos([{ id: 'front', bytes: Buffer.from('not an image') }]),
  ).rejects.toMatchObject({ code: 'PHOTO_FORMAT' })
  sdk.generate.mockResolvedValue({ text: JSON.stringify(readable) })
  await expect(
    readPackagePhotos([{ id: 'front', bytes: await photo() }]),
  ).rejects.toMatchObject({ code: 'PHOTO_EVIDENCE_INVALID' })
  sdk.generate.mockResolvedValue({
    text: JSON.stringify({
      ...readable,
      fields: [
        {
          field: 'calories',
          value: 300,
          photoId: 'back',
          quote: 'Calories 300',
          uncertain: false,
        },
      ],
    }),
  })
  await expect(
    readPackagePhotos([{ id: 'back', bytes: await photo() }]),
  ).rejects.toMatchObject({ code: 'PHOTO_RESPONSE_INVALID' })
  expect(sdk.generate).toHaveBeenCalledTimes(2)
})
it('enforces write roles before reading files and sanitizes SDK failure responses without saving images', async () => {
  const client = {
    query: vi.fn(async (sql: string, _params?: unknown[]) => ({
      rows: sql.startsWith('SELECT data FROM photo_pilot_grants')
        ? [
            {
              id: 'grant',
              name: 'Grant',
              data: {
                enabled: true,
                processingEnabled: true,
                boundsVerified: true,
                dailyLimit: 20,
                monthlyLimit: 100,
                spendLimitMicros: 2000000,
                reservationMicros: 50000,
              },
            },
          ]
        : [],
    })),
  }
  const denied = await handlePackagePhotos(
    new Request('https://test.invalid/api/workspace?packagePhotos=1', {
      method: 'POST',
    }),
    {
      client,
      org: PHOTO_WORKSPACE,
      actor: PHOTO_ACCOUNT,
      role: 'Production Staff',
    },
  )
  expect(denied.status).toBe(403)
  expect(sdk.generate).not.toHaveBeenCalled()
  // Provider details may contain credentials; the client sees only the safe summary.
  sdk.generate.mockRejectedValue(new Error('provider-request-body-and-secret'))
  const form = new FormData()
  form.append(
    'back',
    new Blob([new Uint8Array(await photo())], { type: 'image/jpeg' }),
    'label.jpg',
  )
  const response = await handlePackagePhotos(
    new Request('https://test.invalid/api/workspace?packagePhotos=1', {
      method: 'POST',
      headers: { 'Idempotency-Key': '00000000-0000-4000-8000-000000000001' },
      body: form,
    }),
    { client, org: PHOTO_WORKSPACE, actor: PHOTO_ACCOUNT, role: 'Owner' },
  )
  expect(response.status).toBe(503)
  const body = await response.json()
  expect(body.error).toContain('your photos and draft are preserved')
  expect(JSON.stringify(body)).not.toContain('secret')
  expect(
    client.query.mock.calls.some(([sql]) =>
      /INSERT INTO (ingredients|graphic_assets|ledger)/.test(sql),
    ),
  ).toBe(false)
})

it('does not dispatch inference when durable attempt recording fails; rejects unexpected provider token usage', async () => {
  const observe = vi.fn(async () => {
    throw new Error('database unavailable')
  })
  await expect(
    readPackagePhotos([{ id: 'back', bytes: await photo() }], observe),
  ).rejects.toThrow('database unavailable')
  expect(sdk.generate).not.toHaveBeenCalled()
  sdk.generate.mockResolvedValue({
    text: JSON.stringify(readable),
    usageMetadata: { promptTokenCount: 40001, candidatesTokenCount: 800 },
  })
  await expect(
    readPackagePhotos([{ id: 'back', bytes: await photo() }]),
  ).rejects.toMatchObject({ code: 'PHOTO_USAGE_UNCERTAIN' })
  expect(sdk.generate).toHaveBeenCalledTimes(1)
})
