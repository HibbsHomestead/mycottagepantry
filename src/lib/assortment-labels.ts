import {
  isMixedPack,
  packagingLines,
  type Item,
  type Workspace,
} from './domain'
import {
  defaultAssortmentLayout,
  resolveLabelData,
  type AssortmentLayout,
} from './label-studio'
import { productionRunLines } from './production-run'
import { printRotations, type PrintRotation } from './label-printers'
import { formatNetWeight, productNetWeight } from './net-weight'
import { mergePrintIssue } from './label-sets'

export type PackedLine = {
  productId: string
  quantity: number
  unit: 'loose' | 'package'
  declaration?: string
  contains?: string
  advisory?: string
  supplierReviewed?: boolean
}

export type AssortmentSpec = {
  name: string
  templateId: string
  productId: string
  batchId: string
  group: string
  packagingId: string
  mode: 'fixed' | 'variable'
  expectedLoose: number
  expectedPackages: number
  containers: number
  copies: number
  componentId: string
  rotation?: PrintRotation
  lines: PackedLine[]
}

export function fixedAssortmentContents(definition?: Item) {
  const lines: PackedLine[] = (definition?.kitComponents || []).map(
    (line: Item) => ({
      productId: line.productId,
      quantity: Number(line.quantity),
      unit: line.basis === 'unpackaged' ? 'loose' : 'package',
    }),
  )
  return {
    lines,
    expectedLoose: lines.reduce(
      (sum, line) => sum + (line.unit === 'loose' ? line.quantity : 0),
      0,
    ),
    expectedPackages: lines.reduce(
      (sum, line) => sum + (line.unit === 'package' ? line.quantity : 0),
      0,
    ),
  }
}

export function assortmentRunDefinition(owner?: Item, run?: Item) {
  if (!run || !owner) return owner
  const outputs = productionRunLines(run).filter(
    (line) => line.productId === owner.id,
  )
  const definitions = outputs.map((line) => line.definition?.product)
  const first = definitions[0]
  if (
    !first ||
    definitions.some(
      (definition) =>
        !definition ||
        assortmentSignature(fixedAssortmentContents(definition)) !==
          assortmentSignature(fixedAssortmentContents(first)),
    )
  )
    return undefined
  return first
}

function text(value: unknown, max = 300, required = false) {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    (required && !value.trim())
  )
    throw new Error('Check the label’s required fields and text lengths.')
  return value.trim()
}

function count(value: unknown, label: string, min = 0, max = 200) {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  )
    throw new Error(
      `${label} must be a whole number between ${min} and ${max}.`,
    )
  return value
}

