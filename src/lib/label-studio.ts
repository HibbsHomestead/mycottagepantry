import { labelFontExtents } from './label-font-extents'
import type { LabelLayout } from './label-sets'
import { libraryArtwork, withLibraryArtwork } from './artwork-library'
import type { LabelFont } from './label-font-catalog'
import { labelFontMetrics } from './label-font-metrics'
import { ingredientStatementRuns } from './label-ingredient-statement'
import {
  allergenEvidence, componentSources, componentWeightSource, majorAllergens, mergeWeightedIngredients,
  weightedComponents, type AllergenDecisions, type AllergenEvidence,
  type WeightedIngredient,
} from './label-ingredient-review'
import {
  convert,
  money,
  effectiveRecipeLines,
  type Workspace,
  type Item,
} from './domain'
import { productNetWeight, productNetWeightText } from './net-weight'
import { labelFonts } from './label-font-catalog'
import {
  supplierLabelSource,
  type SupplierLabelSource,
} from './supplier-label-source'
export { labelFonts } from './label-font-catalog'
export const labelTypes = [
  'Finished-product front label',
  'Finished-product full compliance label',
  'Ingredient label',
  'Packaging / supply label',
  'Jar label',
  'Bag label',
  'Bread-bag label',
  'Cookie package label',
  'Bakery box label',
  'Market-price label',
  'Batch / production label',
  'Inventory label',
  'Barcode label',
  'Custom label',
]
export const labelFilters = [
  'All styles',
  'Front labels',
  'Compliance labels',
  'Bread / loaf labels',
  'Cookie labels',
  'Cake / cupcake labels',
  'Jars / preserves',
  'Spice blends',
  'Dehydrated goods',
  'Ingredient labels',
  'Farmers-market labels',
  'Minimal',
  'Rustic',
  'Modern',
  'Farmhouse',
  'Bold',
  'Black and white',
  'Color',
  'Seasonal',
]
export const labelSizes = [
  { name: '2 × 1 in · thermal', w: 144, h: 72 },
  { name: '2 × 2 in', w: 144, h: 144 },
  { name: '2 × 3 in', w: 144, h: 216 },
  { name: '3 × 2 in', w: 216, h: 144 },
  { name: '3 × 3 in', w: 216, h: 216 },
  { name: '4 × 2 in', w: 288, h: 144 },
  { name: '4 × 3 in', w: 288, h: 216 },
  { name: '4 × 4 in', w: 288, h: 288 },
  { name: '4 × 6 in · thermal', w: 288, h: 432 },
  { name: '8.5 × 11 in', w: 612, h: 792 },
  { name: 'Round 2 in', w: 144, h: 144, round: true },
  { name: 'Round 3 in', w: 216, h: 216, round: true },
]
export const imageBindings = [
  'product.image',
  'product.graphic',
  'business.logo',
  'business.secondaryLogo',
  'business.mark',
]
export const imageBindingNames: Record<string, string> = {
  'business.cottageFoodDisclaimer': 'Business cottage-food disclaimer',
  'product.labelMainName': 'Label main name',
  'product.labelProductType': 'Label product type',
  'product.image': 'Product photo',
  'product.graphic': 'Product label graphic',
  'business.logo': 'Business logo',
  'business.secondaryLogo': 'Secondary business logo',
  'business.mark': 'Business logo mark',
}
export function elementAssetId(e: LabelElement, data: LabelData) {
  return e.binding ? data.values[e.binding] || '' : e.assetId || ''
}
export const bindings = [
  'product.name',
  'product.displayName',
  'product.labelMainName',
  'product.labelProductType',
  'product.subtitle',
  'product.flavor',
  'product.variant',
  'product.description',
  'product.price',
  'product.sku',
  'product.category',
  'product.netQuantity',
  'product.storage',
  'product.barcode',
  ...imageBindings,
  'recipe.name',
  'recipe.ingredients',
  'recipe.allergens',
  'recipe.allergenAdvisory',
  'recipe.yield',
  'batch.number',
  'batch.date',
  'batch.packedDate',
  'batch.bestBy',
  'batch.quantity',
  'business.name',
  'business.address',
  'business.website',
  'business.phone',
  'business.email',
  'business.jurisdiction',
  'business.disclaimer',
  'business.cottageFoodDisclaimer',
  'business.footer',
  'date',
]
export type LabelElement = {
  id: string
  type: 'text' | 'shape' | 'line' | 'border' | 'image' | 'illustration'
  binding?: string
  text: string
  textRuns?: { id: string; text: string; font: string }[]
  x: number
  y: number
  width: number
  height: number
  rotation: number
  locked: boolean
  hidden: boolean
  groupId?: string
  condition?: 'always' | 'nonempty' | 'batch' | 'allergens'
  font: string
  fontSize: number
  /** Opt-in presentation only; fontSize remains the selected maximum. */
  autoFit?: boolean
  minimumFontSize?: number
  bold: boolean
  italic: boolean
  underline: boolean
  letterSpacing: number
  lineHeight: number
  align: 'left' | 'center' | 'right'
  vertical: 'top' | 'middle' | 'bottom'
  textCase: 'none' | 'upper' | 'lower' | 'title'
  color: string
  fill: string
  opacity: number
  colorOpacity?: number
  fillOpacity?: number
  assetId?: string
  graphic?: string
  fit: 'contain' | 'cover'
}
export const assortmentParentFields = {
  'product.storage': 'Storage instructions',
  'product.netQuantity': 'Recorded net weight',
  'business.name': 'Business name',
  'business.address': 'Business address',
  'business.website': 'Website',
  'business.disclaimer': 'Configured disclaimer',
  'batch.packedDate': 'Recorded packed date',
  'batch.bestBy': 'Recorded best-by date',
  'assortment.allergens': 'Overall Contains (confirmed contents only)',
} as const
type AssortmentParentField = keyof typeof assortmentParentFields
export type AssortmentLayout = {
  minimumFontSize: number
  parentFields: AssortmentParentField[]
}
export const defaultAssortmentLayout: AssortmentLayout = {
  minimumFontSize: 10,
  parentFields: ['product.storage', 'business.disclaimer', 'business.name', 'business.address'],
}

export type LabelDocument = {
  id: string
  /** Explicit-save labels; legacy documents remain preserved until conversion review. */
  workflowVersion?: 1
  productId?: string
  source?: LabelSource
  brandId?: string
  manualTextReviewedFor?: string
  printSettings?: {
    printingMethod?: string
    copies: number
    layout: import('./label-print-layout').SheetLayout
    parts: 'both' | 'front' | 'back'
    order: 'grouped' | 'paired'
  }
  recordKind?: 'label' | 'template'
  sourceTemplateId?: string
  format?: 'single' | 'front-back'
  assortmentLayout?: AssortmentLayout
  renderVersion?: 2
  back?: LabelLayout
  deletedAt?: string
  name: string
  category: string
  labelType: string
  width: number
  height: number
  round: boolean
  background: string
  backgroundOpacity?: number
  elements: LabelElement[]
  revision: number
  savedAt?: string
  updatedAt?: string
  isSystem?: boolean
  tags: string[]
  displayUnit?: 'in' | 'mm' | 'px'
}
export const newElement = (
  type: LabelElement['type'] = 'text',
  text = 'Your text',
  binding?: string,
): LabelElement => ({
  id:
    globalThis.crypto?.randomUUID?.() ||
    `element-${Math.random().toString(36).slice(2)}`,
  type,
  text,
  binding,
  x: 18,
  y: 18,
  width: 180,
  height: type === 'line' ? 2 : 36,
  rotation: 0,
  locked: false,
  hidden: false,
  font: 'DM Sans',
  fontSize: 12,
  bold: false,
  italic: false,
  underline: false,
  letterSpacing: 0,
  lineHeight: 1.2,
  align: 'left',
  vertical: 'top',
  textCase: 'none',
  color: '#25221e',
  fill: type === 'shape' ? '#25221e' : 'transparent',
  fillOpacity: 1,
  colorOpacity: 1,
  opacity: 1,
  fit: 'contain',
})
export const DEFAULT_LABEL_BACKGROUND = '#FFFFFF'

