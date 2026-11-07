import {
  elementVisible,
  elementText,
  elementAssetId,
  labelBackground,
  type LabelDocument,
  type LabelData,
} from './label-studio'
import { validateSheet, type SheetLayout } from './label-print-layout'
export type LabelSide = 'front' | 'back'
export type LabelParts = 'both' | LabelSide
export type LabelOrder = 'grouped' | 'paired'
export type LabelLayout = Pick<
  LabelDocument,
  | 'width'
  | 'height'
  | 'round'
  | 'background'
  | 'backgroundOpacity'
  | 'elements'
  | 'labelType'
  | 'displayUnit'
>
export const layoutKeys = [
  'width',
  'height',
  'round',
  'background',
  'backgroundOpacity',
  'elements',
  'labelType',
  'displayUnit',
] as const
export function labelLayout(d: LabelDocument): LabelLayout {
  const normalized = { ...d, ...labelBackground(d) }
  return Object.fromEntries(
    layoutKeys.map((key) => [key, structuredClone(normalized[key])]),
  ) as LabelLayout
}
export function labelSide(d: LabelDocument, side: LabelSide): LabelDocument {
  const single = { ...d }
  delete single.back
  if (side === 'back' && !d.back)
    throw new Error('This template has no Back label.')
  return {
    ...single,
    ...(side === 'back' ? d.back : {}),
    ...labelBackground(side === 'back' ? d.back! : d),
    id: d.format === 'front-back' ? `${d.id}-${side}` : d.id,
    format: 'single',
  }
}
export function labelSides(d: LabelDocument): LabelSide[] {
  return d.format === 'front-back' ? ['front', 'back'] : ['front']
}
export function labelSetPlan(
  d: LabelDocument,
  products: number,
  parts: LabelParts = 'both',
  order: LabelOrder = 'grouped',
  layout?: SheetLayout,
) {
  if (!Number.isInteger(products) || products < 1 || products > 200)
    throw new Error('Choose 1–200 products.')
  if (
    !['both', 'front', 'back'].includes(parts) ||
    !['grouped', 'paired'].includes(order)
  )
    throw new Error('Choose valid label sides and order.')
  if (parts === 'back' && d.format !== 'front-back')
    throw new Error('This template has no Back label.')
  const sides = parts === 'both' ? labelSides(d) : [parts]
  const designs = sides.map((side) => ({ side, document: labelSide(d, side) }))
  for (const { side, document } of designs) {
    if (d.format === 'front-back' && !document.elements.some((e) => !e.hidden))
      throw new Error(
        `${side === 'front' ? 'Front' : 'Back'} is blank. Add content or explicitly select replacement labels.`,
      )
    if (layout) validateSheet(document, layout)
  }
  const differentStock =
    designs.length === 2 &&
    (designs[0].document.width !== designs[1].document.width ||
      designs[0].document.height !== designs[1].document.height ||
      designs[0].document.round !== designs[1].document.round)
  const grouped = designs.flatMap(({ side }) =>
    Array<LabelSide>(products).fill(side),
  )
  const sequence =
    order === 'paired' && !differentStock && sides.length === 2
      ? Array.from(
          { length: products },
          () => ['front', 'back'] as LabelSide[],
        ).flat()
      : grouped
  const runs = differentStock
    ? designs.map(({ side, document }) => ({
        name: side === 'front' ? 'Front' : 'Back',
        document,
        sequence: Array<LabelSide>(products).fill(side),
      }))
    : [
        {
          name:
            sides.length === 2
              ? 'Complete sets'
              : sides[0] === 'back'
                ? 'Back'
                : 'Front',
          document: designs[0].document,
          sequence,
        },
      ]
  if (runs.some((run) => run.sequence.length > 200))
    throw new Error(
      'This run exceeds 200 individual labels. Use at most 100 complete sets on matching stock, or split the run.',
    )
  return {
    products,
    sides,
    differentStock,
    sequence,
    runs,
    total: sequence.length,
  }
}

/** A populated set must not emit an empty side when its bindings/conditions resolve away. */
export function validateLabelRunContent(
  document: LabelDocument,
  data: LabelData,
  sides: LabelSide[],
) {
  if (document.format !== 'front-back') return
  for (const side of new Set(sides)) {
    const layout = labelSide(document, side)
    if (
      !layout.elements.some(
        (element) =>
          elementVisible(element, data) &&
          (element.type === 'text'
            ? Boolean(elementText(element, data).trim())
            : element.type === 'image'
              ? Boolean(elementAssetId(element, data))
              : true),
      )
    )
      throw new Error(
        `${side === 'front' ? 'Front' : 'Back'} has no visible content for this product. Add content or choose replacement labels for the other side.`,
      )
  }
}
