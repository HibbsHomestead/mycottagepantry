import type { Item, Workspace } from './domain'
import { labelRecordKind } from './label-library'
import {
  elementText,
  elementVisible,
  imageBindings,
  type LabelData,
  type LabelDocument,
} from './label-studio'

/** Saved, non-deleted label designs that can be assigned to and printed for an item. */
export const assignableLabels = (w: Workspace) =>
  ((w.label_templates || []) as LabelDocument[]).filter((t) => !t.deletedAt)

export type AssignedLabel =
  | { status: 'none' }
  | { status: 'missing'; id: string }
  | { status: 'ok'; design: LabelDocument }

/**
 * The design explicitly assigned to a product. Never falls back to another
 * design: an unknown or deleted assignment is reported as missing.
 */
export function assignedLabel(w: Workspace, product: Item): AssignedLabel {
  const id = String(product.labelDesignId || '')
  if (!id) return { status: 'none' }
  const design = assignableLabels(w).find((t) => t.id === id)
  return design ? { status: 'ok', design } : { status: 'missing', id }
}

const words = (key: string) =>
  key
    .replace(/^label(?=[A-Z])/, 'label ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()

/** Human-readable name for a data binding, e.g. product.netQuantity → Product net quantity. */
export function bindingDisplayName(binding: string) {
  const [scope, key = ''] = binding.split('.')
  const text = `${scope} ${words(key)}`.trim()
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * Visible text fields bound to item data that resolve to nothing. The preview
 * lists them instead of presenting an incomplete label as finished.
 */
export function missingLabelFields(d: LabelDocument, data: LabelData) {
  const missing = new Set<string>()
  for (const e of d.elements) {
    if (e.binding && imageBindings.includes(e.binding)) continue
    if (e.type !== 'text' || !elementVisible(e, data)) continue
    const text = elementText(e, data)
    if (e.binding && !text.trim()) missing.add(bindingDisplayName(e.binding))
    for (const token of text.match(/\{\{[^{}]+\}\}/g) || [])
      missing.add(`Unresolved template field: ${token}`)
  }
  return [...missing]
}

/** Server-side: validate an explicit product → label design assignment. */
export function productLabelAssignment(
  w: Workspace,
  data: { productId?: unknown; labelId?: unknown },
): Item {
  const product = w.products.find((p) => p.id === data.productId)
  if (!product) throw new Error('Choose a product from this oven.')
  if (data.labelId === null || data.labelId === '') {
    const next = { ...product }
    delete next.labelDesignId
    return next
  }
  const design = assignableLabels(w).find((t) => t.id === data.labelId)
  if (
    !design ||
    (labelRecordKind(design) !== 'template' &&
      product.labelDesignId !== design.id)
  )
    throw new Error('Choose a saved label design from this oven.')
  return { ...product, labelDesignId: design.id }
}

/** An explicit editor action changes assignment; unrelated saves preserve legacy links. */
export function applyProductTemplateDraft(
  w: Workspace,
  item: Item,
  stored?: Item,
) {
  if (item.labelAssignmentEdited === true) {
    const product = { ...stored, ...item, labelDesignId: stored?.labelDesignId }
    const next = productLabelAssignment(
      {
        ...w,
        products: [product, ...w.products.filter((p) => p.id !== product.id)],
      },
      { productId: product.id, labelId: item.labelDesignId || '' },
    )
    item.labelDesignId = next.labelDesignId || ''
  } else if (stored?.labelDesignId) item.labelDesignId = stored.labelDesignId
  else delete item.labelDesignId
  delete item.labelAssignmentEdited
  return item
}
