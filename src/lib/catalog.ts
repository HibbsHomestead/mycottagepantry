import { z } from 'zod'
import { barcodeText, normalizedBarcode, validGTIN } from './barcodes'

export const catalogKinds = ['ingredient', 'packaging', 'supply'] as const
export const catalogFieldKeys = [
  'name',
  'brand',
  'variant',
  'barcode',
  'barcodeFormat',
  'subingredients',
  'sourceContains',
  'sourceMayContain',
  'purchaseQuantity',
  'purchaseUnit',
  'packCount',
  'dimensions',
  'fiber',
  'itemsPerPackage',
] as const
export const catalogFieldsSchema = z
  .object({
    name: z.string().trim().min(1).max(300),
    brand: z.string().max(300).optional(),
    variant: z.string().max(300).optional(),
    barcode: z.string().max(512).optional(),
    barcodeFormat: z.string().max(30).optional(),
    subingredients: z.string().max(30000).optional(),
    sourceContains: z.string().max(5000).optional(),
    sourceMayContain: z.string().max(5000).optional(),
    purchaseQuantity: z.number().positive().max(1000000).optional(),
    purchaseUnit: z.string().max(30).optional(),
    packCount: z.number().int().positive().max(1000000).optional(),
    dimensions: z.string().max(2000).optional(),
    fiber: z.string().max(2000).optional(),
    itemsPerPackage: z.number().int().positive().max(1000000).optional(),
  })
  .strict()
  .superRefine((f, c) => {
    if ((f.purchaseQuantity !== undefined) !== (f.purchaseUnit !== undefined))
      c.addIssue({
        code: 'custom',
        message: 'Package quantity and unit must be supplied together.',
      })
    if (f.barcode) {
      try {
        externalGTIN(f.barcode, f.barcodeFormat)
      } catch {
        c.addIssue({
          code: 'custom',
          path: ['barcode'],
          message: 'Use a valid, explicitly identified GTIN.',
        })
      }
    }
  })
export const catalogSnapshotSchema = z
  .object({
    kind: z.enum(catalogKinds),
    entryType: z.enum(['generic', 'branded']),
    fields: catalogFieldsSchema,
  })
  .strict()
  .superRefine((s, c) => {
    if (
      s.entryType === 'generic' &&
      Object.keys(s.fields).some((k) => k !== 'name')
    )
      c.addIssue({
        code: 'custom',
        message: 'Generic starters contain only a generic name.',
      })
    if (
      s.kind !== 'ingredient' &&
      ['subingredients', 'sourceContains', 'sourceMayContain'].some(
        (k) => k in s.fields,
      )
    )
      c.addIssue({
        code: 'custom',
        message: 'Food statements do not belong on supplies or packaging.',
      })
  })
export type CatalogFields = z.infer<typeof catalogFieldsSchema>
export type CatalogSnapshot = z.infer<typeof catalogSnapshotSchema>
export type CatalogResult = CatalogSnapshot & {
  id: string
  revisionId: string
  status: string
  reviewScope: string
  reviewedAt: string
  sources: { url: string; license: string }[]
}
export const acceptanceSchema = z
  .object({
    requestId: z.uuid(),
    itemId: z.string().max(100),
    revisionId: z.string().max(100),
    fields: z.array(z.enum(catalogFieldKeys)).min(1).max(20),
  })
  .strict()
export function externalGTIN(raw: string, format?: string) {
  const text = barcodeText(raw)
  if (format === 'upc_e') {
    const expanded = normalizedBarcode(text, format)
    if (expanded === text) throw new Error('UPC-E could not be validated.')
    return expanded.padStart(14, '0')
  }
  if (format && !['upc_a', 'ean_13', 'ean_8', 'gtin_14'].includes(format))
    throw new Error('This identifier supports private matching only.')
  if (![8, 12, 13, 14].includes(text.length) || !validGTIN(text))
    throw new Error(
      'Enter a complete GTIN with its check digit. Missing digits are not guessed.',
    )
  if (text.length === 8 && format !== 'ean_8')
    throw new Error(
      'Choose EAN-8 or UPC-E for an eight-digit barcode before external lookup.',
    )
  const lengths: Record<string, number> = {
    upc_a: 12,
    ean_13: 13,
    ean_8: 8,
    gtin_14: 14,
  }
  if (format && lengths[format] !== text.length)
    throw new Error('Barcode length does not match its stated format.')
  // EAN-8 stays distinct from ambiguous eight-digit UPC-E input.
  return text.length === 8 ? `ean8:${text}` : text.padStart(14, '0')
}
export function sharedSnapshot(
  draft: Record<string, unknown>,
  kind: CatalogSnapshot['kind'],
): CatalogSnapshot {
  const referenceOnly = draft.amountPerPackage != null
  const fields = Object.fromEntries(
    catalogFieldKeys
      .filter(
        (k) =>
          !referenceOnly || !['purchaseQuantity', 'purchaseUnit'].includes(k),
      )
      .filter((k) => draft[k] !== undefined && draft[k] !== '')
      .filter(
        (k) =>
          kind === 'ingredient' ||
          !['subingredients', 'sourceContains', 'sourceMayContain'].includes(k),
      )
      .map((k) => [
        k,
        ['purchaseQuantity', 'packCount', 'itemsPerPackage'].includes(k)
          ? Number(draft[k])
          : draft[k],
      ]),
  )
  return catalogSnapshotSchema.parse({ kind, entryType: 'branded', fields })
}

export const catalogResultSchema = catalogSnapshotSchema.safeExtend({
  id: z.string().min(1).max(100),
  revisionId: z.string().min(1).max(100),
  status: z.enum(['active', 'external', 'withdrawn', 'superseded']),
  reviewScope: z.string().max(2000),
  reviewedAt: z.string().max(100),
  sources: z
    .array(
      z.object({
        url: z.url().startsWith('https://'),
        license: z.string().max(1000),
      }),
    )
    .max(10),
})
export const catalogResponseSchema = z.object({
  version: z.literal(1),
  results: z.array(catalogResultSchema).max(20).optional(),
  existing: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        variant: z.string().optional(),
        usedAs: z.string().optional(),
      }),
    )
    .optional(),
  notice: z.string().optional(),
  candidates: z
    .array(
      z.object({
        url: z.url().startsWith('https://'),
        domain: z.string(),
        title: z.string(),
        confirmed: z.literal(false),
      }),
    )
    .max(8)
    .optional(),
  fallbackUrl: z.url().startsWith('https://').optional(),
  provider: z.string().optional(),
  submitted: z.boolean().optional(),
  updates: z
    .array(catalogResultSchema.safeExtend({ ingredientId: z.string() }))
    .optional(),
})
export type CatalogResponse = z.infer<typeof catalogResponseSchema>
