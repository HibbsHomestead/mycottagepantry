import { describe, it, expect } from 'vitest'
import { printPageHtml } from './label-browser-print'
import { defaultSheet } from './label-print-layout'
import { blankLabel } from './label-studio'
import { validatePrinterProfile, qzPrintOptions } from './label-printers'
const document = { ...blankLabel(), width: 144, height: 72 }
const profile = validatePrinterProfile({
  name: 'Test driver',
  method: 'qz',
  width: 2,
  height: 1,
  unit: 'in',
  orientation: 'landscape',
  offsetX: 0.02,
  offsetY: 0,
  options: { colorType: 'color' },
})
describe('physical print documents', () => {
  it('renders exactly the requested roll labels at their physical size', () => {
    const html = printPageHtml(
      '<svg />',
      document,
      3,
      { ...defaultSheet, mode: 'roll' },
      profile,
    )
    expect(html.match(/class="label"/g)).toHaveLength(3)
    expect(html.match(/class="page"/g)).toHaveLength(3)
    expect(html).toContain('@page{size:144pt 72pt;margin:0}')
    expect(html).toContain('translate(1.44pt,0pt)')
    expect(html).not.toContain('<button')
    expect(qzPrintOptions(profile).copies).toBe(1)
    expect(qzPrintOptions(profile).scaleContent).toBe(false)
  })
  it('does not fill unused sheet positions with extra copies', () => {
    const html = printPageHtml('<svg />', document, 7, {
      ...defaultSheet,
      mode: 'sheet',
    })
    expect(html.match(/class="label"/g)).toHaveLength(7)
    expect(html.match(/class="page"/g)).toHaveLength(2)
  })
  it('rejects mismatched paper sizes and invalid quantities', () => {
    expect(() =>
      printPageHtml('', document, 1, defaultSheet, { ...profile, width: 3 }),
    ).toThrow(/sizes differ/)
    for (const n of [0, 1.5, 201])
      expect(() => printPageHtml('', document, n, defaultSheet)).toThrow()
  })
})
