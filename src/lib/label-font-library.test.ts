import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import fontkit from '@pdf-lib/fontkit'
import { PDFDocument } from 'pdf-lib'
import { bundledLabelFonts as labelFonts } from './label-font-catalog'
import { labelFontMetrics } from './label-font-metrics'
import { applyFontPairing, fontPairings } from './label-font-pairings'
import {
  newElement,
  blankLabel,
  checkLabel,
  resolveLabelData,
} from './label-studio'
import { demoData } from './demo'
describe('licensed print font library', () => {
  it('has a broad catalog with local licensed, measurable, embeddable fonts', async () => {
    expect(labelFonts.length).toBeGreaterThan(110)
    const pdf = await PDFDocument.create()
    pdf.registerFontkit(fontkit)
    for (const f of labelFonts) {
      expect(
        (await readFile(`public/label-fonts/${f.file}-LICENSE.txt`, 'utf8'))
          .length,
      ).toBeGreaterThan(100)
      for (const weight of f.weights) {
        const key = f.file + (weight === 700 ? '-bold' : '')
        expect(labelFontMetrics[key]).toBeDefined()
        const embedded = await pdf.embedFont(
          new Uint8Array(await readFile(`public/label-fonts/${key}.ttf`)),
          {
            subset: true,
          },
        )
        pdf
          .addPage([200, 50])
          .drawText('Banana Bread', { font: embedded, size: 12 })
      }
    }
    expect((await pdf.save()).length).toBeGreaterThan(1000)
  }, 30000)
  it('keeps locked fonts and routes required text to readable pairing fonts', () => {
    for (const p of fontPairings) {
      const title = { ...newElement('text'), binding: 'product.name' },
        body = { ...newElement('text'), binding: 'recipe.ingredients' },
        locked = { ...newElement('text'), locked: true, font: 'Caveat' }
      const result = applyFontPairing([title, body, locked], p)
      expect(result[0].font).toBe(p.heading)
      expect(result[1].font).toBe(p.compliance)
      expect(result[2]).toBe(locked)
      expect(labelFonts.find((f) => f.name === p.compliance)?.smallPrint).toBe(
        true,
      )
    }
  })
  it('warns about decorative required text', () => {
    const doc = blankLabel()
    doc.elements = [
      {
        ...newElement('text'),
        font: 'Pacifico',
        binding: 'recipe.ingredients',
      },
    ]
    const data = resolveLabelData(demoData(), { kind: 'product', id: '' })
    expect(
      checkLabel(doc, data, []).some((s) => s.includes('best for headings')),
    ).toBe(true)
  })
})
