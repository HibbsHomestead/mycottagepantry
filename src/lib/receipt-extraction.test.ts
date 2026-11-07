// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { PDFDocument } from 'pdf-lib'
const provider = vi.hoisted(() => ({ generate: vi.fn() }))
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: provider.generate }
  },
}))
import {
  extractReceipt,
  receiptFile,
  extractionFailure,
} from '../../netlify/lib/receipt-extraction'
beforeEach(() => provider.generate.mockReset())
for (const type of ['png', 'jpeg', 'pdf'] as const)
  it(`uses original ${type} bytes for real provider requests, without fabricated missing values`, async () => {
    let bytes: Buffer
    if (type === 'pdf') {
      const doc = await PDFDocument.create()
      doc.addPage()
      doc.addPage()
      bytes = Buffer.from(await doc.save())
    } else {
      const image = sharp({
        create: { width: 200, height: 200, channels: 3, background: 'white' },
      })
      bytes = await image[type]().toBuffer()
    }
    const saved = await receiptFile(
      new File([new Uint8Array(bytes)], 'receipt.' + type),
    )
    provider.generate.mockResolvedValue({
      text: JSON.stringify({
        vendor: 'Printed vendor',
        total: 0,
        lines: [{ description: 'Printed item', amount: 0 }],
      }),
    })
    const result = await extractReceipt(saved.bytes, saved.originalMime)
    expect(
      provider.generate.mock.calls[0][0].contents[0].parts[0].inlineData.data,
    ).toBe(bytes.toString('base64'))
    expect(result.subtotal).toBeNull()
    expect(result.tax).toBeNull()
    expect(result.total).toBe(0)
    expect(result.lines[0].quantity).toBeNull()
  })
it('rejects unreadable and malformed provider data', async () => {
  const doc = await PDFDocument.create()
  doc.addPage()
  const bytes = Buffer.from(await doc.save())
  provider.generate.mockResolvedValue({ text: '{}' })
  await expect(extractReceipt(bytes, 'application/pdf')).rejects.toThrow(
    'couldn’t extract',
  )
  provider.generate.mockResolvedValue({ text: '{"total":"20"}' })
  await expect(extractReceipt(bytes, 'application/pdf')).rejects.toThrow(
    'invalid fields',
  )
})
it('keeps readable receipt fields for partial review when confidence and page-overlay metadata are malformed', async () => {
  const doc = await PDFDocument.create()
  doc.addPage()
  provider.generate.mockResolvedValue({
    text: JSON.stringify({
      vendor: 'Mill',
      date: '2026-11-02',
      total: 9,
      subtotal: 9,
      tax: 0,
      pagesReviewed: [1],
      confidence: 0.9,
      warnings: null,
      lines: [
        {
          description: 'Flour',
          quantity: 2,
          unit: 'bags',
          amount: 9,
          confidence: 'high',
          fieldConfidence: null,
          bbox: [5, 0, 1, 1],
          page: 1,
        },
      ],
    }),
  })
  const result = await extractReceipt(
    Buffer.from(await doc.save()),
    'application/pdf',
  )
  expect(result).toMatchObject({
    vendor: 'Mill',
    total: 9,
    partial: true,
    confidence: {},
  })
  expect(result.lines[0]).toMatchObject({
    description: 'Flour',
    amount: 9,
    printedQuantity: 2,
    printedUnit: 'bags',
    quantity: null,
    unit: '',
    confidence: null,
  })
  expect(result.lines[0].bbox).toBeUndefined()
  expect(result.warnings.join(' ')).toMatch(/confidence was unavailable/)
  expect(result.warnings.join(' ')).toMatch(
    /position on the original was unavailable/,
  )
})
it('accepts one document wrapped in a list and rejects multiple returned drafts instead of taking only the first', async () => {
  const doc = await PDFDocument.create()
  doc.addPage()
  const bytes = Buffer.from(await doc.save())
  const receipt = {
    vendor: 'Mill',
    total: 9,
    pagesReviewed: [1],
    lines: [{ description: 'Flour', amount: 9 }],
  }
  provider.generate.mockResolvedValue({ text: JSON.stringify([receipt]) })
  expect(await extractReceipt(bytes, 'application/pdf')).toMatchObject({
    vendor: 'Mill',
    total: 9,
    pageCount: 1,
  })
  provider.generate.mockResolvedValue({
    text: JSON.stringify([receipt, receipt]),
  })
  await expect(extractReceipt(bytes, 'application/pdf')).rejects.toMatchObject({
    code: 'ambiguous_document_results',
  })
})
it('distinguishes missing credentials from unavailable providers without exposing raw diagnostics', () => {
  expect(extractionFailure(new Error('API key must be set'))).toMatchObject({
    status: 'not_configured',
    message:
      'Receipt extraction is not configured. You can still enter details manually.',
  })
  expect(
    extractionFailure({ status: 503, message: 'private request' }),
  ).toMatchObject({ status: 'failed', code: 'provider_unavailable' })
  expect(
    extractionFailure(new Error('Could not load the default credentials')),
  ).toMatchObject({
    status: 'not_configured',
    code: 'provider_credentials_missing',
  })
  expect(
    JSON.stringify(
      extractionFailure({ status: 503, message: 'private request' }),
    ),
  ).not.toContain('private request')
})