export function assortmentLabel(workspace: Workspace, input: AssortmentSpec) {
  if (
    !input ||
    !Array.isArray(input.lines) ||
    !input.lines.length ||
    input.lines.length > 30
  )
    throw new Error(
      'Select 1 to 30 actual products or flavors before previewing.',
    )
  if (input.rotation !== undefined && !printRotations.includes(input.rotation))
    throw new Error('Choose a supported output rotation.')
  const spec: AssortmentSpec = {
    name: text(input.name, 120, true),
    templateId: text(input.templateId, 200, true),
    productId: text(input.productId),
    batchId: text(input.batchId),
    group: text(input.group, 80, Boolean(input.batchId)),
    packagingId: text(input.packagingId),
    componentId: text(input.componentId),
    mode: input.mode === 'fixed' ? 'fixed' : 'variable',
    expectedLoose: count(input.expectedLoose, 'Intended loose items'),
    expectedPackages: count(
      input.expectedPackages,
      'Intended individually packaged units',
    ),
    containers: count(input.containers, 'Outer containers', 1),
    copies: count(input.copies, 'Label copies', 1),
    rotation: input.rotation ?? 0,
    lines: input.lines.map((line) => {
      if (!line || !['loose', 'package'].includes(line.unit))
        throw new Error('Choose how each product is packed.')
      return {
        productId: text(line.productId, 200, true),
        quantity: count(line.quantity, 'Quantity per outer container', 1),
        unit: line.unit,
        declaration: text(line.declaration ?? '', 3000),
        contains: text(line.contains ?? '', 400),
        advisory: text(line.advisory ?? '', 400),
        supplierReviewed: line.supplierReviewed === true,
      }
    }),
  }
  const owner = workspace.products.find(
    (product) => product.id === spec.productId,
  )
  const run = workspace.batches.find((batch) => batch.id === spec.batchId)
  if (spec.productId && !owner)
    throw new Error('The outer product is unavailable.')
  const stock = workspace.label_templates?.find(
    (template) => template.id === spec.templateId && !template.deletedAt,
  )
  if (
    !stock ||
    stock.round ||
    stock.format === 'front-back' ||
    ![stock.width, stock.height].every(
      (size) => Number.isFinite(size) && size >= 36 && size <= 1440,
    )
  )
    throw new Error(
      'Choose a saved rectangular, single-sided label stock size.',
    )
  const material = workspace.ingredients.find(
    (item) => item.id === spec.packagingId && item.usedAs === 'packaging',
  )
  if (spec.packagingId && (!material || material.archived))
    throw new Error('Choose an available label material from Packaging.')
  const runLines = run ? productionRunLines(run) : []
  const output = runLines.filter((line) => line.productId === spec.productId)
  const posted = run?.status === 'completed' || run?.status === 'Completed'
  const limit = output.reduce(
    (total, line) => total + Number(posted ? line.actualYield : line.quantity),
    0,
  )
  if (
    spec.batchId &&
    (!run ||
      !owner ||
      ['canceled', 'cancelled'].includes(run.status?.toLowerCase()) ||
      !Number.isFinite(limit) ||
      limit < spec.containers)
  )
    throw new Error(
      'Choose a run output with enough planned or completed containers.',
    )
  const totals = spec.lines.reduce(
    (sum, line) => ({ ...sum, [line.unit]: sum[line.unit] + line.quantity }),
    { loose: 0, package: 0 },
  )
  if (
    totals.loose !== spec.expectedLoose ||
    totals.package !== spec.expectedPackages
  )
    throw new Error(
      'Actual contents must match the intended loose-item and individually packaged counts per container.',
    )
  const keys = new Set<string>()
  const definition = assortmentRunDefinition(owner, run)
  const mixed = isMixedPack(owner)
  const basketDefinition = definition?.kitComponents
  if (mixed && spec.mode !== 'fixed' && !run)
    throw new Error(
      'Use the saved mixed-pack contents, or select a production run to review a different actual packing group.',
    )
  if (owner?.workflow === 'kit' && spec.mode === 'fixed') {
    if (!definition)
      throw new Error(
        'This run has no single saved packing combination. Enter and review the actual contents for this packing group.',
      )
    const expected = Array.isArray(basketDefinition) ? basketDefinition : []
    if (
      expected.length !== spec.lines.length ||
      expected.some(
        (component: Item) =>
          (!mixed && component.basis !== 'package') ||
          !spec.lines.some(
            (line) =>
              line.unit ===
                (mixed && component.basis === 'unpackaged'
                  ? 'loose'
                  : 'package') &&
              line.productId === component.productId &&
              line.quantity === Number(component.quantity),
          ),
      )
    )
      throw new Error(
        mixed
          ? 'Label contents changed. Reload the saved mixed-pack combination and review it again.'
          : 'Fixed basket contents must match its configured selling packages. Use an actual selection for a variable packing mix.',
      )
  }
  const warnings: string[] = []
  const sections = spec.lines.map((line) => {
    const product = workspace.products.find(
      (item) => item.id === line.productId,
    )
    if (!product || product.archived || product.workflow === 'kit')
      throw new Error(
        'Select an available individual product or flavor, not another basket.',
      )
    const key = `${line.productId}:${line.unit}`
    if (keys.has(key))
      throw new Error(
        'Combine quantities for the same product and packing arrangement.',
      )
    keys.add(key)
    const name = [
      ...new Set(
        [product.name, product.flavor, product.variant].filter(Boolean),
      ),
    ].join(' · ')
    const source = resolveLabelData(workspace, {
      kind: 'product',
      id: product.id,
    })
    const usesProductSource = Boolean(product.recipeId || source.supplierLabelSource)
    if (line.unit === 'loose' && source.nonFood)
      throw new Error(
        'Select individually packaged units for non-food products.',
      )
    const declaration = usesProductSource
      ? source.values['recipe.ingredients']
      : line.declaration
    const contains = usesProductSource
      ? source.values['recipe.allergens']
      : line.contains
    if (!source.nonFood && (!spec.componentId || (line.productId === spec.componentId && line.unit === 'package'))) {
      if (!declaration)
        warnings.push(`${name}: ingredient statement is missing.`)
      if (usesProductSource)
        warnings.push(
          ...[...source.warnings, mergePrintIssue(source)].filter(Boolean)
            .filter(
              (warning) => !warning.startsWith('Net weight needs review:'),
            )
            .map((warning) => `${name}: ${warning}`),
        )
      else if (!line.supplierReviewed)
        warnings.push(
          `${name}: reviewed supplier ingredients and allergen information are missing.`,
        )
    }
    return {
      productId: line.productId,
      unit: line.unit,
      quantity: line.quantity,
      name,
      contents: `${line.quantity} ${line.unit === 'package' ? 'individually packaged selling unit' : 'loose item'}${line.quantity === 1 ? '' : 's'}`,
      declaration: source.nonFood ? '' : declaration,
      contains:
        source.nonFood || !contains
          ? ''
          : usesProductSource
            ? contains
            : `Contains: ${contains}`,
      advisory: source.nonFood ? '' : source.values['recipe.allergenAdvisory'] || line.advisory,
      confirmedAllergens: source.allergenReview?.status === 'confirmed' ? source.allergens : source.supplierLabelSource?.reviewed && source.supplierLabelSource.noMajorAllergens ? [] : undefined,
      nonFood: Boolean(source.nonFood),
      supplierContains:
        !source.nonFood && product.recipeId && !source.supplierLabelSource && !source.allergenReview
          ? source.sourceAllergenStatements?.contains || []
          : [],
      storage: source.values['product.storage'],
      sourceRevision: {
        recipeId: product.recipeId || '',
        parts: source.ingredientParts,
        allergens: source.allergens,
        supplierStatements: source.sourceAllergenStatements,
        ingredientMode: source.ingredientMerge?.mode || 'parenthetical',
        groupSmallIngredients: source.ingredientMerge?.groupSmall || false,
        allergenReview: source.allergenReview,
        ...(source.supplierLabelSource ? { supplierLabelSource: source.supplierLabelSource } : {}),
      },
    }
  })
  const selectedComponent = sections.find(
    (section) =>
      section.productId === spec.componentId && section.unit === 'package',
  )
  if (spec.componentId && !selectedComponent)
    throw new Error(
      'Component labels require an individually packaged product in this assortment.',
    )
  const layout: AssortmentLayout =
    stock.assortmentLayout || defaultAssortmentLayout
  const parent = definition || owner
  const brand = workspace.brand_kits?.find((item) => item.id === stock.brandId)
  const parentData = resolveLabelData(
    workspace,
    { kind: 'product', id: parent?.id || '' },
    brand,
  )
  if (parent) {
    parentData.values['product.storage'] =
      parent.storage || brand?.defaultStorage || ''
    parentData.values['business.disclaimer'] =
      parent.disclaimer ||
      brand?.defaultDisclaimer ||
      workspace.settings[0]?.disclaimer ||
      ''
  }
  if (!selectedComponent && layout.parentFields.includes('assortment.allergens')) {
    const food = sections.filter((section) => !section.nonFood)
    if (food.some((section) => !section.confirmedAllergens))
      warnings.push('Overall Contains requires structured confirmed allergen information for each food. Review the sources or use a template with per-product declarations only.')
    else {
      const confirmed = [...new Set(food.flatMap((section) => section.confirmedAllergens || []))]
      if (confirmed.length) parentData.values['assortment.allergens'] = `Contains: ${confirmed.join(', ')}`
    }
  }
  if (layout.parentFields.includes('product.netQuantity')) {
    const weight = parent ? productNetWeight(parent) : undefined
    if (weight?.review) warnings.push(`${parent?.name}: ${weight.review}`)
    parentData.values['product.netQuantity'] = formatNetWeight(weight?.ounces)
  }
  parentData.values['batch.packedDate'] = run?.packedDate || ''
  parentData.values['batch.bestBy'] = run?.bestBy || ''
  const snapshot = {
    name: selectedComponent?.name || spec.name,
    contentsSummary: sections
      .map(
        (section) => section.unit === 'package'
          ? `${section.quantity} selling package${section.quantity === 1 ? '' : 's'} of ${section.name}`
          : `${section.quantity} ${section.name}`,
      )
      .join(' · '),
    fixedRevision: [
      definition?.name,
      definition?.expectedContents,
      definition?.mixedLabelTemplateId,
      definition?.mixedLabelStockId,
      packagingLines(definition || {}),
      basketDefinition,
    ],
    packingRevision: {
      containers: spec.containers,
      copies: spec.copies,
      group: spec.group,
      batchId: spec.batchId,
      mode: spec.mode,
      outputs: output.map((line) => [
        line.id,
        posted ? line.actualYield : line.quantity,
        line.definition?.product?.kitComponents,
      ]),
    },
    sections: selectedComponent ? [selectedComponent] : sections,
    allSections: sections,
    fields: [
      ...new Set(
        layout.parentFields
          .map((field) => parentData.values[field])
          .filter(Boolean)
          .map(String),
      ),
    ],
    stock: {
      width: stock.width as number,
      height: stock.height as number,
      name: stock.name,
      revision: stock.revision || 0,
    },
    layout: {
      version: 1 as const,
      minimumFontSize: layout.minimumFontSize,
      rotation: spec.rotation ?? 0,
    },
    material: material ? { id: material.id, name: material.name } : null,
    warnings: [...new Set(warnings)],
  }
  return { spec, snapshot, limit }
}

