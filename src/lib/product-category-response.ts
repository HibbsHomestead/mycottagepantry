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
  const location = `HTTP ${response.status}; ${categoryEndpoint}`
  if (!['application/json', 'application/problem+json'].includes(mime || '')) {
    throw new Error(
      [401, 403].includes(response.status)
        ? `Site access or sign-in is required (${location}). Complete sign-in on this site, then retry.`
        : `The category service returned a non-JSON response (${location}).`,
    )
  }
  let raw: unknown
  try {
    raw = await response.json()
  } catch {
    throw new Error(`The category service returned invalid JSON (${location}).`)
  }
  if (!response.ok) {
    const error = z
      .object({ error: z.string(), code: z.string().optional() })
      .safeParse(raw)
    const code =
      error.success &&
      [
        'SIGN_IN_REQUIRED',
        'EMAIL_UNVERIFIED',
        'IDENTITY_UNAVAILABLE',
        'WORKSPACE_SELECTION_REQUIRED',
        'ONBOARDING_REQUIRED',
        'WORKSPACE_SETUP_REQUIRED',
        'WORKSPACE_REQUEST_FAILED',
      ].includes(error.data.code || '')
        ? `; ${error.data.code}`
        : ''
    throw new Error(
      `${error.success ? error.data.error : 'The category request failed.'} (${location}${code})`,
    )
  }
  return raw
}
