import { z } from 'zod'
import {
  inventoryErrorMessage,
  inventoryErrorStack,
} from './inventory-error-details'
import { safeSupportRoute } from './support'
export const supportAiModel = 'gpt-4.1-mini'
export const supportAiDefaults = {
  enabled: true,
  userDaily: 20,
  businessDaily: 60,
  globalDaily: 400,
  cooldownSeconds: 10,
  retentionDays: 30,
}
export const supportAiPolicySchema = z
  .object({
    enabled: z.boolean(),
    userDaily: z.number().int().min(1).max(100),
    businessDaily: z.number().int().min(1).max(500),
    globalDaily: z.number().int().min(1).max(2000),
    cooldownSeconds: z.number().int().min(5).max(300),
    retentionDays: z.number().int().min(1).max(90),
  })
  .strict()
export function redactSupportText(raw: string) {
  return raw
    .replace(/https?:\/\/[^\s]+/gi, '[link omitted]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email omitted]')
    .replace(/\b(?:sk|pk|rk)[_-][a-z0-9_-]{8,}\b/gi, '[credential omitted]')
    .replace(/\b(?:bearer\s+)[a-z0-9._~+/-]+/gi, '[credential omitted]')
    .replace(
      /\b(?:password|token|secret|api[_ -]?key|authorization|cookie|card(?: number)?|cvv)\s*[:=]\s*[^\s,;]+/gi,
      '[sensitive value omitted]',
    )
    .replace(/\b\d(?:[ -]?\d){12,18}\b/g, '[number omitted]')
}
/** Rebuild allowlisted diagnostics; unknown text and arbitrary JSON never pass through. */
export function sanitizeSupportDiagnostics(raw: unknown) {
  if (!raw || typeof raw !== 'object') return null
  const input = raw as Record<string, unknown>
  const error = (
    input.error && typeof input.error === 'object' ? input.error : {}
  ) as Record<string, unknown>
  const string = (v: unknown) =>
    typeof v === 'string' ? v.slice(0, 20000) : ''
  return {
    appVersion: /^[a-f0-9]{12,64}$/i.test(string(input.appVersion))
      ? string(input.appVersion)
      : 'unknown',
    page: safeSupportRoute(string(input.pathname || input.page)),
    timestamp: Number.isFinite(Date.parse(string(input.timestamp)))
      ? new Date(string(input.timestamp)).toISOString()
      : null,
    error: {
      type: ['Error', 'TypeError', 'RangeError', 'NetworkError'].includes(
        string(error.type),
      )
        ? string(error.type)
        : 'Error',
      message: inventoryErrorMessage(string(error.message)),
      stack: inventoryErrorStack(
        string(error.stack),
        'https://mycottagepantry.com',
      ),
    },
  }
}
export type SupportAiMessage = {
  role: 'user' | 'assistant'
  text: string
  at: string
  articles?: string[]
}
export type SupportAiConversation = {
  id: string
  messages: SupportAiMessage[]
  diagnostics: ReturnType<typeof sanitizeSupportDiagnostics>
  contextTicketId?: string | null
  ticketId?: string | null
  expiresAt: string
}

export type SupportAiAction = {
  id: string
  conversation_id: string
  tool: string
  status: string
  updated_at: string
}
// Reference API token estimate only; Gateway/hosting charges and provider rate changes are separate.
export function supportTokenEstimate(input: number, output: number) {
  return (input * 0.4 + output * 1.6) / 1_000_000
}
