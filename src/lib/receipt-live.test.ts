// @vitest-environment node
// Opt-in paid provider acceptance with synthetic documents; no workspace writes.
import { expect, it } from 'vitest'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import sharp from 'sharp'
import {
  extractReceipt,
  extractionFailure,
} from '../../netlify/lib/receipt-extraction'
it.skipIf(process.env.RUN_RECEIPT_LIVE !== '1')(
  'reads an image-only scanned receipt PDF without embedded text',
  async () => {
    const doc = await PDFDocument.create()
    const svg =
      '<svg width="1200" height="900" xmlns="http://www.w3.org/2000/svg"><rect width="1200" height="900" fill="white"/><g fill="#222" font-family="sans-serif" font-size="34"><text x="40" y="80">Juniper Mill Supply</text><text x="40" y="150">Receipt 0930 | Date 2026-11-02 | Currency USD</text><text x="40" y="230">Flour | Quantity 2 bags | Unit price USD 3.00</text><text x="40" y="310">Line discount USD 1.00 | Line total USD 5.00</text><text x="40" y="390">Subtotal after discounts USD 5.00</text><text x="40" y="470">Sales tax USD 0.50</text><text x="40" y="550">Grand total USD 5.50</text></g></svg>'
    const image = await doc.embedPng(
      await sharp(Buffer.from(svg)).png().toBuffer(),
    )
    doc
      .addPage([612, 792])
      .drawImage(image, { x: 0, y: 230, width: 612, height: 459 })
    let result: Awaited<ReturnType<typeof extractReceipt>>
    try {
      result = await extractReceipt(
        Buffer.from(await doc.save()),
        'application/pdf',
      )
    } catch (error) {
      const failure = extractionFailure(error)
      // eslint-disable-next-line preserve-caught-error -- Provider errors can contain credentials; retain only sanitized diagnostics.
      throw new Error(`${failure.code}: ${failure.message}`)
    }
    expect(result).toMatchObject({
      processingMethod: 'document_ocr',
      pageCount: 1,
      vendor: 'Juniper Mill Supply',
      date: '2026-11-02',
      currency: 'USD',
      subtotal: 5,
      tax: 0.5,
      total: 5.5,
      pagesReviewed: [1],
    })
    expect(result.lines).toHaveLength(1)
    expect(result.lines[0]).toMatchObject({
      printedQuantity: 2,
      unitPrice: 3,
      amount: 5,
      discounts: 1,
      quantity: null,
      unit: '',
    })
  },
  60000,
)
it.skipIf(process.env.RUN_RECEIPT_LIVE !== '1')(
  'reads text, scanned and partially readable pages, discounts and multiple quantities through the real provider',
  async () => {
    const doc = await PDFDocument.create(),
      font = await doc.embedFont(StandardFonts.Helvetica)
    const p = doc.addPage([612, 792])
    for (const [i, text] of [
      'Juniper Mill Supply',
      'Receipt #0821 | Date 2026-11-02 | Currency USD',
      'Flour | Quantity 2 bags | Unit price USD 3.00',
      'Flour line discount USD 1.00 | Line total USD 5.00',
      'Continued on page 2. Page 3 is damaged.',
      'Subtotal after discounts USD 9.00',
      'Sales tax USD 0.90 | Shipping USD 1.00',
      'Grand total USD 10.90',
    ].entries())
      p.drawText(text, { font, size: 14, x: 32, y: 740 - i * 35 })
    const svg =
      '<svg width="1200" height="800" xmlns="http://www.w3.org/2000/svg"><rect width="1200" height="800" fill="white"/><g fill="#222" font-family="sans-serif" font-size="32"><text x="40" y="80">Juniper Mill Supply receipt 0821 - page 2 of 3</text><text x="40" y="160">Packaging sleeves | Quantity 2 packs</text><text x="40" y="220">Printed unit price USD 2.00</text><text x="40" y="280">Line total USD 4.00</text></g></svg>'
    const img = await doc.embedPng(
      await sharp(Buffer.from(svg)).png().toBuffer(),
    )
    doc
      .addPage([612, 792])
      .drawImage(img, { x: 0, y: 250, width: 612, height: 408 })
    const unreadable = await doc.embedPng(
      await sharp({
        create: { width: 400, height: 600, channels: 3, background: '#a6a6a6' },
      })
        .png()
        .toBuffer(),
    )
    doc
      .addPage([612, 792])
      .drawImage(unreadable, { x: 0, y: 0, width: 612, height: 792 })
    let result: Awaited<ReturnType<typeof extractReceipt>>
    try {
      result = await extractReceipt(
        Buffer.from(await doc.save()),
        'application/pdf',
      )
    } catch (error) {
      const failure = extractionFailure(error)
      // eslint-disable-next-line preserve-caught-error -- Raw provider causes can contain credentials; retain only safe diagnostics.
      throw new Error(`${failure.code}: ${failure.message}`)
    }
    expect(result.pageCount).toBe(3)
    expect(result.processingMethod).toBe('document_ocr')
    expect(result.vendor).toMatch(/Juniper Mill/i)
    expect(result.currency).toBe('USD')
    expect(result.subtotal).toBe(9)
    expect(result.tax).toBe(0.9)
    expect(result.otherCharges).toBe(1)
    expect(result.total).toBe(10.9)
    expect(result.lines).toHaveLength(2)
    expect(
      result.lines.find((l) => /Flour/i.test(l.description || '')),
    ).toMatchObject({
      printedQuantity: 2,
      printedUnit: 'bags',
      unitPrice: 3,
      amount: 5,
      discounts: 1,
      quantity: null,
    })
    expect(
      result.lines.find((l) => /sleeves/i.test(l.description || '')),
    ).toMatchObject({
      printedQuantity: 2,
      unitPrice: 2,
      amount: 4,
      page: 2,
      quantity: null,
    })
    expect(result.partial).toBe(true)
    expect(result.unverifiedPages).toContain(3)
  },
  60000,
)
