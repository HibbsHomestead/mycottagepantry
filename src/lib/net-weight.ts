import type { Item } from './domain'

export const gramsPerWeightOunce = 28.349523125

export function netWeightOunces(value: unknown): number | null {
  if (value == null || value === '') return null
  if (
    !['number', 'string'].includes(typeof value) ||
    (typeof value === 'string' &&
      !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim()))
  )
    throw new Error('Enter a positive net weight in ounces, or leave it blank.')
  const ounces = Number(value)
  if (
    !Number.isFinite(ounces) ||
    ounces <= 0 ||
    !Number.isFinite(ounces * gramsPerWeightOunce)
  )
    throw new Error('Enter a positive net weight in ounces, or leave it blank.')
  return ounces
}

/** Shared by form feedback and the label data used by canvas, PDF and print. */
export function formatNetWeight(value: unknown) {
  const ounces = netWeightOunces(value)
  return ounces == null
    ? ''
    : `Net Wt. ${ounces}oz (${Math.trunc(ounces * gramsPerWeightOunce)}g)`
}

export function inspectLegacyNetWeight(value: unknown): {
  ounces: number | null
  review?: string
} {
  const text = String(value ?? '').trim()
  if (!text) return { ounces: null }
  const match = text.match(
    /^(?:net\s*(?:wt\.?|weight)\s*:?\s*)?(\d+(?:\.\d+)?)\s*(?:oz\.?|ounces?)(?:\s*\(\s*(\d+(?:\.\d+)?)\s*g\s*\))?$/i,
  )
  if (!match || !(Number(match[1]) > 0))
    return {
      ounces: null,
      review:
        'Existing net quantity needs review. Confirm weight ounces; the original text is preserved.',
    }
  const ounces = Number(match[1])
  if (!Number.isFinite(ounces * gramsPerWeightOunce))
    return {
      ounces: null,
      review: 'Existing net quantity is outside the supported range.',
    }
  const grams = Math.trunc(ounces * gramsPerWeightOunce)
  if (match[2] !== undefined && Number(match[2]) !== grams)
    return {
      ounces: null,
      review: `Existing text says ${ounces}oz (${match[2]}g); ${ounces} weight ounces produces ${grams}g. Confirm the ounce value before replacing this line.`,
    }
  return { ounces }
}

export function productNetWeight(product: Partial<Item>) {
  if (product.netWeightOz !== undefined) {
    try {
      return { ounces: netWeightOunces(product.netWeightOz) }
    } catch {
      return { ounces: null, review: 'Stored net weight needs review.' }
    }
  }
  return inspectLegacyNetWeight(product.netQuantity)
}

/** Original text stays intact, including when a user explicitly clears ounces. */
export function normalizeProductNetWeight(item: Item, previous?: Item) {
  if (previous?.netQuantity !== undefined)
    item.netQuantity = previous.netQuantity
  if (item.netWeightOz !== undefined)
    item.netWeightOz = netWeightOunces(item.netWeightOz)
  else if (previous?.netWeightOz !== undefined)
    item.netWeightOz = previous.netWeightOz
  else {
    const legacy = inspectLegacyNetWeight(item.netQuantity)
    if (legacy.ounces != null && !legacy.review)
      item.netWeightOz = legacy.ounces
  }
}

export function productNetWeightText(product: Partial<Item>) {
  const result = productNetWeight(product)
  // Preserve ambiguous legacy labels until their owner explicitly reviews them.
  return result.review
    ? String(product.netQuantity || '')
    : formatNetWeight(result.ounces)
}
