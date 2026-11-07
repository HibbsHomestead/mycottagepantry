import type { LabelElement } from './label-studio'
export const fontPairings = [
  {
    name: 'Farmhouse Bold',
    heading: 'Rye',
    body: 'Roboto Slab',
    compliance: 'Source Sans 3',
  },
  {
    name: 'Artisan Bread',
    heading: 'Playfair Display',
    body: 'Lora',
    compliance: 'Libre Baskerville',
  },
  {
    name: 'Modern Market',
    heading: 'League Spartan',
    body: 'DM Sans',
    compliance: 'Inter',
  },
  {
    name: 'Rustic Pantry',
    heading: 'Oswald',
    body: 'Source Sans 3',
    compliance: 'Source Sans 3',
    accent: 'Caveat',
  },
  {
    name: 'Vintage Label',
    heading: 'Abril Fatface',
    body: 'Libre Baskerville',
    compliance: 'Libre Baskerville',
    accent: 'Special Elite',
  },
  {
    name: 'Friendly Bakery',
    heading: 'Pacifico',
    body: 'Nunito Sans',
    compliance: 'Open Sans',
  },
  {
    name: 'Bold Product Label',
    heading: 'Anton',
    body: 'Roboto Condensed',
    compliance: 'Inter',
  },
  {
    name: 'Homestead',
    heading: 'Rye',
    body: 'Merriweather',
    compliance: 'Merriweather',
    accent: 'Dancing Script',
  },
]
export function applyFontPairing(
  elements: LabelElement[],
  pairing: (typeof fontPairings)[number],
) {
  return elements.map((e) =>
    e.type !== 'text' || e.locked
      ? e
      : {
          ...e,
          font: [
            'recipe.ingredients',
            'recipe.allergens',
            'business.disclaimer',
            'product.netQuantity',
            'business.address',
          ].includes(e.binding || '')
            ? pairing.compliance
            : e.binding === 'product.name' || e.fontSize >= 18
              ? pairing.heading
              : e.binding === 'product.subtitle' && pairing.accent
                ? pairing.accent
                : pairing.body,
          bold: false,
        },
  )
}
// Future uploads must use tenant-scoped assets, parsed/validated TTF/OTF/WOFF/WOFF2,
// explicit commercial embedding consent, and an embedding check before catalog registration.
export type BusinessFontAsset = {
  businessId: string
  assetId: string
  family: string
  format: 'ttf' | 'otf' | 'woff' | 'woff2'
  embeddingConsent: boolean
  status: 'pending' | 'validated' | 'rejected'
  fallbackFamily: string
}
