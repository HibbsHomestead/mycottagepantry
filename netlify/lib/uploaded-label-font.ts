import fontkit from '@pdf-lib/fontkit'
import { PDFDocument } from 'pdf-lib'
export const fontLicenseConsent =
  'I confirm I have the right to use and embed this font in printed and exported labels.'
export async function validateUploadedFont(
  bytes: Uint8Array,
  filename: string,
  consent: boolean,
) {
  if (!consent)
    throw new Error('Confirm your right to use and embed this font.')
  if (!bytes.length || bytes.length > 4 * 1024 * 1024)
    throw new Error('Choose a font file up to 4 MB.')
  const ext = filename.split('.').at(-1)?.toLowerCase()
  const signature = Array.from(bytes.slice(0, 4))
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('')
  const formats: Record<string, string> = {
    '00010000': 'ttf',
    '4f54544f': 'otf',
    '774f4646': 'woff',
    '774f4632': 'woff2',
  }
  if (
    !ext ||
    !['ttf', 'otf', 'woff', 'woff2'].includes(ext) ||
    formats[signature] !== ext
  )
    throw new Error('Upload a valid TTF, OTF, WOFF, or WOFF2 font file.')
  let face: ReturnType<typeof fontkit.create>
  try {
    face = fontkit.create(bytes)
    if (!face.unitsPerEm || !face.characterSet.length)
      throw new Error('Invalid font')
  } catch {
    throw new Error(
      'This font could not be read. Choose a different font file.',
    )
  }
  const embedding = (face as any)['OS/2']?.fsType
  if (
    embedding?.noEmbedding ||
    embedding?.noSubsetting ||
    embedding?.bitmapOnly ||
    (typeof embedding === 'number' && !!(embedding & 0x302))
  )
    throw new Error(
      'This font restricts PDF embedding. Choose a font licensed for embedding and subsetting.',
    )
  const tables =
    (face as unknown as { directory?: { tables: Record<string, unknown> } })
      .directory?.tables || {}
  if (['COLR', 'CBDT', 'sbix', 'SVG '].some((t) => t in tables))
    throw new Error(
      'Color and bitmap fonts cannot be preserved by this PDF exporter. Upload an outline font instead.',
    )
  try {
    const pdf = await PDFDocument.create()
    pdf.registerFontkit(fontkit)
    const embedded = await pdf.embedFont(bytes, { subset: true })
    pdf
      .addPage([72, 72])
      .drawText(
        String.fromCodePoint(face.characterSet.find((c) => c > 32) || 32),
        { font: embedded, size: 10 },
      )
    await pdf.save()
  } catch {
    throw new Error(
      'This font cannot be embedded reliably in PDF exports. Choose a different font file.',
    )
  }
  return {
    family: String(face.familyName || 'Uploaded font').slice(0, 80),
    style: String(face.subfamilyName || 'Regular').slice(0, 60),
    format: ext,
    browserFormat:
      ext === 'ttf' ? 'truetype' : ext === 'otf' ? 'opentype' : ext,
  }
}
