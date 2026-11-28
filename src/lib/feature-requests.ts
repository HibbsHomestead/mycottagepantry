import { z } from 'zod'

export const boardStatuses = [
  'New',
  'Under review',
  'Planned',
  'In progress',
  'Shipped',
  'Not planned',
] as const
export const boardCategories = [
  'Recipes',
  'Products',
  'Labels',
  'Inventory',
  'Orders/Sales',
  'Reports',
  'Other',
] as const

const uuid = z.uuid()
const displayName = z.string().trim().max(32).optional()
const title = z.string().trim().min(5).max(100)
const useCase = z.string().trim().min(12).max(2000)
const category = z.enum(boardCategories)
const reason = z.string().trim().min(3).max(500)
const releaseLink = z
  .url({ protocol: /^https$/ })
  .max(300)
  .refine((value) => {
    const url = new URL(value)
    return !url.username && !url.password
  })
const requestFields = { title, useCase, category, displayName }

export const boardCommand = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('submit'),
    ...requestFields,
    image: z.string().max(2_800_000).optional(),
  }),
  z.strictObject({ action: z.literal('edit'), id: uuid, ...requestFields }),
  z.strictObject({ action: z.literal('withdraw'), id: uuid }),
  z.strictObject({ action: z.literal('vote'), id: uuid, enabled: z.boolean() }),
  z.strictObject({
    action: z.literal('follow'),
    id: uuid,
    enabled: z.boolean(),
  }),
  z.strictObject({
    action: z.literal('comment'),
    id: uuid,
    body: z.string().trim().min(3).max(1000),
    displayName,
  }),
  z.strictObject({
    action: z.literal('report'),
    id: uuid,
    commentId: uuid.optional(),
    reason,
  }),
  z.strictObject({
    action: z.literal('preferences'),
    notifications: z.boolean(),
  }),
  z.strictObject({ action: z.literal('read'), eventId: uuid }),
  z.strictObject({
    action: z.literal('status'),
    id: uuid,
    status: z.enum(boardStatuses),
    note: z.string().trim().max(500),
  }),
  z.strictObject({
    action: z.literal('triage'),
    id: uuid,
    title,
    category,
    tags: z.array(z.string().trim().min(1).max(24)).max(6),
    releaseUrl: z.union([z.literal(''), releaseLink]),
  }),
  z.strictObject({ action: z.literal('merge'), id: uuid, targetId: uuid }),
  z.strictObject({
    action: z.literal('hide'),
    id: uuid,
    commentId: uuid.optional(),
    reason,
  }),
  z.strictObject({ action: z.literal('reviewReport'), id: uuid, reason }),
  z.strictObject({
    action: z.literal('voteLimit'),
    limit: z.number().int().min(1).max(1000).nullable(),
  }),
  z.strictObject({
    action: z.literal('anonymize'),
    subject: uuid,
    confirmation: z.literal('Verified account deletion'),
    reviewed: z
      .array(
        z.union([
          z.strictObject({ id: uuid, title, useCase }),
          z.strictObject({
            id: uuid,
            body: z.string().trim().min(3).max(1000),
          }),
        ]),
      )
      .max(100)
      .optional(),
  }),
])

export type BoardCommand = z.infer<typeof boardCommand>
export type BoardStatus = (typeof boardStatuses)[number]
export type BoardCategory = (typeof boardCategories)[number]
export type BoardRequest = {
  id: string
  title: string
  useCase: string
  category: BoardCategory
  status: BoardStatus
  displayName: string
  own: boolean
  editable: boolean
  votes: number
  voted: boolean
  following: boolean
  hasImage: boolean
  tags: string[]
  releaseUrl: string | null
  createdAt: string
  hidden?: boolean
}
export type BoardDetail = {
  request: BoardRequest
  comments: {
    id: string
    body: string
    displayName: string
    createdAt: string
    hidden?: boolean
  }[]
  history: {
    id: string
    status: BoardStatus
    note: string | null
    createdAt: string
  }[]
  redirected: boolean
}
export type BoardListing = {
  requests: BoardRequest[]
  notifications: boolean
  voteLimit: number | null
  inbox: {
    id: string
    requestId: string
    title: string
    status: BoardStatus
  }[]
  reports?: {
    id: string
    requestId: string
    commentId: string | null
    reason: string
    title: string
  }[]
  hasMore: boolean
}

export const boardTitleKey = (value: string) =>
  value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
