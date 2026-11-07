import { z } from 'zod'
import { convert, units, unitLabel, normalizeUnit, type Item } from './domain'
import { classifyRecipeText, isDirection } from './recipe-source'
const nullableNumber = z
  .number()
  .finite()
  .nonnegative()
  .nullable()
  .default(null)
export const importLineSchema = z.object({
  original: z.string().max(2000).default(''),
  group: z.string().max(200).default(''),
  quantity: nullableNumber,
  unit: z.string().max(80).default(''),
  name: z.string().max(300).default(''),
  preparation: z.string().max(1000).default(''),
  uncertainty: z.string().max(1000).default(''),
  ingredientId: z.string().max(100).default(''),
  decision: z.enum(['unresolved', 'match', 'new']).default('unresolved'),
  confirmed: z.boolean().default(false),
  cupStandard: z.enum(['', 'us', 'metric']).default(''),
})
export const recipeDraftSchema = z.object({
  title: z.string().max(300).default(''),
  description: z.string().max(6000).default(''),
  lines: z.array(importLineSchema).max(150).default([]),
  instructions: z.array(z.string().max(6000)).max(100).default([]),
  instructionGroups: z.array(z.string().max(200)).max(100).default([]),
  optionalAdditions: z.array(importLineSchema).max(150).default([]),
  unclassified: z.array(z.string().max(6000)).max(150).default([]),
  sourceUrl: z
    .string()
    .max(8192)
    .default('')
    .refine((value) => {
      if (!value) return true
      try {
        const url = new URL(value)
        return (
          ['https:', 'http:'].includes(url.protocol) &&
          !url.username &&
          !url.password
        )
      } catch {
        return false
      }
    }, 'Use a public source URL without credentials.'),
  sourceAttribution: z.array(z.string().max(2000)).max(30).default([]),
  missingInstructionsReviewed: z.boolean().default(false),
  yieldQuantity: nullableNumber,
  yieldUnit: z.string().max(80).default(''),
  prepMinutes: nullableNumber,
  cookMinutes: nullableNumber,
  notes: z.string().max(10000).default(''),
  author: z.string().max(300).default(''),
  sourceApp: z.string().max(150).default(''),
  sourceId: z.string().max(500).default(''),
})
export type ImportLine = z.infer<typeof importLineSchema>
export type RecipeDraft = z.infer<typeof recipeDraftSchema>
const fractions: Record<string, string> = {
  '½': '1/2',
  '¼': '1/4',
  '¾': '3/4',
  '⅓': '1/3',
  '⅔': '2/3',
  '⅛': '1/8',
  '⅜': '3/8',
  '⅝': '5/8',
  '⅞': '7/8',
  '⅕': '1/5',
  '⅖': '2/5',
  '⅗': '3/5',
  '⅘': '4/5',
  '⅙': '1/6',
  '⅚': '5/6',
}
export function parseQuantity(value: string): number | null {
  const s = value
    .trim()
    .replace(/(\d)([½¼¾⅓⅔⅛⅜⅝⅞⅕⅖⅗⅘⅙⅚])/g, '$1 $2')
    .replace(/[½¼¾⅓⅔⅛⅜⅝⅞⅕⅖⅗⅘⅙⅚]/g, (c) => fractions[c])
  if (/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(s)) return Number(s)
  const m = s.match(/^(?:(\d+)\s+)?(\d+)\/(\d+)$/)
  return m && Number(m[3]) > 0
    ? Number(m[1] || 0) + Number(m[2]) / Number(m[3])
    : null
}
const rangeNumber = '(?:\\d+(?:\\s+\\d+\\/\\d+|\\/\\d+|\\.\\d+)?|[½¼¾⅓⅔⅛⅜⅝⅞])'
export function hasQuantityRange(text: string) {
  return new RegExp(
    rangeNumber + '\\s*(?:[a-z]+\\s+)?(?:[-–—]|\\bto\\b)\\s*' + rangeNumber,
    'i',
  ).test(text)
}
export function parseIngredient(original: string, group = ''): ImportLine {
  // A list ordinal is structure, never a recipe amount.
  let rest = original
      .replace(/^\s*[-•*]\s*/, '')
      .replace(/^\s*\d+[.)]\s+/, '')
      .trim(),
    quantity: number | null = null,
    uncertainty = ''
  const m = rest.match(
    /^((?:\d+\s+\d+\/\d+|\d+\/\d+|(?:\d+(?:\.\d+)?|\.\d+)[½¼¾⅓⅔⅛⅜⅝⅞⅕⅖⅗⅘⅙⅚]?|[½¼¾⅓⅔⅛⅜⅝⅞⅕⅖⅗⅘⅙⅚]))\s*/,
  )
  if (m) {
    quantity = parseQuantity(m[1])
    rest = rest.slice(m[0].length)
  }
  if (/^(?:[-–—]|to\s+\d)/i.test(rest)) {
    quantity = null
    uncertainty = 'Quantity range — choose a quantity for costing.'
    rest = rest.replace(/^(?:[-–—]|to)\s*[\d/.½¼¾]+\s*/, '')
  }
  const um = rest.match(
    /^((?:US\s+)?(?:fl\.?\s*oz|fluid ounces?|[a-z]+))\.?\b\s*/i,
  )
  let unit = ''
  if (um) {
    const key = um[1].toLowerCase().replace(/\./g, '').replace(/\s+/g, ' '),
      u = normalizeUnit(key, true) || ''
    if (units[u]) {
      unit = u
      rest = rest.slice(um[0].length)
      if (
        ['gallon', 'quart', 'pint', 'tsp', 'tbsp', 'fl oz'].includes(u) &&
        !/^us /.test(key)
      ) {
        unit = ''
        uncertainty =
          'Confirm the volume standard and select an explicit US or metric unit.'
      }
    }
  }
  const alternatives = /\band\/or\b|\bor\b/.test(rest)
  const parts = alternatives ? [rest] : rest.split(/,\s*/),
    name = parts.shift() || '',
    preparation = parts.join(', ')
  if (/optional|to taste|as needed/i.test(original))
    uncertainty = 'Optional / to taste — review quantity and inclusion.'
  if (hasQuantityRange(original)) {
    quantity = null
    uncertainty = 'Quantity range — choose a quantity for costing.'
  }
  if (alternatives)
    uncertainty +=
      (uncertainty ? ' ' : '') +
      'Alternative ingredients — choose explicitly before including in costing.'
  return importLineSchema.parse({
    original,
    group,
    quantity,
    unit,
    name,
    preparation,
    uncertainty,
  })
}
export function parseRecipeText(text: string): RecipeDraft {
  const draft = recipeDraftSchema.parse({})
  for (const block of classifyRecipeText(text)) {
    const row = block.text
    switch (block.kind) {
      case 'title':
        draft.title = row
        break
      case 'source': {
        const value = row.replace(/^Source(?: URL)?\s*:\s*/i, '')
        const parsed = recipeDraftSchema.shape.sourceUrl.safeParse(value)
        if (parsed.success && !draft.sourceUrl) draft.sourceUrl = value
        else draft.sourceAttribution.push(row)
        break
      }
      case 'description':
        draft.description += (draft.description ? '\n' : '') + row
        break
      case 'ingredient':
        draft.lines.push(parseIngredient(row, block.group))
        break
      case 'optional':
        draft.optionalAdditions.push(parseIngredient(row, block.group))
        break
      case 'instruction':
        draft.instructions.push(row.replace(/^\d+[.)]\s*/, ''))
        draft.instructionGroups.push(block.group)
        break
      case 'note':
        draft.notes += (draft.notes ? '\n' : '') + row
        break
      case 'unclassified':
        draft.unclassified.push(row)
        break
      case 'attribution':
        draft.sourceAttribution.push(row)
        if (/Shared from CookBook/i.test(row))
          draft.sourceApp = 'CookBook Manager'
        break
      case 'yield': {
        const match = row.match(
          /^(?:yield|makes|serves|servings)\s*:?\s*(\d+(?:\.\d+)?)(?:\s+([^\d].*))?$/i,
        )
        if (match && !hasQuantityRange(row)) {
          draft.yieldQuantity = Number(match[1])
          draft.yieldUnit = match[2] || ''
        } else draft.unclassified.push(row)
        break
      }
      case 'prep':
      case 'cook': {
        const match = row.match(
          /^(?:prep|cook)(?:\s+time)?\s*:\s*(\d+(?:\.\d+)?)\s*(min(?:utes?)?|hours?|hrs?)\s*$/i,
        )
        if (match)
          draft[block.kind === 'prep' ? 'prepMinutes' : 'cookMinutes'] =
            Number(match[1]) * (/^h/i.test(match[2]) ? 60 : 1)
        else draft.unclassified.push(row)
        break
      }
    }
  }
  return recipeDraftSchema.parse(draft)
}
export function recipeMethod(draft: RecipeDraft) {
  let previous = ''
  return draft.instructions
    .flatMap((step, index) => {
      const group = draft.instructionGroups[index] || ''
      const heading =
        group && group !== previous
          ? [group.endsWith(':') ? group : group + ':']
          : []
      previous = group
      return [...heading, step]
    })
    .join('\n\n')
}
// Structured sources and OCR use the same boundary checks as pasted text.
export function separateExtractedContent(input: RecipeDraft): RecipeDraft {
  const draft = recipeDraftSchema.parse(input)
  const moved: string[] = [],
    groups: string[] = []
  draft.lines = draft.lines.filter((line) => {
    if (isDirection(line.original || line.name)) {
      const text = (line.original || line.name).replace(/^\d+[.)]\s*/, '')
      if (!draft.instructions.includes(text)) {
        moved.push(text)
        groups.push(line.group)
      }
      return false
    }
    if (
      /\boptional\b|^additions?:?$/i.test(line.group + ' ' + line.original) ||
      /^additions?:?$/i.test(line.group)
    ) {
      draft.optionalAdditions.push(line)
      return false
    }
    if (hasQuantityRange(line.original)) {
      line.quantity = null
      line.uncertainty = 'Quantity range — choose a quantity for costing.'
    }
    return true
  })
  draft.instructions = [...moved, ...draft.instructions]
  for (const line of draft.optionalAdditions) {
    if (hasQuantityRange(line.original)) {
      line.quantity = null
      line.uncertainty =
        'Quantity range — choose a quantity for costing if included.'
    }
  }
  draft.instructionGroups = [
    ...groups,
    ...input.instructions.map(
      (_, index) => input.instructionGroups?.[index] || '',
    ),
  ]
  return draft
}
export function sourceHasDirections(text: string) {
  return classifyRecipeText(text).some((block) => block.kind === 'instruction')
}
export type ContentSection =
  'ingredient' | 'instruction' | 'optional' | 'unclassified' | 'note'
