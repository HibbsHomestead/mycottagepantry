/** Classify text before interpreting any leading number as an ingredient amount. */
export type SourceKind =
  | 'title'
  | 'source'
  | 'description'
  | 'yield'
  | 'prep'
  | 'cook'
  | 'ingredient_group'
  | 'ingredient'
  | 'instruction_group'
  | 'instruction'
  | 'optional'
  | 'note'
  | 'unclassified'
  | 'attribution'
export type SourceBlock = { kind: SourceKind; text: string; group: string }
const amount =
  /^(?:\d+[.)]\s+)?(?:\d+(?:[./]\d+)?(?:\s+\d+\/\d+)?|[½¼¾⅓⅔⅛⅜⅝⅞])(?:\s|[-–—½¼¾⅓⅔⅛⅜⅝⅞])/
const measured =
  /^(?:\d+[.)]\s+)?[\d\s./½¼¾⅓⅔⅛⅜⅝⅞–—-]+\s*(?:to\s+[\d./]+\s*)?(?:cups?|tablespoons?|teaspoons?|tbsp|tsp|fl\.?\s*oz|fluid ounces?|grams?|kilograms?|g|kg|oz|ounces?|pounds?|lbs?|ml|milliliters?|liters?|l|packages?|cans?|bags?|each)\b/i
const verbs =
  '(?:mix|melt|set|pour|stir|bake|preheat|combine|whisk|beat|fold|knead|heat|cool|chill|refrigerate|serve|spread|sprinkle|press|roll|add|remove|allow|place|transfer|cook|bring|leave|cover|divide|let|sift|chop|grease|line)'
const action = new RegExp(
  '(?:^(?:(?:gently|slowly|carefully|evenly|gradually|meanwhile|then)\\s*,?\\s*)?' +
    verbs +
    '\\b|[,;]\\s*' +
    verbs +
    '\\b|\\b(?:then|until|while|and)\\s+' +
    verbs +
    '\\b)',
  'i',
)
export function isDirection(text: string) {
  const body = text.replace(/^\s*(?:[-•*]\s*|\d+[.)]\s+)/, '').trim()
  const words = body.split(/\s+/).length
  // Preparation adjectives (melted/chopped) do not match imperative verbs.
  // A measured ingredient may contain them; procedural clauses still need review.
  return (
    (action.test(body) &&
      (words >= 2 || /[.!?]$/.test(body)) &&
      (!measured.test(body) ||
        /\b(?:until|then|while)\b|[.;]\s*\S/.test(body))) ||
    (/\b(?:is|are|should be|must be)\s+(?:mixed|combined|stirred|added|baked|poured|spread|folded|kneaded|heated)\b/i.test(
      body,
    ) &&
      words >= 5) ||
    (/\b(?:should|must|will)\b/.test(body) &&
      words >= 5 &&
      /[.!?]$/.test(body)) ||
    (/^\d+[.)]\s+/.test(text.trim()) &&
      !amount.test(body + ' ') &&
      words >= 5 &&
      /[.!?]$/.test(body))
  )
}
function ingredientShape(text: string, explicit = false) {
  const body = text.replace(/^[-•*]\s*/, '').replace(/^\d+[.)]\s+/, '')
  if (isDirection(text)) return false
  if (measured.test(body)) return true
  if (amount.test(body) && !/[.!?]/.test(body.replace(/\d\.\d/g, '')))
    return true
  if (/\b(?:to taste|as needed|a pinch|handful)\b/i.test(body)) return true
  return (
    explicit &&
    body.split(/\s+/).length <= 7 &&
    !/[.!?]/.test(body) &&
    !/\b(?:should|then|until|while|using|this|that|you|sentence|annotation)\b/i.test(
      body,
    )
  )
}
const standard = (s: string) =>
  /^(?:ingredients?|instructions?|directions?|method|preparation|steps?|notes?|additions?|optional(?: additions?| ingredients?)?)\s*:?$/i.test(
    s,
  )
