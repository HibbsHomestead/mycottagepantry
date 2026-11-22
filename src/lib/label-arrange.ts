import type { LabelElement } from './label-studio'
import { rotateVector } from './label-transform'

export type LabelAlignment =
  'top' | 'middle' | 'bottom' | 'left' | 'center' | 'right'
export function alignLabelElements(
  elements: LabelElement[],
  selected: string,
  width: number,
  height: number,
  alignment: LabelAlignment,
  safe = true,
) {
  const element = elements.find((e) => e.id === selected)
  if (!element || element.locked) return elements
  const group = elements.filter(
    (e) =>
      e.id === selected || (element.groupId && e.groupId === element.groupId),
  )
  if (group.some((e) => e.locked)) return elements
  const points = group.flatMap((e) =>
    (e.type === 'line'
      ? [
          { x: 0, y: 0 },
          { x: e.width, y: e.height },
        ]
      : [
          { x: 0, y: 0 },
          { x: e.width, y: 0 },
          { x: 0, y: e.height },
          { x: e.width, y: e.height },
        ]
    ).map((p) => {
      const v = rotateVector(p, e.rotation)
      return { x: e.x + v.x, y: e.y + v.y }
    }),
  )
  const left = Math.min(...points.map((p) => p.x)),
    right = Math.max(...points.map((p) => p.x)),
    top = Math.min(...points.map((p) => p.y)),
    bottom = Math.max(...points.map((p) => p.y))
  const margin = safe ? 9 : 0
  const dx =
    alignment === 'left'
      ? margin - left
      : alignment === 'right'
        ? width - margin - right
        : alignment === 'center'
          ? width / 2 - (left + right) / 2
          : 0
  const dy =
    alignment === 'top'
      ? margin - top
      : alignment === 'bottom'
        ? height - margin - bottom
        : alignment === 'middle'
          ? height / 2 - (top + bottom) / 2
          : 0
  return elements.map((e) =>
    group.includes(e) ? { ...e, x: e.x + dx, y: e.y + dy } : e,
  )
}
export function orderLabelElement(
  elements: LabelElement[],
  id: string,
  action: 'front' | 'back' | 'forward' | 'backward',
) {
  const index = elements.findIndex((e) => e.id === id)
  if (index < 0 || elements[index].locked) return elements
  const next = [...elements],
    [element] = next.splice(index, 1)
  const target =
    action === 'front'
      ? next.length
      : action === 'back'
        ? 0
        : action === 'forward'
          ? Math.min(index + 1, next.length)
          : Math.max(index - 1, 0)
  next.splice(target, 0, element)
  return next
}
