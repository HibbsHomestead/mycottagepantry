/** Product selection belongs to the ASIN and offer options, never the SEO slug. */
export function amazonAsin(url: URL) {
  if (!['amazon.com', 'www.amazon.com'].includes(url.hostname)) return undefined
  return url.pathname
    .match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([a-z0-9]{10})(?:\/|$)/i)?.[1]
    .toUpperCase()
}

export function normalizeProductUrl(value: string) {
  const url = new URL(value)
  if (url.protocol === 'http:') url.protocol = 'https:'
  const asin = amazonAsin(url)
  if (!asin) return url.href
  // Do not normalize away credentials or ports: the protected fetcher rejects them.
  url.hostname = 'www.amazon.com'
  url.pathname = `/dp/${asin}`
  url.hash = ''
  for (const key of [...url.searchParams.keys()]) {
    // Keep offerListingID, smid/m (seller), th/psc, quantity, condition, and
    // unknown options. Only known search/referral attribution is discarded.
    if (
      /^(?:ref_?|tag|linkCode|camp|creative|creativeASIN|ascsubtag|qid|sr|keywords|sprefix|crid|dib|dib_tag|pd_rd_.*|pf_rd_.*|utm_.*|content-id)$/i.test(
        key,
      )
    )
      url.searchParams.delete(key)
  }
  return url.href
}

export const amazonSelectionKeys = [
  'th',
  'psc',
  'smid',
  'm',
  'offerListingID',
  'condition',
  'quantity',
] as const