export function moveRecipeContent(
  draft: RecipeDraft,
  from: Exclude<ContentSection, 'note'>,
  index: number,
  to: ContentSection,
): RecipeDraft {
  const next = recipeDraftSchema.parse(draft)
  if (from === to) return next
  const collection =
    from === 'ingredient'
      ? next.lines
      : from === 'optional'
        ? next.optionalAdditions
        : from === 'instruction'
          ? next.instructions
          : next.unclassified
  const item = collection[index]
  if (item === undefined) return next
  const text = typeof item === 'string' ? item : item.original || item.name
  const group =
    typeof item === 'string'
      ? from === 'instruction'
        ? next.instructionGroups[index] || ''
        : ''
      : item.group
  collection.splice(index, 1)
  if (from === 'instruction') next.instructionGroups.splice(index, 1)
  if (to === 'instruction') {
    next.instructions.push(text.replace(/^\d+[.)]\s*/, ''))
    next.instructionGroups.push(group)
    next.missingInstructionsReviewed = false
  }
  if (to === 'ingredient' || to === 'optional')
    (to === 'ingredient' ? next.lines : next.optionalAdditions).push(
      typeof item === 'string' ? parseIngredient(item, group) : item,
    )
  if (to === 'unclassified') next.unclassified.push(text)
  if (to === 'note')
    next.notes +=
      (next.notes ? '\n\n' : '') +
      (group ? group.replace(/:$/, '') + ':\n' : '') +
      text
  return next
}
export function reprocessRecipeDraft(
  current: RecipeDraft,
  source: string,
  ingredients: Item[],
) {
  const draft = parseRecipeText(source)
  const existing = [...current.lines, ...current.optionalAdditions]
  let preservedMatches = 0
  for (const line of [...draft.lines, ...draft.optionalAdditions]) {
    const at = existing.findIndex(
      (old) => old.original.trim() === line.original.trim(),
    )
    const old = at >= 0 ? existing.splice(at, 1)[0] : null
    if (
      old?.decision === 'match' &&
      ingredients.some(
        (i) =>
          i.id === old.ingredientId &&
          !['packaging', 'supply'].includes(i.usedAs),
      )
    ) {
      Object.assign(line, {
        ingredientId: old.ingredientId,
        decision: old.decision,
        confirmed: old.confirmed,
        cupStandard: old.cupStandard,
      })
      preservedMatches++
    }
  }
  const moved = current.lines.filter(
    (line) =>
      isDirection(line.original) &&
      draft.instructions.some(
        (step) => step === line.original.replace(/^\d+[.)]\s*/, ''),
      ),
  )
  return { draft, movedInstructions: moved.length, preservedMatches }
}
const normalized = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
export function suggestIngredient(line: ImportLine, ingredients: Item[]) {
  const name = normalized(line.name)
  // Exact names/aliases only: near names and brand differences require human selection.
  return ingredients
    .filter((i) => i.usedAs !== 'packaging' && i.usedAs !== 'supply')
    .filter((i) =>
      [i.name, ...(Array.isArray(i.aliases) ? i.aliases : [])].some(
        (n) => normalized(String(n)) === name,
      ),
    )
}
export function measurement(line: ImportLine) {
  if (line.unit === 'cup' && line.cupStandard === 'metric')
    return { quantity: (line.quantity ?? 0) * 250, unit: 'ml' }
  return { quantity: line.quantity ?? 0, unit: line.unit }
}
export function lineIssues(line: ImportLine, ingredients: Item[]): string[] {
  const issues: string[] = []
  if (isDirection(line.original || line.name))
    issues.push(
      'This looks like method text. Move it to Instructions / Method before approval.',
    )
  if (line.quantity == null || line.quantity <= 0)
    issues.push('Enter a quantity greater than zero.')
  if (!units[line.unit])
    issues.push('Choose a known unit; package contents must be confirmed.')
  if (line.unit === 'cup' && !line.cupStandard)
    issues.push('Confirm cup standard: US or metric.')
  if (!line.name.trim()) issues.push('Ingredient name is missing.')
  const i = ingredients.find((i) => i.id === line.ingredientId)
  if (
    !line.confirmed ||
    line.decision === 'unresolved' ||
    (line.decision === 'match' && !i)
  )
    issues.push('Confirm a Pantry match or approve a new ingredient.')
  if (line.decision === 'new')
    issues.push(
      'New ingredient needs purchase/cost details; no stock or price is assigned.',
    )
  else if (i) {
    const price = i.currentCost ?? i.cost
    if (
      i.needsCostSetup ||
      price == null ||
      price === '' ||
      !Number.isFinite(Number(price)) ||
      Number(price) < 0
    )
      issues.push('Missing price: enter purchase/cost details in Pantry.')
    try {
      const m = measurement(line)
      convert(m.quantity, m.unit, i.unit, i.conversions)
    } catch {
      issues.push(
        `Conversion needed: ${unitLabel(measurement(line).unit)} to ${unitLabel(i.unit)} for ${i.name}.`,
      )
    }
  }
  return issues
}
/** Existing approval rules, separate from costing gaps that may remain unfinished. */
export function recipeApprovalBlockers(
  draft: RecipeDraft,
  sourceText: string,
  ingredients: Item[],
) {
  const blockers: { target: string; message: string }[] = []
  const add = (target: string, message: string) =>
    blockers.push({ target, message })
  if (!draft.title.trim()) add('import-title', 'Enter a recipe title.')
  if (
    !draft.yieldQuantity ||
    draft.yieldQuantity <= 0 ||
    !draft.yieldUnit.trim()
  )
    add('import-yield', 'Enter a positive yield and yield unit.')
  if (!draft.lines.length)
    add('import-ingredients', 'Add at least one ingredient.')
  if (draft.unclassified.length)
    add('import-content', 'Classify the remaining review-needed text.')
  if (
    !draft.instructions.some((step) => step.trim()) &&
    sourceHasDirections(sourceText) &&
    !draft.missingInstructionsReviewed
  )
    add(
      'import-content',
      'Review the missing instructions and acknowledge them, or enter the method.',
    )
  draft.lines.forEach((line, index) => {
    const reasons: string[] = []
    if (isDirection(line.original || line.name))
      reasons.push('move method text to Instructions / Method')
    if (
      line.quantity == null ||
      !Number.isFinite(line.quantity) ||
      line.quantity <= 0
    )
      reasons.push('enter a positive quantity')
    if (!units[line.unit]) reasons.push('choose a known unit')
    if (!line.name.trim()) reasons.push('enter an ingredient name')
    if (line.unit === 'cup' && !line.cupStandard)
      reasons.push('confirm US or metric cups')
    if (!line.confirmed || line.decision === 'unresolved')
      reasons.push('confirm a Pantry match or new ingredient')
    if (
      line.decision === 'match' &&
      !ingredients.some(
        (i) =>
          i.id === line.ingredientId &&
          !['packaging', 'supply'].includes(i.usedAs),
      )
    )
      reasons.push('choose a Pantry ingredient in this oven')
    if (line.decision === 'new' && ['package', 'case'].includes(line.unit))
      reasons.push(
        'confirm physical package contents and choose a storage unit',
      )
    if (reasons.length)
      add(
        `import-line-${index}`,
        `Ingredient ${index + 1}: ${reasons.join('; ')}.`,
      )
  })
  return blockers
}
export function duplicateRecipes(
  draft: RecipeDraft,
  url: string,
  recipes: Item[],
  sourceHash = '',
) {
  const canonical = (v: string) => {
    try {
      const u = new URL(v)
      u.hash = ''
      return u.href.replace(/\/$/, '')
    } catch {
      return v
    }
  }
  return recipes.filter(
    (r) =>
      (sourceHash && r.importProvenance?.sourceHash === sourceHash) ||
      (url &&
        r.importProvenance?.sourceUrl &&
        canonical(url) === canonical(r.importProvenance.sourceUrl)) ||
      (draft.sourceId && r.importProvenance?.sourceId === draft.sourceId) ||
      normalized(r.name) === normalized(draft.title) ||
      similarTitle(r.name, draft.title),
  )
}

function similarTitle(a: string, b: string) {
  const x = new Set(normalized(a).split(' ').filter(Boolean)),
    y = new Set(normalized(b).split(' ').filter(Boolean))
  if (x.size < 2 || y.size < 2) return false
  return (
    [...x].filter((w) => y.has(w)).length / new Set([...x, ...y]).size >= 0.8
  )
}
