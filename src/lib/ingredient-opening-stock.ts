import { convert, number, type Item } from './domain'

/** Opening stock is an explicit, one-time receipt, never part of reference metadata. */
export function openingStockEntry(item: Item, input: any, ledger: Item[]) {
  if (!input?.enabled) return null
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(input.operationId || ''))
    throw new Error('Invalid opening-stock operation. Reopen the ingredient.')
  const unit = item.storageUnit || item.unit
  if (input.unit !== unit)
    throw new Error(
      'Inventory unit changed. Review the opening stock before saving.',
    )
  const quantity = number(input.quantity, 'Opening stock quantity', 0.000001)
  const value = number(input.value, 'Opening stock value')
  if (input.value === '' || input.value == null)
    throw new Error(
      'Enter the opening stock value; enter zero only for stock with no cost.',
    )
  const id = `opening-${input.operationId}`
  const fingerprint = JSON.stringify([
    item.id,
    quantity,
    unit,
    value,
    input.date,
  ])
  const previous = ledger.find((l) => l.id === id)
  if (previous) {
    if (previous.openingFingerprint !== fingerprint)
      throw new Error(
        'This opening-stock operation was already used for different values.',
      )
    return { replay: true as const, previous }
  }
  if (
    item.openingStockRecorded ||
    Number(item.quantity) !== 0 ||
    ledger.some((l) => l.ingredientId === item.id)
  )
    throw new Error(
      'Stock history already exists. Use a stock count or adjustment instead of another opening entry.',
    )
  const normalized = convert(quantity, unit, item.unit, item.conversions)
  if (!(normalized > 0))
    throw new Error('Opening stock must be greater than zero.')
  return {
    replay: false as const,
    item: {
      ...item,
      quantity: normalized,
      cost: value / normalized,
      openingStockRecorded: true,
    },
    ledger: {
      id,
      name: `${item.name} opening stock`,
      ingredientId: item.id,
      quantity: normalized,
      unit: item.unit,
      amount: value,
      type: 'opening_balance',
      reason: 'Opening stock already owned',
      date: input.date,
      openingCount: quantity,
      openingCountUnit: unit,
      openingFingerprint: fingerprint,
    },
    journal:
      value > 0
        ? {
            id: `journal-${id}`,
            name: `Opening stock: ${item.name}`,
            sourceId: id,
            date: input.date,
            status: 'posted',
            lines: [
              { account: 'Inventory asset', debit: value, credit: 0 },
              { account: 'Owner equity', debit: 0, credit: value },
            ],
          }
        : null,
  }
}
