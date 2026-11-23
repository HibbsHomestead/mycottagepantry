import { createHash } from 'node:crypto'
import type { Item, Workspace } from '../../src/lib/domain'
import {
  activePrepLots,
  planPrepUsage,
  planStockPrep,
  prepReviewKey,
  prepStockBalance,
} from '../../src/lib/stock-prep'

type StockContext = {
  state: Workspace
  save: (table: string, item: Item) => Promise<void>
  authorizePreparedWrite?: (id: string) => void
}
type PrepContext = StockContext & {
  today: string
  audit: (name: string, detail: string) => Promise<void>
}
const digest = (data: unknown) =>
  createHash('sha256').update(JSON.stringify(data)).digest('hex')

export async function applyPrepUsage(
  ctx: StockContext,
  i: Item,
  usage: NonNullable<ReturnType<typeof planPrepUsage>>,
) {
  if (usage.lot) {
    await ctx.save('lots', usage.lot)
    Object.assign(
      ctx.state.lots.find((l) => l.id === usage.lot?.id)!,
      usage.lot,
    )
  }
  i.quantity = usage.remaining
  i.cost = usage.remainingCost
  ctx.authorizePreparedWrite?.(i.id)
  await ctx.save('ingredients', i)
}

export async function handleStockPrep(
  action: string,
  data: Item,
  ctx: PrepContext,
) {
  const { state, save, today, audit } = ctx
  if (
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(
      data.operationId || '',
    )
  )
    throw new Error('Reopen the prep form to get a new reference.')
  const i = state.ingredients.find((item) => item.id === data.id)
  if (!i) throw new Error('Choose an ingredient from this business.')
  const posting = action === 'stockPrepPost'
  const lotId = posting ? `prep-${data.operationId}` : String(data.lotId || '')
  const lot = state.lots.find(
    (l) =>
      l.id === lotId && l.kind === 'ingredient_prep' && l.ingredientId === i.id,
  )
  const requestHash = digest(data)
  const key = `${posting ? 'prep' : 'prep-reverse'}-movement-${data.operationId}`
  const prior = state.ledger.find((l) => l.id === key)
  if (prior) {
    if (prior.ingredientId !== i.id || prior.requestHash !== requestHash)
      throw new Error(
        'This prep reference was already used for different details. Reopen the form.',
      )
    return
  }
  const move = (
    id: string,
    type: string,
    quantity: number,
    amount: number,
    date: string,
    reason: string,
    details = {},
  ) =>
    save('ledger', {
      id,
      name: i.name,
      type,
      ingredientId: i.id,
      sourceId: lotId,
      prepLotId: lotId,
      quantity,
      amount,
      unit: i.unit,
      date,
      reason,
      requestHash,
      ...details,
    })
  if (posting) {
    if (lot) throw new Error('This prep reference is already in use.')
    const p = planStockPrep(i, state.lots, data, today)
    if (data.review !== prepReviewKey(p))
      throw new Error(
        'Stock or prep details changed since review. Refresh the ingredient and review the movement again.',
      )
    await move(
      key,
      'prep_source',
      -p.usable,
      -p.carriedCost,
      p.date,
      p.method,
      { location: i.storageLocation || '' },
    )
    if (p.loss)
      await move(`${key}-loss`, 'prep_loss', -p.loss, 0, p.date, p.lossReason)
    await move(
      `${key}-output`,
      'prep_output',
      p.usable,
      p.carriedCost,
      p.date,
      p.method,
      { location: p.location },
    )
    const record: Item = {
      ...p,
      before: undefined,
      remaining: undefined,
      totalAfter: undefined,
      id: lotId,
      name: p.method,
      kind: 'ingredient_prep',
      ingredientId: i.id,
      quantity: p.usable,
    }
    await save('lots', record)
    state.lots.push(record)
    i.quantity = p.totalAfter
    i.cost = p.before.value / p.totalAfter
    ctx.authorizePreparedWrite?.(i.id)
    await save('ingredients', i)
    await audit(
      'Ingredient stock prepared',
      `${i.name}: ${p.portions} portions stored in ${p.location}.`,
    )
  } else {
    const reason = String(data.reason || '').trim()
    if (!reason || reason.length > 200 || data.confirmPhysicalStock !== true)
      throw new Error(
        'Enter a reason and confirm that the original usable stock physically exists.',
      )
    if (
      !lot ||
      lot.reversedAt ||
      lot.unit !== i.unit ||
      lot.usedInProduction ||
      lot.quantity !== lot.usable ||
      !activePrepLots(state.lots, i.id).some((l) => l.id === lot.id)
    ) {
      throw new Error(
        'Only untouched, unreversed prep can be reversed. Some of this stock was used or is no longer available.',
      )
    }
    const balance = prepStockBalance(i, state.lots)
    await move(
      key,
      'prep_reverse_output',
      -lot.usable,
      -lot.carriedCost,
      today,
      reason,
      { location: lot.location },
    )
    await move(
      `${key}-source`,
      'prep_reverse_source',
      lot.usable,
      lot.carriedCost,
      today,
      reason,
    )
    if (lot.loss)
      await move(`${key}-loss`, 'prep_reverse_loss', lot.loss, 0, today, reason)
    const reversed = {
      ...lot,
      quantity: 0,
      balances: lot.balances.map(() => 0),
      reversedAt: new Date().toISOString(),
      reversalReason: reason,
    }
    await save('lots', reversed)
    Object.assign(lot, reversed)
    i.quantity = Math.round((balance.quantity + Number(lot.loss)) * 1e8) / 1e8
    i.cost = balance.value / i.quantity
    ctx.authorizePreparedWrite?.(i.id)
    await save('ingredients', i)
    await audit('Ingredient prep reversed', `${i.name}: ${reason}`)
  }
}
