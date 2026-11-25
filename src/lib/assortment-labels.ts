import { isMixedPack, mixedLabelQuantity, packagingLines, type Item, type Workspace } from './domain'
import { resolveLabelData } from './label-studio'
import { productionRunLines } from './production-run'

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
  lines: PackedLine[]
}

export function fixedAssortmentContents(definition?: Item) {
  const lines: PackedLine[] = (definition?.kitComponents || []).map((line: Item) => ({
    productId: line.productId,
    quantity: Number(line.quantity),
    unit: line.basis === 'unpackaged' ? 'loose' : 'package',
  }))
  return {
    lines,
    expectedLoose: lines.reduce((sum, line) => sum + (line.unit === 'loose' ? line.quantity : 0), 0),
    expectedPackages: lines.reduce((sum, line) => sum + (line.unit === 'package' ? line.quantity : 0), 0),
  }
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
  const definition = posted ? output[0]?.definition?.product : owner
  const mixed = isMixedPack(owner)
  const basketDefinition = definition?.kitComponents
  if (mixed) {
    const labels = mixedLabelQuantity(definition)
    if (spec.mode !== 'fixed') throw new Error('Use the saved fixed contents for a mixed-pack label.')
    if (definition?.mixedLabelTemplateId && spec.templateId !== definition.mixedLabelTemplateId)
      throw new Error('Use the label template saved on the mixed pack.')
    if (!spec.componentId && labels && (spec.packagingId !== definition.mixedLabelStockId || spec.copies !== spec.containers * labels))
      throw new Error(`Use the saved label material and ${labels} label(s) per mixed pack.`)
  }
  if (owner?.workflow === 'kit' && spec.mode === 'fixed') {
    const expected = Array.isArray(basketDefinition) ? basketDefinition : []
    if (
      expected.length !== spec.lines.length ||
      expected.some(
        (component: Item) =>
          (!mixed && component.basis !== 'package') ||
          !spec.lines.some(
            (line) =>
              line.unit === (mixed && component.basis === 'unpackaged' ? 'loose' : 'package') &&
              line.productId === component.productId &&
              line.quantity === Number(component.quantity),
          ),
      )
    )
      throw new Error(
        mixed ? 'Label contents changed. Reload the saved mixed-pack combination and review it again.' :
          'Fixed basket contents must match its configured selling packages. Use an actual selection for a variable packing mix.',
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
    const hasRecipe = Boolean(product.recipeId)
    if (line.unit === 'loose' && source.nonFood)
      throw new Error(
        'Select individually packaged units for non-food products.',
      )
    const declaration = hasRecipe
      ? source.values['recipe.ingredients']
      : line.declaration
    const contains = hasRecipe
      ? source.values['recipe.allergens']
      : line.contains
    if (!source.nonFood) {
      if (!declaration)
        warnings.push(`${name}: ingredient statement is missing.`)
      if (hasRecipe)
        warnings.push(
          ...source.warnings
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
          : hasRecipe
            ? contains
            : `Contains: ${contains}`,
      advisory: source.nonFood ? '' : line.advisory,
      storage: source.values['product.storage'],
      sourceRevision: {
        recipeId: product.recipeId || '',
        parts: source.ingredientParts,
        allergens: source.allergens,
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
  const settings = workspace.settings[0] || {}
  const snapshot = {
    name: selectedComponent?.name || spec.name,
    ...(mixed ? {
      contentsSummary: sections.map((section) => `${section.quantity} ${section.name.toLowerCase()}${section.unit === 'package' ? ' (finished packages)' : ''}`).join(' + '),
      fixedRevision: [definition?.name, definition?.expectedContents, definition?.mixedLabelTemplateId, definition?.mixedLabelStockId, packagingLines(definition || {}), basketDefinition],
    } : {}),
    sections: selectedComponent ? [selectedComponent] : sections,
    allSections: sections,
    fields: [
      ...new Set(
        [
          owner?.storage,
          owner?.disclaimer || settings.disclaimer,
          settings.name,
          settings.address,
        ]
          .filter(Boolean)
          .map(String),
      ),
    ],
    stock: {
      width: stock.width as number,
      height: stock.height as number,
      name: stock.name,
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
    const snapshot = assortmentLabel(workspace, job.assortmentSpec).snapshot
    return (
      !snapshot.warnings.length &&
      assortmentSignature(snapshot) ===
        assortmentSignature(job.assortmentSnapshot)
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
      section.advisory,
      section.storage,
    ]),
    ...snapshot.fields,
  ].filter((line): line is string => Boolean(line))
}
