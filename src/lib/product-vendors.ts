import type { Item } from './domain'

export function vendorDomain(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return ''
  try {
    const url = new URL(
      /^https?:\/\//i.test(value) ? value : `https://${value}`,
    )
    return url.hostname
      .toLowerCase()
      .replace(/^www\./, '')
      .replace(/\.$/, '')
  } catch {
    return ''
  }
}
const normalize = (value: unknown) =>
  String(value || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
const retailers = [
  {
    name: 'Sam’s Club',
    domain: 'samsclub.com',
    aliases: ['samsclub', 'samsclubcom'],
  },
  {
    name: 'Walmart',
    domain: 'walmart.com',
    aliases: ['walmart', 'walmartcom'],
  },
  {
    name: 'Costco',
    domain: 'costco.com',
    aliases: ['costco', 'costcowholesale', 'costcocom'],
  },
]
function retailer(value: string) {
  const domain = vendorDomain(value)
  return retailers.find(
    (r) => r.domain === domain || r.aliases.includes(normalize(value)),
  )
}
export function suggestedVendorName(name: string, sourceUrl: string) {
  // Seller identity wins over the hosting marketplace when explicitly provided.
  return (
    retailer(name)?.name ||
    name ||
    retailer(sourceUrl)?.name ||
    vendorDomain(sourceUrl)
  )
}
export function matchProductVendors(
  vendors: Item[],
  name: string,
  website = '',
) {
  const known = retailer(name)
  const domains = new Set(
    [vendorDomain(website), known?.domain].filter(Boolean),
  )
  const names = new Set(
    [normalize(name), ...(known?.aliases || []), normalize(known?.name)].filter(
      Boolean,
    ),
  )
  return vendors.filter((vendor) => {
    const aliases = Array.isArray(vendor.aliases)
      ? vendor.aliases.filter((v: unknown) => typeof v === 'string')
      : []
    return (
      [vendor.website, vendor.url, vendor.domain, ...aliases].some((v) =>
        domains.has(vendorDomain(v)),
      ) ||
      [vendor.name, ...aliases].some(
        (v) =>
          names.has(normalize(v)) || (known && retailer(String(v)) === known),
      )
    )
  })
}

/** Resolve only against the authorized workspace; never create a vendor on ingredient save. */
export function ingredientVendor(input: any, vendors: Item[], existing?: Item) {
  if (input.vendorId) {
    const vendor = vendors.find((v) => v.id === input.vendorId)
    if (!vendor) throw new Error('Choose a vendor in this oven.')
    return { vendorId: vendor.id, vendor: vendor.name }
  }
  const name = String(input.vendor ?? existing?.vendor ?? '')
  if (
    input.vendorId === undefined &&
    existing?.vendorId &&
    name === existing.vendor
  ) {
    const vendor = vendors.find((v) => v.id === existing.vendorId)
    if (vendor) return { vendorId: vendor.id, vendor: vendor.name }
  }
  const matches = vendors.filter((v) => v.name === name)
  if (matches.length > 1)
    throw new Error(
      'More than one vendor has this name. Choose a vendor by ID.',
    )
  return { vendorId: matches[0]?.id || null, vendor: name }
}
