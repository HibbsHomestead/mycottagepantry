import { isMixedPack, mixedLabelQuantity, packagingLines, type Item, type Workspace } from './domain'
import {
  blankLabel,
  labelTextLines,
  measureLabelText,
  newElement,
  resolveLabelData,
  type LabelData,
  type LabelDocument,
} from './label-studio'
import { productionRunLines } from './production-run'

export type AssortmentLine = {
  productId: string
  count: number
  unit: 'item' | 'package'
  wrapped: boolean
  advisory: string
  componentLabel: boolean
}
export type AssortmentGroup = {
  name: string
  count: number
  lines: AssortmentLine[]
}
export type AssortmentPlan = {
  name: string
  templateId: string
  count: number
  labelsPerContainer: number
  mode: 'fixed' | 'variable'
  groups: AssortmentGroup[]
  runId?: string
  runLineId?: string
  packagingId?: string
  extraText: string
}
export type AssortmentTarget = { group: number; component: number }

function whole(value: unknown, min: number, max: number, message: string) {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  )
    throw new Error(message)
  return value
}

function text(value: unknown, limit: number) {
  if (typeof value !== 'string' || value.trim().length > limit)
    throw new Error(`Use plain text up to ${limit} characters.`)
  return value.trim()
}

export function normalizeAssortment(
  workspace: Workspace,
  input: AssortmentPlan,
): AssortmentPlan {
  if (
    !input ||
    !['fixed', 'variable'].includes(input.mode) ||
    !Array.isArray(input.groups) ||
    !input.groups.length ||
    input.groups.length > 12
  )
    throw new Error(
      'Enter the actual assortment: choose up to 12 explicitly packed combinations.',
    )
  if (input.mode === 'fixed' && input.groups.length !== 1)
    throw new Error('A fixed assortment has exactly one combination.')
  const name = text(input.name, 100)
  if (!name) throw new Error('Name the outer container or assortment.')
  const count = whole(
    input.count,
    1,
    200,
    'Enter 1–200 packed outer containers.',
  )
  const labelsPerContainer = whole(
    input.labelsPerContainer,
    0,
    4,
    'Choose 0–4 optional outer labels per container.',
  )
  const groups = input.groups.map((group, index) => {
    if (
      !Array.isArray(group?.lines) ||
      !group.lines.length ||
      group.lines.length > 20
    )
      throw new Error('Enter 1–20 actual contents for each combination.')
    const groupName = text(group.name, 100)
    if (input.mode === 'variable' && !groupName)
      throw new Error('Name every actual packing combination.')
    const lines = group.lines.map((entry) => {
      const product = workspace.products.find(
        (candidate) =>
          candidate.id === entry?.productId && !candidate.archivedAt,
      )
      if (!product || product.workflow === 'kit')
        throw new Error(
          'Choose an available product or flavor for each content row. Nested baskets are not supported.',
        )
      if (
        !['item', 'package'].includes(entry.unit) ||
        typeof entry.wrapped !== 'boolean'
      )
        throw new Error(
          'Specify whether each quantity counts individual items or selling packages and whether it is wrapped.',
        )
      if (entry.componentLabel && !entry.wrapped)
        throw new Error(
          'Component labels are available for individually packaged contents only.',
        )
      return {
        productId: product.id,
        count: whole(
          entry.count,
          1,
          200,
          'Enter a whole quantity for every product.',
        ),
        unit: entry.unit,
        wrapped: entry.wrapped,
        advisory: text(entry.advisory, 400),
        componentLabel: entry.componentLabel === true,
      }
    })
    if (
      new Set(
        lines.map(
          (line) => `${line.productId}/${line.unit}/${line.wrapped}`,
        ),
      ).size !== lines.length
    )
      throw new Error(
        `Combination ${index + 1}: consolidate duplicate product rows with the same unit and wrapping.`,
      )
    return {
      name: groupName,
      count: whole(
        group.count,
        1,
        200,
        'Enter the number of containers packed with each combination.',
      ),
      lines,
    }
  })
  if (groups.reduce((sum, group) => sum + group.count, 0) !== count)
    throw new Error(
      'The combination counts must add up to the intended number of outer containers.',
    )
  if (
    new Set(
      groups.map(({ lines }) =>
        JSON.stringify(
          lines
            .map(({ productId, count, unit, wrapped }) =>
              JSON.stringify([productId, count, unit, wrapped]),
            )
            .sort(),
        ),
      ),
    ).size !== groups.length
  )
    throw new Error(
      'Combine groups with identical contents rather than approving the same combination twice.',
    )
  const runId = input.runId || undefined
  const runLineId = input.runLineId || undefined
  if (runId || runLineId) {
    const run = workspace.batches.find(
      (candidate) =>
        candidate.id === runId &&
        !['canceled', 'cancelled'].includes(candidate.status),
    )
    const line = productionRunLines(run).find(
      (candidate) => candidate.id === runLineId,
    )
    if (!run || !line)
      throw new Error('Select a saved packing run and product line.')
    if (
      !workspace.products.some(
        (product) => product.id === line.productId && !product.archivedAt,
      )
    )
      throw new Error('The packing run product is unavailable.')
    const output = Number(
      run.status === 'completed'
        ? line.output
        : line.output === ''
          ? line.quantity
          : (line.output ?? line.quantity),
    )
    if (output !== count)
      throw new Error(
        `The assortment must account for all ${output} outer packages on the selected run line.`,
      )
    const product = workspace.products.find(
      (candidate) => candidate.id === line.productId,
    )
    const definition =
      run.status === 'completed' ? line.definition?.product : product
    if (definition?.workflow === 'kit' || product?.workflow === 'kit') {
      const mixed = isMixedPack(definition)
      const labels = mixedLabelQuantity(definition)
      if (mixed && (input.mode !== 'fixed' ||
        (definition?.mixedLabelTemplateId && input.templateId !== definition.mixedLabelTemplateId) ||
        (labels && (labelsPerContainer !== labels || input.packagingId !== definition?.mixedLabelStockId))))
        throw new Error('Review and use the mixed pack’s saved contents and label configuration.')
      const components: Item[] =
        (run.status === 'completed'
          ? line.definition?.components
          : product?.kitComponents) || []
      if (
        !components.length ||
        groups.some(
          (group) =>
            components.length !== group.lines.length ||
            components.some(
              (component) =>
                !group.lines.some(
                  (row) =>
                    row.productId === component.productId &&
                    row.unit === (mixed && component.basis === 'unpackaged' ? 'item' : 'package') &&
                    row.wrapped === !(mixed && component.basis === 'unpackaged') &&
                    row.count === Number(component.quantity),
                ),
            ),
        )
      )
        throw new Error(
          mixed ? 'Match the saved mixed-pack contents, quantities and stock bases before reviewing this label.' :
            'This basket uses fixed selling-package components. Match its saved component IDs and selling-package counts; do not substitute loose items or another flavor on its label.',
        )
    }
    if (
      input.packagingId &&
      !packagingLines(definition || {}).some(
        (material) => material.ingredientId === input.packagingId,
      )
    )
      throw new Error(
        'Choose packaging already assigned to this run product.',
      )
  }
  if (
    input.packagingId &&
    !workspace.ingredients.some(
      (item) =>
        item.id === input.packagingId &&
        item.usedAs === 'packaging' &&
        !item.archivedAt,
    )
  )
    throw new Error('Choose existing packaging for the outer container.')
  const template = workspace.label_templates.find(
    (entry) => entry.id === input.templateId && !entry.deletedAt,
  )
  if (
    !template ||
    template.round ||
    template.format === 'front-back' ||
    !Number.isFinite(template.width) ||
    !Number.isFinite(template.height) ||
    template.width < 36 ||
    template.height < 36
  )
    throw new Error('Choose available rectangular single-label stock.')
  return {
    name,
    templateId: template.id,
    count,
    labelsPerContainer,
    mode: input.mode,
    groups,
    runId,
    runLineId,
    packagingId: input.packagingId || undefined,
    extraText: text(input.extraText, 300),
  }
}

