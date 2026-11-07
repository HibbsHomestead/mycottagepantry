import type { Item, Workspace } from './domain'
import type { LabelDocument, LabelSource } from './label-studio'
import { labelSide, labelSides } from './label-sets'
import { copyLabelDesign } from './label-library'
import { validateSheet } from './label-print-layout'

export const sourceKey = (source: LabelSource) =>
  `${source.kind}:${source.id}:${source.productId || ''}`

export const sourceProductId = (source: LabelSource) =>
  source.kind === 'product' ? source.id : source.productId || ''

export function manualLabelFields(document: LabelDocument) {
  return labelSides(document).flatMap((side) =>
    labelSide(document, side)
      .elements.filter((e) => e.type === 'text' && !e.binding && e.text.trim())
      .map((e) => ({ id: `${side}:${e.id}`, side, text: e.text })),
  )
}

export function preservedManualTextWarnings(document: LabelDocument) {
  return document.workflowVersion !== 1 && manualLabelFields(document).length
    ? ['Review manually entered text for this product on every side. Product-linked fields update automatically; manual text stays as entered.']
    : []
}

/** New explicit links and preserved legacy links, without changing either record. */
export function labelsForProduct(w: Workspace, product: Item): LabelDocument[] {
  return ((w.label_templates || []) as LabelDocument[]).filter(
    (d) =>
      !d.deletedAt &&
      (d.productId === product.id || d.id === product.labelDesignId),
  )
}

export function labelSource(
  w: Workspace,
  document: LabelDocument,
  productId = '',
): LabelSource {
  if (document.source) return structuredClone(document.source)
  const linked = w.products.filter((p) => p.labelDesignId === document.id)
  const selected =
    linked.find((p) => p.id === productId) ||
    (linked.length === 1 ? linked[0] : undefined)
  return { kind: 'product', id: selected?.id || '' }
}

export function duplicateSavedLabel(
  document: LabelDocument,
  source: LabelSource,
): LabelDocument {
  const copy = copyLabelDesign(
    document,
    'label',
    document.name.slice(0, 90) + ' — Copy',
  )
  copy.workflowVersion = 1
  copy.source = structuredClone(source)
  copy.productId = sourceProductId(source) || undefined
  // An unknown legacy source cannot establish that its static product text was reviewed.
  if (!document.source || sourceKey(document.source) !== sourceKey(source))
    delete copy.manualTextReviewedFor
  return copy
}

export function validateSavedLabelContext(
  w: Workspace,
  document: LabelDocument,
) {
  if (document.workflowVersion !== 1 || document.recordKind !== 'label')
    throw new Error(
      'Create or duplicate a label in Labels. Preserved designs are not overwritten.',
    )
  const source = document.source
  if (!source || !['product', 'ingredient', 'batch'].includes(source.kind))
    throw new Error('Choose a label source.')
  const rows =
    source.kind === 'product'
      ? w.products
      : source.kind === 'batch'
        ? w.batches
        : w.ingredients
  if (!rows.some((r) => r.id === source.id))
    throw new Error('Choose a source from this business.')
  const productId = sourceProductId(source)
  if ((document.productId || '') !== productId)
    throw new Error('The saved product link does not match this label.')
  if (productId && !w.products.some((p) => p.id === productId))
    throw new Error('Choose a product from this business.')
  if (
    source.kind === 'batch' &&
    productId &&
    w.products.find((p) => p.id === productId)?.recipeId !==
      w.batches.find((b) => b.id === source.id)?.recipeId
  )
    throw new Error('This product does not use the selected batch recipe.')
  if (document.brandId && !w.brand_kits.some((b) => b.id === document.brandId))
    throw new Error('Choose a brand from this business.')
  if (
    manualLabelFields(document).length &&
    document.manualTextReviewedFor !== sourceKey(source)
  )
    throw new Error(
      'Review manually entered text for the selected product before saving or printing.',
    )
  const print = document.printSettings
  if (print) {
    if (
      print.printingMethod !== undefined &&
      (typeof print.printingMethod !== 'string' ||
        print.printingMethod.length > 100)
    )
      throw new Error('Choose a valid printing method.')
    if (
      !Number.isInteger(print.copies) ||
      print.copies < 1 ||
      print.copies > 200 ||
      !['both', 'front', 'back'].includes(print.parts) ||
      !['grouped', 'paired'].includes(print.order)
    )
      throw new Error('Choose valid print settings.')
    validateSheet(document, print.layout)
  }
}

export function assertSavedLabelOutput(
  document: LabelDocument,
  source: LabelSource,
  brandId?: string,
) {
  if (document.workflowVersion !== 1) return
  if (
    !source ||
    !document.source ||
    sourceKey(document.source) !== sourceKey(source) ||
    (document.brandId || '') !== (brandId || '')
  )
    throw new Error(
      'Save this label with the selected product and brand before printing.',
    )
  if (
    manualLabelFields(document).length &&
    document.manualTextReviewedFor !== sourceKey(source)
  )
    throw new Error('Review manually entered product text before printing.')
}
