import type { Item } from './domain'

export const supplierLabelLimits = {
  source: 500,
  declaration: 6000,
  contains: 1000,
  advisory: 1000,
}

export type SupplierLabelSource = Record<
  keyof typeof supplierLabelLimits,
  string
> & {
  reviewed: boolean
  noMajorAllergens?: boolean
}

export function supplierLabelSource(
  product?: Item,
): SupplierLabelSource | undefined {
  const value = product?.supplierLabelSource
  if (product?.workflow !== 'resale' || !value) return
  const text = (key: keyof typeof supplierLabelLimits) =>
    typeof value[key] === 'string' ? value[key].trim() : ''
  const source = text('source'),
    declaration = text('declaration')
  return {
    source,
    declaration,
    contains: text('contains'),
    advisory: text('advisory'),
    reviewed: value.reviewed === true && !!source && !!declaration,
    ...(value.noMajorAllergens === true && !text('contains') ? { noMajorAllergens: true } : {}),
  }
}
