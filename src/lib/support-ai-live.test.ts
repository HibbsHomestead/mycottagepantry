// @vitest-environment node
import { expect, it } from 'vitest'
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
