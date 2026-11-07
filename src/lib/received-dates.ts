import { validateDate, type Item } from './domain'
import { ovenToday } from './oven-dates'
export function receivedDateReview(record: Item, settings?: Item) {
  const original =
    record.originalReceivedDate || record.receivedDate || record.date || ''
  const instant = record.addedAt || record.occurredAt
  if (
    record.receivedDate ||
    record.dateCorrection ||
    record.purchaseDate ||
    !instant ||
    original !== instant.slice(0, 10)
  )
    return ''
  const local = ovenToday(settings, new Date(instant))
  return local !== original ? local : ''
}
export function applyReceivedDateCorrections(records: Item[], settings?: Item) {
  return records.map((record) => {
    const correction = (settings?.receivedDateCorrections || [])
      .filter((c: any) => c.ledgerId === record.id)
      .at(-1)
    return correction
      ? {
          ...record,
          originalReceivedDate: record.date,
          receivedDate: correction.receivedDate,
          date: correction.receivedDate,
          dateCorrection: correction,
        }
      : record
  })
}
export function receiveDateCorrection(
  record: Item,
  data: Record<string, any>,
  actor: string,
  at = new Date().toISOString(),
) {
  validateDate(data.receivedDate)
  if (data.confirmed !== true || !String(data.reason || '').trim())
    throw new Error('Approve the received date and enter a correction reason.')
  if (
    record.type !== 'purchase_receipt' ||
    (record.receivedDate || record.date) !== data.expectedDate
  )
    throw new Error(
      'The receipt date changed. Reopen the record before correcting it.',
    )
  return {
    id: data.operationId,
    ledgerId: record.id,
    originalDate: record.originalReceivedDate || record.date,
    previousDate: record.receivedDate || record.date,
    receivedDate: data.receivedDate,
    reason: String(data.reason).slice(0, 1000),
    actor,
    at,
  }
}
