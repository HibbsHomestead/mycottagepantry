import { getStore } from '@netlify/blobs'
import fontkit from '@pdf-lib/fontkit'
import { resolveFontFace } from '../../src/lib/label-font-catalog'
// Only allow catalog families and Google's fixed CSS/font hosts, never client URLs.
export async function fetchGoogleFontFace(
  key: string,
  fetcher: typeof fetch = fetch,
): Promise<Uint8Array> {
  const font = resolveFontFace(key)
  if (!font || font.source !== 'google')
    throw new Error('Choose a supported Google font.')
  const variant =
    key === font.file + '-bold' ? '700' : font.googleStyle || '400'
  const cssUrl =
    'https://fonts.googleapis.com/css?family=' +
    encodeURIComponent(font.name + ':' + variant)
  const response = await fetcher(cssUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(15000),
    redirect: 'error',
  })
  if (!response.ok)
    throw new Error(
      `Google Fonts could not load ${font.name}. Choose a bundled font or try again.`,
    )
  const css = await response.text()
  const match = css.match(
    /src:\s*url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)\s*format\(['"](?:truetype|opentype)['"]\)/,
  )
  if (!match)
    throw new Error(
      `${font.name} does not provide a supported embeddable print font. Choose another font.`,
    )
  const url = new URL(match[1])
  if (url.hostname !== 'fonts.gstatic.com' || url.protocol !== 'https:')
    throw new Error('Unsupported font source.')
  const face = await fetcher(url, {
    signal: AbortSignal.timeout(20000),
    redirect: 'error',
  })
  if (!face.ok || Number(face.headers.get('content-length')) > 20000000)
    throw new Error(
      `The print font for ${font.name} is unavailable or too large.`,
    )
  const bytes = new Uint8Array(await face.arrayBuffer())
  if (bytes.length > 20000000) throw new Error('The print font is too large.')
  const parsed = fontkit.create(bytes)
  if (!parsed.unitsPerEm || !parsed.characterSet.length)
    throw new Error('The print font could not be validated.')
  // Restricted embedding flags must never be ignored, even for a catalog font.
  const embedding = (parsed as any)['OS/2']?.fsType
  if (
    (typeof embedding === 'number' && !!(embedding & 0x302)) ||
    embedding?.noEmbedding ||
    embedding?.noSubsetting ||
    embedding?.bitmapOnly
  )
    throw new Error('This font restricts embedding. Choose another font.')
  const tables =
    (parsed as unknown as { directory?: { tables: Record<string, unknown> } })
      .directory?.tables || {}
  if (['COLR', 'CBDT', 'sbix', 'SVG '].some((table) => table in tables))
    throw new Error(
      `${font.name} uses color or bitmap glyphs that this PDF exporter cannot preserve. Choose another font.`,
    )
  return bytes
}
export async function loadGoogleFontFace(key: string) {
  if (!resolveFontFace(key) || !key.startsWith('google-'))
    throw new Error('Unsupported Google font.')
  const store = getStore('google-label-fonts')
  const cached = await store.get('v1/' + key, { type: 'arrayBuffer' })
  if (cached) return new Uint8Array(cached)
  const bytes = await fetchGoogleFontFace(key)
  await store.set('v1/' + key, bytes.buffer as ArrayBuffer)
  return bytes
}
