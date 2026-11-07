import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs'
export const receiptLimits = {
  bytes: 4 * 1024 * 1024,
  pages: 20,
  text: 120000,
  attemptsPerDay: 10,
  attemptsPerReceiptPerDay: 3,
} as const
export type ReceiptPage = {
  page: number
  text: string
  hasText: boolean
  hasImages: boolean
}
/** Read every page. The original stays in private Blobs; PDF text is transient. */
export async function readReceiptPdf(bytes: Buffer): Promise<ReceiptPage[]> {
  const task = getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: true,
    stopAtErrors: true,
  })
  try {
    const doc = await task.promise
    if (doc.numPages > receiptLimits.pages)
      throw new Error(
        `This PDF has ${doc.numPages} pages. Receipt reading supports up to ${receiptLimits.pages}; split it into separate documents for manual review.`,
      )
    const pages: ReceiptPage[] = []
    let size = 0
    for (let page = 1; page <= doc.numPages; page++) {
      const p = await doc.getPage(page),
        content = await p.getTextContent(),
        operators = await p.getOperatorList()
      const lines: string[] = []
      let y: number | undefined
      for (const item of content.items)
        if ('str' in item) {
          if (y !== undefined && Math.abs(item.transform[5] - y) > 3)
            lines.push('\n')
          lines.push(item.str, item.hasEOL ? '\n' : ' ')
          y = item.transform[5]
        }
      const text = lines.join('').trim()
      size += text.length
      if (size > receiptLimits.text)
        throw new Error(
          'The PDF contains too much text for one reading. Use manual entry or split the document.',
        )
      // PDF.js image paint operators: image mask, image object, inline image, and repeats/groups.
      const hasImages = operators.fnArray.some((op: number) =>
        [
          OPS.paintImageMaskXObject,
          OPS.paintImageXObject,
          OPS.paintInlineImageXObject,
          OPS.paintImageMaskXObjectGroup,
          OPS.paintImageXObjectRepeat,
          OPS.paintImageMaskXObjectRepeat,
        ].includes(op),
      )
      pages.push({
        page,
        text,
        hasText: text.replace(/\s/g, '').length >= 30,
        hasImages,
      })
      p.cleanup()
    }
    return pages
  } finally {
    await task.destroy()
  }
}
