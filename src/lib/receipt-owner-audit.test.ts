// @vitest-environment node
// Explicit read-only source audit. Never writes a receipt, stock, or financial record.
import { it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import {
  extractReceipt,
  extractionFailure,
} from '../../netlify/lib/receipt-extraction'
import { readReceiptPdf } from '../../netlify/lib/receipt-pdf'
it.skipIf(process.env.RUN_RECEIPT_OWNER_AUDIT !== '1')(
  'reads the owner’s original invoice without altering its posted receipt',
  async () => {
    const bytes = await readFile('/tmp/cottage-owner-receipt.pdf')
    const pages = await readReceiptPdf(bytes)
    expect(pages).toHaveLength(1)
    expect(pages[0].text).toContain('001993')
    let result: Awaited<ReturnType<typeof extractReceipt>>
    try {
      result = await extractReceipt(bytes, 'application/pdf')
    } catch (error) {
      const failure = extractionFailure(error)
      // eslint-disable-next-line preserve-caught-error -- Raw provider causes can contain credentials; retain only safe diagnostics.
      throw new Error(
        `Owner source reading: ${failure.code}. ${failure.message}`,
      )
    }
    expect(result.vendor).toMatch(/CCCC Sertoma/i)
    expect(result.date).toBe('2026-07-26')
    expect(result.receiptNumber).toContain('001993')
    expect(result.subtotal).toBe(25)
    expect(result.total).toBe(25)
    expect(result.tax).toBeNull()
    expect(result.currency).toBeNull()
    expect(result.lines).toHaveLength(1)
    expect(result.lines[0].description).toMatch(/Booth Space/i)
    expect(result.lines[0].printedQuantity).toBe(1)
    expect(result.lines[0].unitPrice).toBe(25)
    expect(result.lines[0].amount).toBe(25)
    expect(result.lines[0].quantity).toBeNull()
    expect(result.pagesReviewed).toEqual([1])
    console.log(
      JSON.stringify({
        source: 'Owner invoice 001993',
        pages: result.pageCount,
        method: result.processingMethod,
        fields: [
          'vendor',
          'date',
          'receiptNumber',
          'description',
          'printedQuantity',
          'unitPrice',
          'amount',
          'subtotal',
          'total',
        ],
        unknown: ['tax', 'currency'],
        usage: result.usage,
      }),
    )
  },
  60000,
)
