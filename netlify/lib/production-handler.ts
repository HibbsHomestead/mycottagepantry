import { createHash } from 'node:crypto'
import {
  convert,
  number,
  roundMoney,
  validateDate,
  type Item,
  type Workspace,
} from '../../src/lib/domain'
import {
  productionDefinition,
  productionRequirements,
  productionYieldConvert,
} from '../../src/lib/production'
import { finishedMovement } from './product-workflow-handler'

type Context = {
  state: Workspace
  save: (table: string, item: Item) => Promise<void>
  today: string
  actor: string
  audit: (name: string, detail: string) => Promise<void>
}
const digest = (data: unknown) =>
  createHash('sha256').update(JSON.stringify(data)).digest('hex')
export async function handleProduction(
  action: string,
  table: string,
  data: Item,
  ctx: Context,
) {
  if (
    !['productionSave', 'productionComplete', 'productionCancel'].includes(
      action,
    )
  )
    return false
  if (table !== 'batches' || !/^[a-zA-Z0-9_-]{8,100}$/.test(data.id || ''))
    throw new Error('A stable production run ID is required.')
  const { state, save } = ctx
  const existing = state.batches.find((b) => b.id === data.id)
  if (existing && !existing.productionVersion)
    throw new Error(
      'Legacy runs retain their original workflow. Create a new product run separately.',
    )
  if (action === 'productionSave') {
    const hash = digest([
      data.productId,
      data.quantity,
      data.mapping,
      data.date,
      data.note,
      data.status,
      data.legacyRunId,
    ])
    if (existing?.saveHash === hash) return true
    if (existing && existing.status !== 'draft')
      throw new Error(
        'Only drafts can be changed. Cancel an uncompleted plan and create a new run.',
      )
    const product = state.products.find((p) => p.id === data.productId)
    if (!product) throw new Error('Choose a product from this oven.')
    const quantity = number(data.quantity, 'Selling packages', 1)
    if (!Number.isInteger(quantity))
      throw new Error('Use whole selling packages.')
    if (!['draft', 'scheduled'].includes(data.status))
      throw new Error('Choose Save draft or Confirm plan.')
    const status = data.status
    const legacyRunId = existing?.legacyRunId || data.legacyRunId
    const legacy = legacyRunId
      ? state.batches.find((b) => b.id === legacyRunId)
      : undefined
    if (
      legacyRunId &&
      (!legacy ||
        legacy.productionVersion ||
        ['completed', 'canceled'].includes(legacy.status))
    )
      throw new Error(
        'The original legacy plan is unavailable or already closed. Review it before creating a replacement.',
      )
    const definition =
      status === 'scheduled'
        ? productionDefinition(product, state, data.mapping || {})
        : null
    if (definition) productionRequirements(definition, quantity)
    await save('batches', {
      id: data.id,
      name: product.name,
      productionVersion: 1,
      legacyRunId,
      productId: product.id,
      recipeId: definition?.recipe?.id || null,
      kind: product.workflow === 'kit' ? 'assembly' : 'manufacture',
      quantity,
      yield: quantity,
      count: definition
        ? productionRequirements(definition, quantity).multiplier
        : 0,
      status,
      mapping: data.mapping,
      definition,
      date: validateDate(data.date || ctx.today),
      note: String(data.note || '').slice(0, 2000),
      saveHash: hash,
    })
    if (status === 'scheduled' && legacy) {
      await save('batches', {
        ...legacy,
        status: 'canceled',
        replacementRunId: data.id,
      })
      await ctx.audit('Legacy plan replaced', legacy.name)
    }
    await ctx.audit('Production saved', `${product.name}: ${status}`)
    return true
  }
  if (!existing) throw new Error('Run unavailable.')
  if (action === 'productionCancel') {
    if (existing.status === 'canceled') return true
    if (existing.status === 'completed')
      throw new Error(
        'Completed runs cannot be canceled or disassembled. Their stock and history are immutable.',
      )
    await save('batches', { ...existing, status: 'canceled' })
    await ctx.audit('Production canceled', existing.name)
    return true
  }
  const hash = digest([
    data.output,
    data.waste,
    data.wasteReason,
    data.laborMinutes,
    data.usage,
    data.wasteCost,
    data.materialWaste,
  ])
  if (existing.status === 'completed') {
    if (existing.completionHash === hash) return true
    throw new Error('Run already completed with different actuals.')
  }
  if (existing.status !== 'scheduled' || !existing.definition)
    throw new Error('Schedule and review this run before completing it.')
  const d = structuredClone(existing.definition)
  d.ingredients = d.ingredients.map((i: Item) => {
    const current = state.ingredients.find((item) => item.id === i.id)
    if (!current) throw new Error(`${i.name}: input unavailable.`)
    return {
      ...i,
      cost:
        number(current.cost, 'Stock cost') *
        convert(1, i.unit, current.unit, current.conversions),
    }
  })
  const product = state.products.find((p) => p.id === existing.productId)
  if (!product) throw new Error('Output product unavailable.')
  if (
    product.foodStockEnabled !== true &&
    !['handmade', 'kit'].includes(product.workflow) &&
    Number(product.quantity || 0) !== 0
  )
    throw new Error(
      'Existing food balance needs review before enabling finished stock. No opening stock is inferred.',
    )
  const basis = d.recipe
    ? { unit: d.recipe.yieldUnit, quantity: d.product.unitsPerPackage }
    : { unit: 'each', quantity: 1 }
  if (
    Number(product.quantity || 0) > 0 &&
    product.stockOutputBasis &&
    Math.abs(
      productionYieldConvert(
        product.stockOutputBasis.quantity,
        product.stockOutputBasis.unit,
        basis.unit,
        d.mapping?.conversions,
      ) - basis.quantity,
    ) > 1e-8
  )
    throw new Error(
      'This package size differs from existing finished stock. Use a separate product.',
    )
  const result = productionRequirements(d, existing.quantity, data)
  const reason = String(data.wasteReason || '').trim()
  if (
    (result.waste > 0 ||
      Number(data.wasteCost) > 0 ||
      Object.values(data.materialWaste || {}).some((q) => Number(q) > 0)) &&
    !reason
  )
    throw new Error('Explain the waste.')
  const usage: Item[] = []
  let ingredient = 0,
    packagingCost = 0
  for (const line of result.requirements) {
    const item = (
      line.kind === 'product' ? state.products : state.ingredients
    ).find((i) => i.id === line.itemId)
    if (!item) throw new Error(`${line.name} is unavailable.`)
    const quantity =
      line.kind === 'product'
        ? line.quantity
        : convert(line.quantity, line.unit, item.unit, item.conversions)
    if (line.kind === 'product' && item.stockCostKnown !== true)
      throw new Error(`${line.name}: produce or receive finished stock first.`)
    if (line.tracked && Number(item.quantity) + 1e-8 < quantity)
      throw new Error(
        `${line.name}: insufficient stock. Produce or receive stock separately.`,
      )
    if (item.needsCostSetup || item.cost == null)
      throw new Error(`${line.name}: stock cost is incomplete.`)
    const amount = quantity * number(item.cost, 'Stock unit cost')
    const isPackaging =
      line.kind === 'ingredient' && item.usedAs === 'packaging'
    if (isPackaging) packagingCost += amount
    else ingredient += amount
    const movementId = `production-${existing.id}-${line.id}`
    const actualLine = {
      ...line,
      materialWaste: data.materialWaste?.[line.itemId] || 0,
      actualUsed: data.usage?.[line.itemId],
      enteredQuantity: line.quantity,
      enteredUnit: line.unit,
      quantity,
      unit: line.kind === 'product' ? 'package' : item.unit,
      unitCost: item.cost,
      cost: amount,
    }
    usage.push(actualLine)
    await save('batch_usage', {
      ...actualLine,
      id: movementId,
      batchId: existing.id,
      ingredientId: line.kind === 'ingredient' ? line.itemId : undefined,
      productId: line.kind === 'product' ? line.itemId : undefined,
      unitCost: item.cost,
      cost: amount,
    })
    if (!line.tracked) continue
    if (line.kind === 'product')
      await finishedMovement(ctx, item, movementId, -line.quantity, -amount, {
        type: 'assembly_consumption',
        batchId: existing.id,
        sourceId: existing.id,
        reason: reason || 'Kit assembly',
      })
    else {
      item.quantity = Math.max(0, item.quantity - quantity)
      await save('ingredients', item)
      await save('ledger', {
        id: movementId,
        name: item.name,
        ingredientId: item.id,
        quantity: -quantity,
        unit: item.unit,
        amount: -amount,
        type: 'batch_consumption',
        batchId: existing.id,
        sourceId: existing.id,
        date: ctx.today,
        reason: reason || 'Product production',
      })
    }
  }
  const c = result.cost
  // Keep configured flat recipe packaging and allocation rules, replacing estimated input costs with actual stock costs.
  const flatPackaging = d.recipe
    ? number(d.recipe.packagingCost || 0, 'Recipe packaging') *
      result.multiplier
    : 0
  const total =
    ingredient + packagingCost + flatPackaging + c.labor + c.overhead + c.waste
  const snapshot = {
    lines: usage,
    ingredient,
    packagingCost: packagingCost + flatPackaging,
    laborMinutes: c.laborMinutes,
    laborRate: c.laborRate,
    labor: c.labor,
    overhead: c.overhead,
    waste: c.waste,
    total,
    actualYield: result.output,
    unitsPerPackage: 1,
    perItem: total / result.output,
    perPackage: total / result.output,
    costingPolicy: 'actual_stock_and_pinned_allocations',
  }
  if (product.workflow !== 'kit' && product.workflow !== 'handmade')
    product.foodStockEnabled = true
  product.stockOutputBasis = basis
  await finishedMovement(
    ctx,
    product,
    `production-output-${existing.id}`,
    result.output,
    total,
    {
      type: 'production_receipt',
      batchId: existing.id,
      sourceId: existing.id,
      reason: 'Completed product production',
    },
  )
  const transferred = roundMoney(
    usage.filter((l) => l.tracked).reduce((sum, l) => sum + l.cost, 0),
  )
  const value = roundMoney(total)
  if (value || transferred)
    await save('journals', {
      id: `production-journal-${existing.id}`,
      name: `${existing.name} production`,
      sourceId: existing.id,
      date: ctx.today,
      status: 'posted',
      lines: [
        { account: 'Inventory asset', debit: value, credit: 0 },
        { account: 'Inventory asset', debit: 0, credit: transferred },
        {
          account: 'Production cost allocation',
          debit: 0,
          credit: roundMoney(value - transferred),
        },
      ],
    })
  await save('batches', {
    ...existing,
    status: 'completed',
    completionHash: hash,
    actualYield: result.output,
    waste: result.waste,
    wasteReason: reason,
    usage,
    historicalCost: total,
    costSnapshot: snapshot,
    completedAt: new Date().toISOString(),
  })
  await ctx.audit(
    'Production completed',
    `${existing.name}: ${result.output} packages`,
  )
  return true
}
