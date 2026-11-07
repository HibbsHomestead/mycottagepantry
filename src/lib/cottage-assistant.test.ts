// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const provider = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('openai', () => {
  class Client {
    static APIConnectionTimeoutError = class extends Error {}
    chat = { completions: { create: provider.create } }
  }
  return { default: Client }
})
import {
  assistantDraftPatch,
  assistantInput,
  readAssistantResponse,
  type AssistantResult,
} from './cottage-assistant'
import {
  assistantFailure,
  citationSources,
  gatewayConfigured,
  requestAssistant,
  reserveAssistant,
} from '../../netlify/lib/cottage-assistant'
beforeEach(() => {
  provider.create.mockReset()
  vi.stubEnv('NETLIFY_AI_GATEWAY_KEY', 'test-only-placeholder')
  vi.stubEnv('NETLIFY_AI_GATEWAY_URL', 'https://gateway.test')
  vi.stubEnv('OPENAI_BASE_URL', 'https://gateway.test/openai/v1')
})
afterEach(() => vi.unstubAllEnvs())
it('accepts only product text and a mode; never client oven or role', () => {
  expect(
    assistantInput.safeParse({
      mode: 'paste',
      text: 'Some product text',
      businessId: 'other',
      role: 'Owner',
    }).success,
  ).toBe(false)
  expect(
    assistantInput.safeParse({ mode: 'paste', text: 'x'.repeat(12001) })
      .success,
  ).toBe(false)
})
it('rejects an overridden direct-provider connection', () => {
  expect(gatewayConfigured()).toBe(true)
  vi.stubEnv('OPENAI_BASE_URL', 'https://direct-provider.test/v1')
  expect(gatewayConfigured()).toBe(false)
})
it('withholds unsupported or invented evidence and preserves leading zeros', async () => {
  provider.create.mockResolvedValue({
    model: 'perplexity/sonar',
    choices: [
      {
        message: {
          content: JSON.stringify({
            fields: { barcode: '071012041053', brand: 'Invented' },
            evidence: { barcode: 'UPC 071012041053', brand: 'Not in input' },
          }),
        },
      },
    ],
  })
  const result = await requestAssistant({
    mode: 'paste',
    text: 'UPC 071012041053 printed on the package.',
  })
  expect(result.fields).toEqual({ barcode: '071012041053' })
  expect(result.warnings).toHaveLength(1)
  expect(provider.create.mock.calls[0][0].messages[1]).toEqual({
    role: 'user',
    content: 'UPC 071012041053 printed on the package.',
  })
})
it.each([
  ['not JSON', 'invalid field suggestion'],
  [
    JSON.stringify({ fields: { quantity: 999, reviewed: true }, evidence: {} }),
    'invalid field suggestion',
  ],
  [
    JSON.stringify({ fields: { purchaseQuantity: 0 }, evidence: {} }),
    'invalid field suggestion',
  ],
])(
  'rejects unusable model output without returning a patch',
  async (content, message) => {
    provider.create.mockResolvedValue({
      model: 'perplexity/sonar',
      choices: [{ message: { content } }],
    })
    await expect(
      requestAssistant({ mode: 'paste', text: 'Some product text' }),
    ).rejects.toThrow(message)
  },
)
it('reports missing web metadata instead of claiming sourced research', async () => {
  provider.create.mockResolvedValue({
    model: 'perplexity/sonar',
    choices: [{ message: { content: 'A product research answer' } }],
  })
  const result = await requestAssistant({
    mode: 'research',
    text: 'Research the flour product',
  })
  expect(result.sources).toEqual([])
  expect(result.warnings[0]).toMatch(/no web source metadata/)
  expect(result.fields).toEqual({})
})
it('withholds values that contradict an otherwise exact evidence quote', async () => {
  provider.create.mockResolvedValue({
    model: 'perplexity/sonar',
    choices: [
      {
        message: {
          content: JSON.stringify({
            fields: {
              packagePrice: 99,
              barcode: '999999999999',
              sourceContains: 'No allergens',
            },
            evidence: {
              packagePrice: 'Price: 6.49 USD',
              barcode: 'UPC: 071012041053',
              sourceContains: 'Contains: Wheat',
            },
          }),
        },
      },
    ],
  })
  const result = await requestAssistant({
    mode: 'paste',
    text: 'Price: 6.49 USD. UPC: 071012041053. Contains: Wheat.',
  })
  expect(result.fields).toEqual({})
})
it('extracts real annotation metadata, removes unsafe links, and deduplicates citations', () => {
  expect(
    citationSources({
      choices: [
        {
          message: {
            annotations: [
              {
                type: 'url_citation',
                url_citation: {
                  url: 'https://maker.test/flour',
                  title: 'Flour',
                },
              },
              {
                type: 'url_citation',
                url_citation: { url: 'javascript:alert(1)', title: 'Bad' },
              },
              {
                type: 'url_citation',
                url_citation: {
                  url: 'https://secret@maker.test/flour',
                  title: 'Bad',
                },
              },
            ],
          },
        },
      ],
      citations: ['https://maker.test/flour'],
    }),
  ).toEqual([{ url: 'https://maker.test/flour', title: 'Flour' }])
})
it('applies only selected allowed fields, resets allergen approval, and never applies research', () => {
  const result = {
    mode: 'paste',
    fields: { name: 'Bread flour', barcode: '071012041053' },
  } as AssistantResult
  expect(assistantDraftPatch(result, ['name'])).toEqual({
    name: 'Bread flour',
    reviewed: false,
  })
  expect(
    assistantDraftPatch({ ...result, mode: 'research' }, ['name']),
  ).toEqual({})
  expect(assistantDraftPatch(result, [])).toEqual({})
})
it('enforces user and oven windows, cooldown, and daily limits independently', () => {
  const now = 200000000
  expect(() =>
    reserveAssistant([{ actor: 'a', at: now - 1000 }], 'a', now),
  ).toThrow('15 seconds')
  const userHour = Array.from({ length: 10 }, (_, i) => ({
    actor: 'a',
    at: now - 20000 - i * 1000,
  }))
  expect(() => reserveAssistant(userHour, 'a', now)).toThrow('limit reached')
  expect(reserveAssistant(userHour, 'b', now)).toHaveLength(11)
  expect(() =>
    reserveAssistant(
      Array.from({ length: 30 }, (_, i) => ({
        actor: String(i),
        at: now - 100000,
      })),
      'new',
      now,
    ),
  ).toThrow('limit reached')
  expect(() =>
    reserveAssistant(
      Array.from({ length: 30 }, () => ({ actor: 'a', at: now - 4000000 })),
      'a',
      now,
    ),
  ).toThrow('limit reached')
  expect(() =>
    reserveAssistant(
      Array.from({ length: 100 }, (_, i) => ({
        actor: String(i),
        at: now - 4000000,
      })),
      'new',
      now,
    ),
  ).toThrow('limit reached')
  expect(
    reserveAssistant([{ actor: 'a', at: now - 86400001 }], 'a', now),
  ).toHaveLength(1)
})
it.each([401, 403, 429, 402, 400, 500])(
  'sanitizes provider HTTP %s errors and never leaks raw error content',
  (status) => {
    const result = assistantFailure({
      status,
      message: 'sensitive-provider-details',
    })
    expect(result.message).not.toContain('sensitive-provider-details')
    expect(result.status).toBeGreaterThanOrEqual(400)
  },
)
it('maps a real provider rejection without retries or provider switching', async () => {
  provider.create.mockRejectedValue({
    status: 429,
    message: 'private upstream message',
  })
  await expect(
    requestAssistant({ mode: 'paste', text: 'Some product information' }),
  ).rejects.toMatchObject({ status: 429, code: 'PROVIDER_LIMIT' })
  expect(provider.create).toHaveBeenCalledTimes(1)
})
it('handles site protection, malformed JSON and non-JSON errors clearly', async () => {
  await expect(
    readAssistantResponse(
      new Response('<html>Login</html>', {
        status: 401,
        headers: { 'content-type': 'text/html' },
      }),
    ),
  ).rejects.toThrow('sign-in')
  await expect(
    readAssistantResponse(
      new Response('', { headers: { 'content-type': 'application/json' } }),
    ),
  ).rejects.toThrow('unreadable response')
  await expect(
    readAssistantResponse(
      Response.json({ error: 'Wait before another request.' }, { status: 429 }),
    ),
  ).rejects.toThrow('Wait before')
})

beforeEach(() =>
  vi.stubGlobal('Netlify', {
    env: {
      get: (name: string) =>
        name === 'AI_ENABLED' ? 'true' : process.env[name],
    },
  }),
)
