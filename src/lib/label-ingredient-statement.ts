import type { LabelData } from './label-studio'

export type IngredientStatementRun = { text: string; bold: boolean }

/** Keep the source text intact; parentheses of every depth always stay regular. */
function nameRuns(text: string): IngredientStatementRun[] {
  const runs: IngredientStatementRun[] = []
  let depth = 0
  for (const char of text) {
    if (char === '(') depth++
    const bold = depth === 0 && char !== ')'
    if (runs.at(-1)?.bold === bold) runs[runs.length - 1].text += char
    else runs.push({ text: char, bold })
    if (char === ')') depth = Math.max(0, depth - 1)
  }
  return runs
}

export function ingredientStatementRuns(
  data: LabelData,
): IngredientStatementRun[] {
  const text = data.values['recipe.ingredients'] || ''
  const structured: IngredientStatementRun[] = [
    { text: 'Ingredients: ', bold: false },
  ]
  for (const [index, part] of data.ingredientParts.entries()) {
    if (index) structured.push({ text: ', ', bold: false })
    structured.push(...nameRuns(part.name))
    if (part.subingredients)
      structured.push({ text: ` (${part.subingredients})`, bold: false })
  }
  if (
    data.ingredientParts.length &&
    structured.map((run) => run.text).join('') === text
  )
    return structured

  // Older print snapshots may only contain text. Only commas OUTSIDE all
  // parentheses delimit main ingredients; never split nested subingredients.
  const prefix = text.match(/^Ingredients:\s*/i)?.[0] || ''
  const runs: IngredientStatementRun[] = prefix
    ? [{ text: prefix, bold: false }]
    : []
  let depth = 0,
    start = prefix.length
  for (let i = start; i <= text.length; i++) {
    if (text[i] === '(') depth++
    if (text[i] === ')') depth = Math.max(0, depth - 1)
    if (i === text.length || (text[i] === ',' && depth === 0)) {
      const segment = text.slice(start, i)
      const name = segment.trim()
      const leading = segment.slice(0, segment.indexOf(name))
      const trailing = segment.slice(leading.length + name.length)
      if (leading) runs.push({ text: leading, bold: false })
      runs.push(...nameRuns(name))
      if (trailing) runs.push({ text: trailing, bold: false })
      if (i < text.length) runs.push({ text: ',', bold: false })
      start = i + 1
    }
  }
  return runs
}
