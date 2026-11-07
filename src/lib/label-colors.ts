export type LabelColor = { hex: string; opacity: number }
export const validHex = (s: string) =>
  /^#[\da-f]{6}$/i.test(s) || s === 'transparent'
export function parseHex(s: string) {
  const text = s.trim().replace(/^#/, '')
  if (/^[\da-f]{3}$/i.test(text))
    return (
      '#' +
      text
        .split('')
        .map((c) => c + c)
        .join('')
        .toLowerCase()
    )
  return /^[\da-f]{6}$/i.test(text) ? '#' + text.toLowerCase() : null
}
export const clamp = (v: number, min = 0, max = 1) =>
  Math.max(min, Math.min(max, v))
export function validateLabelColor(v: any): LabelColor {
  if (
    !v ||
    !validHex(v.hex) ||
    typeof v.opacity !== 'number' ||
    !Number.isFinite(v.opacity) ||
    v.opacity < 0 ||
    v.opacity > 1
  )
    throw new Error('Choose a valid color and opacity.')
  return { hex: v.hex, opacity: v.opacity }
}
export function rgbHex(r: number, g: number, b: number) {
  return (
    '#' +
    [r, g, b]
      .map((n) =>
        Math.round(clamp(n, 0, 255))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  )
}
export function hexRgb(hex: string) {
  return [1, 3, 5].map((n) =>
    parseInt((hex === 'transparent' ? '#ffffff' : hex).slice(n, n + 2), 16),
  ) as [number, number, number]
}
export function hexHsv(hex: string) {
  const [r, g, b] = hexRgb(hex).map((n) => n / 255),
    max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    delta = max - min
  const h =
    delta === 0
      ? 0
      : max === r
        ? ((g - b) / delta + 6) % 6
        : max === g
          ? (b - r) / delta + 2
          : (r - g) / delta + 4
  return { h: h * 60, s: max === 0 ? 0 : delta / max, v: max }
}
export function hsvHex(h: number, s: number, v: number) {
  const c = v * s,
    x = c * (1 - Math.abs(((h / 60) % 2) - 1)),
    m = v - c
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x]
  return rgbHex((r + m) * 255, (g + m) * 255, (b + m) * 255)
}
export function hexHsl(hex: string) {
  const { h, s, v } = hexHsv(hex),
    l = v * (1 - s / 2)
  return [
    h,
    l === 0 || l === 1 ? 0 : ((v - l) / Math.min(l, 1 - l)) * 100,
    l * 100,
  ]
}
export function hslHex(h: number, s: number, l: number) {
  s /= 100
  l /= 100
  const v = l + s * Math.min(l, 1 - l)
  return hsvHex(h, v === 0 ? 0 : 2 * (1 - l / v), v)
}
export function recentColorList(colors: LabelColor[], color: LabelColor) {
  return [
    color,
    ...colors.filter((c) => c.hex !== color.hex || c.opacity !== color.opacity),
  ].slice(0, 16)
}

export function effectiveFill(e: {
  type: string
  fill: string
  color: string
  fillOpacity?: number
}) {
  return e.type === 'shape' &&
    e.fill === 'transparent' &&
    e.fillOpacity === undefined
    ? e.color
    : e.fill
}
