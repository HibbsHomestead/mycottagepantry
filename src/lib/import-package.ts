/** Only explicit textual contents, never physical dimensions or image inference. */
export function explicitCountedPackage(text: string) {
  text = text.replace(
    /\b\d+(?:\.\d+)?(?:\s*[x×]\s*\d+(?:\.\d+)?){1,2}\s*(?:inches|inch|in\b|cm\b|mm\b|[\"])/gi,
    '',
  )
  const nested = text.match(
    /\bcase\s+of\s+(\d+)\s+packs?\s+(?:of|containing)\s+(\d+)\s+(bags?|labels?|liners?|sheets?|pieces?|pcs|each|count|ct)\b/i,
  )
  if (nested)
    return {
      amountPerPackage: Number(nested[1]) * Number(nested[2]),
      purchaseUnit: 'case',
      unit: 'each',
      packageRelationship: `1 case = ${nested[1]} packs × ${nested[2]} ${nested[3]}`,
    }
  // A multipack needs an explicit nested relationship before a total can be inferred.
  if (/\bcase\s+of\b|\b\d+\s*(?:packs?|pk)\b|\b\d+\s*[x×]\s*\d+/i.test(text))
    return undefined
  const count = text.match(
    /\b(\d+)\s*[- ]?(count|ct|bags?|labels?|liners?|sheets?|pieces?|pcs)\b/i,
  )
  if (!count || Number(count[1]) <= 0) return undefined
  const purchaseUnit = /\bbox\b/i.test(text) ? 'box' : 'package'
  return {
    amountPerPackage: Number(count[1]),
    purchaseUnit,
    unit: 'each',
    packageRelationship: `1 ${purchaseUnit} = ${count[1]} ${count[2]}`,
  }
}
