// Sampled from original PNG jar-label and chart-bar interiors (see docs/brand-color.md).
export const brandPurple = '#5c3a83'
export function mixColor(hex: string, target: string, fraction: number) {
  const channels = [1, 3, 5].map((i) =>
    Math.round(
      parseInt(hex.slice(i, i + 2), 16) * (1 - fraction) +
        parseInt(target.slice(i, i + 2), 16) * fraction,
    ),
  )
  return '#' + channels.map((v) => v.toString(16).padStart(2, '0')).join('')
}
