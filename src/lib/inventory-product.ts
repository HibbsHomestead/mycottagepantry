/** Shared product metadata, deliberately separate from owner SKU, retail price and stock. */
export const inventoryProductLabels: Record<string, string> = {
  manufacturerSku: 'Manufacturer part / model number',
  retailerSku: 'Retailer product identifier (not internal SKU or barcode)',
  materialType: 'Material type',
  fiber: 'Material composition',
  color: 'Color',
  pattern: 'Pattern',
  variant: 'Selected variant',
  fabricWidth: 'Fabric width',
  widthUnit: 'Fabric width unit',
  yarnLength: 'Yarn length per package',
  yarnLengthUnit: 'Yarn length unit',
  yarnWeight: 'Yarn weight per package',
  yarnWeightUnit: 'Yarn weight unit',
  dimensions: 'Dimensions / specifications',
  itemsPerPackage: 'Items per purchase package',
  onlinePackageQuantity: 'Listed package contents quantity',
  onlinePackageUnit: 'Listed package contents unit',
}
export const inventoryProductKeys = Object.keys(inventoryProductLabels)
export function foodProduct(draft: Record<string, any>) {
  if (draft.workflow === 'resale') return draft.foodClass === 'food'
  return (
    !draft.workflow &&
    !['material', 'packaging', 'supply'].includes(draft.usedAs) &&
    !['craft-materials', 'packaging', 'supplies'].includes(draft.categoryId)
  )
}

export const productSourceKeys = [
  ...inventoryProductKeys,
  'name',
  'brand',
  'barcode',
  'notes',
  'productSourceUrl',
  'productRequestedUrl',
  'productCheckedAt',
  'listedOnlinePrice',
  'currency',
  'imageAssetId',
]
/** Existing stock configuration and all actual receipt quantities/costs stay authoritative. */
export function reviewedProductMetadata(
  item: Record<string, any>,
  input: Record<string, any>,
  vendors: Record<string, any>[] = [],
) {
  const keys = [
    ...productSourceKeys,
    ...(foodProduct(item)
      ? ['subingredients', 'sourceContains', 'sourceMayContain']
      : []),
  ]
  const patch = Object.fromEntries(
    keys
      .filter(
        (key) =>
          !['materialType', 'fabricWidth', 'widthUnit'].includes(key) &&
          input[key] !== undefined,
      )
      .map((key) => [key, input[key]]),
  )
  if (input.vendorId !== undefined) {
    const vendor = vendors.find((v) => v.id === input.vendorId)
    if (!vendor) throw new Error('Choose a supplier from this oven.')
    if (item.workflow === 'resale') patch.supplierId = vendor.id
    else patch.vendorId = vendor.id
    patch.vendor = vendor.name
  }
  if (
    ['subingredients', 'sourceContains', 'sourceMayContain'].some((key) =>
      Object.hasOwn(patch, key),
    )
  )
    patch.reviewed = false
  return patch
}