export function assortmentReview(
  workspace: Workspace,
  input: AssortmentPlan,
  target: AssortmentTarget,
  memo = new Map<string, LabelData>(),
) {
  const plan = normalizeAssortment(workspace, input)
  const group =
    plan.groups[
      whole(
        target.group,
        0,
        plan.groups.length - 1,
        'Select a packing combination.',
      )
    ]
  const component = whole(
    target.component,
    -1,
    group.lines.length - 1,
    'Select an outer or configured component label.',
  )
  const chosen = component === -1 ? group.lines : [group.lines[component]]
  if (component >= 0 && !chosen[0].componentLabel)
    throw new Error('Enable this wrapped product’s component label first.')
  const copies = whole(
    group.count *
      (component < 0 ? plan.labelsPerContainer : chosen[0].count),
    1,
    200,
    'Choose 1–200 labels for this specific output. Split larger quantities into separate packing runs.',
  )
  const warnings: string[] = []
  const products = chosen.map((line) => {
    const product = workspace.products.find(
      (candidate) => candidate.id === line.productId,
    )!
    if (!memo.has(product.id))
      memo.set(
        product.id,
        resolveLabelData(workspace, { kind: 'product', id: product.id }),
      )
    const source = memo.get(product.id)!
    const name = [product.name, product.flavor || product.variant]
      .filter(Boolean)
      .join(' · ')
    if (!source.nonFood && !source.values['recipe.ingredients'])
      warnings.push(
        `${name}: reviewed ingredient and allergen information is missing.`,
      )
    warnings.push(
      ...source.warnings
        .filter(
          (warning) => !warning.startsWith('Net weight needs review:'),
        )
        .map((warning) => `${name}: ${warning}`),
    )
    return {
      name,
      line,
      ingredients: source.values['recipe.ingredients'],
      allergens: source.values['recipe.allergens'],
      sourceAllergenStatements: source.sourceAllergenStatements,
      parts: source.ingredientParts,
      netQuantity:
        line.unit === 'package' ? source.values['product.netQuantity'] : '',
      nonFood: source.nonFood,
    }
  })
  const stock = workspace.label_templates.find(
    (entry) => entry.id === plan.templateId,
  ) as LabelDocument
  const title =
    component >= 0
      ? products[0].name
      : [...new Set([plan.name, group.name].filter(Boolean))].join(' · ')
  const contents = products.map(
    ({ line, name }) =>
      `${line.count} ${line.unit === 'package' ? 'selling package' : 'individual item'}${line.count === 1 ? '' : 's'} · ${name} (${line.wrapped ? 'individually packaged' : 'loose in outer container'})`,
  )
  const textBody = [
    component < 0
      ? ['Contents per container:', ...contents].join('\n')
      : products[0].netQuantity,
    ...products.map((product) =>
      [
        component < 0 ? product.name : '',
        product.ingredients,
        product.allergens,
        ...(product.sourceAllergenStatements?.contains || []).map(
          (statement) =>
            `Reviewed supplier allergen statement: ${statement}`,
        ),
        ...(product.sourceAllergenStatements?.advisories || []).map(
          (statement) => `Reviewed supplier advisory: ${statement}`,
        ),
        product.line.advisory
          ? `Reviewed advisory: ${product.line.advisory}`
          : '',
      ]
        .filter(Boolean)
        .join('\n'),
    ),
    plan.extraText,
  ]
    .filter(Boolean)
    .join('\n\n')
  const data: LabelData = {
    values: {},
    warnings,
    allergens: [],
    weightsVerified: warnings.length === 0,
    ingredientParts: [],
  }
  const doc: LabelDocument = {
    ...blankLabel(),
    id: `${stock.id}-assortment`,
    name: title,
    width: stock.width,
    height: stock.height,
    renderVersion: 2,
  }
  let top = 12
  let overflow = false
  for (const [index, content] of [title, textBody].entries()) {
    if (!content) continue
    const element = {
      ...newElement('text', content),
      id: `assortment-text-${index}`,
      x: 12,
      y: top,
      width: doc.width - 24,
      fontSize: index === 0 ? 14 : 10,
      bold: index === 0,
    }
    const lines = labelTextLines(element, data)
    element.height =
      lines.length * element.fontSize * element.lineHeight + 3
    top += element.height + 4
    overflow ||= lines.some(
      (line) =>
        measureLabelText(element, line.map((run) => run.text).join('')) >
        element.width,
    )
    doc.elements.push(element)
  }
  if (overflow || top > doc.height - 8)
    warnings.push(
      'Contents do not fit at the set text size. Choose larger label stock; no wording was removed or shrunk.',
    )
  const reviewKey = JSON.stringify([
    plan,
    target,
    stock.revision,
    stock.updatedAt,
    doc.width,
    doc.height,
    products,
    textBody,
    warnings,
  ])
  return {
    plan,
    group,
    document: doc,
    data,
    warnings,
    copies,
    reviewKey,
    target,
    products,
    overflow: overflow || top > doc.height - 8,
  }
}

export async function assortmentReviewDigest(key: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(key),
  )
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}
