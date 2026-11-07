import { describe, it, expect, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { PDFDocument } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import {
  labelFonts,
  bundledLabelFonts,
  googleFontKey,
  resolveFontFace,
  fontFileUrl,
} from './label-font-catalog'
import { googleFontCatalog } from './google-font-catalog'
import { fetchGoogleFontFace } from '../../netlify/lib/google-label-font'
import { blankLabel, newElement, validateLabelDocument } from './label-studio'
describe('full Google Fonts connection', () => {
  it('includes every catalog family and keeps the bundled families available offline', () => {
    expect(googleFontCatalog.length).toBeGreaterThan(1900)
    for (const [name] of googleFontCatalog)
      expect(labelFonts.some((f) => f.name === name)).toBe(true)
    expect(new Set(labelFonts.map((f) => f.name)).size).toBe(labelFonts.length)
    expect(new Set(labelFonts.map((f) => f.file)).size).toBe(labelFonts.length)
    expect(bundledLabelFonts.length).toBe(118)
    expect(fontFileUrl('dm-sans')).toBe('/label-fonts/dm-sans.ttf')
    expect(fontFileUrl(googleFontKey('Abel'))).toContain(
      '/.netlify/functions/google-label-font?font=',
    )
    const doc = blankLabel()
    doc.elements = [{ ...newElement('text'), font: 'Abel' }]
    expect(() => validateLabelDocument(doc)).not.toThrow()
  })
  it('requests only allowlisted Google CSS and validated embeddable font data', async () => {
    const bytes = new Uint8Array(
      await readFile('public/label-fonts/dm-sans.ttf'),
    )
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          "@font-face{src: url(https://fonts.gstatic.com/s/abel/v1/face.ttf) format('truetype');}",
        ),
      )
      .mockResolvedValueOnce(new Response(bytes))
    const face = await fetchGoogleFontFace(googleFontKey('Abel'), fetcher)
    expect(face).toEqual(bytes)
    expect(fetcher.mock.calls[0][0]).toBe(
      'https://fonts.googleapis.com/css?family=Abel%3A400',
    )
    const pdf = await PDFDocument.create()
    pdf.registerFontkit(fontkit)
    const font = await pdf.embedFont(face, { subset: true })
    pdf.addPage().drawText('Banana Bread', { font })
    expect((await pdf.save()).length).toBeGreaterThan(100)
  })
  it('rejects arbitrary families, hostile sources, and unavailable print fonts', async () => {
    const fetcher = vi.fn()
    await expect(
      fetchGoogleFontFace('https://example.com/font.ttf', fetcher),
    ).rejects.toThrow('supported')
    expect(fetcher).not.toHaveBeenCalled()
    expect(resolveFontFace('google-invented-font')).toBeUndefined()
    fetcher.mockResolvedValueOnce(
      new Response(
        "src: url(https://example.com/font.ttf) format('truetype');",
      ),
    )
    await expect(
      fetchGoogleFontFace(googleFontKey('Abel'), fetcher),
    ).rejects.toThrow('supported embeddable')
    fetcher.mockResolvedValueOnce(new Response('Unavailable', { status: 503 }))
    await expect(
      fetchGoogleFontFace(googleFontKey('Abel'), fetcher),
    ).rejects.toThrow('Choose a bundled font')
  })
  it.runIf(process.env.COTTAGE_GOOGLE_FONT_LIVE === '1')(
    'embeds a live Google font as vector text',
    async () => {
      const bytes = await fetchGoogleFontFace(googleFontKey('Abel'))
      const pdf = await PDFDocument.create()
      pdf.registerFontkit(fontkit)
      const face = await pdf.embedFont(bytes, { subset: true })
      pdf
        .addPage([216, 144])
        .drawText('Cottage Pantry · Banana Bread', { font: face, size: 12 })
      expect((await pdf.save()).length).toBeGreaterThan(1000)
    },
    30000,
  )
})
