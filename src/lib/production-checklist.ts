import { convert, packagingLines, type Item, type Workspace } from './domain'
import { basketProduction } from './basket-production'

export const checklistStages = ['reviewed', 'picked', 'packed'] as const
export type ChecklistStage = (typeof checklistStages)[number]
export type ChecklistMark = {
  signature: string
  quantity: number
  checked: boolean
  stale?: boolean
}

export function basketChecklist(
  line: Item,
  state: Workspace,
  stage: ChecklistStage,
) {
  const definition = line.definition
  if (definition?.product?.workflow !== 'kit') return []
  const planned = Number(line.quantity)
  const count =
    stage === 'reviewed'
      ? planned
      : Number(line.output || planned) + Number(line.waste || 0)
  const entries = new Map<
    string,
    {
      key: string
      name: string
      variant: string
      perBasket: number
      unit: string
      available: number
      supply: boolean
    }
  >()
  const managedStock = line.basketPlan && line.basketParentId
    ? new Map(basketProduction(line, state, line.basketParentId).map((row) => [row.component.productId, row.ready]))
    : undefined
  for (const component of definition.components) {
    const product = component.product
    const key = `product:${component.productId}`
    entries.set(key, {
      key,
      name: product.name,
      perBasket: Number(component.quantity),
      unit: 'packages',
      supply: false,
      variant: [
        product.sku,
        product.unitsPerPackage
          ? `${product.unitsPerPackage} ${product.contentUnit || 'units'} per package`
          : 'Selling package',
      ]
        .filter(Boolean)
        .join(' · '),
      available: managedStock
        ? managedStock.get(component.productId) || 0
        : Number(state.products.find((item) => item.id === product.id)?.quantity || 0),
    })
  }
  for (const supply of packagingLines(definition.product)) {
    const item = definition.ingredients.find(
      (entry: Item) => entry.id === supply.ingredientId,
    )
    if (!item) continue
    const key = `supply:${item.id}`
    const perBasket =
      (entries.get(key)?.perBasket || 0) +
      convert(
        Number(supply.quantity),
        supply.unit || item.unit,
        item.unit,
        item.conversions,
      )
    entries.set(key, {
      key,
      name: item.name,
      variant: '',
      perBasket,
      unit: item.unit,
      supply: true,
      available: Number(
        state.ingredients.find((entry) => entry.id === item.id)?.quantity || 0,
      ),
    })
  }
  return [...entries.values()].map((entry) => {
    const required = entry.perBasket * count
    const signature = JSON.stringify([
      line.productId,
      planned,
      count,
      entry.perBasket,
      entry.unit,
      entry.variant,
    ])
    const saved: ChecklistMark | undefined =
      line.checklist?.[stage]?.[entry.key]
    const reReview = !!saved && (saved.stale || saved.signature !== signature)
    return {
      ...entry,
      required,
      signature,
      mark: reReview ? undefined : saved,
      reReview,
    }
  })
}

export function updatedBasketChecklist(
  line: Item,
  previous: Item | undefined,
  state: Workspace,
) {
  if (!previous?.checklist) return undefined
  return Object.fromEntries(
    checklistStages.map((stage) => {
      const entries = new Map(
        basketChecklist(line, state, stage).map((entry) => [
          entry.key,
          entry.signature,
        ]),
      )
      const marks = Object.entries<ChecklistMark>(
        previous.checklist[stage] || {},
      ).map(([key, mark]) => [
        key,
        entries.get(key) === mark.signature ? mark : { ...mark, stale: true },
      ])
      return [stage, Object.fromEntries(marks)]
    }),
  )
}

export function basketDefinitionChanged(
  line: Item,
  current: Item,
  state: Workspace,
) {
  const signature = (entry: Item) =>
    basketChecklist(entry, state, 'reviewed')
      .map(({ key, signature }) => JSON.stringify([key, signature]))
      .sort()
      .join('\n')
  return signature(line) !== signature({ ...line, definition: current })
}

export function basketChecklistIssues(
  lines: Item[],
  state: Workspace,
  stages: readonly ChecklistStage[],
) {
  return lines.flatMap((line) =>
    stages.flatMap((stage) =>
      basketChecklist(line, state, stage)
        .filter((entry) => !entry.mark?.checked)
        .map(
          (entry) =>
            `${line.name}: ${entry.name} — ${stage} ${entry.mark?.quantity || 0} of ${Number(entry.required.toFixed(6))} ${entry.unit}.`,
        ),
    ),
  )
}
