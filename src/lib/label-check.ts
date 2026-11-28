import {
  checkLabel,
  elementText,
  elementVisible,
  type LabelData,
  type LabelDocument,
} from './label-studio'
import { labelRunDeclarations, labelSide, labelSides, type LabelSide } from './label-sets'
import type { Item } from './domain'
import type { LabelFont } from './label-font-catalog'

export type LabelCheckIssue = {
  id: string
  group: 'Source data' | 'Label content' | 'Layout'
  message: string
  side?: LabelSide
  elementId?: string
  record?: { kind: 'ingredient' | 'recipe'; id: string }
}

/** Check the complete draft against current workspace data, never the active side. */
export function checkLabelSet(
  doc: LabelDocument,
  data: LabelData,
  assets: Item[] = [],
  fonts: LabelFont[] = [],
): LabelCheckIssue[] {
  const result = new Map<string, LabelCheckIssue>()
  const add = (
    issue: Omit<LabelCheckIssue, 'id'>,
    key = JSON.stringify(issue),
  ) => result.set(key, { ...issue, id: key })
  for (const message of data.warnings) {
    const record = data.sourceRecords?.[message]
    add(
      {
        group: 'Source data',
        message: `${record?.kind === 'ingredient' ? 'Ingredient data' : 'Recipe'}: ${message}`,
        record,
      },
      `source:${record?.id || ''}:${message}`,
    )
  }
  const sides = labelSides(doc)
  const allElements = sides.flatMap((side) => labelSide(doc, side).elements)
  const requiredElements = allElements.map((e) => {
    if (e.binding || e.type !== 'text') return e
    const binding = /^\s*ingredients\s*:/i.test(e.text)
      ? 'recipe.ingredients'
      : /^\s*contains\s*:/i.test(e.text)
        ? 'recipe.allergens'
        : ''
    return binding ? { ...e, binding } : e
  })
  const clean = { ...data, warnings: [] }
  // Required content belongs to the set; do not require a duplicate on each face.
  const required = [
    ...new Set(
      sides.flatMap((side) =>
        checkLabel(
          { ...labelSide(doc, side), elements: [] },
          clean,
          assets,
          fonts,
          requiredElements,
        ),
      ),
    ),
  ]
  for (const message of required)
    add({ group: 'Label content', message }, `required:${message}`)
  for (const side of sides) {
    const design = labelSide(doc, side)
    for (const element of design.elements.filter((e) => !e.hidden)) {
      const own = checkLabel(
        { ...design, elements: [element] },
        clean,
        assets,
        fonts,
        requiredElements,
      ).filter((message) => !required.includes(message))
      for (const message of own)
        add({
          group: message.startsWith('Print warning:')
            ? 'Layout'
            : 'Label content',
          message,
          side,
          elementId: element.id,
        })
      if (element.type !== 'text') continue
      if (element.binding) {
        const empty = !elementText(element, data).trim()
        // A known conditional allergen field is intentionally empty when none are declared.
        const optional =
          (element.binding === 'recipe.allergens' && !data.allergens.length) ||
          (element.condition === 'batch' && !data.values['batch.number'])
        if (
          !(element.binding in data.values) ||
          (empty && !optional && elementVisible(element, data))
        )
          add({
            group: 'Label content',
            message: `The live field “${element.binding}” ${element.binding in data.values ? 'has no current value' : 'cannot be resolved'}.`,
            side,
            elementId: element.id,
          })
      } else {
        const key = /^\s*ingredients\s*:/i.test(element.text)
          ? 'recipe.ingredients'
          : /^\s*contains\s*:/i.test(element.text)
            ? 'recipe.allergens'
            : ''
        if (
          key &&
          normalize(element.text) !== normalize(data.values[key] || '')
        )
          add({
            group: 'Label content',
            message: `This manually entered ${key === 'recipe.ingredients' ? 'ingredient' : 'allergen'} statement differs from the current source. It does not update automatically.`,
            side,
            elementId: element.id,
          })
      }
    }
  }
  // Require a statement somewhere in the set. A stale static statement already
  // has an element-specific discrepancy above; do not count it twice.
  if (
    data.allergens.length &&
    !allElements.some(
      (e) =>
        elementVisible(e, data) &&
        (e.binding === 'recipe.allergens' ||
          (!e.binding && /^\s*contains\s*:/i.test(e.text))),
    )
  )
    add(
      {
        group: 'Label content',
        message: 'The label set has no current allergen statement.',
      },
      'missing:allergens',
    )
  return [...result.values()]
}
const normalize = (text: string) =>
  text.trim().replace(/\s+/g, ' ').toLowerCase()

export function labelOutputIssues(doc: LabelDocument, data: LabelData, sides: LabelSide[], issues: LabelCheckIssue[]) {
  const usage = labelRunDeclarations(doc, data, sides)
  const usesNetWeight = [...new Set(sides)].some((side) => labelSide(doc, side).elements.some((element) => element.binding === 'product.netQuantity' && elementVisible(element, data)))
  return issues.filter((issue) => {
    if (issue.side && !sides.includes(issue.side)) return false
    if (issue.group === 'Source data') {
      if (issue.message.includes('Net weight needs review:')) return usesNetWeight
      if (issue.message.includes('ingredient order is unverified') || issue.message.includes('verified weight conversion')) return usage.ingredients
      return usage.allergens
    }
    if (issue.id === 'missing:allergens') return usage.allergens
    return true
  }).map((issue) => issue.message)
}