export type AssortmentSnapshot = ReturnType<typeof assortmentLabel>['snapshot']

export function assortmentSignature(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(assortmentSignature).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(
        ([key, entry]) =>
          `${JSON.stringify(key)}:${assortmentSignature(entry)}`,
      )
      .join(',')}}`
  return JSON.stringify(value) ?? 'null'
}

export function assortmentJobCurrent(workspace: Workspace, job: Item) {
  try {
    if (
      workspace.label_print_jobs?.some((newer) =>
        newer.assortmentSupersedes?.includes(job.id),
      )
    )
      return false
    const { spec, snapshot } = assortmentLabel(workspace, job.assortmentSpec)
    const outputSignature = (value: AssortmentSnapshot) => assortmentSignature(spec.componentId
      ? { ...value, allSections: undefined, contentsSummary: undefined }
      : value)
    return (
      !snapshot.warnings.length &&
      outputSignature(snapshot) === outputSignature(job.assortmentSnapshot)
    )
  } catch {
    return false
  }
}

export function assortmentLabelText(
  snapshot: AssortmentSnapshot,
  component = false,
) {
  return [
    snapshot.name,
    !component && snapshot.contentsSummary,
    ...snapshot.sections.flatMap((section) => [
      component ? '' : `${section.name} — ${section.contents}`,
      section.declaration,
      section.contains,
      ...(section.supplierContains || []),
      section.advisory,
      section.storage,
    ]),
    ...snapshot.fields,
  ].filter((line): line is string => Boolean(line))
}