export function classifyRecipeText(source: string): SourceBlock[] {
  const rows = source.replace(/\r/g, '').split('\n')
  const result: SourceBlock[] = []
  let section: 'intro' | 'ingredients' | 'instructions' | 'notes' | 'optional' =
    'intro'
  let group = '',
    title = false,
    attribution = false,
    numberedMethod = false
  const push = (kind: SourceKind, text: string, value = group) =>
    result.push({ kind, text, group: value })
  for (let index = 0; index < rows.length; index++) {
    const raw = rows[index],
      text = raw.trim()
    if (!text) continue
    if (/^(?:notes?|tips?)\s*:\s*\S/i.test(text)) {
      push('note', text)
      continue
    }
    const next =
      rows
        .slice(index + 1)
        .find((row) => row.trim())
        ?.trim() || ''
    if (/^Shared from\s+/i.test(text)) {
      push('attribution', text, '')
      attribution = true
      continue
    }
    if (/^(?:Source(?: URL)?\s*:\s*)?https?:\/\/\S+$/i.test(text)) {
      push(attribution ? 'attribution' : 'source', text, '')
      continue
    }
    if (
      /^(?:yield|makes|serves|servings)\s*:/i.test(text) ||
      /^(?:yield|makes|serves|servings)\s+\d/i.test(text)
    ) {
      push('yield', text, '')
      continue
    }
    if (/^(?:prep|cook)(?:\s+time)?\s*:/i.test(text)) {
      push(/^prep/i.test(text) ? 'prep' : 'cook', text, '')
      continue
    }
    const named =
      text.length <= 100 &&
      !/^\d/.test(text) &&
      (/:$/.test(text) ||
        standard(text) ||
        /^(?:for the\s+)?(?:dough|filling|topping|streusel|frosting|glaze|icing)$/i.test(
          text,
        ) ||
        (!/[.!?]/.test(text) &&
          rows[index - 1]?.trim() === '' &&
          isDirection(next)))
    if (named) {
      if (/^notes?\s*:?$/i.test(text)) {
        section = 'notes'
        numberedMethod = false
        group = ''
        push('note', text)
        continue
      }
      if (
        /^(?:additions?|optional(?: additions?| ingredients?)?)\s*:?$/i.test(
          text,
        )
      ) {
        section = 'optional'
        numberedMethod = false
        group = text.replace(/:$/, '')
        push('ingredient_group', text)
        continue
      }
      const kind =
        /^(?:instructions?|directions?|method|preparation|steps?)\s*:?$/i.test(
          text,
        ) || isDirection(next)
          ? 'instruction_group'
          : /ingredient/i.test(text) || ingredientShape(next, true)
            ? 'ingredient_group'
            : 'unclassified'
      if (kind === 'instruction_group') {
        section = 'instructions'
        numberedMethod = false
        group =
          /^(?:instructions?|directions?|method|preparation|steps?)\s*:?$/i.test(
            text,
          )
            ? ''
            : text
      } else if (kind === 'ingredient_group') {
        section = 'ingredients'
        numberedMethod = false
        group = /^ingredients?\s*:?$/i.test(text) ? '' : text.replace(/:$/, '')
      }
      push(kind, text)
      continue
    }
    if (
      !title &&
      section === 'intro' &&
      !ingredientShape(text) &&
      !isDirection(text)
    ) {
      push('title', text, '')
      title = true
      continue
    }
    const previous = result.at(-1)
    const numbered = /^\d+[.)]\s+/.test(text)
    if (
      section === 'instructions' &&
      numberedMethod &&
      !numbered &&
      previous?.kind === 'instruction' &&
      !ingredientShape(text)
    ) {
      previous.text += (rows[index - 1]?.trim() ? '\n' : '\n\n') + text
      continue
    }
    const continuation =
      previous &&
      rows[index - 1]?.trim() &&
      !numbered &&
      !isDirection(text) &&
      !ingredientShape(text) &&
      (/^\s+\S/.test(raw) ||
        /[,;:]$/.test(previous.text) ||
        /^(?:and|or|until|with|for)\b/i.test(text) ||
        (previous.kind === 'instruction' && !/[.!?]$/.test(previous.text)))
    if (
      continuation &&
      ['ingredient', 'optional', 'instruction', 'description', 'note'].includes(
        previous.kind,
      )
    ) {
      previous.text += '\n' + text
      continue
    }
    if (section === 'notes') {
      push('note', text)
      continue
    }
    if (isDirection(text)) {
      if (section !== 'instructions') group = ''
      section = 'instructions'
      if (numbered) numberedMethod = true
      push('instruction', text)
      continue
    }
    if (section === 'instructions') {
      if (ingredientShape(text)) {
        push('unclassified', text)
        continue
      }
      if (numbered) numberedMethod = true
      push('instruction', text)
      continue
    }
    if (
      ingredientShape(text, section === 'ingredients' || section === 'optional')
    ) {
      const optional: boolean =
        section === 'optional' || /\boptional\b/i.test(text)
      section = optional ? 'optional' : 'ingredients'
      push(optional ? 'optional' : 'ingredient', text)
      continue
    }
    push(section === 'intro' ? 'description' : 'unclassified', text)
  }
  return result
}
