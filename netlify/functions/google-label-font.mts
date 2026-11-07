import fontkit from '@pdf-lib/fontkit'
import { loadGoogleFontFace } from '../lib/google-label-font'
export default async (request: Request) => {
  if (request.method !== 'GET')
    return new Response('Method not allowed', {
      status: 405,
      headers: { Allow: 'GET' },
    })
  const url = new URL(request.url),
    key = url.searchParams.get('font') || ''
  try {
    const bytes = await loadGoogleFontFace(key)
    const headers = {
      'Cache-Control': 'public, max-age=604800',
      'X-Content-Type-Options': 'nosniff',
    }
    if (url.searchParams.get('metrics') === '1') {
      const face = fontkit.create(bytes)
      const widths = Object.fromEntries(
        face.characterSet.map((code) => [
          code,
          face.glyphForCodePoint(code).advanceWidth / face.unitsPerEm,
        ]),
      )
      return Response.json(widths, { headers })
    }
    return new Response(bytes as BodyInit, {
      headers: { ...headers, 'Content-Type': 'font/ttf' },
    })
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Google Fonts is unavailable. Try a bundled font.',
      },
      { status: 422, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
