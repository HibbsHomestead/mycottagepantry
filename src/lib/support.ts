import { z } from 'zod'
export const supportCategories = [
  'Question',
  'Bug',
  'Account & billing',
  'Feature request',
] as const
export const supportStatuses = {
  new: 'New',
  in_progress: 'In progress',
  waiting_on_customer: 'Waiting on customer',
  resolved: 'Resolved',
} as const
export const ticketInput = z
  .object({
    subject: z.string().trim().min(1).max(160),
    aiReviewConsent: z.boolean().default(false),
    category: z.enum(supportCategories),
    message: z.string().trim().min(1).max(6000),
    submissionKey: z.string().uuid(),
    route: z.string().max(250).optional(),
  })
  .strict()
export const replyInput = z
  .object({
    ticketId: z.string().uuid(),
    message: z.string().trim().min(1).max(6000),
    submissionKey: z.string().uuid(),
    internal: z.boolean().default(false),
  })
  .strict()
export const emailAddress = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((v) => v.toLowerCase())
export type SupportTicket = {
  id: string
  number: number
  subject: string
  category: string
  status: keyof typeof supportStatuses
  createdAt: string
  updatedAt: string
  requesterEmail?: string
  workspaceId?: string
  diagnostics?: Record<string, string>
}
export type SupportMessage = {
  id: string
  kind: 'customer' | 'support' | 'internal'
  body: string
  createdAt: string
  own: boolean
  attachments: { id: string; byteSize: number }[]
}
export type SupportDetail = {
  aiConversation?: {
    id: string
    messages: import('./support-ai').SupportAiMessage[]
    diagnostics: unknown
    expires_at: string
  } | null
  ticket: SupportTicket
  messages: SupportMessage[]
  notifications?: {
    id: string
    kind: string
    status: string
    attempts: number
    errorCode: string | null
  }[]
}

/** Deliberately retains no URL IDs, query, fragments, tokens or arbitrary diagnostic values. */
export function safeSupportRoute(value?: string) {
  if (!value) return '/oven'
  try {
    const url = new URL(value, 'https://mycottagepantry.com')
    const pathname = url.pathname.replace(/^\/(workspace|studio)$/, '/oven')
    const path = [
      '/oven',
      '/oven/billing',
      '/help',
      '/login',
      '/support',
      '/platform-support',
    ].includes(pathname)
      ? pathname
      : '/oven'
    const section = decodeURIComponent(url.hash.slice(1))
      .split('?')[0]
      .split('/')[0]
    return path === '/oven' &&
      [
        'Dashboard',
        'Pantry',
        'Recipes',
        'Products & Pricing',
        'Production',
        'Labels',
        'Finances',
        'Reports',
        'Settings',
        'Inventory',
        'Products',
        'Purchasing',
        'Finance',
        'Sales',
      ].includes(section)
      ? `${path}#${section}`
      : path
  } catch {
    return '/oven'
  }
}
