export const majorAllergens = [
  'Milk',
  'Eggs',
  'Fish',
  'Crustacean shellfish',
  'Tree nuts',
  'Peanuts',
  'Wheat',
  'Soybeans',
  'Sesame',
] as const

export type MajorAllergen = (typeof majorAllergens)[number]
export type AllergenDecision = {
  status: 'present' | 'absent' | 'review' | 'unknown'
  reason?: string
  name?: string
}
export type AllergenDecisions = Partial<Record<MajorAllergen, AllergenDecision>>
export type AllergenEvidence = {
  allergen?: MajorAllergen
  path: string[]
  confidence: 'name match' | 'needs review' | 'incomplete data'
  sourceDeclaration?: boolean
}
export const speciesAllergens = [
  'Fish',
  'Crustacean shellfish',
  'Tree nuts',
] as const

export function validateAllergenDecisions(
  input: AllergenDecisions,
  evidence: AllergenEvidence[],
): AllergenDecisions {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Review the allergen decisions.')
  const decisions: AllergenDecisions = {}
  for (const allergen of majorAllergens) {
    const decision = input[allergen]
    if (
      !decision ||
      !['present', 'absent', 'review', 'unknown'].includes(decision.status)
    )
      throw new Error(`Choose a review state for ${allergen}.`)
    const reason =
      typeof decision.reason === 'string' ? decision.reason.trim() : ''
    const name = typeof decision.name === 'string' ? decision.name.trim() : ''
    if (reason.length > 500 || name.length > 120)
      throw new Error('Use a shorter allergen note or source name.')
    if (
      decision.status === 'absent' &&
      evidence.some(
        (entry) => entry.allergen === allergen && entry.sourceDeclaration,
      )
    )
      throw new Error(
        `A reviewed ingredient source declares ${allergen}. Correct the source before confirming absence.`,
      )
    if (
      decision.status === 'absent' &&
      evidence.some((entry) => entry.allergen === allergen) &&
      !reason
    )
      throw new Error(
        `Record a reason for dismissing the ${allergen} suggestion.`,
      )
    const specific = speciesAllergens.some((entry) => entry === allergen)
    if (
      decision.status === 'present' &&
      specific &&
      (!name ||
        !/^[\p{L}\p{M}][\p{L}\p{M} ,'-]*$/u.test(name) ||
        name.toLowerCase() === allergen.toLowerCase())
    )
      throw new Error(
        `Enter the specific reviewed source name(s) for ${allergen}.`,
      )
    decisions[allergen] = {
      status: decision.status,
      ...(reason ? { reason } : {}),
      ...(specific && decision.status === 'present' ? { name } : {}),
    }
  }
  return decisions
}

const defaultAliases: Record<MajorAllergen, string[]> = {
  Milk: ['milk', 'whey', 'casein', 'butter', 'cheese', 'cream'],
  Eggs: ['egg', 'eggs', 'albumen'],
  Fish: ['fish', 'anchovy', 'cod', 'salmon', 'tuna'],
  'Crustacean shellfish': [
    'shrimp',
    'prawn',
    'crab',
    'lobster',
    'crayfish',
    'crustacean',
  ],
  'Tree nuts': [
    'almond',
    'cashew',
    'pecan',
    'walnut',
    'pistachio',
    'hazelnut',
    'macadamia',
    'brazil nut',
    'tree nuts',
  ],
  Peanuts: ['peanut', 'groundnut'],
  Wheat: ['wheat', 'spelt', 'durum', 'semolina'],
  Soybeans: ['soy', 'soya', 'soybean', 'tofu'],
  Sesame: ['sesame', 'tahini'],
}

const uncertain =
  /\b(?:natural flavors?|flavoring|spices?|lecithin|modified food starch|blends?|mix(?:es)?|oils?)\b/i
const normalize = (text: string) =>
  text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

export function allergenEvidence(
  path: string[],
  text: string,
  aliases: Partial<Record<MajorAllergen, string[]>> = {},
): AllergenEvidence[] {
  const padded = ` ${normalize(text)} `
  const results: AllergenEvidence[] = []
  for (const allergen of majorAllergens) {
    const names = [...defaultAliases[allergen], ...(aliases[allergen] || [])]
    if (
      names.some((entry) => {
        const name = normalize(entry)
        return (
          name &&
          (padded.includes(` ${name} `) || padded.includes(` ${name}s `))
        )
      })
    )
      results.push({
        allergen,
        path,
        confidence: uncertain.test(text) ? 'needs review' : 'name match',
      })
  }
  if (uncertain.test(text)) results.push({ path, confidence: 'needs review' })
  return results
}

export type ComponentSource = {
  key: string
  name: string
  children: ComponentSource[]
}
export type ComponentWeights = {
  text: string
  sourceRef?: string
  shares: Record<string, string>
}
export function componentWeightSource(item: Record<string, unknown>) {
  const fields = [
    'brand',
    'supplierId',
    'vendorId',
    'barcode',
    'productSourceUrl',
    'labelSourceRevision',
  ].map((key) => String(item[key] || ''))
  return fields.some(Boolean) ? JSON.stringify(fields) : ''
}
const qualifier =
  /^(?:milk|egg|eggs|fish|crustacean shellfish|tree nuts|peanut|peanuts|wheat|soy|soybeans?|sesame)$/i

export function componentSources(
  text: string,
  parent = '',
  level = 0,
): ComponentSource[] | null {
  if (!text.trim()) return []
  if (level > 12 || text.length > 8000) return null
  const entries: string[] = []
  let depth = 0
  let start = 0
  for (const [index, character] of text.split('').entries()) {
    if (character === '(') depth++
    if (character === ')') depth--
    if (depth < 0) return null
    if (character === ',' && depth === 0) {
      entries.push(text.slice(start, index).trim())
      start = index + 1
    }
  }
  if (depth !== 0) return null
  entries.push(text.slice(start).trim())
  const result: ComponentSource[] = []
  for (const [index, entry] of entries.entries()) {
    if (
      !entry ||
      /[;[\]{}]|\b(?:contains|may contain|less than)\b|%/i.test(entry)
    )
      return null
    const key = `${parent}${index + 1}`
    const split = entry.indexOf('(')
    if (split < 0) {
      result.push({ key, name: entry, children: [] })
      continue
    }
    const suffix = entry.slice(split + 1, -1).trim()
    if (!entry.endsWith(')') || !entry.slice(0, split).trim()) return null
    if (qualifier.test(suffix)) {
      result.push({ key, name: entry, children: [] })
      continue
    }
    const children = componentSources(suffix, `${key}.`, level + 1)
    if (!children?.length) return null
    result.push({ key, name: entry.slice(0, split).trim(), children })
  }
  return result
}

export type WeightedIngredient = {
  name: string
  weight: number
  contributions: { path: string[]; grams: number }[]
}

export function weightedComponents(
  nodes: ComponentSource[],
  shares: ComponentWeights | undefined,
  text: string,
  grams: number,
  path: string[],
  reportIssue?: (message: string) => void,
): WeightedIngredient[] | null {
  if (!shares || shares.text !== text || !Number.isFinite(grams) || grams <= 0)
    return null
  const result: WeightedIngredient[] = []
  function expand(
    rows: ComponentSource[],
    weight: number,
    parents: string[],
  ): boolean {
    const values = rows.map((row) => {
      const value = shares?.shares?.[row.key]
      return typeof value === 'string' &&
        /^(?:\d{1,3}(?:\.\d{1,6})?|\.\d{1,6})$/.test(value)
        ? Number(value)
        : NaN
    })
    const missing = rows.filter((row) => {
      const value = shares?.shares?.[row.key]
      return value === undefined || (typeof value === 'string' && !value.trim())
    })
    const at = parents.join(' → ')
    if (missing.length) {
      reportIssue?.(`Missing percentages in ${at}: ${missing.map((row) => row.name).join(', ')}.`)
      return false
    }
    if (!rows.length || values.some((value) => !Number.isFinite(value) || value <= 0 || value > 100)) {
      reportIssue?.(`Enter valid positive percentages for the listed components in ${at}.`)
      return false
    }
    if (Math.abs(values.reduce((sum, value) => sum + value, 0) - 100) > 1e-9) {
      reportIssue?.(`Percentages in ${at} do not total 100%.`)
      return false
    }
    return rows.every((row, index) => {
      const amount = weight * (values[index] / 100)
      const next = [...parents, row.name]
      if (row.children.length) return expand(row.children, amount, next)
      result.push({
        name: row.name,
        weight: amount,
        contributions: [{ path: next, grams: amount }],
      })
      return true
    })
  }
  return expand(nodes, grams, path) ? result : null
}

export function mergeWeightedIngredients(
  ingredients: WeightedIngredient[],
  groupSmall: boolean,
) {
  const byName = new Map<string, WeightedIngredient>()
  for (const ingredient of ingredients) {
    const key = ingredient.name.trim().replace(/\s+/g, ' ').toLowerCase()
    const previous = byName.get(key)
    byName.set(
      key,
      previous
        ? {
            ...previous,
            weight: previous.weight + ingredient.weight,
            contributions: [
              ...previous.contributions,
              ...ingredient.contributions,
            ],
          }
        : ingredient,
    )
  }
  const parts = [...byName.values()].sort(
    (first, second) => second.weight - first.weight,
  )
  const total = parts.reduce((sum, part) => sum + part.weight, 0)
  const firstSmall =
    groupSmall && total > 0
      ? parts.findIndex(
          (part) =>
            part.weight < total * 0.02 && total * 0.02 - part.weight > 1e-9,
        )
      : -1
  const names = (rows: WeightedIngredient[]) =>
    rows.map(({ name }) => name).join(', ')
  const text = parts.length
    ? `Ingredients: ${firstSmall > 0 ? `${names(parts.slice(0, firstSmall))}. Contains less than 2% of: ${names(parts.slice(firstSmall))}` : names(parts)}`
    : ''
  return { text, parts }
}
