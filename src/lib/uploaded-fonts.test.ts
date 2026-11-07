import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { validateUploadedFont } from '../../netlify/lib/uploaded-label-font'
import {
  bundledLabelFonts,
  fontFileUrl,
  type LabelFont,
} from './label-font-catalog'
import {
  blankLabel,
  newElement,
  validateLabelDocument,
  resolveLabelData,
} from './label-studio'
import { demoData } from './demo'
import { exportLabelPdf } from './label-export'
const custom: LabelFont = {
  ...bundledLabelFonts[0],
  name: 'Private bakery font',
  file: 'custom-own-font',
  source: 'custom',
  weights: [400],
}
describe('oven font uploads', () => {
  for (const [path, name] of [
    ['public/label-fonts/dm-sans.ttf', 'font.ttf'],
    ['src/lib/test-fixtures/source-sans-3.otf', 'font.otf'],
    ['src/lib/test-fixtures/dm-sans.woff', 'font.woff'],
    ['src/lib/test-fixtures/dm-sans.woff2', 'font.woff2'],
  ])
    it(`validates and embeds ${name}`, async () => {
      const bytes = new Uint8Array(await readFile(path))
      const result = await validateUploadedFont(bytes, name, true)
      expect(result.family.length).toBeGreaterThan(0)
      expect(result.format).toBe(name.split('.')[1])
    }, 15000)
  it('requires license consent and rejects oversized, invalid, and disguised files', async () => {
    const bytes = new Uint8Array(
      await readFile('public/label-fonts/dm-sans.ttf'),
    )
    await expect(
      validateUploadedFont(bytes, 'font.ttf', false),
    ).rejects.toThrow('right to use')
    await expect(validateUploadedFont(bytes, 'font.otf', true)).rejects.toThrow(
      'valid TTF',
    )
    await expect(
      validateUploadedFont(
        new Uint8Array(4 * 1024 * 1024 + 1),
        'font.ttf',
        true,
      ),
    ).rejects.toThrow('4 MB')
    await expect(
      validateUploadedFont(
        new TextEncoder().encode('not a font'),
        'font.ttf',
        true,
      ),
    ).rejects.toThrow('valid TTF')
  })
  it('rejects embedding restrictions declared inside the font', async () => {
    const bytes = new Uint8Array(
      await readFile('public/label-fonts/dm-sans.ttf'),
    )
    const view = new DataView(bytes.buffer)
    for (let i = 0; i < view.getUint16(4); i++) {
      const offset = 12 + i * 16
      if (String.fromCharCode(...bytes.slice(offset, offset + 4)) === 'OS/2') {
        view.setUint16(view.getUint32(offset + 8) + 8, 2)
        break
      }
    }
    await expect(validateUploadedFont(bytes, 'font.ttf', true)).rejects.toThrow(
      'restricts PDF embedding',
    )
  })
  it('accepts uploaded references only from the provided oven and embeds that exact font', async () => {
    const doc = blankLabel()
    doc.elements = [
      { ...newElement('text'), text: 'Banana Bread', font: custom.name },
    ]
    expect(() => validateLabelDocument(doc)).toThrow('Unsupported')
    expect(() => validateLabelDocument(doc, [custom])).not.toThrow()
    expect(fontFileUrl(custom.file)).toBe('/api/workspace?font=own-font')
    const data = resolveLabelData(demoData(), { kind: 'product', id: '' })
    const bytes = await exportLabelPdf(doc, data, [], 1, undefined, {
      fonts: [custom],
      font: async (key) => {
        expect(key).toBe(custom.file)
        return new Uint8Array(
          await readFile('src/lib/test-fixtures/dm-sans.woff2'),
        )
      },
      image: async () => {
        throw new Error('Not used')
      },
    })
    expect(bytes.length).toBeGreaterThan(1000)
  })
})
