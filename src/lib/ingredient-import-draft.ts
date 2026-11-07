import { convert, units, type Item } from './domain'
import { matchProductVendors } from './product-vendors'

export type ImportFields = Record<string, string | number>
export const importValuePresent = (value: unknown) =>
  value != null && String(value).trim() !== ''

/** Fill only values shared by every returned package/fulfillment offer. */
export function commonImportFields(products: { fields: ImportFields }[]) {
  const first = products[0]?.fields || {}
  return Object.fromEntries(
    Object.entries(first).filter(
      ([key, value]) =>
        importValuePresent(value) &&
        products.every((product) => product.fields[key] === value),
    ),
  )
}

/** The new package form measures contents in its chosen stock unit.
 * Legacy edit forms still use purchaseQuantity + purchaseUnit together. */
export function ingredientImportFields(
  fields: ImportFields,
  draft: Record<string, Item[string]>,
  packageSetup: boolean,
) {
  const mapped = { ...fields }
  delete mapped.packageSize
  if (packageSetup) {
    delete mapped.purchaseQuantity
    delete mapped.purchaseUnit
    if (fields.purchaseQuantity != null && fields.purchaseUnit) {
      try {
        mapped.amountPerPackage = convert(
          fields.purchaseQuantity,
          String(fields.purchaseUnit),
          draft.unit,
          draft.conversions,
        )
        // No bag/bottle type is inferred from a measurement such as lb.
        mapped.purchaseUnit =
          draft.purchaseUnit && units[draft.purchaseUnit]?.factor === 0
            ? draft.purchaseUnit
            : 'package'
      } catch {
        // Retain the source measurement for review, never invent density.
      }
    }
  }
  return mapped
}

export function blankIngredientImportPatch(
  fields: ImportFields,
  draft: Record<string, Item[string]>,
  vendors: Item[],
  sourceUrl: string,
  packageSetup: boolean,
) {
  const patch: Record<string, Item[string]> = {}
  const packageConflict =
    packageSetup &&
    importValuePresent(draft.purchaseUnit) &&
    draft.purchaseUnit !== fields.purchaseUnit
  // Legacy package measurements are a pair: filling only one half beside a
  // manual half would silently reinterpret the entered amount.
  const legacyPackageConflict =
    !packageSetup &&
    ['purchaseQuantity', 'purchaseUnit'].some(
      (key) =>
        importValuePresent(draft[key]) &&
        importValuePresent(fields[key]) &&
        String(draft[key]) !== String(fields[key]),
    )
  const costBasisConflict =
    legacyPackageConflict ||
    packageConflict ||
    (packageSetup &&
      importValuePresent(draft.amountPerPackage) &&
      importValuePresent(fields.amountPerPackage) &&
      Number(draft.amountPerPackage) !== Number(fields.amountPerPackage)) ||
    (importValuePresent(draft.currency) &&
      importValuePresent(fields.currency) &&
      draft.currency !== fields.currency)
  for (const [key, value] of Object.entries(fields)) {
    if (
      key === 'vendor' ||
      !importValuePresent(value) ||
      importValuePresent(draft[key]) ||
      (draft.reviewed &&
        ['subingredients', 'sourceContains', 'sourceMayContain'].includes(
          key,
        )) ||
      (packageConflict && key === 'amountPerPackage') ||
      (costBasisConflict && key === 'packagePrice') ||
      (legacyPackageConflict &&
        ['purchaseQuantity', 'purchaseUnit'].includes(key))
    )
      continue
    patch[key] = value
  }
  if (fields.vendor && !draft.vendorId && !draft.vendor) {
    const matches = matchProductVendors(
      vendors,
      String(fields.vendor),
      sourceUrl,
    )
    if (matches.length === 1) {
      patch.vendorId = matches[0].id
      patch.vendor = matches[0].name
    }
  }
  return patch
}