beforeEach(() =>
  vi.stubGlobal('Netlify', {
    env: {
      get: (name: string) => (name === 'AI_ENABLED' ? 'true' : undefined),
    },
  }),
)

it('extracts every embedded-text page and flags uncovered pages without guessing received quantities', async () => {
  const { StandardFonts } = await import('pdf-lib')
  const doc = await PDFDocument.create(),
    font = await doc.embedFont(StandardFonts.Helvetica)
  for (const text of [
    'Mill invoice 0821: Flour 2 bags USD 5.00',
    'Packaging sleeves 3 packs USD 4.00 printed supplies line',
  ])
    doc.addPage().drawText(text, { font, x: 30, y: 700 })
  const bytes = Buffer.from(await doc.save())
  provider.generate.mockResolvedValue({
    text: JSON.stringify({
      vendor: 'Mill',
      date: '2026-11-02',
      currency: 'USD',
      subtotal: 9,
      tax: 0,
      total: 9,
      pagesReviewed: [1],
      lines: [
        { description: 'Flour', quantity: 2, unit: 'bags', amount: 5, page: 1 },
      ],
    }),
  })
  const result = await extractReceipt(bytes, 'application/pdf')
  expect(
    provider.generate.mock.calls[0][0].contents[0].parts[0].text,
  ).toContain('Packaging sleeves')
  expect(result.processingMethod).toBe('embedded_text')
  expect(result.unverifiedPages).toEqual([2])
  expect(result.partial).toBe(true)
  expect(result.lines[0]).toMatchObject({
    printedQuantity: 2,
    printedUnit: 'bags',
    quantity: null,
    unit: '',
  })
})
it('sends mixed and scanned PDFs intact, rejects corruption and page limits before provider calls', async () => {
  const doc = await PDFDocument.create(),
    image = await doc.embedPng(
      await sharp({
        create: { width: 10, height: 10, channels: 3, background: 'white' },
      })
        .png()
        .toBuffer(),
    )
  doc.addPage().drawImage(image, { x: 0, y: 0, width: 100, height: 100 })
  doc.addPage()
  const bytes = Buffer.from(await doc.save())
  provider.generate.mockResolvedValue({
    text: JSON.stringify({
      vendor: 'Scan',
      pagesReviewed: [1],
      unreadablePages: [2],
      lines: [{ description: 'Printed item', amount: 2, page: 1 }],
    }),
  })
  const result = await extractReceipt(bytes, 'application/pdf')
  expect(
    provider.generate.mock.calls[0][0].contents[0].parts[0].inlineData.data,
  ).toBe(bytes.toString('base64'))
  expect(result.partial).toBe(true)
  expect(result.pageCount).toBe(2)
  const calls = provider.generate.mock.calls.length
  await expect(
    extractReceipt(Buffer.from('%PDF-broken'), 'application/pdf'),
  ).rejects.toThrow('cannot be read')
  for (let i = 2; i < 21; i++) doc.addPage()
  await expect(
    extractReceipt(Buffer.from(await doc.save()), 'application/pdf'),
  ).rejects.toThrow('supports up to 20')
  expect(provider.generate).toHaveBeenCalledTimes(calls)
})
it('rejects truncated provider output and invalid page references instead of reporting success', async () => {
  const doc = await PDFDocument.create()
  doc.addPage()
  const bytes = Buffer.from(await doc.save())
  provider.generate.mockResolvedValue({
    text: JSON.stringify({ vendor: 'Mill', pagesReviewed: [2] }),
  })
  await expect(extractReceipt(bytes, 'application/pdf')).rejects.toThrow(
    'invalid page',
  )
  provider.generate.mockResolvedValue({
    text: JSON.stringify({ vendor: 'Mill' }),
    candidates: [{ finishReason: 'MAX_TOKENS' }],
  })
  await expect(extractReceipt(bytes, 'application/pdf')).rejects.toThrow(
    'stopped before',
  )
})
