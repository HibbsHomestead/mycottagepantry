import type { Item, Workspace } from './domain'
import { handmadeBom } from './handmade'

// Copy definitions explicitly: inventory, audit, integrations and saved editable
// artwork are intentionally never carried into a new record.
const common = ['description', 'category', 'categoryId', 'notes', 'workflow']
const recipeFields = [
  'lines',
  'baseRecipeId',
  'baseQuantity',
  'baseUnit',
  'baseMultiplier',
  'baseYield',
  'baseYieldUnit',
  'baseOverlapApproval',
  'yield',
  'yieldUnit',
  'compound',
  'instructions',
  'laborMinutes',
  'laborRate',
  'overhead',
  'overheadMode',
  'wasteMode',
  'wastePercent',
  'wasteCost',
]
const productFields = [
  'productCategoryId',
  'classification',
  'taxSource',
  'taxCategory',
  'taxCode',
  'taxable',
  'taxRate',
  'recipeId',
  'unitsPerPackage',
  'price',
  'wholesale',
  'targetMargin',
  'pricingMode',
  'sellingUnit',
  'unit',
  'packagingLines',
  'packaging',
  'kitComponents',
  'assemblyMinutes',
  'assemblyRate',
  'overhead',
  'overheadMode',
  'wasteMode',
  'wastePercent',
  'wasteCost',
  'threshold',
  'vendor',
  'purchaseUnit',
  'taxStatus',
  'categoryTaxCode',
  'supplierId',
  'variantGroup',
  'variant',
  'labelMainName',
  'labelProductType',
  'netWeight',
  'netWeightUnit',
  'labelArtworkVersion',
  'priceTaxMode',
  'taxRateIds',
  'taxAssignments',
  'targetFoodCost',
  'netWeightOz',
  'netQuantity',
  'packagingId',
  'packagingQuantity',
  'itemsPerUnit',
  'sellUnit',
  'sellUnitLabel',
  'sellUnitPlural',
]
export function copyDefinition(
  source: Item,
  table: 'recipes' | 'products',
  workspace: Workspace,
): Item {
  const draft: Item = {
    id: crypto.randomUUID(),
    name: `${source.name} — Copy`,
  }
  for (const key of [
    ...common,
    ...(table === 'recipes' ? recipeFields : productFields),
  ]) {
    if (source[key] !== undefined) draft[key] = structuredClone(source[key])
  }
  if (table === 'products') {
    draft.priceTaxMode = source.priceTaxMode || 'configured'
    draft.quantity = 0
    draft.status = 'draft'
    if (source.workflow === 'handmade') {
      const bom = handmadeBom(source, workspace)
      if (bom) {
        draft.bom = { id: crypto.randomUUID(), name: 'Bill of materials' }
        for (const key of [
          'lines',
          'output',
          'laborMinutes',
          'laborRate',
          'overhead',
          'scrapPercent',
        ])
          if (bom[key] !== undefined) draft.bom[key] = structuredClone(bom[key])
      }
      delete draft.recipeId
    }
  }
  for (const key of ['imageAssetId', 'graphicAssetId']) {
    const asset = (workspace.graphic_assets || []).find(
      (a) => a.id === source[key],
    )
    if (asset && !asset.mockup && asset.category !== 'product-mockup')
      draft[key] = asset.id
  }
  // Row references remain shared, while row-owned IDs/audit data do not.
  for (const rows of [draft.lines, draft.packagingLines, draft.kitComponents, draft.bom?.lines]) {
    for (const row of rows || []) {
      for (const key of ['id', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy']) delete row[key]
    }
  }
  return draft
}
