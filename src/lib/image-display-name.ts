import type { Item } from './domain'

/** Never show generated asset IDs as image names. */
export function imageDisplayName(asset: Item | undefined, index = 0) {
  if (!asset) return ''
  const raw = String(asset.name || '').trim(),
    base = raw.replace(/\.(png|jpe?g|webp|gif)$/i, '').trim()
  const generated =
    !base ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      base,
    ) ||
    (!!asset.id && base.includes(String(asset.id))) ||
    /^[0-9a-f]{16,}$/i.test(base) ||
    /^(image|img|file|upload|blob)?[-_ ]?[0-9a-f-]{20,}$/i.test(base)
  if (!generated) return raw
  const kind = /photo/i.test(String(asset.category || ''))
    ? 'Uploaded photo'
    : 'Uploaded image'
  return index > 0 ? `${kind} ${index}` : kind
}
