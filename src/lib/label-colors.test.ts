import { describe, it, expect } from 'vitest'
import {
  parseHex,
  hexRgb,
  rgbHex,
  hexHsv,
  hsvHex,
  hexHsl,
  hslHex,
  recentColorList,
  validateLabelColor,
  effectiveFill,
} from './label-colors'
describe('label color fidelity', () => {
  it('normalizes typed HEX and rejects invalid values', () => {
    expect(parseHex(' 71315F ')).toBe('#71315f')
    expect(parseHex('#abc')).toBe('#aabbcc')
    expect(parseHex('#wrong')).toBeNull()
    expect(() => validateLabelColor({ hex: '#ffffff', opacity: NaN })).toThrow()
    expect(validateLabelColor({ hex: 'transparent', opacity: 0 })).toEqual({
      hex: 'transparent',
      opacity: 0,
    })
  })
  it.each(['#71315f', '#000000', '#ffffff', '#123abc', '#ff0000'])(
    'round trips RGB HSV and HSL for %s',
    (hex) => {
      expect(rgbHex(...hexRgb(hex))).toBe(hex)
      const hsv = hexHsv(hex)
      expect(hsvHex(hsv.h, hsv.s, hsv.v)).toBe(hex)
      expect(hslHex(...(hexHsl(hex) as [number, number, number]))).toBe(hex)
    },
  )
  it('deduplicates committed colors and caps recent history at sixteen', () => {
    const colors = Array.from({ length: 20 }, (_, i) => ({
      hex: rgbHex(i, 0, 0),
      opacity: 1,
    }))
    const recent = recentColorList(colors, colors[5])
    expect(recent).toHaveLength(16)
    expect(recent.filter((c) => c.hex === colors[5].hex)).toHaveLength(1)
    expect(recent[0]).toEqual(colors[5])
  })
  it('preserves legacy filled shapes while distinguishing explicit no fill', () => {
    const shape = { type: 'shape', fill: 'transparent', color: '#71315f' }
    expect(effectiveFill(shape)).toBe('#71315f')
    expect(effectiveFill({ ...shape, fillOpacity: 0 })).toBe('transparent')
  })
})
