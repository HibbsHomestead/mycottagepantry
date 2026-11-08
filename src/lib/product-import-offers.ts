type Offer = {
  fields: Record<string, string | number>
  title: string
  sourceUrl: string
  conditions: string[]
}

const samsClub = (offer: Offer) => {
  try {
    return ['samsclub.com', 'www.samsclub.com'].includes(
      new URL(offer.sourceUrl).hostname,
    )
  } catch {
    return false
  }
}

// The extractor labels channels in conditions, e.g. “Sam’s Club · PICKUP · …”.
// Require a channel label, rather than a passing mention of pickup in prose.
const pickup = (offer: Offer) =>
  offer.conditions.some((condition) =>
    condition.split(/[·|;]/).some((part) => /^pickup$/i.test(part.trim())),
  ) &&
  !offer.conditions.some((condition) =>
    /out\s*of\s*stock|outofstock|sold\s*out|unavailable|discontinued|not\s+available/i.test(
      condition,
    ),
  )

function productPackage(offer: Offer) {
  return JSON.stringify([
    offer.sourceUrl,
    offer.title,
    ...[
      'name',
      'brand',
      'retailerSku',
      'barcode',
      'variant',
      'packageSize',
      'purchaseQuantity',
      'purchaseUnit',
      'packCount',
      'itemsPerPackage',
    ].map((key) => offer.fields[key] ?? ''),
  ])
}

/** A default only: call when results arrive, never during a render/effect. */
export function productOfferDefault(offers: Offer[]) {
  const initial = offers.length === 1 ? 0 : -1
  if (!offers.length || !offers.every(samsClub))
    return { index: initial, notice: '' }

  const pickups = offers.flatMap((offer, index) =>
    pickup(offer) ? [index] : [],
  )
  if (!pickups.length)
    return {
      index: initial,
      notice:
        'Pickup is unavailable in the imported offers. Review an available alternative below or check your selected club on Sam’s Club.',
    }

  if (
    pickups.length !== 1 ||
    offers.some((offer) => productPackage(offer) !== productPackage(offers[0]))
  )
    return {
      index: -1,
      notice:
        'Multiple products, packages or Pickup offers need review. Choose the exact package, club and price below.',
    }

  return { index: pickups[0], notice: '' }
}
