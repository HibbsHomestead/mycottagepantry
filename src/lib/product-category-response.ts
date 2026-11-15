import { customerMessage } from './customer-message'
import { z } from 'zod'
import {
  categoryListSchema,
  categoryMappingsSchema,
} from './product-categories'

export const categoryEndpoint = '/api/workspace?productCategories=1'
export const categoryConfigurationSchema = z.object({
  categories: categoryListSchema,
  revision: z.number().int().nonnegative(),
  products: z.array(
    z.object({ id: z.string(), name: z.string() }).passthrough(),
  ),
  selectedId: z.string().optional(),
})
export const categoryTaxConfigurationSchema = z.object({
  mappings: categoryMappingsSchema,
  rates: z.array(
    z
      .object({
        id: z.string(),
        name: z.string(),
        jurisdiction: z.string(),
        ratePercent: z.number().finite(),
      })
      .passthrough(),
  ),
})
export type CategoryConfiguration = z.infer<
  typeof categoryConfigurationSchema
> & {
  tax?: z.infer<typeof categoryTaxConfigurationSchema>
}

/** Validation locations only: never include saved values in diagnostics. */
export function categoryValidationFields(error: z.ZodError) {
  return [...new Set(error.issues.map((issue) => issue.path.join('.')))].join(
    ', ',
  )
}

/** Keep HTTP, authentication and response-format failures distinguishable. */
export async function readCategoryResponse(response: Response) {
  const mime = response.headers.get('content-type')?.split(';')[0].trim()
  if (!['application/json', 'application/problem+json'].includes(mime || '')) {
    throw new Error(
      [401, 403].includes(response.status)
        ? 'Please sign in to continue, then retry.'
        : 'Product categories could not be loaded. Please try again or contact support.',
    )
  }
  let raw: unknown
  try {
    raw = await response.json()
  } catch {
    throw new Error(
      'Product categories could not be loaded. Please try again or contact support.',
    )
  }
  if (!response.ok) {
    const error = z
      .object({ error: z.string(), code: z.string().optional() })
      .safeParse(raw)
    throw new Error(
      customerMessage(
        error.success ? error.data.error : null,
        'Product categories could not be loaded. Please try again or contact support.',
      ),
    )
  }
  return raw
}
