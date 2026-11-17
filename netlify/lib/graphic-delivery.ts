import { createHash } from 'node:crypto'
import sharp from 'sharp'

export interface GraphicStore {
  get(
    key: string,
    options: { type: 'arrayBuffer' },
  ): Promise<ArrayBuffer | null>
  set(key: string, value: ArrayBuffer): Promise<unknown>
}

/** Called only after membership, tenant RLS and asset ownership are verified.
 * Originals are immutable; replacement uploads receive new asset IDs.
 * Versioned, tenant-scoped variants also cover old uploads on first request.
 */
export async function deliverGraphic({
  request,
  org,
  asset,
  store,
}: {
  request: Request
  org: string
  asset: { id: string; fileType: string; updatedAt?: string }
  store: GraphicStore
}) {
  const width = Number(new URL(request.url).searchParams.get('imageWidth'))
  const preview =
    [128, 480, 800].includes(width) &&
    ['image/png', 'image/jpeg', 'image/webp'].includes(asset.fileType)
  const version = createHash('sha256')
    .update(
      JSON.stringify([
        org,
        asset.id,
        asset.updatedAt || '',
        preview ? width : 'original',
        'webp-v1',
      ]),
    )
    .digest('hex')
  const headers = {
    'Content-Type': preview ? 'image/webp' : asset.fileType,
    // Revalidate access on every reuse, including after logout or tenant switch.
    'Cache-Control': 'private, no-cache',
    ETag: `"${version}"`,
    Vary: 'Cookie, Authorization',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'",
  }
  if (request.headers.get('if-none-match') === headers.ETag)
    return new Response(null, { status: 304, headers })
  const originalKey = `${org}/${asset.id}`
  const variantKey = `${org}/previews/webp-v1/${asset.id}/${version}`
  let bytes = preview
    ? await store.get(variantKey, { type: 'arrayBuffer' })
    : null
  if (!bytes) {
    const original = await store.get(originalKey, { type: 'arrayBuffer' })
    if (!original) throw new Error('Graphic file is unavailable.')
    if (preview) {
      const output = await sharp(Buffer.from(original), {
        limitInputPixels: 40000000,
      })
        .rotate()
        .resize({
          width,
          height: width,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: 85 })
        .toBuffer()
      bytes = new Uint8Array(output).buffer
      // A cache write failure must not prevent displaying the photo.
      await store.set(variantKey, bytes).catch(() => undefined)
    } else bytes = original
  }
  return new Response(bytes, { headers })
}