const missingLabelBackground = (value: unknown) =>
  value == null || (typeof value === 'string' && value.trim() === '')

/** Missing backgrounds are opaque white, independently on each label side. */
export function labelBackground(layout: {
  background?: string | null
  backgroundOpacity?: number
}) {
  return missingLabelBackground(layout.background)
    ? { background: DEFAULT_LABEL_BACKGROUND, backgroundOpacity: 1 }
    : {
        background: layout.background!,
        backgroundOpacity: layout.backgroundOpacity ?? 1,
      }
}

export function withLabelBackgrounds(document: LabelDocument): LabelDocument {
  return {
    ...document,
    ...(missingLabelBackground(document.background)
      ? labelBackground(document)
      : {}),
    ...(document.back
      ? {
          back: {
            ...document.back,
            ...(missingLabelBackground(document.back.background)
              ? labelBackground(document.back)
              : {}),
          },
        }
      : {}),
  }
}

export const blankLabel = (): LabelDocument => ({
  id: '',
  name: 'Untitled label',
  category: 'Custom',
  labelType: 'Custom label',
  width: 288,
  height: 432,
  round: false,
  background: DEFAULT_LABEL_BACKGROUND,
  backgroundOpacity: 1,
  elements: [],
  revision: 0,
  tags: [],
})
function template(
  id: string,
  name: string,
  tags: string[],
  style: number,
): LabelDocument {
  const d = blankLabel()
  d.id = 'system-' + id
  d.name = name
  d.isSystem = true
  d.tags = tags
  d.category = tags[0]
  d.labelType =
    style === 4
      ? 'Market-price label'
      : 'Finished-product full compliance label'
  const text = (
    binding: string,
    y: number,
    h: number,
    size: number,
    font = 'DM Sans',
    bold = false,
  ) => ({
    ...newElement('text', '', binding),
    id: `${id}-${binding}`,
    x: 24,
    y,
    width: 240,
    height: h,
    fontSize: size,
    font,
    bold,
    align: 'center' as const,
  })
  const border = {
    ...newElement('border'),
    id: id + '-border',
    x: 10,
    y: 10,
    width: 268,
    height: 412,
    color: style === 0 ? '#6b284f' : '#2f3426',
  }
  d.elements = [
    border,
    text(
      'business.name',
      26,
      30,
      14,
      style === 0 ? 'Oswald' : 'Libre Baskerville',
    ),
    {
      ...newElement('illustration'),
      id: id + '-art',
      x: 109,
      y: 62,
      width: 70,
      height: 52,
      graphic: style === 2 ? 'jar' : style === 3 ? 'leaf' : 'bread',
    },
    text(
      'product.name',
      122,
      70,
      30,
      style === 0
        ? 'Oswald'
        : style === 2
          ? 'Special Elite'
          : 'Libre Baskerville',
      true,
    ),
    text('product.subtitle', 192, 22, 12),
    text('product.netQuantity', 220, 20, 11, 'Barlow Condensed'),
    text('recipe.ingredients', 250, 65, 9),
    text('recipe.allergens', 318, 23, 9, 'DM Sans', true),
    text('business.address', 346, 24, 9),
    text('business.disclaimer', 376, 36, 8),
  ]
  if (style === 4) {
    d.width = 216
    d.height = 288
    d.elements = [
      { ...border, width: 196, height: 268 },
      { ...text('product.name', 28, 64, 26, 'Oswald'), x: 18, width: 180 },
      {
        ...text('product.price', 107, 55, 38, 'Oswald', true),
        x: 18,
        width: 180,
      },
      { ...text('product.description', 170, 44, 11), x: 18, width: 180 },
      { ...text('recipe.allergens', 226, 32, 10), x: 18, width: 180 },
    ]
  }
  if (style === 3) {
    d.width = 216
    d.height = 216
    d.elements = [
      { ...border, width: 196, height: 196 },
      {
        ...text('product.name', 25, 53, 23, 'Libre Baskerville'),
        x: 20,
        width: 176,
      },
      { ...text('product.netQuantity', 86, 20, 10), x: 20, width: 176 },
      { ...text('recipe.ingredients', 115, 42, 8), x: 20, width: 176 },
      { ...text('date', 170, 20, 9), x: 20, width: 176 },
    ]
  }
  return d
}
export const systemLabelTemplates = [
  template(
    'farmhouse',
    'Homestead bold',
    [
      'Farmhouse',
      'Bold',
      'Bread / loaf labels',
      'Compliance labels',
      'Black and white',
    ],
    0,
  ),
  template(
    'artisan',
    'The artisan loaf',
    ['Rustic', 'Bread / loaf labels', 'Front labels', 'Compliance labels'],
    1,
  ),
  template(
    'pantry',
    'Field & pantry',
    ['Dehydrated goods', 'Spice blends', 'Ingredient labels', 'Seasonal'],
    2,
  ),
  template(
    'jar',
    'Little jar, big flavor',
    ['Jars / preserves', 'Minimal', 'Modern', 'Color'],
    3,
  ),
  template(
    'market',
    'Market day',
    ['Farmers-market labels', 'Cookie labels', 'Cake / cupcake labels', 'Bold'],
    4,
  ),
]
export type LabelSource = {
  kind: 'product' | 'ingredient' | 'batch'
  id: string
  productId?: string
}
export type LabelData = {
  ingredientMerge?: {
    mode: 'parenthetical' | 'merged'
    groupSmall: boolean
    parenthetical: string
    merged: string
    issues: string[]
    parts: WeightedIngredient[]
  }
  allergenReview?: {
    status: 'unconfirmed' | 'confirmed' | 'changed'
    source: Record<string, string>
    evidence: AllergenEvidence[]
    decisions: AllergenDecisions
    changed: string[]
  }
  nonFood?: boolean
  supplierLabelSource?: SupplierLabelSource
  ingredientStatementOverrides?: { id: string; name: string }[]
  declaredAllergenSourceIds?: string[]
  sourceAllergenStatements?: { contains: string[]; advisories: string[] }
  sourceRecords?: Record<string, { kind: 'ingredient' | 'recipe'; id: string }>
  values: Record<string, string>
  warnings: string[]
  allergens: string[]
  weightsVerified: boolean
  ingredientParts: {
    name: string
    subingredients: string
    weight: number | null
    sourceRecipeIds?: string[]
  }[]
}
export function resolveLabelData(
  w: Workspace,
  source: LabelSource,
  brand?: Item,
): LabelData {
  const business = {
      ...w.settings[0],
      ...Object.fromEntries(
        Object.entries(brand?.contact || {}).filter(
          ([, v]) => v !== '' && v != null,
        ),
      ),
    },
    values: Record<string, string> = {},
    warnings: string[] = [],
    known = new Set<string>(),
    sourceContains = new Set<string>(),
    sourceAdvisories = new Set<string>(),
    statementOverrides = new Map<string, { id: string; name: string }>(),
    parts: LabelData['ingredientParts'] = []
  const batch =
    source.kind === 'batch'
      ? w.batches.find((b) => b.id === source.id)
      : undefined
  const ingredient =
    source.kind === 'ingredient'
      ? w.ingredients.find((i) => i.id === source.id)
      : undefined
  const product = w.products.find(
    (p) => p.id === (source.kind === 'product' ? source.id : source.productId),
  )
  const recipe = w.recipes.find(
    (r) => r.id === (batch?.recipeId || product?.recipeId),
  )
  const weighted: WeightedIngredient[] = []
  const mergeIssues = new Set<string>()
  const evidence: AllergenEvidence[] = []
  const declaredAllergenSources = new Set<string>()
  const allergenSource: Record<string, string> = {}
  const groupSmall = product?.labelGroupSmallIngredients === true
  const mergeMode = product?.labelIngredientMode === 'merged' ? 'merged' : 'parenthetical'
  const aliases = product?.allergenAliases || {}
  const root = [...new Set([product?.name, recipe?.name, ingredient?.name].filter((name): name is string => Boolean(name)))]
  const visits = new Map<string, number>()
  const scan = (path: string[], text: string) => evidence.push(...allergenEvidence(path, text, aliases))
  const incomplete = (path: string[]) => evidence.push({ path, confidence: 'incomplete data' })
  const supplier = supplierLabelSource(product)
  if (
    source.id &&
    !(source.kind === 'product'
      ? product
      : source.kind === 'batch'
        ? batch
        : ingredient)
  )
    warnings.push('Missing information: the selected source is unavailable.')
  if (batch && product && product.recipeId !== batch.recipeId)
    warnings.push(
      'Needs review: this product does not use the selected batch recipe.',
    )
  const map = (prefix: string, obj: Item | undefined, keys: string[]) =>
    keys.forEach((k) => {
      values[prefix + '.' + k] = String(obj?.[k] ?? '')
    })
  map('product', product, [
    'name',
    'labelMainName',
    'labelProductType',
    'subtitle',
    'flavor',
    'variant',
    'description',
    'sku',
    'category',
    'netQuantity',
    'storage',
    'barcode',
    'image',
  ])
  if (product) {
    values['product.displayName'] = String(product.labelMainName || '').trim()
      ? String(product.labelMainName).trim()
      : product.name
    values['product.netQuantity'] = productNetWeightText(product)
    const weight = productNetWeight(product)
    if (weight.review)
      warnings.push(`Net weight needs review: ${weight.review}`)
  }
  if (ingredient) {
    values['product.name'] = ingredient.name
    values['product.category'] = ingredient.category || ''
    values['product.netQuantity'] = `${ingredient.quantity} ${ingredient.unit}`
  }
  values['product.image'] = product?.imageAssetId || ''
  values['product.graphic'] =
    product?.graphicAssetId ||
    (product?.labelArtworkVersion === 2 ? '' : product?.iconAssetId || '')
  values['product.icon'] = values['product.graphic']
  values['business.logo'] =
    brand?.primaryLogoAssetId || business.logoAssetId || ''
  values['business.secondaryLogo'] = brand?.secondaryLogoAssetId || ''
  values['business.mark'] = brand?.markAssetId || ''
  values['product.price'] = product ? money(product.price || 0) : ''
  map('business', business, [
    'name',
    'address',
    'website',
    'phone',
    'email',
    'jurisdiction',
    'disclaimer',
  ])
  values['business.disclaimer'] =
    product?.disclaimer || brand?.defaultDisclaimer || business.disclaimer || ''
  // Explicit business text is independent of the legacy product/brand fallback.
  // Keep that existing binding unchanged so saved designs retain their behavior.
  values['business.cottageFoodDisclaimer'] = String(
    w.settings[0]?.disclaimer ?? '',
  )
  values['business.footer'] = brand?.defaultFooter || ''
  values['product.storage'] = product?.storage || brand?.defaultStorage || ''
  values['recipe.name'] = recipe?.name || ''
  values['recipe.yield'] = recipe ? `${recipe.yield} ${recipe.yieldUnit}` : ''
  values['batch.number'] = batch?.number || batch?.id || ''
  values['batch.date'] = batch?.date || ''
  values['batch.packedDate'] = batch?.packedDate || ''
  values['batch.bestBy'] = batch?.bestBy || ''
  values['batch.quantity'] = String(batch?.actualYield ?? batch?.yield ?? '')
  values.date = new Date().toISOString().slice(0, 10)
  if (batch?.netQuantity) values['product.netQuantity'] = batch.netQuantity
  const sourceRecords: NonNullable<LabelData['sourceRecords']> = {}
  function ingredientWarning(i: Item, message: string) {
    if (/missing information|missing or cyclic|not edible|unavailable or invalid/i.test(message)) mergeIssues.add(message)
    const text = `${message} [${i.id}]`
    warnings.push(text)
    sourceRecords[text] = { kind: 'ingredient', id: i.id }
  }
  if (product?.workflow === 'kit')
    warnings.push('Review each included product in Label Studio → Assortments.')
  else if (
    !recipe &&
    product &&
    product.workflow !== 'resale' &&
    product.workflow !== 'handmade'
  )
    warnings.push('The product’s connected recipe is unavailable.')
  let weightsVerified = true
  function visit(i: Item, q: number, u: string, path: string[], parents: string[]) {
    if (source.kind !== 'ingredient' && ['packaging', 'supply', 'material'].includes(i.usedAs)) {
      incomplete([...parents, i.name])
      ingredientWarning(
        i,
        `Needs review: ${i.name} is not an edible ingredient and was excluded.`,
      )
      return
    }
    // These are the same saved fields used by IngredientDetail. An explicit
    // statement overrides the saved name; an empty override uses that name.
    const statementName =
      String(i.statement || '').trim() || String(i.name || '').trim()
    const names = [...parents, statementName || i.id]
    const subingredients = String(i.subingredients || '').trim()
    const nodes = componentSources(subingredients)
    const key = [...path, i.id].join(' → ')
    const occurrence = (visits.get(key) || 0) + 1
    visits.set(key, occurrence)
    allergenSource[`${key} (${occurrence})`] = JSON.stringify([names.join(' → '), i.name, statementName, subingredients, i.allergens, i.sourceContains, i.sourceMayContain, i.reviewed, i.requiresSubingredients, i.compoundRecipeId, componentWeightSource(i), q, u, ...(i.allergenSourceRevision ? [i.allergenSourceRevision] : [])])
    scan(names, statementName)
    const declared = allergenEvidence(names, (i.allergens || []).join(', '))
    evidence.push(...declared.map((entry) => i.reviewed && entry.allergen ? { ...entry, sourceDeclaration: true } : entry))
    const supplierContainsText = String(i.sourceContains || '')
    const supplierEvidence = allergenEvidence(names, supplierContainsText)
    const affirmative = i.reviewed && !/\b(?:no|not|without|free|may|traces?)\b/i.test(supplierContainsText)
    evidence.push(...supplierEvidence.map((entry) => affirmative && entry.allergen ? { ...entry, sourceDeclaration: true } : entry))
    if ((i.reviewed && declared.some((entry) => entry.allergen)) || (affirmative && supplierEvidence.some((entry) => entry.allergen))) declaredAllergenSources.add(i.id)
    const scanNodes = (rows: NonNullable<typeof nodes>, prefix: string[]) => {
      for (const row of rows) {
        const next = [...prefix, row.name]
        scan(next, row.name)
        scanNodes(row.children, next)
      }
    }
    if (nodes) scanNodes(nodes, names)
    else if (subingredients) {
      scan([...names, subingredients], subingredients)
      evidence.push({ path: names, confidence: 'needs review' })
    }
    const purchasedMix = !i.compoundRecipeId && /\b(?:mix(?:es)?|blends?)\b/i.test(`${i.name} ${statementName}`)
    const naturalFlavor = !i.compoundRecipeId && /\bnatural flavou?r(?:s|ing)?\b/i.test(`${i.name} ${statementName} ${subingredients}`)
    const missingComponents = !subingredients && (i.requiresSubingredients || purchasedMix)
    if (missingComponents || (!i.reviewed && (purchasedMix || naturalFlavor || i.requiresSubingredients || i.allergens?.length || supplierContainsText.trim()))) incomplete(names)
    if (!i.compoundRecipeId && statementName !== String(i.name || '').trim())
      statementOverrides.set(i.id, { id: i.id, name: i.name })
    for (const a of i.allergens || []) known.add(a)
    if (i.reviewed && String(i.sourceContains || '').trim()) sourceContains.add(String(i.sourceContains).trim())
    if (i.reviewed && String(i.sourceMayContain || '').trim()) sourceAdvisories.add(String(i.sourceMayContain).trim())
    const hasOwnDeclaration = !!(
      i.statement ||
      i.subingredients ||
      i.sourceContains ||
      i.sourceMayContain ||
      i.allergens?.length ||
      i.requiresSubingredients
    )
    if (!i.compoundRecipeId || hasOwnDeclaration) {
      if (!i.reviewed)
        ingredientWarning(
          i,
          `Needs review: verify allergens for ${i.name}; ${i.labelReviewReason || 'supplier ingredient/allergen review is not saved.'}`,
        )
      if (!i.reviewed && naturalFlavor)
        ingredientWarning(i, `Needs review: verify allergens for ${i.name}; check the natural flavor with the supplier.`)
      if (missingComponents)
        ingredientWarning(i, `Missing information: subingredients for ${i.name}; add the supplier’s component list.`)
      if (!statementName)
        ingredientWarning(
          i,
          `Missing information: ingredient statement name for ${i.id}.`,
        )
    }
    if (i.compoundRecipeId) {
      if (subingredients) mergeIssues.add(`${i.name}: supplier subingredients are also recorded on this prepared ingredient; reconcile them with its recipe before merging.`)
      const prep = w.recipes.find((r) => r.id === i.compoundRecipeId)
      if (!prep || path.includes(prep.id)) {
        ingredientWarning(
          i,
          `Needs review: compound recipe ${i.compoundRecipeId} is missing or cyclic.`,
        )
        weightsVerified = false
        incomplete(names)
        return
      }
      let scale: number
      try {
        scale = convert(q, u, prep.yieldUnit, i.conversions) / prep.yield
        if (!Number.isFinite(scale) || scale <= 0) throw new Error('Invalid prep yield')
      } catch {
        weightsVerified = false
        ingredientWarning(
          i,
          `Needs review: verified weight conversion for ${i.name} is missing.`,
        )
        mergeIssues.add(`${i.name}: verified prep quantity or conversion is missing.`)
        scale = NaN
      }
      let prepLines: ReturnType<typeof effectiveRecipeLines>
      try {
        prepLines = effectiveRecipeLines(prep, w.recipes)
      } catch {
        incomplete(names)
        ingredientWarning(
          i,
          `Needs review: the base recipe for ${prep.name} is unavailable or invalid.`,
        )
        return
      }
      const firstChild = weighted.length
      for (const line of prepLines) {
        const child = w.ingredients.find((entry) => entry.id === line.ingredientId)
        if (child)
          visit(child, line.quantity * scale, line.unit, [
            ...new Set([...path, prep.id, ...(line.sourceRecipePath || [])]),
          ], names)
        else {
          incomplete([...names, line.ingredientId])
          ingredientWarning(
            i,
            `Missing information: a compound ingredient in ${prep.name} is unavailable.`,
          )
        }
      }
      if (weighted.length > firstChild) {
        try {
          const used = convert(q, u, 'g', i.conversions)
          const total = weighted.slice(firstChild).reduce((sum, part) => sum + part.weight, 0)
          if (!Number.isFinite(used) || used <= 0 || !total) throw new Error('Invalid prep weight')
          const factor = used / total
          for (const part of weighted.slice(firstChild)) {
            part.weight *= factor
            part.contributions = part.contributions.map(({ path, grams }) => ({ path, grams: grams * factor }))
          }
        } catch {
          mergeIssues.add(`${i.name}: verified weight of the prepared ingredient is missing.`)
        }
      }
      return
    }
    let weight: number | null = null
    try {
      weight = convert(q, u, 'g', i.conversions)
      if (!Number.isFinite(weight) || weight <= 0) throw new Error('Invalid weight')
    } catch {
      weight = null
      weightsVerified = false
      ingredientWarning(
        i,
        `Needs review: verified weight conversion for ${i.name} is missing.`,
      )
    }
    if (weight === null) mergeIssues.add(`${i.name}: verified weight in grams is missing.`)
    else if (subingredients) {
      const savedWeights = i.labelComponentWeights
      const expanded = nodes && savedWeights && (savedWeights.sourceRef || '') === componentWeightSource(i) && weightedComponents(nodes, savedWeights, subingredients, weight, names)
      if (expanded) weighted.push(...expanded)
      else mergeIssues.add(`${i.name}: verify every component’s weight percentage against the supplier declaration.`)
    } else if (statementName && !i.requiresSubingredients) {
      weighted.push({ name: statementName, weight, contributions: [{ path: names, grams: weight }] })
    }
    const existing = parts.find(
      (p) =>
        p.name === statementName &&
        p.subingredients === (i.subingredients || ''),
    )
    if (existing && weight !== null && existing.weight !== null) {
      existing.weight += weight
      if (recipe?.baseRecipeId && path.length)
        existing.sourceRecipeIds = [
          ...new Set([...(existing.sourceRecipeIds || []), ...path]),
        ]
    } else
      parts.push({
        name: statementName,
        subingredients: i.subingredients || '',
        ...(recipe?.baseRecipeId && path.length
          ? { sourceRecipeIds: [...path] }
          : {}),
        weight,
      })
  }
  const actual =
    batch?.costSnapshot?.lines || batch?.costSnapshot?.ingredientLines
  function currentRecipeLines() {
    if (!recipe) return []
    try {
      return effectiveRecipeLines(recipe, w.recipes)
    } catch {
      warnings.push(`Needs review: the base recipe for ${recipe.name} is unavailable or invalid.`)
      mergeIssues.add('The recipe base could not be expanded.')
      incomplete(root)
      return []
    }
  }
  const lines =
    Array.isArray(actual) &&
    actual.every(
      (l: any) =>
        l.ingredientId &&
        (l.quantity !== undefined || l.inventoryQuantity !== undefined),
    )
      ? actual
      : supplier && !batch
        ? []
        : currentRecipeLines()
  // Only new explicit workflows bypass food ingredient/allergen review. Legacy labels retain their existing behavior.
  const classification = (business.productCategories || []).find(
    (c: Item) => c.id === product?.productCategoryId,
  )?.classification
  const nonFood =
    ingredient?.usedAs === 'material' ||
    recipe?.workflow === 'handmade' ||
    product?.workflow === 'handmade' ||
    (product?.workflow === 'resale' && classification === 'non_food')
  if (!nonFood && recipe && !lines.length) {
    incomplete(root)
    mergeIssues.add('The source recipe has no available ingredient lines.')
  }
  if (nonFood) values['business.disclaimer'] = product?.disclaimer || ''
  if (nonFood) {
    /* Craft materials never become food ingredient statements. */
  } else if (supplier && !batch) {
    if (!supplier.reviewed)
      warnings.push('Needs review: verify the manufacturer ingredient and allergen statement.')
    if (!supplier.contains && !supplier.noMajorAllergens)
      warnings.push('Allergen information not confirmed by the manufacturer statement.')
    if (supplier.reviewed && supplier.advisory)
      sourceAdvisories.add(supplier.advisory)
  } else if (!recipe && product?.workflow === 'resale') {
    warnings.push('Missing information: no manufacturer ingredient and allergen statement on file.')
  } else if (ingredient) visit(ingredient, 1, ingredient.unit, [], [])
  else
    for (const l of lines) {
      const i = w.ingredients.find((i) => i.id === l.ingredientId)
      if (i)
        visit(
          i,
          Number(l.normalized ?? l.inventoryQuantity ?? l.quantity),
          l.normalized !== undefined || l.inventoryQuantity !== undefined
            ? l.storageUnit
            : l.unit,
          l.sourceRecipePath || (recipe ? [recipe.id] : []),
          root,
        )
      else {
        mergeIssues.add(`Ingredient ${l.ingredientId} is missing.`)
        incomplete([...root, l.ingredientId])
        warnings.push(
          `Missing information: recipe ingredient ${l.ingredientId} is unavailable in ${recipe?.name || 'the selected recipe'}.`,
        )
      }
    }
  if (weightsVerified) parts.sort((a, b) => (b.weight || 0) - (a.weight || 0))
  else
    warnings.push(
      'Needs review: ingredient order is unverified; missing weights are never guessed.',
    )
  values['recipe.ingredients'] = parts.length
    ? 'Ingredients: ' +
      parts
        .map(
          (p) =>
            p.name + (p.subingredients ? ' (' + p.subingredients + ')' : ''),
        )
        .join(', ')
    : ''
  const merged = mergeWeightedIngredients(weighted, groupSmall)
  const ingredientMerge: LabelData['ingredientMerge'] = !nonFood && product && recipe && !supplier ? {
    mode: mergeMode, groupSmall, parenthetical: values['recipe.ingredients'],
    merged: mergeIssues.size ? '' : merged.text,
    issues: [...mergeIssues], parts: merged.parts,
  } : undefined
  if (ingredientMerge?.mode === 'merged') {
    if (ingredientMerge.merged) values['recipe.ingredients'] = ingredientMerge.merged
    else warnings.push('Merged ingredient order is unconfirmed. Add verified weights or switch the product to parenthetical mode before finalizing.')
  }
  values['recipe.allergens'] = known.size
    ? 'CONTAINS: ' + [...known].map((a) => a.toUpperCase()).join(', ')
    : ''
  if (!nonFood && supplier && !batch) {
    values['recipe.ingredients'] = supplier.declaration
    values['recipe.allergens'] = supplier.reviewed && supplier.contains
      ? /^contains\s*:/i.test(supplier.contains)
        ? supplier.contains
        : `Contains: ${supplier.contains}`
      : ''
    values['recipe.allergenAdvisory'] = supplier.reviewed ? supplier.advisory : ''
  }
  let allergenReview: LabelData['allergenReview']
  let resolvedAllergens = [...known]
  if (ingredient && !ingredient.reviewed) {
    resolvedAllergens = []
    values['recipe.allergens'] = ''
  }
  if (!nonFood && (product || batch) && recipe && !supplier) {
    const saved = product?.allergenReview
    allergenSource.recipe = JSON.stringify([recipe.name, recipe.id, recipe.baseRecipeId, product?.recipeId, aliases])
    for (const entry of evidence.filter((entry) => entry.confidence === 'incomplete data'))
      allergenSource[`incomplete:${entry.path.join(' → ')}`] = JSON.stringify(entry.path)
    const previous = saved?.source || {}
    const changed = [...new Set([...Object.keys(previous), ...Object.keys(allergenSource)])].filter((key) => previous[key] !== allergenSource[key]).map((key) => {
      try { return JSON.parse(allergenSource[key] || previous[key])[0] || key } catch { return key }
    }).filter((key): key is string => typeof key === 'string')
    const decisions: AllergenDecisions = saved?.decisions || {}
    const confirmed = Boolean(saved && !changed.length && majorAllergens.every((name) => ['present', 'absent'].includes(decisions[name]?.status || '')) && !evidence.some((entry) => entry.confidence === 'incomplete data' || (entry.sourceDeclaration && entry.allergen && decisions[entry.allergen]?.status !== 'present')))
    allergenReview = {
      status: confirmed ? 'confirmed' : saved && changed.length ? 'changed' : 'unconfirmed',
      source: allergenSource,
      evidence: [...new Map(evidence.map((entry) => [JSON.stringify(entry), entry])).values()],
      changed: saved ? [...new Set(changed)] : [], decisions,
    }
    if (!confirmed) warnings.push(allergenReview.status === 'changed' ? 'Allergen information not confirmed: source changes need re-review.' : `Allergen information not confirmed: ${product ? 'review all nine major allergens.' : 'select a linked product with a reviewed source.'}`)
    const order = [...known].map((name) => name.toLowerCase())
    const position = (name: string) => order.includes(name.toLowerCase()) ? order.indexOf(name.toLowerCase()) : order.length
    const declarationOrder = [...majorAllergens].sort((first, second) => position(first) - position(second))
    resolvedAllergens = confirmed ? declarationOrder.flatMap((name) => decisions[name]?.status === 'present' ? [decisions[name]?.name || name] : []) : []
    values['recipe.allergens'] = resolvedAllergens.length ? `CONTAINS: ${resolvedAllergens.map((name) => name.toUpperCase()).join(', ')}` : ''
    values['recipe.allergenAdvisory'] = confirmed ? saved.advisory || '' : ''
  }
  return {
    values,
    nonFood,
    ...(ingredientMerge ? { ingredientMerge } : {}),
    ...(allergenReview ? { allergenReview } : {}),
    ...(allergenReview?.status !== 'confirmed' && declaredAllergenSources.size ? { declaredAllergenSourceIds: [...declaredAllergenSources] } : {}),
    ...(!nonFood && supplier && !batch ? { supplierLabelSource: supplier } : {}),
    ...(statementOverrides.size ? { ingredientStatementOverrides: [...statementOverrides.values()] } : {}),
    warnings: [...new Set(warnings)],
    allergens: resolvedAllergens,
    ...((sourceContains.size || sourceAdvisories.size) ? { sourceAllergenStatements: { contains: [...sourceContains], advisories: [...sourceAdvisories] } } : {}),
    weightsVerified,
    sourceRecords: {
      ...Object.fromEntries(
        warnings
          .filter((text) => !sourceRecords[text] && recipe)
          .map((text) => [text, { kind: 'recipe' as const, id: recipe!.id }]),
      ),
      ...sourceRecords,
    },
    ingredientParts: parts,
  }
}

