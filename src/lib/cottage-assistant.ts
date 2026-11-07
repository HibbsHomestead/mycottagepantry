import { z } from 'zod'

export const assistantModel = 'perplexity/sonar'
export const assistantLimits = {
  userHourly: 10,
  userDaily: 30,
  workspaceHourly: 30,
  workspaceDaily: 100,
  cooldownSeconds: 15,
}
export const assistantFieldLabels = {
  name: 'Name',
  brand: 'Brand',
  vendor: 'Preferred vendor',
  barcode: 'Barcode',
  retailerSku: 'Retailer SKU',
  purchaseQuantity: 'Package quantity',
  purchaseUnit: 'Package unit',
  packagePrice: 'Package price',
  currency: 'Currency',
  subingredients: 'Source ingredient statement',
  sourceContains: 'Source Contains statement',
  sourceMayContain: 'Source May contain statement',
} as const
export type AssistantField = keyof typeof assistantFieldLabels
export const assistantFields = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    brand: z.string().trim().min(1).max(200).optional(),
    vendor: z.string().trim().min(1).max(200).optional(),
    barcode: z
      .string()
      .regex(/^\d{8}$|^\d{12,14}$/)
      .optional(),
    retailerSku: z.string().min(1).max(100).optional(),
    purchaseQuantity: z.number().finite().positive().max(1000000).optional(),
    purchaseUnit: z
      .enum([
        'g',
        'kg',
        'oz',
        'lb',
        'ml',
        'l',
        'fl oz',
        'cup',
        'tbsp',
        'tsp',
        'each',
        'dozen',
        'package',
        'case',
      ])
      .optional(),
    packagePrice: z.number().finite().nonnegative().max(1000000).optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    subingredients: z.string().min(1).max(4000).optional(),
    sourceContains: z.string().min(1).max(2000).optional(),
    sourceMayContain: z.string().min(1).max(2000).optional(),
  })
  .strict()
export const assistantInput = z
  .object({
    mode: z.enum(['paste', 'research']),
    text: z.string().trim().min(10).max(12000),
  })
  .strict()
const source = z.object({
  url: z
    .string()
    .url()
    .refine((value) => {
      const url = new URL(value)
      return (
        ['http:', 'https:'].includes(url.protocol) &&
        !url.username &&
        !url.password
      )
    }),
  title: z.string().max(500),
})
export const assistantResult = z.object({
  mode: z.enum(['paste', 'research']),
  model: z.literal(assistantModel),
  fields: assistantFields,
  evidence: z.record(z.string(), z.string().max(12000)),
  answer: z.string().max(16000),
  sources: z.array(source).max(30),
  warnings: z.array(z.string().max(1000)).max(20),
  checkedAt: z.string().datetime(),
  usage: z.object({
    totalTokens: z.number().nonnegative().nullable(),
    costUsd: z.number().nonnegative().nullable(),
  }),
})
export type AssistantResult = z.infer<typeof assistantResult>
export const assistantStatus = z.object({
  configured: z.boolean(),
  status: z.enum([
    'Unavailable',
    'Configured, not tested',
    'Connection successful',
    'Last request failed',
  ]),
  model: z.literal(assistantModel),
  checkedAt: z.string().nullable(),
  sourcesReturned: z.boolean().nullable(),
  message: z.string().nullable(),
})
export type AssistantStatus = z.infer<typeof assistantStatus>

// This allowlist is also applied at the final draft boundary. AI cannot set
// stock, conversion, accounting, cost, identity, or reviewed fields.
export function assistantDraftPatch(
  result: AssistantResult,
  selected: string[],
) {
  if (result.mode !== 'paste') return {}
  const patch = assistantFields.parse(
    Object.fromEntries(
      Object.entries(result.fields).filter(([key]) => selected.includes(key)),
    ),
  )
  return Object.keys(patch).length ? { ...patch, reviewed: false } : {}
}

export async function readAssistantResponse(response: Response) {
  if (!response.headers.get('content-type')?.includes('application/json'))
    throw new Error(
      [401, 403].includes(response.status)
        ? 'Site access or sign-in is required. Sign in to Cottage Pantry and try again.'
        : 'The assistant service returned a webpage or an unreadable response. Try later or enter details manually.',
    )
  let body: any
  try {
    body = await response.json()
  } catch {
    throw new Error(
      'The assistant returned an unreadable response. Your draft is preserved.',
    )
  }
  if (!response.ok)
    throw new Error(
      typeof body?.error === 'string'
        ? body.error
        : 'The assistant request failed. Try later or enter details manually.',
    )
  return body
}
