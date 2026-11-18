import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { imageSize } from 'image-size'

export const COPY_BYTES = 3_000_000
export const COPY_EDGE = 2048
const unavailable =
  'Preview unavailable. Dropbox may not supply a usable bounded preview for this file.'
export type PreviewDiagnostics = {
  stage: string
  httpStatus?: number
  retrievedBytes?: number
  width?: number
  height?: number
  preparedBytes?: number
  preparationMs: number
}
export class DropboxPreviewError extends Error {
  constructor(
    message: string,
    public diagnostics: PreviewDiagnostics,
  ) {
    super(message)
  }
}
class PreviewLimitError extends Error {
  constructor() {
    super(
      'Artwork exceeds supported processing limits: retrieved preview up to 4 MB, decoded preview up to 2048 × 2048 pixels, saved PNG up to 3 MB.',
    )
  }
}
export function dropboxSelection(input: unknown) {
  const v = input as Record<string, unknown> | null
  if (
    !v ||
    typeof v.id !== 'string' ||
    !/^id:[\w-]{1,200}$/.test(v.id) ||
    typeof v.name !== 'string' ||
    v.name.length > 255 ||
    !/\.(png|jpe?g|webp)$/i.test(v.name) ||
    !Number.isSafeInteger(v.bytes) ||
    Number(v.bytes) <= 0 ||
    v.isDir
  )
    throw new Error('Choose a PNG, JPG, or WebP artwork file.')
  return { id: v.id, name: v.name, bytes: Number(v.bytes) }
}
export function dropboxThumbnailUrl(input: string, resize = false) {
  if (typeof input !== 'string' || input.length > 8192)
    throw new Error(unavailable)
  const u = new URL(input)
  if (
    u.protocol !== 'https:' ||
    u.username ||
    u.password ||
    u.port ||
    !(
      [
        'www.dropbox.com',
        'previews.dropbox.com',
        'photos.dropbox.com',
        'dl.dropboxusercontent.com',
        'dl.dropbox.com',
      ].includes(u.hostname) || /^photos-[0-9]+\.dropbox\.com$/.test(u.hostname)
    ) ||
    !/^\/(temp_thumb|p\/thumb|thumb)(\/|$)/.test(u.pathname)
  )
    throw new Error(unavailable)
  if (resize) {
    u.searchParams.set('bounding_box', '2048')
    u.searchParams.set('mode', 'fit')
  }
  return u
}
export async function validateDropboxCopy(bytes: Uint8Array) {
  const s = imageSize(bytes)
  if (
    !bytes.length ||
    bytes.length > COPY_BYTES ||
    s.type !== 'png' ||
    !s.width ||
    !s.height ||
    s.width > COPY_EDGE ||
    s.height > COPY_EDGE
  )
    throw new Error(
      'The mockup copy must be a PNG up to 3 MB and 2048 × 2048 pixels.',
    )
  const image = sharp(bytes, { limitInputPixels: COPY_EDGE ** 2 }).timeout({
    seconds: 8,
  })
  const m = await image.metadata()
  if ((m.pages || 1) !== 1)
    throw new Error('Animated artwork is not supported.')
  await image.stats()
  return { width: s.width, height: s.height, hasAlpha: !!m.hasAlpha }
}
export async function prepareDropboxPreview(
  link: string,
  signal?: AbortSignal,
) {
  const started = performance.now()
  const diagnostics: PreviewDiagnostics = {
    stage: 'preview selection',
    preparationMs: 0,
  }
  try {
    if (!link)
      throw new Error(
        'Dropbox supplied no thumbnail preview for this selection.',
      )
    diagnostics.stage = 'URL validation'
    const abort = AbortSignal.any([
      AbortSignal.timeout(15_000),
      ...(signal ? [signal] : []),
    ])
    let url = dropboxThumbnailUrl(link, true)
    for (let redirects = 0; redirects <= 3; redirects++) {
      diagnostics.stage = 'preview retrieval'
      const response = await fetch(url, {
        redirect: 'manual',
        signal: abort,
        credentials: 'omit',
      })
      diagnostics.httpStatus = response.status
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel()
        diagnostics.stage = 'redirect validation'
        url = dropboxThumbnailUrl(
          new URL(response.headers.get('location') || '', url).href,
        )
        continue
      }
      diagnostics.stage = 'retrieved preview byte limit'
      if (Number(response.headers.get('content-length')) > 4_000_000) {
        await response.body?.cancel()
        throw new PreviewLimitError()
      }
      if (!response.ok || !response.body) {
        await response.body?.cancel()
        diagnostics.stage = 'preview retrieval'
        throw new Error(unavailable)
      }
      diagnostics.stage = 'preview retrieval'
      const reader = response.body.getReader(),
        chunks: Uint8Array[] = []
      let total = 0
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          total += value.length
          diagnostics.retrievedBytes = total
          if (total > 4_000_000) {
            diagnostics.stage = 'retrieved preview byte limit'
            throw new PreviewLimitError()
          }
          chunks.push(value)
        }
      } finally {
        await reader.cancel().catch(() => {})
      }
      diagnostics.retrievedBytes = total
      diagnostics.stage = 'response format'
      const bytes = Buffer.concat(chunks),
        size = imageSize(bytes)
      if (
        !['png', 'jpg', 'webp'].includes(size.type || '') ||
        !size.width ||
        !size.height
      )
        throw new Error(unavailable)
      diagnostics.width = size.width
      diagnostics.height = size.height
      diagnostics.stage = 'decoded preview pixel limit'
      if (size.width > COPY_EDGE || size.height > COPY_EDGE)
        throw new PreviewLimitError()
      diagnostics.stage = 'image decode'
      const image = sharp(bytes, { limitInputPixels: COPY_EDGE ** 2 }).timeout({
        seconds: 8,
      })
      if (((await image.metadata()).pages || 1) !== 1)
        throw new Error(unavailable)
      await image.stats()
      diagnostics.stage = 'PNG conversion'
      const copy = await image
        .rotate()
        .png({ compressionLevel: 9, adaptiveFiltering: true })
        .toBuffer()
      diagnostics.preparedBytes = copy.length
      diagnostics.stage = 'optimized output size'
      if (copy.length > COPY_BYTES) throw new PreviewLimitError()
      const dimensions = await validateDropboxCopy(copy)
      diagnostics.stage = 'ready for visual review'
      diagnostics.preparationMs = Math.round(performance.now() - started)
      return {
        diagnostics,
        ...dimensions,
        bytes: copy.length,
        format: 'image/png',
        data: copy.toString('base64'),
      }
    }
    diagnostics.stage = 'redirect limit'
    throw new Error(unavailable)
  } catch (error) {
    diagnostics.preparationMs = Math.round(performance.now() - started)
    // Only fixed stage labels and numeric measurements leave this boundary.
    throw new DropboxPreviewError(
      error instanceof PreviewLimitError
        ? error.message
        : diagnostics.stage === 'preview selection'
          ? 'Dropbox supplied no thumbnail preview for this selection. No original download was attempted.'
          : unavailable,
      diagnostics,
    )
  }
}
export function dropboxAssetIdentity(
  org: string,
  product: string,
  source: string,
  bytes: Uint8Array,
) {
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  return {
    sha256,
    id:
      'dropbox-' +
      createHash('sha256')
        .update(JSON.stringify([org, product, source, sha256]))
        .digest('hex'),
  }
}
