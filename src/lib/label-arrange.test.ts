// @vitest-environment node
import { expect, it } from 'vitest'
import { newElement } from './label-studio'
import { alignLabelElements, orderLabelElement } from './label-arrange'

it.each([
  ['left', 9, 40],
  ['center', 94, 40],
  ['right', 179, 40],
  ['top', 30, 9],
  ['middle', 30, 62],
  ['bottom', 30, 115],
] as const)(
  'aligns %s in document coordinates without changing styling',
  (alignment, x, y) => {
    const element = {
      ...newElement('text'),
      x: 30,
      y: 40,
      width: 100,
      height: 20,
      rotation: 0,
      binding: 'product.name',
    }
    const [result] = alignLabelElements(
      [element],
      element.id,
      288,
      144,
      alignment,
    )
    expect(result).toEqual({ ...element, x, y })
    expect(element.x).toBe(30)
  },
)
it('accounts for rotated bounds and supports label edges independently of zoom or guides', () => {
  const element = {
    ...newElement('shape'),
    x: 30,
    y: 40,
    width: 100,
    height: 20,
    rotation: 90,
  }
  const [safe] = alignLabelElements([element], element.id, 288, 144, 'left')
  const [edge] = alignLabelElements(
    [element],
    element.id,
    288,
    144,
    'left',
    false,
  )
  expect(safe.x).toBeCloseTo(29)
  expect(edge.x).toBeCloseTo(20)
  expect(safe.rotation).toBe(90)
})
it('moves groups together and respects locked members', () => {
  const a = {
    ...newElement('text'),
    groupId: 'pair',
    x: 30,
    y: 40,
    width: 100,
    height: 20,
  }
  const b = {
    ...newElement('text'),
    groupId: 'pair',
    x: 150,
    y: 40,
    width: 50,
    height: 20,
  }
  const result = alignLabelElements([a, b], a.id, 288, 144, 'right')
  expect(result[1].x - result[0].x).toBe(120)
  expect(result[1].x + result[1].width).toBe(279)
  expect(
    alignLabelElements([a, { ...b, locked: true }], a.id, 288, 144, 'left')[0],
  ).toEqual(a)
})
it('orders one step or to the ends without altering any geometry', () => {
  const elements = [newElement('text'), newElement('image'), newElement('line')]
  expect(orderLabelElement(elements, elements[0].id, 'forward')).toEqual([
    elements[1],
    elements[0],
    elements[2],
  ])
  expect(orderLabelElement(elements, elements[2].id, 'backward')).toEqual([
    elements[0],
    elements[2],
    elements[1],
  ])
  expect(orderLabelElement(elements, elements[0].id, 'front')).toEqual([
    elements[1],
    elements[2],
    elements[0],
  ])
  expect(orderLabelElement(elements, elements[2].id, 'back')).toEqual([
    elements[2],
    elements[0],
    elements[1],
  ])
})
it.each(['text', 'image', 'shape', 'border', 'line', 'illustration'] as const)(
  'aligns %s without changing its geometry, style, or binding',
  (type) => {
    const element = {
      ...newElement(type),
      x: 30,
      y: 40,
      width: 100,
      height: 20,
      binding: type === 'text' ? 'product.name' : undefined,
    }
    const [result] = alignLabelElements(
      [element],
      element.id,
      288,
      144,
      'bottom',
    )
    expect(result).toEqual({ ...element, y: 115 })
    expect(
      alignLabelElements(
        [{ ...element, locked: true }],
        element.id,
        288,
        144,
        'left',
      )[0].x,
    ).toBe(30)
  },
)
