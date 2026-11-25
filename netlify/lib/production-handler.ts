import { createHash } from 'node:crypto'
import { basketAllocationIssues, basketProduction, basketSources } from '../../src/lib/basket-production'
import { basketChecklist, basketChecklistIssues, basketDefinitionChanged, checklistStages, updatedBasketChecklist, type ChecklistStage } from '../../src/lib/production-checklist'
import { productionOrderInvoices, validateBasketAssignments } from '../../src/lib/production-destinations'
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
import {
  productionRunLines,
  combinedProductionRequirements,
} from '../../src/lib/production-run'
import { workflowOf } from '../../src/lib/product-workflows'
import { finishedMovement } from './product-workflow-handler'
import { planPrepUsage } from '../../src/lib/stock-prep'
import { applyPrepUsage } from './stock-prep-handler'

type Context = {
  state: Workspace
  save: (table: string, item: Item) => Promise<void>
  today: string
  actor: string
  audit: (name: string, detail: string) => Promise<void>
  assertProductAccess?: (product: Item) => void
  authorizePreparedWrite?: (id: string) => void
}
const digest = (data: unknown) =>
  createHash('sha256').update(JSON.stringify(data)).digest('hex')
function productionLink(value: unknown, existing: string | undefined, records: Item[] | undefined, label: string) {
  if (value === undefined || value === existing) return existing
  if (value === '' || value === null) return null
  if (typeof value !== 'string' || !records?.some((record) => record.id === value))
    throw new Error(`Choose an existing ${label} from this business.`)
  return value
}
async function handleSingleProduction(
  action: string,
  table: string,
  data: Item,
  ctx: Context,
) {
  if (
    ![
      'productionSave',
      'productionComplete',
      'productionCancel',
      'productionReverse',
    ].includes(action)
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
  if (action === 'productionReverse') {
    if (
      !existing ||
      existing.status !== 'completed' ||
      existing.definition?.product?.workflow !== 'handmade'
    )
      throw new Error('Choose a completed handmade production run.')
    if (existing.usage?.some((line: Item) => line.prepLotId))
      throw new Error('This run used prepared stock. Review the linked stock correction before reversing it.')
    const reversalId = 'production-reversal-' + existing.id
    if (state.ledger.some((l) => l.id === reversalId)) return true
    const reason = String(data.reason || '').trim()
    if (!reason) throw new Error('Explain the reversal before posting it.')
    const p = state.products.find((p) => p.id === existing.productId)
    if (
      !p ||
      Number(p.quantity) < existing.actualYield ||
      p.stockCostKnown !== true
    )
      throw new Error('Finished output is unavailable for reversal.')
    if (
      state.ledger.some(
        (l) =>
          l.productId === p.id &&
          Number(l.quantity) < 0 &&
          String(l.occurredAt || '') >= existing.completedAt,
      )
    )
      throw new Error(
        'Finished units moved after this run. Resolve downstream sales/usage before a production correction; automatic disassembly is unavailable.',
      )
    const remaining = Number(p.quantity) - existing.actualYield
    const remainingValue =
      Number(p.quantity) * Number(p.cost) - existing.historicalCost
    if (remainingValue < -0.000001)
      throw new Error('Inventory valuation needs review before reversal.')
    await finishedMovement(
      ctx,
      p,
      reversalId,
      -existing.actualYield,
      -existing.historicalCost,
      {
        type: 'production_reversal',
        sourceId: existing.id,
        batchId: existing.id,
        reason,
      },
    )
    p.cost = remaining > 0 ? Math.max(0, remainingValue) / remaining : 0
    await save('products', p)
    for (const line of existing.usage) {
      if (!line.tracked || line.kind !== 'ingredient') continue
      const i = state.ingredients.find((i) => i.id === line.itemId)
      if (!i || i.unit !== line.unit)
        throw new Error(
          'Material stock unit changed; review the correction with your accountant.',
        )
      const quantity = Number(i.quantity) + line.quantity
      i.cost = (Number(i.quantity) * Number(i.cost) + line.cost) / quantity
      i.currentCost = i.cost
      i.quantity = quantity
      await save('ingredients', i)
      await save('ledger', {
        id: reversalId + '-' + i.id,
        name: i.name,
        ingredientId: i.id,
        quantity: line.quantity,
        amount: line.cost,
        unit: i.unit,
        type: 'production_reversal',
        sourceId: existing.id,
        batchId: existing.id,
        date: ctx.today,
        reason,
      })
    }
    const original = state.journals.find(
      (j) => j.id === 'production-journal-' + existing.id,
    )
    if (original)
      await save('journals', {
        id: reversalId,
        name: existing.name + ' production reversal',
        sourceId: existing.id,
        status: 'posted',
        date: ctx.today,
        lines: original.lines.map((l: Item) => ({
          ...l,
          debit: l.credit,
          credit: l.debit,
        })),
      })
    await ctx.audit(
      'Handmade production reversed',
      existing.name + ': ' + reason,
    )
    return true
  }
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
    if (!product || product.archived)
      throw new Error('Choose an active product from this oven.')
    if (!existing && workflowOf(product) === 'kit')
      throw new Error('Save a basket from the production board to review its checklist before starting.')
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
    if (current.needsCostSetup || current.cost == null || current.cost === '')
      throw new Error(`${i.name}: stock cost is incomplete.`)
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
    product.workflow === 'handmade' &&
    Number(product.quantity || 0) > 0 &&
    product.stockCostKnown !== true
  )
    throw new Error(
      'Existing finished inventory cost needs review before blending new production.',
    )
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
    packagingCost = 0,
    suppliesCost = 0
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
    const prepared = line.tracked && line.kind === 'ingredient'
      ? planPrepUsage(item, state.lots, quantity, data.prepSources?.[item.id], line.source.prepared)
      : undefined
    const unitCost = prepared?.unitCost ?? number(item.cost, 'Stock unit cost')
    const amount = prepared?.cost ?? quantity * unitCost
    const supplyAmount = Number(line.supplyQuantity || 0) * unitCost
    const hasAllocations = ['supplyQuantity', 'packagingQuantity', 'ingredientQuantity'].some(key => Object.hasOwn(line, key))
    const packageAmount =
      (hasAllocations ? Number(line.packagingQuantity || 0) : line.kind === 'ingredient' && item.usedAs === 'packaging' ? quantity : 0) * unitCost
    suppliesCost += supplyAmount
    packagingCost += packageAmount
    ingredient += amount - supplyAmount - packageAmount
    const movementId = `production-${existing.id}-${line.id}`
    const actualLine = {
      ...line,
      materialWaste: data.materialWaste?.[line.itemId] || 0,
      actualUsed: data.usage?.[line.itemId],
      enteredQuantity: line.quantity,
      enteredUnit: line.unit,
      quantity,
      unit: line.kind === 'product' ? 'package' : item.unit,
      unitCost,
      cost: amount,
      ...(prepared?.lot ? { prepLotId: prepared.lot.id, prepLocation: prepared.lot.location } : {}),
    }
    usage.push(actualLine)
    await save('batch_usage', {
      ...actualLine,
      id: movementId,
      batchId: existing.id,
      ingredientId: line.kind === 'ingredient' ? line.itemId : undefined,
      productId: line.kind === 'product' ? line.itemId : undefined,
      unitCost,
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
      if (prepared) await applyPrepUsage(ctx, item, prepared)
      else {
        item.quantity = Math.max(0, item.quantity - quantity)
        await save('ingredients', item)
      }
      await save('ledger', {
        id: movementId,
        name: item.name,
        ingredientId: item.id,
        quantity: -quantity,
        unit: item.unit,
        amount: -amount,
        type: 'batch_consumption',
        ...(prepared?.lot ? { prepLotId: prepared.lot.id, location: prepared.lot.location } : {}),
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
    ingredient +
    suppliesCost +
    packagingCost +
    flatPackaging +
    c.labor +
    c.overhead +
    c.waste
  const snapshot = {
    lines: usage,
    ingredient,
    suppliesCost,
    supplies: usage
      .filter((line) => Number(line.supplyQuantity) > 0)
      .map((line) => ({
        ...line,
        quantity: line.supplyQuantity,
        cost: line.supplyQuantity * line.unitCost,
      })),
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

/** Product lines share the enclosing workspace transaction and tenant lock. The
 * established single-product engine retains all unit, stock and costing rules. */
export async function handleProduction(
  action: string,
  table: string,
  data: Item,
  ctx: Context,
) {
  const existing = ctx.state.batches.find((b) => b.id === data.id)
  if (!Array.isArray(data.lines) && existing?.productionVersion !== 2)
    return handleSingleProduction(action, table, data, ctx)
  if (
    ![
      'productionSave',
      'productionComplete',
      'productionCancel',
      'productionReverse',
      'productionRecordActuals',
      'productionChecklist',
    ].includes(action)
  )
    return false
  if (table !== 'batches' || !/^[a-zA-Z0-9_-]{8,100}$/.test(data.id || ''))
    throw new Error('A stable production run ID is required.')
  if (existing && !existing.productionVersion)
    throw new Error('Use the original workflow for this legacy recipe run.')
  const revision = Number(existing?.revision || 0)
  const planHash = action === 'productionSave' && data.planContents === true ? digest(data) : undefined
  if (planHash && existing?.basketPlanHash === planHash && revision === Number(data.expectedRevision) + 1) return true
  const completionHash = digest(['finalize', data.expectedRevision])
  if (action === 'productionComplete' && existing?.status === 'completed') {
    if (existing.completionHash === completionHash) return true
    throw new Error(
      'This run is finalized. Reopen it to view its recorded output.',
    )
  }
  if (action === 'productionReverse') {
    if (
      !existing ||
      existing.status !== 'completed' ||
      productionRunLines(existing).some(
        (l) => l.definition?.product?.workflow !== 'handmade',
      )
    )
      throw new Error(
        'Automatic reversal supports handmade-only runs. Food or mixed runs require separately linked authorized stock corrections.',
      )
    for (const line of productionRunLines(existing)) {
      const childId = 'line-' + digest([existing.id, line.id]).slice(0, 40)
      const child = {
        ...line,
        id: childId,
        completedAt: existing.completedAt,
        status: 'completed',
        productionVersion: 1,
      }
      await handleSingleProduction(
        action,
        table,
        { ...data, id: childId },
        {
          ...ctx,
          state: { ...ctx.state, batches: [...ctx.state.batches, child] },
          save: async (target, item) =>
            ctx.save(target, {
              ...item,
              ...(['ledger', 'batch_usage'].includes(target)
                ? { batchId: existing.id, productionLineId: line.id }
                : {}),
              ...(['ledger', 'journals'].includes(target)
                ? { sourceId: existing.id, productionLineId: line.id }
                : {}),
            }),
        },
      )
    }
    await ctx.audit('Production reversed', existing.name + ': ' + data.reason)
    return true
  }
  if (existing && ['completed', 'canceled'].includes(existing.status)) {
    if (action === 'productionCancel' && existing.status === 'canceled')
      return true
    throw new Error('Finalized or cancelled runs are read-only.')
  }
  if (existing && data.expectedRevision !== revision)
    throw new Error(
      'This run changed in another session. Close and reopen it before saving; your changes have not overwritten it.',
    )
  if (action === 'productionChecklist') {
    if (!existing || !checklistStages.includes(data.stage)) throw new Error('Choose a saved basket and checklist stage.')
    const stage = data.stage as ChecklistStage
    if (stage !== 'reviewed' && existing.status !== 'scheduled') throw new Error('Start the basket before recording assembly progress.')
    const lines = productionRunLines(existing)
    const line = lines.find((entry) => entry.id === data.lineId)
    if (!line) throw new Error('Reopen this basket before saving the checklist.')
    const product = ctx.state.products.find((entry) => entry.id === line.productId && !entry.archived)
    if (!product || workflowOf(product) !== 'kit') throw new Error('Choose an active basket.')
    ctx.assertProductAccess?.(product)
    const entry = basketChecklist(line, ctx.state, stage).find((item) => item.key === data.key)
    if (!entry || entry.signature !== data.signature) throw new Error('The requirements changed. Reopen the checklist and review the quantities.')
    if (data.checked === true && stage !== 'reviewed' && entry.available + 1e-8 < entry.required)
      throw new Error(`${entry.name}: ${entry.required - entry.available} ${entry.unit} still needed. Record partial progress instead.`)
    const quantity = data.checked === true ? entry.required : number(data.quantity ?? 0, 'Checklist quantity')
    if (quantity > entry.required || (!entry.supply && !Number.isSafeInteger(quantity))) throw new Error('Enter an actual quantity from zero up to the required amount (whole packages for products).')
    line.checklist = { ...line.checklist, [stage]: { ...line.checklist?.[stage], [entry.key]: { signature: entry.signature, quantity, checked: data.checked === true } } }
    await ctx.save('batches', { ...existing, lines, revision: revision + 1 })
    return true
  }
  if (action === 'productionRecordActuals') {
    if (!existing || !Array.isArray(data.lines))
      throw new Error('Choose a saved production run.')
    if (existing.status !== 'scheduled') throw new Error('Start the run before recording output.')
    const lines = productionRunLines(existing).map((line) => {
      const input = data.lines.find((l: Item) => l.id === line.id)
      if (!input) throw new Error('Reopen this run before recording actuals.')
      return {
        ...line,
        output: input.output,
        waste: input.waste,
        wasteReason: input.wasteReason,
        laborMinutes: input.laborMinutes,
        usage: input.usage,
        prepSources: input.prepSources,
        materialWaste: input.materialWaste,
      }
    })
    return handleProduction(
      'productionSave',
      table,
      { ...existing, lines, expectedRevision: revision },
      ctx,
    )
  }
  if (action === 'productionCancel') {
    if (!existing) throw new Error('Run unavailable.')
    await ctx.save('batches', {
      ...existing,
      status: 'canceled',
      auditTrail: [
        ...(existing.auditTrail || []),
        { event: 'Cancelled', actor: ctx.actor, at: new Date().toISOString() },
      ],
      revision: revision + 1,
    })
    await ctx.audit('Production cancelled', existing.name)
    return true
  }
  if (action === 'productionSave') {
    if (!['draft', 'scheduled'].includes(data.status))
      throw new Error('Choose Save draft or Start run.')
    if (existing?.status === 'scheduled' && data.status === 'draft')
      throw new Error('Started runs cannot return to Planned.')
    if (
      !Array.isArray(data.lines) ||
      !data.lines.length ||
      data.lines.length > 100
    )
      throw new Error('Add between one and 100 products.')
    const ids = new Set<string>()
    const lines = data.lines.map((input: Item) => {
      if (!/^[a-zA-Z0-9_-]{8,100}$/.test(input.id) || ids.has(input.id))
        throw new Error(
          'Each product line needs a unique reference. Reopen the run.',
        )
      ids.add(input.id)
      const product = ctx.state.products.find(
        (p) => p.id === input.productId && !p.archived,
      )
      if (!product)
        throw new Error('Choose an active product from this business.')
      if (!['food', 'handmade', 'kit'].includes(workflowOf(product)))
        throw new Error(
          'Receive resale products through stock receipts; they cannot be manufactured.',
        )
      ctx.assertProductAccess?.(product)
      const quantity = number(input.quantity, 'Planned selling packages', 1)
      if (!Number.isInteger(quantity))
        throw new Error('Use whole selling packages.')
      const prior = productionRunLines(existing).find((l) => l.id === input.id)
      const sameSetup =
        prior?.productId === input.productId &&
        digest(prior?.mapping || {}) === digest(input.mapping || {})
      let definition = sameSetup && workflowOf(product) !== 'kit' ? prior?.definition : undefined
      // Drafts can retain incomplete setup. Starting/finalizing requires a valid definition.
      if (!definition) {
        try {
          definition = productionDefinition(
            product,
            ctx.state,
            input.mapping || {},
          )
        } catch (e) {
          if (data.status !== 'draft') throw e
        }
      }
      if (prior?.basketPlan && data.planContents !== true && (quantity !== prior.quantity || !definition || basketDefinitionChanged(prior, definition, ctx.state)))
        throw new Error('Preview and save basket contents and component work before recording output or starting.')
      const actual = {
        id: input.id,
        name: product.name,
        ...(input.output !== '' && input.output != null
          ? { output: number(input.output, 'Actual good output', 1) }
          : {}),
        waste: number(input.waste || 0, 'Rejected output'),
        wasteReason: String(input.wasteReason || '').slice(0, 2000),
        ...(input.laborMinutes !== '' && input.laborMinutes != null
          ? { laborMinutes: number(input.laborMinutes, 'Actual labor minutes') }
          : {}),
        usage: input.usage || {},
        prepSources: input.prepSources || {},
        materialWaste: input.materialWaste || {},
      }
      if (definition)
        productionRequirements(definition, quantity, actual as Item)
      return {
        productId: product.id,
        quantity,
        mapping: input.mapping || {},
        definition,
        checklist: updatedBasketChecklist({ productId: product.id, quantity, definition, ...actual }, sameSetup ? prior : undefined, ctx.state),
        basketAssignments: validateBasketAssignments({ ...input, basketAssignments: input.basketAssignments ?? prior?.basketAssignments }, quantity, data.id, ctx.state),
        ...actual,
        note: String(input.note || '').slice(0, 2000),
        ...(workflowOf(product) === 'kit' && (prior?.basketPlan || data.planContents === true) ? { basketParentId: data.id, basketPlan: data.planContents === true ? input.basketPlan || {} : prior?.basketPlan } : {}),
      }
    })
    const managedBasket = lines.find((line) => line.basketPlan)
    if (managedBasket && (lines.length !== 1 || !managedBasket.definition))
      throw new Error('Plan each basket in its own run with valid contents and packaging.')
    if (managedBasket && data.planContents === true) {
      const rows = basketProduction(managedBasket, ctx.state, data.id)
      managedBasket.basketPlan = Object.fromEntries(rows.map((row) => {
        if (!Number.isSafeInteger(row.required) || row.required < 1)
          throw new Error(`${row.name}: choose a basket count with a valid whole-package requirement.`)
        if (!Number.isSafeInteger(row.allocated) || row.allocated < 0 || row.allocated > row.eligible || row.allocated > Math.max(0, row.required - row.pending - row.posted))
          throw new Error(`${row.name}: allocate whole packages within the remaining demand and ${row.eligible} eligible on hand. Existing linked runs are not resized.`)
        const choice = row.choice
        return [row.component.productId, { stock: row.allocated, wholeBatch: choice.wholeBatch === true, useExistingRun: choice.useExistingRun === true }]
      }))
    }
    if (productionRunLines(existing).some((line) => line.basketPlan) && !managedBasket)
      throw new Error('A linked basket cannot be replaced. Cancel the parent and create a new plan; its component work remains.')
    if ((ctx.state.event_batch_links || []).some((link) => link.recordId === data.id && link.allocations?.some((allocation: Item) => !lines.some((line) => line.id === allocation.lineId && line.productId === allocation.productId))))
      throw new Error('Remove the market allocation before removing or replacing its product line.')
    if (data.status === 'scheduled' && existing?.status !== 'scheduled') {
      const issues = basketChecklistIssues(lines, ctx.state, ['reviewed'])
      if (issues.length) throw new Error(`Review the basket contents on the board before starting: ${issues.join(' ')}`)
    }
    for (const line of lines) {
      try {
        const estimate = combinedProductionRequirements(
          [
            {
              ...line,
              output: undefined,
              waste: 0,
              usage: {},
              materialWaste: {},
              laborMinutes: undefined,
            },
          ],
          ctx.state,
        )
        Object.assign(line, {
          estimatedCost: estimate.costKnown ? estimate.total : null,
        })
      } catch {
        Object.assign(line, { estimatedCost: null })
      }
    }
    const first = lines[0]
    const legacyRunId = existing?.legacyRunId || data.legacyRunId
    const legacy = legacyRunId
      ? ctx.state.batches.find((b) => b.id === legacyRunId)
      : undefined
    if (
      legacyRunId &&
      (!legacy ||
        legacy.productionVersion ||
        (['completed', 'canceled'].includes(legacy.status) &&
          legacy.replacementRunId !== data.id))
    )
      throw new Error(
        'The original recipe plan is unavailable or already closed.',
      )
    const record = {
      ...existing,
      id: data.id,
      name: String(data.name || 'Production run').slice(0, 200),
      estimatedCost: lines.every((l: Item) => l.estimatedCost != null)
        ? lines.reduce((sum: number, l: Item) => sum + l.estimatedCost, 0)
        : null,
      auditTrail: [
        ...(existing?.auditTrail || []),
        {
          event:
            data.status === 'scheduled' ? 'Saved in progress' : 'Saved draft',
          actor: ctx.actor,
          at: new Date().toISOString(),
          revision: revision + 1,
        },
      ],
      productionVersion: 2,
      revision: revision + 1,
      lines,
      basketPlanHash: planHash,
      legacyRunId,
      productId: first.productId,
      recipeId: first.definition?.recipe?.id || null,
      quantity: lines.reduce((sum: number, l: Item) => sum + l.quantity, 0),
      kind: lines.every((line) => line.definition?.product?.workflow === 'kit') ? 'assembly' : 'manufacture',
      status: data.status,
      date: validateDate(data.date || ctx.today),
      dueDate: data.dueDate === undefined ? existing?.dueDate : data.dueDate ? validateDate(data.dueDate) : null,
      eventId: productionLink(data.eventId, existing?.eventId, ctx.state.events, 'market or event'),
      orderId: productionLink(data.orderId, existing?.orderId, productionOrderInvoices(ctx.state).filter((invoice) => !invoice.reversedBy), 'customer order invoice'),
      note: String(data.note || '').slice(0, 2000),
      costingPolicy:
        'Per-line existing recipe/BOM allocations; no additional shared run charges',
    } as Item
    const plannedState = { ...ctx.state, batches: [...ctx.state.batches.filter((run) => run.id !== record.id), record] }
    for (const [targetId, productId] of new Map<string, [string, string]>(lines.flatMap((line) =>
      (line.basketAssignments || []).map((assignment) => [`${assignment.runId}:${line.productId}`, [assignment.runId, line.productId]] as const),
    )).values()) {
      const basket = ctx.state.batches.find((run) => run.id === targetId && ['draft', 'scheduled'].includes(run.status))
      const parentLine = productionRunLines(basket).find((line) => line.basketPlan)
      if (!parentLine) continue
      const row = basketProduction(parentLine, plannedState, targetId).find((entry) => entry.component.productId === productId)
      const priorCoverage = basketSources(ctx.state, targetId, productId).reduce((total, source) => total + source.pending + source.posted, 0)
      if (record.orderId && (record.orderId !== existing?.orderId || (row && row.pending + row.posted > priorCoverage)))
        throw new Error('Use a separate run for order-linked output or remove its basket assignments before linking the order.')
      if (row && row.pending + row.posted > priorCoverage && row.allocated + row.pending + row.posted > row.required)
        throw new Error(`${row.name}: linked runs exceed this basket’s unmet demand.`)
    }
    await ctx.save('batches', record)
    if (managedBasket && data.planContents === true) {
      const state = plannedState
      for (const row of basketProduction(managedBasket, state, record.id)) {
        if (!row.candidate || row.choice.useExistingRun) continue
        const childId = 'basket-work-' + digest([record.id, revision, row.component.productId]).slice(0, 40)
        await handleProduction('productionSave', 'batches', {
          id: childId,
          name: row.name,
          date: record.date,
          dueDate: record.dueDate,
          eventId: record.eventId,
          status: 'draft',
          expectedRevision: 0,
          lines: [{ ...row.candidate, id: `${childId}-line`, basketAssignments: [{ runId: record.id, quantity: row.unplanned }] }],
        } as Item, { ...ctx, state })
      }
    }
    if (data.status === 'scheduled' && legacy && legacy.status !== 'canceled') {
      await ctx.save('batches', {
        ...legacy,
        status: 'canceled',
        replacementRunId: data.id,
      })
      await ctx.audit('Legacy plan replaced', legacy.name)
    }
    await ctx.audit(
      'Production saved',
      `${data.name || 'Production run'}: ${data.status}; ${lines.length} products; revision ${revision + 1}`,
    )
    return true
  }
  if (!existing) throw new Error('Save this run before finalizing.')
  if (existing.status !== 'scheduled') throw new Error('Start the run before finalizing production.')
  const lines = productionRunLines(existing)
  for (const line of lines) {
    const currentProduct = ctx.state.products.find(
      (p) => p.id === line.productId,
    )
    if (!currentProduct) throw new Error('Output product unavailable.')
    if (
      currentProduct.archived ||
      workflowOf(currentProduct) !==
        workflowOf(line.definition?.product || currentProduct)
    )
      throw new Error(
        `${currentProduct.name}: product setup changed. Review this line before finalizing.`,
      )
    ctx.assertProductAccess?.(currentProduct)
    if (workflowOf(currentProduct) === 'kit') {
      const current = productionDefinition(currentProduct, ctx.state, line.mapping || {})
      if (basketDefinitionChanged(line, current, ctx.state))
        throw new Error(`${line.name}: basket contents or packaging changed. Save the updated plan and review the affected checklist lines before finalizing.`)
    }
    if (!line.definition)
      throw new Error(
        `${line.name}: complete the recipe/BOM setup before finalizing.`,
      )
    if (line.output == null || line.output === '')
      throw new Error(
        `${line.name}: record actual good output before finalizing.`,
      )
  }
  const checklistIssues = basketChecklistIssues(lines, ctx.state, checklistStages)
  if (checklistIssues.length) throw new Error(`Finish the basket checklists before finalizing: ${checklistIssues.join(' ')}`)
  const allocationIssues = basketAllocationIssues(lines, ctx.state, existing.id)
  if (allocationIssues.length) throw new Error(allocationIssues.join(' '))
  // Check the aggregate against current stock before applying any product line.
  combinedProductionRequirements(lines, ctx.state, true)
  const completed: Item[] = []
  for (const line of lines) {
    const childId = 'line-' + digest([existing.id, line.id]).slice(0, 40)
    const child = {
      ...existing,
      ...line,
      id: childId,
      productionVersion: 1,
      status: 'scheduled',
      lines: undefined,
    }
    const childState = { ...ctx.state, batches: [...ctx.state.batches, child] }
    await handleSingleProduction(
      'productionComplete',
      'batches',
      { ...line, id: childId } as Item,
      {
        ...ctx,
        state: childState,
        save: async (target, item) => {
          if (target === 'batches') {
            completed.push({
              ...line,
              ...item,
              id: line.id,
              runId: existing.id,
              lines: undefined,
            })
            return
          }
          await ctx.save(target, {
            ...item,
            ...(['batch_usage', 'ledger'].includes(target)
              ? { batchId: existing.id, productionLineId: line.id }
              : {}),
            ...(['ledger', 'journals'].includes(target)
              ? { sourceId: existing.id, productionLineId: line.id }
              : {}),
          })
        },
      },
    )
  }
  await ctx.save('batches', {
    ...existing,
    lines: completed,
    status: 'completed',
    completionHash,
    revision: revision + 1,
    completedAt: new Date().toISOString(),
    finalizedBy: ctx.actor,
    auditTrail: [
      ...(existing.auditTrail || []),
      {
        event: 'Finalized',
        actor: ctx.actor,
        at: new Date().toISOString(),
        revision: revision + 1,
      },
    ],
    historicalCost: completed.reduce((sum, l) => sum + l.historicalCost, 0),
    actualYield: completed.reduce((sum, l) => sum + l.actualYield, 0),
    usage: completed.flatMap((l) =>
      l.usage.map((u: Item) => ({ ...u, productionLineId: l.id })),
    ),
  })
  await ctx.audit(
    'Production finalized',
    `${existing.name}: ${lines.length} products; all stock and costs posted`,
  )
  return true
}
