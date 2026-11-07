// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { readFile } from 'node:fs/promises'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import {
  blankLabel,
  newElement,
  validateLabelDocument,
  type LabelElement,
} from './label-studio'
import {
  elementCenter,
  normalizeAngle,
  pointerAngle,
  resizeCursor,
  resizeElement,
  rotateAboutCenter,
  rotateVector,
  snapAngle,
  toLocal,
} from './label-transform'
import { exportLabelPdf, defaultSheet } from './label-export'
import { LabelCanvas } from '@/components/label-studio'

const corner = (e: LabelElement, lx: number, ly: number) => {
  const v = rotateVector({ x: lx, y: ly }, e.rotation)
  return { x: e.x + v.x, y: e.y + v.y }
}
const close = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  expect(a.x).toBeCloseTo(b.x, 1)
  expect(a.y).toBeCloseTo(b.y, 1)
}

describe('label element transforms', () => {
  it('rotates around the center, including upside down', () => {
    const e = { ...newElement('text'), x: 20, y: 30, width: 100, height: 40 }
    const before = elementCenter(e)
    for (const angle of [37, 180, -90, 270]) {
      const next = { ...e, ...rotateAboutCenter(e, angle) }
      close(elementCenter(next), before)
    }
    expect(rotateAboutCenter(e, 180).rotation).toBe(180)
    expect(normalizeAngle(270)).toBe(-90)
    expect(snapAngle(44)).toBe(45)
    expect(snapAngle(-7)).toBe(0)
  })
  it('measures pointer angles from straight up around the center', () => {
    const e = { ...newElement('shape'), x: 0, y: 0, width: 100, height: 100 }
    expect(pointerAngle(e, { x: 50, y: -10 })).toBeCloseTo(0)
    expect(pointerAngle(e, { x: 150, y: 50 })).toBeCloseTo(90)
  })
  it('resizes an image proportionally from a corner without cropping', () => {
    const e: LabelElement = {
      ...newElement('image'),
      x: 10,
      y: 10,
      width: 120,
      height: 60,
      fit: 'contain',
    }
    const patch = resizeElement(
      e,
      'se',
      { x: 250, y: 400 },
      { keepAspect: true },
    )
    expect(patch.width! / patch.height!).toBeCloseTo(2)
    expect(patch.x).toBe(10)
    expect(patch.y).toBe(10)
    expect(patch.fit).toBeUndefined()
  })
  it('keeps the opposite corner fixed when resizing a rotated element', () => {
    const e: LabelElement = {
      ...newElement('shape'),
      x: 80,
      y: 40,
      width: 100,
      height: 50,
      rotation: 33,
    }
    const anchor = corner(e, 0, 0),
      target = corner(e, 140, 70),
      next = { ...e, ...resizeElement(e, 'se', target) }
    close(corner(next, 0, 0), anchor)
    expect(next.width).toBeCloseTo(140, 1)
    expect(next.height).toBeCloseTo(70, 1)
    // Resizing again from the top-left keeps the bottom-right in place.
    const far = corner(next, next.width, next.height),
      again = { ...next, ...resizeElement(next, 'nw', corner(next, 20, 10)) }
    close(corner(again, again.width, again.height), far)
    expect(again.rotation).toBe(33)
  })
  it('scales text from corners and reflows it from the sides', () => {
    const e: LabelElement = {
      ...newElement('text', '', 'product.name'),
      width: 100,
      height: 30,
      fontSize: 12,
      letterSpacing: 1,
      rotation: 180,
    }
    const scaled = resizeElement(e, 'se', corner(e, 200, 60))
    expect(scaled.width).toBeCloseTo(200)
    expect(scaled.height).toBeCloseTo(60)
    expect(scaled.fontSize).toBe(24)
    expect(scaled.letterSpacing).toBe(2)
    const wider = resizeElement(e, 'e', corner(e, 160, 15))
    expect(wider.width).toBeCloseTo(160)
    expect(wider.height).toBe(30)
    expect(wider.fontSize).toBeUndefined()
    expect({ ...e, ...wider }.binding).toBe('product.name')
  })
  it('lets shapes change width and height independently', () => {
    const e = { ...newElement('shape'), width: 50, height: 50 }
    const p = resizeElement(e, 's', toLocalInverse(e, 25, 120))
    expect(p.height).toBeCloseTo(120)
    expect(p.width).toBe(50)
  })
  it('rotates resize cursors with the element', () => {
    expect(resizeCursor('e', 0)).toBe('ew-resize')
    expect(resizeCursor('e', 90)).toBe('ns-resize')
    expect(resizeCursor('se', 0)).toBe('nwse-resize')
  })
  it('saves, previews and exports transformed elements', async () => {
    const d = blankLabel()
    d.elements = [
      {
        ...newElement('text', '', 'product.name'),
        ...rotateAboutCenter(
          { ...newElement('text'), x: 30, y: 30, width: 120, height: 30 },
          200,
        ),
        width: 120,
        height: 30,
      },
    ]
    const saved = validateLabelDocument(JSON.parse(JSON.stringify(d)))
    expect(saved.elements[0]).toMatchObject(d.elements[0])
    const markup = renderToStaticMarkup(
      createElement(LabelCanvas, {
        document: saved,
        data: { values: { 'product.name': 'Rye' } } as never,
      }),
    )
    const e = saved.elements[0]
    expect(markup).toContain(`translate(${e.x} ${e.y}) rotate(${e.rotation})`)
    expect(markup).not.toContain('data-handle')
    const editorMarkup = renderToStaticMarkup(
      createElement(LabelCanvas, {
        document: saved,
        data: { values: { 'product.name': 'Rye' } } as never,
        editor: true,
        selected: e.id,
        zoom: 2,
      }),
    )
    expect(editorMarkup).toContain('data-handle="rotate"')
    expect(editorMarkup).toContain('data-handle="se"')
    // Handles live inside the editor-only overlay that print/export strips.
    expect(editorMarkup).toMatch(
      /<g data-editor-only="true" data-element="[^"]+" data-selection-overlay/,
    )
    const pdf = await PDFDocument.load(
      await exportLabelPdf(
        saved,
        {
          values: { 'product.name': 'Rye' },
          warnings: [],
          allergens: [],
          weightsVerified: true,
          ingredientParts: [],
        },
        [],
        1,
        defaultSheet,
        {
          font: async (key) =>
            new Uint8Array(
              await readFile('public/label-fonts/' + key + '.ttf'),
            ),
          image: async () => new Uint8Array(),
        },
      ),
    )
    expect(pdf.getPageCount()).toBe(1)
  })
})
function toLocalInverse(e: LabelElement, lx: number, ly: number) {
  const p = corner(e, lx, ly)
  expect(toLocal(e, p).x).toBeCloseTo(lx)
  return p
}
