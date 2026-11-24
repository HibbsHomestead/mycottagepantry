import {
  newerGroceryMark,
  type GroceryList,
  type GroceryMark,
} from './grocery-list'

const prefix = (id: string) => `cp:grocery-check:${id}:`

export const groceryMarkKey = (id: string, mark: GroceryMark) =>
  prefix(id) + mark.token
export const belongsToGroceryOutbox = (id: string, key: string | null) =>
  key === null || key.startsWith(prefix(id))

export function readGroceryOutbox(storage: Storage, id: string) {
  const marks: GroceryMark[] = []
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index)
    if (!key?.startsWith(prefix(id))) continue
    try {
      const mark: GroceryMark = JSON.parse(storage.getItem(key) || 'null')
      if (
        mark &&
        typeof mark.row === 'string' &&
        typeof mark.checked === 'boolean' &&
        Number.isSafeInteger(mark.at) &&
        key === groceryMarkKey(id, mark)
      )
        marks.push(mark)
    } catch {
      continue
    }
  }
  return marks
}

export function mergeGroceryMarks(
  base: GroceryList['marks'],
  marks: GroceryMark[],
) {
  const next = { ...base }
  for (const mark of marks)
    if (newerGroceryMark(mark, next[mark.row])) next[mark.row] = mark
  return next
}
