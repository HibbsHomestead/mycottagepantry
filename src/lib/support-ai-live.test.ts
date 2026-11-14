// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { supportAnswer } from '../../netlify/lib/support-ai-provider'
// Explicit, bounded connectivity test. Ordinary CI never spends provider credits.
it.skipIf(process.env.SUPPORT_AI_LIVE_CHECK !== '1')(
  'answers a real app-use question through the configured AI Gateway',
  async () => {
    const answer = await supportAnswer([
      {
        role: 'user',
        text: 'Inventory shows Conversion required. How should I review the units before receiving stock?',
        at: new Date().toISOString(),
      },
    ])
    expect(answer.text.length).toBeGreaterThan(20)
    expect(answer.text).toMatch(/unit|conversion/i)
    expect(answer.text).not.toMatch(/https?:\/\//)
    expect(answer.articles).toContain('inventory')
    expect(answer.outputTokens).toBeGreaterThan(0)
    expect(answer.outputTokens).toBeLessThanOrEqual(550)
  },
  30000,
)

it.skipIf(process.env.SUPPORT_AI_LIVE_CHECK !== '1')(
  'answers the exact item-type question and follows its context without inventing a conversion',
  async () => {
    const at = new Date().toISOString()
    const messages: import('./support-ai').SupportAiMessage[] = [
      {
        role: 'user',
        text: 'How do I change an ingredient to a craft material?',
        at,
      },
    ]
    const answer = await supportAnswer(messages)
    expect(answer.text).toMatch(
      /cannot|can’t|can.t|fixed|not.*(?:change|convert)/i,
    )
    expect(answer.text).toMatch(/Add Item/i)
    expect(answer.text).toMatch(/Craft Material/i)
    expect(answer.text).toMatch(/original|existing ingredient/i)
    expect(answer.articles).toContain('item-types')
    messages.push(
      { role: 'assistant', text: answer.text, at },
      {
        role: 'user',
        text: 'What if it has no stock? Can I keep the linked recipes and transfer its history?',
        at,
      },
    )
    const followup = await supportAnswer(messages)
    expect(followup.text).toMatch(
      /fixed|cannot|can’t|can.t|still|not.*(?:change|convert)/i,
    )
    expect(followup.text).toMatch(/history|recipes/i)
    expect(followup.articles).toContain('item-types')
  },
  60000,
)

it.skipIf(process.env.SUPPORT_AI_LIVE_CHECK !== '1')(
  'uses an allowlisted status tool and describes recorded evidence without claiming a repair',
  async () => {
    const run = vi.fn(async () => ({
      activeBusiness: true,
      billing: { plan: 'free', status: 'free_active', source: 'internal' },
      integrations: [{ provider: 'square', status: 'disconnected' }],
      limitation:
        'Recorded metadata only, not live payment verification. No change made.',
    }))
    const answer = await supportAnswer(
      [
        {
          role: 'user',
          text: 'Please use business_status to check my recorded billing and integration status. Is Square connected?',
          at: new Date().toISOString(),
        },
      ],
      false,
      { names: ['business_status'], run },
    )
    expect(run).toHaveBeenCalledWith('business_status', {})
    expect(answer.text).toMatch(/disconnected|not connected/i)
    expect(answer.text).not.toMatch(/fixed|repaired|successfully connected/i)
    expect(answer.inputTokens).toBeGreaterThan(0)
  },
  30000,
)
