// @vitest-environment node
import { expect, it } from 'vitest'
import OpenAI from 'openai'
import {
  assistantFailure,
  requestAssistant,
} from '../../netlify/lib/cottage-assistant'

// Explicit opt-in: successful inference consumes Netlify AI credits. No credentials,
// raw responses, or private workspace data are printed or recorded.
const live = process.env.COTTAGE_ASSISTANT_LIVE_TEST === '1'
it.skipIf(!live)(
  'extracts actual draft fields through Gateway → OpenRouter → Perplexity',
  async () => {
    const text =
      'King Arthur Bread Flour. Brand: King Arthur. Package: 5 lb bag. Price: 6.49. Currency: USD. UPC: 071012041053.'
    const result = await requestAssistant({ mode: 'paste', text })
    expect(result.model).toBe('perplexity/sonar')
    expect(result.fields).toMatchObject({
      purchaseQuantity: 5,
      purchaseUnit: 'lb',
    })
    if (result.fields.barcode !== undefined)
      expect(result.fields.barcode).toBe('071012041053')
    if (result.fields.packagePrice !== undefined)
      expect(result.fields.packagePrice).toBe(6.49)
    if (result.fields.currency !== undefined)
      expect(result.fields.currency).toBe('USD')
    for (const key of Object.keys(result.fields))
      expect(text).toContain(result.evidence[key])
    expect(result.fields).not.toHaveProperty('reviewed')
    expect(result.usage.totalTokens).toBeGreaterThan(0)
  },
  35000,
)
it.skipIf(!live)(
  'turns a real rejected gateway request into a clear safe error',
  async () => {
    const client = new OpenAI({
      // Intentionally invalid, nonsecret test text exercises gateway rejection
      // without modifying or revealing the actual runtime credentials.
      apiKey: 'intentional-invalid-test-value',
      baseURL: process.env.OPENAI_BASE_URL,
      maxRetries: 0,
      timeout: 25000,
    })
    const rejection = await client.chat.completions
      .create({
        model: 'perplexity/sonar',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'Connection rejection test.' }],
      })
      .then(
        () => null,
        (error: unknown) => ({
          status: (error as { status: number }).status,
          failure: assistantFailure(error),
        }),
      )
    expect([401, 403]).toContain(rejection?.status)
    expect(rejection?.failure.code).toBe('GATEWAY_ACCESS')
    expect(rejection?.failure.message).toContain(
      'Gateway rejected this connection',
    )
  },
  35000,
)
it.skipIf(!live)(
  'returns actual web research and displayable citation metadata separately',
  async () => {
    const result = await requestAssistant({
      mode: 'research',
      text: 'Research King Arthur Baking Bread Flour, 5 lb bag. Verify the package size and cite official manufacturer product or packaging sources.',
    })
    expect(result.model).toBe('perplexity/sonar')
    expect(result.fields).toEqual({})
    expect(result.answer.length).toBeGreaterThan(30)
    expect(result.sources.length).toBeGreaterThan(0)
    expect(
      result.sources.some((source) =>
        new URL(source.url).hostname.endsWith('kingarthurbaking.com'),
      ),
    ).toBe(true)
    expect(
      result.sources.every(
        (source) => source.title && /^https?:\/\//.test(source.url),
      ),
    ).toBe(true)
  },
  35000,
)