export function resolveRecipeAllergens(workspace: Workspace, recipe: Item) {
  const product = { ...recipe, id: `recipe-review:${recipe.id}`, recipeId: recipe.id, name: recipe.name }
  return resolveLabelData({ ...workspace, products: [product] }, { kind: 'product', id: product.id }).allergenReview
}
export function elementText(e: LabelElement, data: LabelData) {
  let t = e.binding ? data.values[e.binding] || '' : e.text
  if (e.textCase === 'upper') t = t.toUpperCase()
  if (e.textCase === 'lower') t = t.toLowerCase()
  if (e.textCase === 'title') t = t.replace(/\b\w/g, (c) => c.toUpperCase())
  return t
}
export function elementVisible(e: LabelElement, data: LabelData) {
  return (
    !e.hidden &&
    (e.condition !== 'nonempty' || !!elementText(e, data)) &&
    (e.condition !== 'batch' || !!data.values['batch.number']) &&
    (e.condition !== 'allergens' || !!data.allergens.length)
  )
}
export function measureLabelText(e: LabelElement, text: string) {
  const f = labelFonts.find((f) => f.name === e.font),
    key = f
      ? f.file + (e.bold && f.weights.includes(700) ? '-bold' : '')
      : e.font + (e.bold ? '-bold' : '')
  const metrics =
    labelFontMetrics[e.font + (e.bold ? '-bold' : '')] ||
    labelFontMetrics[key] ||
    labelFontMetrics[e.font] ||
    {}
  return (
    Array.from(text).reduce(
      (n, c) => n + (metrics[String(c.codePointAt(0))] ?? 0.55) * e.fontSize,
      0,
    ) +
    Math.max(0, Array.from(text).length - 1) * e.letterSpacing
  )
}
export function wrapLabelText(
  text: string,
  width: number,
  size: number,
  spacing = 0,
  measure?: (s: string) => number,
): string[] {
  const out: string[] = []
  const length = (s: string) =>
    measure
      ? measure(s)
      : Array.from(s).reduce(
          (n, c) =>
            n +
            (/[ilI.,' ]/.test(c) ? 0.27 : /[MW@]/.test(c) ? 0.85 : 0.53) *
              size +
            spacing,
          0,
        )
  for (const paragraph of text.split('\n')) {
    let line = ''
    for (const word of paragraph.split(/\s+/)) {
      const next = line ? line + ' ' + word : word
      if (length(next) > width && line) {
        out.push(line)
        line = ''
      }
      if (length(word) > width) {
        for (const c of word) {
          if (length(line + c) > width && line) {
            out.push(line)
            line = ''
          }
          line += c
        }
      } else line = line ? line + ' ' + word : word
    }
    out.push(line)
  }
  return out
}
export type LabelTextRun = { text: string; font: string; bold?: boolean }

/** Generated ingredient weights are derived, so saved bindings survive copies and either side. */
export function labelTextRuns(
  e: LabelElement,
  data: LabelData,
): LabelTextRun[] {
  if (e.binding === 'recipe.ingredients')
    return ingredientStatementRuns(data).map((run) => ({
      ...run,
      font: e.font,
    }))
  if (e.textRuns && !e.binding) return e.textRuns
  return [
    { text: e.binding ? data.values[e.binding] || '' : e.text, font: e.font },
  ]
}

export function labelTextLines(
  e: LabelElement,
  data: LabelData,
  measure = (text: string, font: string, bold = e.bold) =>
    measureLabelText({ ...e, font, bold }, text),
): LabelTextRun[][] {
  const ingredients = e.binding === 'recipe.ingredients' || !!e.autoFit
  if (!ingredients && (!e.textRuns || e.binding))
    return wrapLabelText(
      elementText(e, data),
      e.width,
      e.fontSize,
      e.letterSpacing,
      (text) => measure(text, e.font),
    ).map((text) => [{ text, font: e.font }])
  let previousCharacter = ''
  const characters = labelTextRuns(e, data).flatMap((run) =>
    Array.from(run.text).flatMap((char) => {
      const transformed =
        e.textCase === 'upper'
          ? char.toUpperCase()
          : e.textCase === 'lower'
            ? char.toLowerCase()
            : e.textCase === 'title' &&
                /\w/.test(char) &&
                !/\w/.test(previousCharacter)
              ? char.toUpperCase()
              : char
      previousCharacter = char
      return Array.from(transformed).map((value) => ({
        char: value,
        font: run.font,
        bold: run.bold,
      }))
    }),
  )
  const lines: (typeof characters)[] = []
  let line: typeof characters = []
  const width = (items: typeof characters) =>
    items.reduce(
      (n, item) => n + measure(item.char, item.font, item.bold ?? e.bold),
      0,
    ) +
    Math.max(0, items.length - 1) * e.letterSpacing
  for (const item of characters) {
    if (item.char === '\n') {
      lines.push(line)
      line = []
      continue
    }
    line.push(item)
    if (line.length > 1 && width(line) > e.width) {
      let space = -1
      for (let i = line.length - 2; i >= 0; i--)
        if (/\s/.test(line[i].char)) {
          space = i
          break
        }
      if (space > 0) {
        lines.push(line.slice(0, space + (ingredients ? 1 : 0)))
        line = line.slice(space + 1)
      } else {
        lines.push(line.slice(0, -1))
        line = [item]
      }
    }
  }
  lines.push(line)
  return lines.map((items) => {
    const runs: LabelTextRun[] = []
    for (const item of items) {
      if (runs.at(-1)?.font === item.font && runs.at(-1)?.bold === item.bold)
        runs[runs.length - 1].text += item.char
      else
        runs.push({
          text: item.char,
          font: item.font,
          ...(item.bold === undefined ? {} : { bold: item.bold }),
        })
    }
    return runs
  })
}
export function ingredientFontExtents(e: LabelElement) {
  const extents = [e.font, ...(e.textRuns || []).map((run) => run.font)].map(
    (name) => {
      const font = labelFonts.find((f) => f.name === name)
      const metrics =
        labelFontMetrics[name] || labelFontMetrics[font?.file || '']
      const boldMetrics =
        labelFontMetrics[name + '-bold'] ||
        labelFontMetrics[(font?.file || '') + '-bold']
      const regular = labelFontExtents[font?.file || name]
      const bold = labelFontExtents[(font?.file || name) + '-bold']
      return {
        ascent: Math.max(
          regular?.ascent || metrics?.__ascent || 1.5,
          bold?.ascent || boldMetrics?.__ascent || 0,
        ),
        descent: Math.max(
          regular?.descent || metrics?.__descent || 0.5,
          bold?.descent || boldMetrics?.__descent || 0,
        ),
      }
    },
  )
  return {
    ascent: Math.max(...extents.map((e) => e.ascent)),
    descent: Math.max(...extents.map((e) => e.descent)),
  }
}
export function labelTextBaseline(e: LabelElement) {
  return e.fontSize * (e.autoFit ? ingredientFontExtents(e).ascent : 1)
}

export const ingredientOverflowMessage =
  'Ingredient list does not fit at the minimum text size. Enlarge the ingredient box or choose a larger label.'

/** Resolve on every render, never write the fitted size back to a saved design.
 * One point inset keeps glyphs clear of the text box edge on physical output.
 * Font advances come from the same loaded font metrics used by SVG output.
 */
export function fitIngredientText(source: LabelElement, data: LabelData) {
  if (!source.autoFit || source.type !== 'text')
    return { element: source, overflow: false }
  const minimum = source.minimumFontSize
  const extents = ingredientFontExtents(source)
  const inset = 1
  const candidate = (fontSize: number): LabelElement => {
    // Half-em horizontal breathing room also contains glyph side bearings and
    // the SVG outline used for single-weight bold. It does not change tracking.
    const horizontal = Math.max(inset, fontSize * 0.5)
    const radians = (source.rotation * Math.PI) / 180
    return {
      ...source,
      fontSize,
      x: source.x + horizontal * Math.cos(radians) - inset * Math.sin(radians),
      y: source.y + horizontal * Math.sin(radians) + inset * Math.cos(radians),
      width: Math.max(0, source.width - horizontal * 2),
      height: Math.max(0, source.height - inset * 2),
      lineHeight: Math.max(extents.ascent + extents.descent, source.lineHeight),
      textCase: 'none',
    }
  }
  const fits = (e: LabelElement) => {
    const runs = labelTextRuns(e, data)
    if (
      runs.some((run) => {
        const bold = run.bold ?? e.bold
        const font = labelFonts.find((f) => f.name === run.font)
        const metrics =
          labelFontMetrics[run.font + (bold ? '-bold' : '')] ||
          labelFontMetrics[
            (font?.file || run.font) +
              (bold && font?.weights.includes(700) ? '-bold' : '')
          ] ||
          labelFontMetrics[run.font]
        return (
          !metrics ||
          Array.from(run.text).some(
            (c) =>
              c !== '\n' && !Object.hasOwn(metrics, String(c.codePointAt(0))),
          )
        )
      })
    )
      return false
    const lines = labelTextLines(e, data)
    return (
      e.width > 0 &&
      e.height > 0 &&
      lines.length * e.fontSize * e.lineHeight <= e.height &&
      lines.every(
        (line) =>
          line.reduce(
            (n, run) =>
              n +
              measureLabelText(
                {
                  ...e,
                  font: run.font,
                  bold: run.bold ?? e.bold,
                  letterSpacing: 0,
                },
                run.text,
              ),
            0,
          ) +
            Math.max(
              0,
              Array.from(line.map((r) => r.text).join('')).length - 1,
            ) *
              e.letterSpacing <=
          e.width,
      )
    )
  }
  if (!minimum || minimum < 1 || minimum > source.fontSize)
    return { element: candidate(source.fontSize), overflow: true }
  if (fits(candidate(source.fontSize)))
    return { element: candidate(source.fontSize), overflow: false }
  if (!fits(candidate(minimum)))
    return { element: candidate(minimum), overflow: true }
  let low = minimum,
    high = source.fontSize
  for (let i = 0; i < 16; i++) {
    const mid = (low + high) / 2
    if (fits(candidate(mid))) low = mid
    else high = mid
  }
  return {
    element: candidate(Math.max(minimum, Math.floor(low * 1000) / 1000)),
    overflow: false,
  }
}

/** Auto-fitted ingredient boxes must remain within the existing ⅛-inch safe area. */
export function ingredientTextOverflow(
  d: LabelDocument,
  e: LabelElement,
  data: LabelData,
) {
  if (!e.autoFit || !elementVisible(e, data)) return false
  const angle = (e.rotation * Math.PI) / 180
  const corners = [
    [0, 0],
    [e.width, 0],
    [0, e.height],
    [e.width, e.height],
  ].map(([x, y]) => ({
    x: e.x + x * Math.cos(angle) - y * Math.sin(angle),
    y: e.y + x * Math.sin(angle) + y * Math.cos(angle),
  }))
  return (
    fitIngredientText(e, data).overflow ||
    corners.some(
      ({ x, y }) =>
        x < 9 ||
        y < 9 ||
        x > d.width - 9 ||
        y > d.height - 9 ||
        (d.round &&
          Math.pow((x - d.width / 2) / (d.width / 2 - 9), 2) +
            Math.pow((y - d.height / 2) / (d.height / 2 - 9), 2) >
            1),
    )
  )
}

export function assertIngredientFit(d: LabelDocument, data: LabelData) {
  if (d.elements.some((e) => ingredientTextOverflow(d, e, data)))
    throw new Error(ingredientOverflowMessage)
}

export function checkLabel(
  d: LabelDocument,
  data: LabelData,
  assets: Item[] = [],
  customFonts: LabelFont[] = [],
  requiredElements: LabelElement[] = d.elements,
) {
  const fitIssues: string[] = []
  try {
    assertIngredientFit(d, data)
  } catch {
    fitIssues.push(ingredientOverflowMessage)
  }
  const issues = [...data.warnings, ...fitIssues],
    visible = d.elements.filter((e) => elementVisible(e, data)),
    has = (binding: string) =>
      requiredElements.some(
        (e) =>
          elementVisible(e, data) &&
          e.binding === binding &&
          elementText(e, data).trim(),
      )
  const compliance =
    !data.nonFood &&
    ![
      'Finished-product front label',
      'Market-price label',
      'Barcode label',
      'Custom label',
      'Packaging / supply label',
      'Inventory label',
    ].includes(d.labelType)
  for (const [key, name] of [
    ['product.name', 'Product name'],
    ...(!data.nonFood && d.labelType === 'Finished-product front label'
      ? [['product.netQuantity', 'Net quantity']]
      : []),
    ...(compliance
      ? [
          ['product.netQuantity', 'Net quantity'],
          ['recipe.ingredients', 'Ingredient statement'],
          ['business.name', 'Business name'],
          ['business.address', 'Business address'],
          ['business.disclaimer', 'Cottage-food disclaimer'],
        ]
      : []),
  ])
    if (
      !has(key) &&
      !(
        key === 'product.name' &&
        (has('product.displayName') ||
          (has('product.labelMainName') && has('product.labelProductType')))
      ) &&
      !(key === 'business.disclaimer' && has('business.cottageFoodDisclaimer'))
    )
      issues.push(`Missing information: ${name}.`)
  for (const [key, name] of [
    ['product.labelMainName', 'Label main name'],
    ['product.labelProductType', 'Label product type'],
  ])
    if (
      d.elements.some((e) => !e.hidden && e.binding === key) &&
      !data.values[key]?.trim()
    )
      issues.push(
        `Missing information: ${name}. Enter it in the product editor before printing.`,
      )
  for (const e of visible) {
    const radians = (e.rotation * Math.PI) / 180,
      corners = [
        [0, 0],
        [e.width, 0],
        [0, e.height],
        [e.width, e.height],
      ].map(([x, y]) => ({
        x: e.x + x * Math.cos(radians) - y * Math.sin(radians),
        y: e.y + x * Math.sin(radians) + y * Math.cos(radians),
      }))
    if (
      corners.some((p) =>
        d.round
          ? ((p.x - d.width / 2) / (d.width / 2 - 9)) ** 2 +
              ((p.y - d.height / 2) / (d.height / 2 - 9)) ** 2 >
            1
          : p.x < 9 || p.y < 9 || p.x > d.width - 9 || p.y > d.height - 9,
      )
    )
      issues.push(
        `Print warning: ${e.binding || e.type} is outside the ⅛-inch safe area.`,
      )
    if (e.type === 'text') {
      const font = [...labelFonts, ...customFonts].find(
        (f) => f.name === e.font,
      )
      for (const name of new Set([
        e.font,
        ...(e.textRuns || []).map((r) => r.font),
      ]))
        if (![...labelFonts, ...customFonts].some((f) => f.name === name))
          issues.push(
            `Missing information: font “${name}” is unavailable. Upload the authorized font file in Brand Kit; no substitute is approved for output.`,
          )
      if (
        font &&
        !font.smallPrint &&
        [
          'recipe.ingredients',
          'recipe.allergens',
          'business.disclaimer',
          'business.cottageFoodDisclaimer',
          'product.netQuantity',
        ].includes(e.binding || '')
      )
        issues.push(
          'Print warning: This font is best for headings. For ingredients and required label text, use a highly readable body font at an adequate print size.',
        )
      if (font && e.fontSize < font.minimumPt)
        issues.push(
          `Print warning: ${font.name} is recommended at ${font.minimumPt} pt or larger.`,
        )
      if (e.fontSize < 7)
        issues.push('Print warning: text is smaller than 7 pt.')
      if (labelTextLines(e, data).length * e.fontSize * e.lineHeight > e.height)
        issues.push(
          `Print warning: ${e.binding || e.text.slice(0, 20)} may overflow its text box.`,
        )
    }
    if (e.type === 'image') {
      const a = withLibraryArtwork(assets).find(
        (a) => a.id === elementAssetId(e, data),
      )
      if (!a)
        issues.push(
          `Missing information: ${e.binding || 'image asset'} is unavailable. Link artwork in Graphics Library or Brand Kit.`,
        )
      else if (
        Math.min(a.widthPx / (e.width / 72), a.heightPx / (e.height / 72)) < 300
      )
        issues.push(`Print warning: ${a.name} is below 300 DPI at this size.`)
    }
    if (e.condition === 'batch' && !data.values['batch.number'])
      issues.push('Missing information: select a batch for the batch fields.')
  }
  return [...new Set(issues)]
}
const color = (v: unknown) =>
  typeof v === 'string' && (/^#[0-9a-f]{6}$/i.test(v) || v === 'transparent')
export function validateLabelDocument(
  input: any,
  customFonts: LabelFont[] = [],
): LabelDocument {
  if (
    !input ||
    typeof input.name !== 'string' ||
    !input.name.trim() ||
    input.name.length > 100
  )
    throw new Error('Give the label a name (up to 100 characters).')
  if (
    !Number.isFinite(input.width) ||
    !Number.isFinite(input.height) ||
    input.width < 36 ||
    input.height < 36 ||
    input.width > 1008 ||
    input.height > 1008
  )
    throw new Error('Label dimensions must be between 0.5 and 14 inches.')
  if (!Array.isArray(input.elements) || input.elements.length > 100)
    throw new Error('Use up to 100 label elements.')
  if (input.assortmentLayout !== undefined) {
    const layout = input.assortmentLayout
    if (
      !layout ||
      !Number.isFinite(layout.minimumFontSize) ||
      layout.minimumFontSize < 7 || layout.minimumFontSize > 36 ||
      !Array.isArray(layout.parentFields) ||
      layout.parentFields.length > Object.keys(assortmentParentFields).length ||
      layout.parentFields.some((field: unknown) => typeof field !== 'string' || !Object.hasOwn(assortmentParentFields, field)) ||
      new Set(layout.parentFields).size !== layout.parentFields.length
    ) throw new Error('Choose a 7–36 pt minimum and supported outer-label fields for the repeating contents block.')
  }
  // Preserve invalid-color validation while allowing legacy unset backgrounds.
  if (typeof input.background === 'string' || input.background == null)
    input = withLabelBackgrounds(input)
  if (!color(input.background))
    throw new Error('Choose a valid background color.')
  for (const opacity of [
    input.backgroundOpacity,
    ...input.elements.flatMap((e: any) => [e.colorOpacity, e.fillOpacity]),
  ])
    if (
      opacity !== undefined &&
      (typeof opacity !== 'number' ||
        !Number.isFinite(opacity) ||
        opacity < 0 ||
        opacity > 1)
    )
      throw new Error('Invalid color opacity.')
  const ids = new Set<string>()
  for (const e of input.elements) {
    if (e.autoFit !== undefined && typeof e.autoFit !== 'boolean')
      throw new Error('Invalid auto-fit setting.')
    if (
      e.minimumFontSize !== undefined &&
      (typeof e.minimumFontSize !== 'number' ||
        !Number.isFinite(e.minimumFontSize) ||
        e.minimumFontSize < 1 ||
        e.minimumFontSize > 300)
    )
      throw new Error(
        'Choose a minimum text size between 1 and 300 pt for this design.',
      )
    if (
      e.autoFit &&
      (e.type !== 'text' ||
        !e.minimumFontSize ||
        e.minimumFontSize > e.fontSize)
    )
      throw new Error(
        'Set the minimum text size at or below the selected font size.',
      )
    if (e.binding === 'product.icon') e.binding = 'product.graphic'
    if (typeof e.id !== 'string' || ids.has(e.id))
      throw new Error('Label elements need unique IDs.')
    ids.add(e.id)
    if (
      !['text', 'shape', 'line', 'border', 'image', 'illustration'].includes(
        e.type,
      ) ||
      ![...labelFonts, ...customFonts].some((f) => f.name === e.font)
    )
      throw new Error('Unsupported element or font.')
    for (const key of [
      'x',
      'y',
      'width',
      'height',
      'rotation',
      'fontSize',
      'letterSpacing',
      'lineHeight',
      'opacity',
    ])
      if (
        typeof e[key] !== 'number' ||
        !Number.isFinite(e[key]) ||
        Math.abs(e[key]) > 5000
      )
        throw new Error('Invalid element dimensions.')
    if (
      e.width <= 0 ||
      e.height <= 0 ||
      e.fontSize < 1 ||
      e.fontSize > 300 ||
      e.lineHeight < 0.5 ||
      e.lineHeight > 4 ||
      e.opacity < 0 ||
      e.opacity > 1
    )
      throw new Error('Invalid element size or opacity.')
    if (!color(e.color) || !color(e.fill))
      throw new Error('Invalid element color.')
    if (
      typeof e.text !== 'string' ||
      e.text.length > 10000 ||
      (e.binding && !bindings.includes(e.binding))
    )
      throw new Error('Invalid label text or binding.')
    if (e.binding && (e.type === 'image') !== imageBindings.includes(e.binding))
      throw new Error('Use image fields for images and text fields for text.')
    if (e.textRuns !== undefined) {
      const runIds = new Set()
      if (
        e.binding ||
        e.type !== 'text' ||
        !Array.isArray(e.textRuns) ||
        e.textRuns.length > 2000 ||
        e.textRuns.some((r: NonNullable<LabelElement['textRuns']>[number]) => {
          const invalid =
            !r ||
            typeof r.id !== 'string' ||
            !r.id ||
            runIds.has(r.id) ||
            typeof r.text !== 'string' ||
            ![...labelFonts, ...customFonts].some((f) => f.name === r.font)
          if (!invalid) runIds.add(r.id)
          return invalid
        }) ||
        e.textRuns
          .map((r: NonNullable<LabelElement['textRuns']>[number]) => r.text)
          .join('') !== e.text
      )
        throw new Error(
          'Static text runs need unique IDs, available fonts, and the complete matching text. Dynamic fields use their element font.',
        )
    }
    if (
      !['left', 'center', 'right'].includes(e.align) ||
      !['top', 'middle', 'bottom'].includes(e.vertical) ||
      !['none', 'upper', 'lower', 'title'].includes(e.textCase) ||
      !['contain', 'cover'].includes(e.fit) ||
      (e.condition &&
        !['always', 'nonempty', 'batch', 'allergens'].includes(e.condition))
    )
      throw new Error('Invalid element style.')
  }
  if (
    input.format !== undefined &&
    !['single', 'front-back'].includes(input.format)
  )
    throw new Error('Choose Single label or Front + Back labels.')
  if (input.format === 'front-back') {
    if (!input.back || input.back.back || input.back.format === 'front-back')
      throw new Error('A two-label template needs one Back layout.')
    validateLabelDocument(
      { ...input.back, name: input.name, id: input.id, format: 'single' },
      customFonts,
    )
  } else if (input.back)
    throw new Error('A Single label cannot contain a hidden Back layout.')
  return {
    ...input,
    isSystem: false,
    round: !!input.round,
    tags: Array.isArray(input.tags)
      ? input.tags.filter((t: any) => typeof t === 'string').slice(0, 20)
      : [],
  }
}
// Original single-stroke illustrations in a shared 100 × 100 coordinate system.
export const bakeryGraphics: Record<string, string> = {
  bread:
    'M12 76V45C12 15 88 15 88 45V76ZM28 46L38 32M46 46L56 30M65 47L75 34M12 64H88',
  wheat:
    'M50 92V16M50 70C22 70 20 52 20 52C40 50 50 63 50 70M50 51C25 50 26 32 26 32C45 34 50 43 50 51M50 32C38 20 50 7 50 7C65 18 57 29 50 32M50 62C75 62 80 43 80 43C59 43 50 55 50 62M50 42C72 42 74 25 74 25C55 25 50 35 50 42',
  'rolling-pin': 'M25 35H75V65H25ZM8 43H25V57H8ZM75 43H92V57H75Z',
  whisk:
    'M42 54L21 86L28 91L51 60M42 54C-2 21 38-2 61 19C90 45 81 81 51 60M42 54C20 15 44 5 61 19C79 37 73 65 51 60M42 54L61 19',
  bananas:
    'M18 18C18 62 46 86 84 65C63 100 11 91 9 27ZM30 13C31 45 53 67 84 65',
  tomato:
    'M50 28C14 9 5 74 30 87C48 98 89 86 89 56C89 32 70 15 50 28ZM50 28L32 12L47 16L54 5L58 22L77 12L67 31',
  jar: 'M27 18H73V28H27ZM28 28L22 41V86H78V41L72 28M28 50H72V73H28Z',
  cookie:
    'M50 9A41 41 0 1 0 91 50C65 53 48 35 50 9ZM31 32L35 37M24 58L29 61M47 72L53 75M68 60L72 65',
  cupcake:
    'M24 55L33 91H70L78 55ZM19 55C10 39 28 36 30 31C26 15 43 22 50 8C62 25 78 16 74 32C94 36 90 51 81 55ZM40 62L44 84M61 62L59 84',
  leaf: 'M21 84C28 52 47 23 81 14C85 54 65 80 29 73M30 72L69 30M42 58L42 40M54 46L70 46',
  flourish: 'M8 53C30 76 42 18 50 49C58 81 72 23 92 46M15 55H85',
  divider: 'M5 50H36L50 35L64 50H95M36 50L50 65L64 50',
}

export function labelArtworkAssignment(
  w: Workspace,
  data: {
    assetId?: string
    target?: string
    productId?: string
    brandId?: string
  },
): { table: 'settings' | 'products' | 'brand_kits'; record: Item }[] {
  const asset =
    w.graphic_assets?.find((a) => a.id === data.assetId) ||
    (['productGraphic', 'productIcon'].includes(data.target || '')
      ? libraryArtwork(data.assetId || '')
      : undefined)
  if (!asset) throw new Error('Choose artwork from this oven.')
  if (data.target === 'businessLogo') {
    const records: {
      table: 'settings' | 'products' | 'brand_kits'
      record: Item
    }[] = [
      {
        table: 'settings',
        record: { ...w.settings[0], logoAssetId: asset.id },
      },
    ]
    if (data.brandId) {
      const kit = w.brand_kits?.find((b) => b.id === data.brandId)
      if (!kit) throw new Error('Choose a brand kit from this oven.')
      records.push({
        table: 'brand_kits',
        record: { ...kit, primaryLogoAssetId: asset.id },
      })
    }
    return records
  }
  const fields: Record<string, string> = {
    productPhoto: 'imageAssetId',
    productGraphic: 'graphicAssetId',
    productIcon: 'graphicAssetId',
  }
  const field = fields[data.target || ''],
    product = w.products.find((p) => p.id === data.productId)
  if (!field || !product)
    throw new Error('Choose a product and image role from this oven.')
  return [
    {
      table: 'products',
      record: { ...product, labelArtworkVersion: 2, [field]: asset.id },
    },
  ]
}
