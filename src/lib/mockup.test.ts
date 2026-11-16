import { describe, it, expect } from 'vitest'
import {
  artworkHeight,
  validateComposition,
  type MockupComposition,
} from './mockup'
const c: MockupComposition = {
  version: 1,
  baseId: 'base',
  artworkId: 'art',
  placement: { x: 300, y: 400, width: 200, rotation: 35 },
  area: { x: 100, y: 200, width: 600, height: 700 },
  panelWidth: 12,
  panelHeight: 14,
  calibrated: true,
}
describe('private mockup geometry', () => {
  it('retains source-pixel geometry across viewport changes', () => {
    expect(validateComposition(c, [{ id: 'base' }, { id: 'art' }])).toEqual(c)
    expect(artworkHeight(c.placement, 100, 300)).toBe(600)
    expect(artworkHeight(c.placement, 300, 100)).toBeCloseTo(66.6667)
  })
  it('rejects images outside the authenticated business', () => {
    expect(() => validateComposition(c, [{ id: 'base' }])).toThrow(
      'this business',
    )
    expect(() => validateComposition(c, [{ id: 'art' }])).toThrow(
      'this business',
    )
  })
  it('rejects invalid sizes and false calibration', () => {
    for (const bad of [
      { ...c, placement: { ...c.placement, width: 0 } },
      { ...c, panelWidth: 0 },
      { ...c, placement: { ...c.placement, rotation: Infinity } },
    ])
      expect(() =>
        validateComposition(bad, [{ id: 'base' }, { id: 'art' }]),
      ).toThrow()
  })
  it('allows uncalibrated reusable blanks without artwork', () => {
    expect(
      validateComposition(
        {
          ...c,
          artworkId: '',
          calibrated: false,
          panelWidth: 0,
          panelHeight: 0,
        },
        [{ id: 'base' }],
      ).artworkId,
    ).toBe('')
  })
})

// Exercise the same renderer used by downloads, with real raster pixels.
import { createCanvas } from '@napi-rs/canvas'
import { vi } from 'vitest'
import { renderMockup } from './mockup'
it('exports original white and colored pixels with no editing guides', () => {
  const base = createCanvas(100, 100),
    b = base.getContext('2d')
  b.fillStyle = '#dbc9a4'
  b.fillRect(0, 0, 100, 100)
  const art = createCanvas(20, 40),
    a = art.getContext('2d')
  a.fillStyle = '#ffffff'
  a.fillRect(0, 0, 10, 40)
  a.fillStyle = '#663399'
  a.fillRect(10, 0, 10, 40)
  const spy = vi
    .spyOn(document, 'createElement')
    .mockImplementation(
      () => createCanvas(1, 1) as unknown as HTMLCanvasElement,
    )
  try {
    const composition = {
      ...c,
      placement: { x: 30, y: 20, width: 20, rotation: 0 },
    }
    const out = renderMockup(
      base as unknown as CanvasImageSource,
      art as unknown as CanvasImageSource,
      composition,
      100,
      100,
      20,
      40,
      100,
    )
    const ctx = out.getContext('2d')!
    expect([...ctx.getImageData(35, 25, 1, 1).data]).toEqual([
      255, 255, 255, 255,
    ])
    expect([...ctx.getImageData(45, 25, 1, 1).data]).toEqual([
      102, 51, 153, 255,
    ])
    expect([...ctx.getImageData(1, 1, 1, 1).data]).toEqual([219, 201, 164, 255])
    expect(out.width).toBe(100)
    expect(out.height).toBe(100)
  } finally {
    spy.mockRestore()
  }
})
it('flattens transparent base onto the explicitly chosen JPG background', () => {
  const base = createCanvas(100, 100)
  const spy = vi
    .spyOn(document, 'createElement')
    .mockImplementation(
      () => createCanvas(1, 1) as unknown as HTMLCanvasElement,
    )
  try {
    const out = renderMockup(
      base as unknown as CanvasImageSource,
      null,
      c,
      100,
      100,
      1,
      1,
      200,
      '#ffcc00',
    )
    expect(out.width).toBe(200)
    expect([...out.getContext('2d')!.getImageData(1, 1, 1, 1).data]).toEqual([
      255, 204, 0, 255,
    ])
  } finally {
    spy.mockRestore()
  }
})
