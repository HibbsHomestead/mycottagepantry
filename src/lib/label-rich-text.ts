import type { LabelElement } from './label-studio'

type Run = NonNullable<LabelElement['textRuns']>[number]
function slice(runs: Run[], start: number, end: number): Run[] {
  let offset = 0
  return runs.flatMap((run) => {
    const from = Math.max(0, start - offset),
      to = Math.min(run.text.length, end - offset)
    offset += run.text.length
    return to > from
      ? [{ ...run, id: crypto.randomUUID(), text: run.text.slice(from, to) }]
      : []
  })
}
export function applySelectionFont(
  element: LabelElement,
  start: number,
  end: number,
  font: string,
): Run[] {
  if (element.binding || start < 0 || end <= start || end > element.text.length)
    throw new Error(
      'Select a word or text range in a static text element first.',
    )
  const runs = element.textRuns || [
    { id: crypto.randomUUID(), text: element.text, font: element.font },
  ]
  return [
    ...slice(runs, 0, start),
    ...slice(runs, start, end).map((run) => ({ ...run, font })),
    ...slice(runs, end, element.text.length),
  ]
}
export function editStaticText(
  element: LabelElement,
  text: string,
): Partial<LabelElement> {
  if (!element.textRuns) return { text }
  let start = 0,
    end = 0
  while (
    start < Math.min(text.length, element.text.length) &&
    text[start] === element.text[start]
  )
    start++
  while (
    end < Math.min(text.length, element.text.length) - start &&
    text[text.length - 1 - end] === element.text[element.text.length - 1 - end]
  )
    end++
  const before = slice(element.textRuns, 0, start),
    after = slice(
      element.textRuns,
      element.text.length - end,
      element.text.length,
    )
  const inserted = text.slice(start, text.length - end)
  return {
    text,
    textRuns: [
      ...before,
      ...(inserted
        ? [
            {
              id: crypto.randomUUID(),
              text: inserted,
              font: before.at(-1)?.font || after[0]?.font || element.font,
            },
          ]
        : []),
      ...after,
    ],
  }
}
