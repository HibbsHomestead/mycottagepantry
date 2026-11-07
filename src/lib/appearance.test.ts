import { describe, expect, it, vi } from 'vitest'
import {
  accentThemes,
  appearanceBootScript,
  appearanceCacheKey,
  readAppearanceCache,
  cacheAppearance,
  appearanceVariables,
  validateAppearance,
} from './appearance'
import { dateRange } from './date-ranges'
const luminance = (hex: string) => {
  const channels = hex
    .slice(1)
    .match(/../g)!
    .map((x) => parseInt(x, 16) / 255)
    .map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4))
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}
const contrast = (a: string, b: string) => {
  const x = luminance(a),
    y = luminance(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}
describe('oven appearance', () => {
  it('keeps light page and content surfaces cool and neutral for every accent', () => {
    for (const theme of accentThemes) {
      const v = appearanceVariables({ theme: theme.id, mode: 'light' })
      expect(v['--background']).toBe('#f5f6fa')
      expect(v['--card']).toBe('#ffffff')
      expect(v['--surface-soft']).toBe('#f0f2f7')
    }
  })
  for (const theme of accentThemes)
    for (const mode of ['light', 'dark'] as const)
      it(`${theme.name} ${mode} keeps text readable`, () => {
        const v = appearanceVariables({ theme: theme.id, mode })
        for (const [fg, bg] of [
          ['--foreground', '--background'],
          ['--foreground', '--card'],
          ['--muted', '--card'],
          ['--primary', '--accent-soft'],
          ['--primary-ink', '--primary'],
          ['--success', '--success-bg'],
          ['--warning', '--warning-bg'],
          ['--danger', '--danger-bg'],
          ['--info', '--info-bg'],
        ])
          expect(
            contrast(v[fg], v[bg]),
            `${fg} on ${bg}`,
          ).toBeGreaterThanOrEqual(4.5)
      })
  it('validates persisted preferences and excludes extra input', () => {
    expect(
      validateAppearance({
        theme: 'plum',
        mode: 'system',
        businessId: 'ignored',
      }),
    ).toEqual({ theme: 'plum', mode: 'system' })
    expect(() =>
      validateAppearance({ theme: 'unknown', mode: 'light' }),
    ).toThrow()
    expect(() => validateAppearance(null)).toThrow()
    expect(() =>
      validateAppearance({ theme: 'plum', mode: 'unknown' }),
    ).toThrow()
  })
  it('follows system dark preference only in system mode', () => {
    expect(
      appearanceVariables({ theme: 'plum', mode: 'system' }, true),
    ).toEqual(appearanceVariables({ theme: 'plum', mode: 'dark' }))
    expect(appearanceVariables({ theme: 'plum', mode: 'light' }, true)).toEqual(
      appearanceVariables({ theme: 'plum', mode: 'light' }, false),
    )
  })
})
describe('report period boundaries', () => {
  it('handles previous month across the year boundary', () =>
    expect(dateRange('Last month', new Date(2026, 0, 5))).toEqual({
      start: '2025-12-01',
      end: '2025-12-31',
    }))
  it('handles leap years', () =>
    expect(dateRange('Last month', new Date(2024, 2, 4))).toEqual({
      start: '2024-02-01',
      end: '2024-02-29',
    }))
  it('limits current periods to today', () => {
    const today = new Date(2026, 9, 28)
    expect(dateRange('This month', today)).toEqual({
      start: '2026-10-01',
      end: '2026-10-28',
    })
    expect(dateRange('This quarter', today)).toEqual({
      start: '2026-10-01',
      end: '2026-10-28',
    })
    expect(dateRange('Year to date', today)).toEqual({
      start: '2026-01-01',
      end: '2026-10-28',
    })
  })
})

describe('theme before first paint', () => {
  const cases = [
    { saved: null, device: true, expected: 'light' },
    {
      saved: { theme: 'orchard', mode: 'light' },
      device: true,
      expected: 'light',
    },
    {
      saved: { theme: 'berry', mode: 'dark' },
      device: false,
      expected: 'dark',
    },
    { saved: { theme: 'ink', mode: 'system' }, device: true, expected: 'dark' },
    {
      saved: { theme: 'ink', mode: 'system' },
      device: false,
      expected: 'light',
    },
    {
      saved: { theme: 'unknown', mode: 'dark' },
      device: true,
      expected: 'light',
    },
    {
      saved: { theme: 'toString', mode: 'dark' },
      device: true,
      expected: 'light',
    },
    {
      saved: { theme: 'plum', mode: 'invalid' },
      device: true,
      expected: 'light',
    },
  ]
  for (const c of cases)
    it(`boots ${JSON.stringify(c.saved)} on device dark=${c.device} directly in ${c.expected}`, () => {
      const storage = { getItem: vi.fn(() => JSON.stringify(c.saved)) }
      const match = vi.fn(() => ({ matches: c.device }))
      new Function(
        'localStorage',
        'window',
        'matchMedia',
        'document',
        appearanceBootScript(),
      )(storage, { matchMedia: match }, match, document)
      expect(document.documentElement.dataset.mode).toBe(c.expected)
      expect(document.documentElement.style.colorScheme).toBe(c.expected)
      expect(document.documentElement.classList.contains('dark')).toBe(
        c.expected === 'dark',
      )
      if (c.saved?.mode !== 'system') expect(match).not.toHaveBeenCalled()
    })
  it('handles unavailable storage and caches explicit choices immediately', () => {
    const storage = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: vi.fn(),
    }
    vi.stubGlobal('localStorage', storage)
    try {
      new Function(appearanceBootScript())()
      expect(document.documentElement.dataset.mode).toBe('light')
      expect(readAppearanceCache().mode).toBe('light')
      cacheAppearance({ theme: 'orchard', mode: 'dark' })
      expect(storage.setItem).toHaveBeenCalledWith(
        appearanceCacheKey,
        JSON.stringify({ theme: 'orchard', mode: 'dark' }),
      )
    } finally {
      vi.unstubAllGlobals()
    }
  })
  it('retains every accent palette in both startup modes', () => {
    for (const theme of accentThemes)
      for (const mode of ['light', 'dark'] as const) {
        new Function('localStorage', appearanceBootScript())({
          getItem: () => JSON.stringify({ theme: theme.id, mode }),
        })
        const palette = appearanceVariables({ theme: theme.id, mode })
        for (const [key, value] of Object.entries(palette))
          expect(document.documentElement.style.getPropertyValue(key)).toBe(
            value,
          )
      }
  })
})
it('uses sampled logo purple before mount while preserving explicitly saved palettes', () => {
  new Function('localStorage', appearanceBootScript())({ getItem: () => null })
  expect(document.documentElement.style.getPropertyValue('--primary')).toBe(
    '#5c3a83',
  )
  expect(readAppearanceCache()).toBeDefined()
  new Function('localStorage', appearanceBootScript())({
    getItem: () => JSON.stringify({ theme: 'plum', mode: 'light' }),
  })
  expect(document.documentElement.style.getPropertyValue('--primary')).toBe(
    '#742b60',
  )
})
