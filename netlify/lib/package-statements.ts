/** Split explicit statement headings without truncating or inferring allergens. */
export function packageStatements(text: string) {
  const matches = [
    ...text.matchAll(
      /(?:^|\n|(?<=\.)\s+)(Contains(?::)?(?!\s+(?:\d|less\b))\s+|May contain(?::)?\s+|(?:Made|Manufactured|Processed|Packed) in (?:a |the )?(?:facility|factory)\b)/gi,
    ),
  ]
  const out: Record<string, string> = {}
  if (!matches.length) return text ? { subingredients: text } : out
  const start = (match: RegExpMatchArray) =>
    match.index! + match[0].indexOf(match[1])
  const first = start(matches[0])
  if (text.slice(0, first).trim())
    out.subingredients = text.slice(0, first).trim()
  for (const [i, m] of matches.entries()) {
    const key = /^Contains\b/i.test(m[1])
      ? 'sourceContains'
      : 'sourceMayContain'
    const part = text
      .slice(start(m), matches[i + 1] ? start(matches[i + 1]) : text.length)
      .trim()
    out[key] = [out[key], part].filter(Boolean).join('\n')
  }
  return out
}
