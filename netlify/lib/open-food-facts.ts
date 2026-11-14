import { z } from 'zod'
import { externalGTIN } from '../../src/lib/catalog'
import { normalizeUnit } from '../../src/lib/domain'
import { packageStatements } from './package-statements'

/** Read one public product only; nutrition and inferred allergen tags are not package evidence. */
export async function openFoodFactsProduct(code: string, format?: string) {
  const identifier = externalGTIN(code, format)
  const response = await fetch(
    `https://world.openfoodfacts.org/api/v2/product/${identifier}.json`,
    {
      headers: {
        'User-Agent': 'CottagePantry/1.0 (https://mycottagepantry.com)',
      },
      signal: AbortSignal.timeout(8000),
    },
  )
  if (response.status === 404) return null
  if (!response.ok) throw new Error('Public food lookup unavailable.')
  const body = z
    .object({
      status: z.number(),
      product: z
        .object({
          code: z.string(),
          product_name: z.string().optional(),
          product_name_en: z.string().optional(),
          brands: z.string().optional(),
          quantity: z.string().optional(),
          ingredients_text: z.string().optional(),
          ingredients_text_en: z.string().optional(),
          image_front_url: z.string().optional(),
        })
        .optional(),
    })
    .safeParse(await response.json())
  if (!body.success || body.data.status !== 1 || !body.data.product) return null
  const p = body.data.product
  try {
    if (
      externalGTIN(p.code, p.code.length === 8 ? 'ean_8' : undefined) !==
      identifier
    )
      return null
  } catch {
    return null
  }
  const title = p.product_name_en || p.product_name
  if (!title) return null
  const sourceUrl = `https://world.openfoodfacts.org/product/${p.code}`
  const size = p.quantity?.match(/^\s*(\d+(?:\.\d+)?)\s*(kg|g|oz|lb|ml|l)\b/i)
  const unit = size && normalizeUnit(size[2])
  let imageUrl = ''
  try {
    const image = new URL(p.image_front_url || '')
    if (
      image.protocol === 'https:' &&
      image.hostname === 'images.openfoodfacts.org' &&
      !image.username &&
      !image.password
    )
      imageUrl = image.href
  } catch {
    /* Missing photos remain unknown. */
  }
  return {
    title,
    sourceUrl,
    imageUrl,
    checkedAt: new Date().toISOString(),
    fields: {
      name: title,
      barcode: code,
      ...(p.brands ? { brand: p.brands } : {}),
      ...(p.quantity ? { packageSize: p.quantity } : {}),
      ...(size && unit && Number(size[1]) > 0
        ? { purchaseQuantity: Number(size[1]), purchaseUnit: unit }
        : {}),
      ...packageStatements(p.ingredients_text || p.ingredients_text_en || ''),
    },
    conditions: [],
    warnings: [
      'Open Food Facts community record; verify the variant, package, ingredients and allergens against your package. Missing allergen statements mean unknown.',
      `Source: ${sourceUrl} — database ODbL, contents DbCL, images CC BY-SA.`,
    ],
  }
}
