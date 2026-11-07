import { applyProductTemplateDraft } from '../../src/lib/label-preview'
import { libraryArtwork } from '../../src/lib/artwork-library'
import { validateDate } from '../../src/lib/domain'
import { reviewedProductMetadata } from '../../src/lib/inventory-product'
import { createHash, randomUUID } from 'node:crypto'
import {
  number,
  convert,
  costBreakdown,
  productCosting,
  roundMoney,
  type Item,
  type Workspace,
} from '../../src/lib/domain'
import { tracksFinishedStock } from '../../src/lib/product-workflows'
import { checkFabricWidth, fabricConvert, isFabric } from '../../src/lib/fabric'
import { handleFabric } from './fabric-handler'
import {
  conflictMessage,
  preserveStoredProductFields,
  productIdentityConflict,
} from '../../src/lib/product-edit'

type Save = (table: string, item: Item) => Promise<void>
type Context = {
  state: Workspace
  save: Save
  audit: (name: string, detail: string) => Promise<void>
  today: string
  actor: string
}
const required = (value: unknown, label: string) => {
  if (value == null || String(value).trim() === '')
    throw new Error(`${label} is required.`)
  return value
}
const text = (value: unknown, label: string, max = 200) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new Error(`Enter ${label} (up to ${max} characters).`)
  return value.trim()
}
function materialDesign(item: Item, state: Workspace) {
  item.name = text(item.name, 'a design name')
  item.yield = number(
    required(item.yield, 'Design yield'),
    'Design yield',
    0.000001,
  )
  item.laborMinutes = number(
    required(item.laborMinutes, 'Labor minutes'),
    'Labor minutes',
  )
  item.laborRate = number(required(item.laborRate, 'Labor rate'), 'Labor rate')
  item.overhead = number(required(item.overhead, 'Other cost'), 'Other cost')
  item.overheadMode = 'batch'
  item.yieldUnit = 'each'
  item.compound = false
  item.wastePercent = 0
  item.wasteMode = 'percent'
  if (
    !Array.isArray(item.lines) ||
    !item.lines.length ||
    item.lines.length > 100
  )
    throw new Error('Add 1 to 100 material lines.')
  if (
    new Set(item.lines.map((l: Item) => l.ingredientId)).size !==
    item.lines.length
  )
    throw new Error('Combine duplicate material lines.')
  for (const line of item.lines) {
    const input = state.ingredients.find(
      (i) =>
        i.id === line.ingredientId &&
        ['material', 'packaging'].includes(i.usedAs),
    )
    if (!input || input.trackInventory === false)
      throw new Error(
        'Choose tracked craft materials or packaging from this oven.',
      )
    line.quantity = number(line.quantity, 'Material quantity', 0.000001)
    checkFabricWidth(input, line)
    if (isFabric(input))
      fabricConvert(line.quantity, line.unit, input.unit, input)
    else convert(line.quantity, line.unit, input.unit, input.conversions)
  }
  costBreakdown(item, state.ingredients)
  return item
}
async function journal(
  ctx: Context,
  source: string,
  name: string,
  value: number,
  debit: string,
  credit: string,
) {
  const amount = roundMoney(value)
  if (amount <= 0) return
  await ctx.save('journals', {
    id: randomUUID(),
    name,
    sourceId: source,
    date: ctx.today,
    status: 'posted',
    lines: [
      { account: debit, debit: amount, credit: 0 },
      { account: credit, debit: 0, credit: amount },
    ],
  })
}
async function finishedMovement(
  ctx: Context,
  product: Item,
  id: string,
  quantity: number,
  amount: number,
  detail: Record<string, unknown>,
) {
  if (Number(product.quantity || 0) + quantity < -1e-8)
    throw new Error(`Insufficient finished stock for ${product.name}.`)
  const oldQuantity = Number(product.quantity || 0)
  if (quantity > 0)
    product.cost =
      (oldQuantity * Number(product.cost || 0) + amount) /
      (oldQuantity + quantity)
  product.quantity = Math.max(0, oldQuantity + quantity)
  product.stockCostKnown = true
  await ctx.save('products', product)
  await ctx.save('ledger', {
    ...detail,
    id,
    name: product.name,
    productId: product.id,
    quantity,
    unit: 'each',
    amount,
    date: ctx.today,
    actor: ctx.actor,
    occurredAt: new Date().toISOString(),
  })
}
export async function consumeFinishedSale(
  ctx: Context,
  sale: Item,
  product: Item,
) {
  if (!tracksFinishedStock(product)) return false
  const quantity = number(sale.quantity, 'Items sold', 0.000001)
  const cost = number(product.cost || 0, 'Stock basis')
  sale.costSnapshot = {
    perPackage: cost,
    perItem: cost,
    unitsPerPackage: 1,
    workflow: product.workflow,
  }
  sale.historicalCogs = roundMoney(quantity * cost)
  sale.costSource = 'finished_weighted_average'
  sale.stockDeducted = true
  await finishedMovement(
    ctx,
    product,
    'sale-stock-' + sale.id,
    -quantity,
    -quantity * cost,
    {
      type: 'sale',
      sourceId: sale.id,
      reason: 'Recorded product sale',
    },
  )
  await journal(
    ctx,
    sale.id,
    'Finished goods sold: ' + product.name,
    sale.historicalCogs,
    'Finished goods COGS',
    'Inventory asset',
  )
  return true
}
export async function returnFinishedSale(
  ctx: Context,
  original: Item,
  refund: Item,
  restock: unknown,
) {
  if (!original.stockDeducted) return
  if (typeof restock !== 'boolean')
    throw new Error(
      'Choose whether the refunded goods physically return to stock.',
    )
  refund.restock = restock
  if (!restock) {
    refund.historicalCogs = 0
    return
  }
  const product = ctx.state.products.find((p) => p.id === original.productId)
  if (!product || !tracksFinishedStock(product))
    throw new Error('The original stock product is unavailable.')
  const amount = original.quantity * original.costSnapshot.perPackage
  await finishedMovement(
    ctx,
    product,
    'return-stock-' + original.id,
    original.quantity,
    amount,
    {
      type: 'customer_return',
      sourceId: refund.id,
      saleId: original.id,
      reason: 'Full refund with physical return',
    },
  )
  await journal(
    ctx,
    refund.id,
    'Customer return: ' + product.name,
    amount,
    'Inventory asset',
    'Finished goods COGS',
  )
}
export async function handleProductWorkflow(
  action: string,
  table: string,
  data: Item,
  ctx: Context,
): Promise<boolean> {
  const { state, save, audit, today } = ctx
  if (await handleFabric(action, table, data, ctx)) return true
  const existingProduct = state.products.find((p) => p.id === data.id)
  if (action === 'save' && table === 'products') {
    if (existingProduct && data.workflow !== existingProduct.workflow)
      throw new Error(
        'Existing product workflow is preserved. Create a new product; do not reclassify stock or history.',
      )
    if (
      data.workflow &&
      !['food', 'handmade', 'resale'].includes(data.workflow)
    )
      throw new Error('Choose a supported workflow.')
  }
  const existingDesign = state.recipes.find((r) => r.id === data.id)
  if (
    action === 'save' &&
    table === 'recipes' &&
    existingDesign &&
    data.workflow !== existingDesign.workflow
  )
    throw new Error(
      'Existing recipe/design workflow is preserved. Create a separate design.',
    )
  if (
    action === 'save' &&
    table === 'recipes' &&
    data.workflow === 'handmade'
  ) {
    const item = materialDesign({ ...data, id: data.id || randomUUID() }, state)
    await save('recipes', item)
    await audit('Design saved', item.name)
    return true
  }
  if (
    action === 'save' &&
    table === 'products' &&
    ['handmade', 'resale'].includes(data.workflow)
  ) {
    // Editing updates the stored ID in place. Stock, receipts and cost history
    // are copied from the stored record, so saving details never posts stock.
    const base: Item = existingProduct
      ? preserveStoredProductFields(data, existingProduct)
      : { ...data, id: data.id || randomUUID() }
    delete base.inventoryCreation
    const item: Item = {
      ...base,
      name: text(data.name, 'a product name'),
    }
    applyProductTemplateDraft(state, item, existingProduct)
    item.price = number(required(item.price, 'Selling price'), 'Selling price')
    item.threshold = number(item.threshold || 0, 'Reorder threshold')
    item.unitsPerPackage = 1
    item.quantity = existingProduct?.quantity || 0
    item.cost = existingProduct?.cost || 0
    item.stockCostKnown = existingProduct?.stockCostKnown === true
    item.unpacked = true
    item.packagingLines = [] // Packaging is an explicit BOM input; purchased resale is received as sellable items.
    item.targetMargin = number(item.targetMargin ?? 0, 'Target margin')
    if (item.targetMargin >= 100)
      throw new Error('Target margin must be below 100%.')
    for (const key of ['sku', 'barcode', 'variantGroup', 'variant']) {
      if (String(item[key] || '').length > 200)
        throw new Error(
          'SKU, barcode and variant fields allow up to 200 characters.',
        )
      item[key] = String(item[key] || '').trim()
    }
    if (item.supplierId && !state.vendors.some((v) => v.id === item.supplierId))
      throw new Error('Choose a supplier from this oven.')
    // One supplier reference: keep the Add Item vendor fields in step.
    if (item.workflow === 'resale') {
      item.supplierId = item.supplierId || ''
      item.vendorId = item.supplierId
      item.vendor =
        state.vendors.find((v) => v.id === item.supplierId)?.name || ''
    }
    const conflict = productIdentityConflict(
      state.products,
      item,
      existingProduct,
    )
    if (conflict) throw new Error(conflictMessage(conflict))
    for (const key of ['imageAssetId', 'graphicAssetId', 'iconAssetId'])
      if (
        item[key] &&
        !state.graphic_assets.some((a) => a.id === item[key]) &&
        !(key === 'graphicAssetId' && libraryArtwork(item[key]))
      )
        throw new Error('Choose artwork from this oven.')
    if (!existingProduct) {
      item.taxSource = 'category'
      delete item.taxRateIds
      delete item.taxStatus
      delete item.taxAssignments
    }
    if (item.workflow === 'handmade') {
      const design = state.recipes.find(
        (r) => r.id === item.recipeId && r.workflow === 'handmade',
      )
      if (!design) throw new Error('Choose a saved handmade design.')
      productCosting(item, state)
    } else item.recipeId = null
    await save('products', item)
    await audit(
      existingProduct ? 'Product updated' : 'Product saved',
      item.name,
    )
    return true
  }
  if (['receive', 'adjust'].includes(action) && table === 'products') {
    const receivedDate = data.receivedDate || today
    validateDate(receivedDate)
    if (data.purchaseDate) validateDate(data.purchaseDate)
    ctx = { ...ctx, today: receivedDate }
    const product = existingProduct
    if (!product || !tracksFinishedStock(product))
      throw new Error('Choose a tracked handmade or resale product.')
    const operationId = text(data.operationId, 'a stock operation ID', 100)
    if (!/^[a-zA-Z0-9_-]+$/.test(operationId))
      throw new Error('Invalid stock operation ID.')
    const id = 'product-stock-' + operationId
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify([
          action,
          data.id,
          data.quantity,
          data.unit,
          data.itemsPerUnit,
          data.price,
          data.reason,
          data.supplierId,
          data.receivedDate,
          data.purchaseDate,
        ]),
      )
      .digest('hex')
    const previous = state.ledger.find((l) => l.id === id)
    if (previous) {
      if (previous.requestHash !== requestHash)
        throw new Error(
          'Operation ID already used for different values. Open a new stock entry.',
        )
      return true
    }
    const reason = text(data.reason, 'a movement reason', 1000)
    let quantity: number, amount: number
    if (action === 'receive') {
      if (product.workflow !== 'resale')
        throw new Error(
          'Receive handmade finished goods through a production run.',
        )
      const purchaseQuantity = number(
        data.quantity,
        'Purchase quantity',
        0.000001,
      )
      const itemsPerUnit = number(
        data.itemsPerUnit,
        'Items per purchase unit',
        0.000001,
      )
      if (!['each', 'pack', 'case', 'box'].includes(data.unit))
        throw new Error('Choose each, pack, case or box.')
      if (data.unit === 'each' && itemsPerUnit !== 1)
        throw new Error('Each contains one sellable item.')
      quantity = purchaseQuantity * itemsPerUnit
      amount = number(
        required(data.price, 'Total acquisition cost'),
        'Total acquisition cost',
      )
      if (
        data.supplierId &&
        !state.vendors.some((v) => v.id === data.supplierId)
      )
        throw new Error('Choose a supplier from this oven.')
      Object.assign(
        product,
        reviewedProductMetadata(product, data, state.vendors),
      )
      if (
        product.imageAssetId &&
        !state.graphic_assets.some((a) => a.id === product.imageAssetId)
      )
        throw new Error('Choose a photo from this oven.')
      Object.assign(product, {
        purchaseQuantity,
        purchaseUnit: data.unit,
        itemsPerUnit,
        purchaseCost: amount,
        lastReceivedUnitCost: amount / quantity,
        supplierId: data.supplierId || product.supplierId,
        lastPurchaseDate: data.purchaseDate || receivedDate,
      })
    } else {
      quantity = number(data.quantity, 'Signed adjustment', -Infinity)
      if (!quantity) throw new Error('Enter a non-zero adjustment.')
      if (!product.stockCostKnown)
        throw new Error('Establish a cost through receipt or production first.')
      amount = quantity * Number(product.cost)
    }
    await finishedMovement(ctx, product, id, quantity, amount, {
      requestHash,
      type: action === 'receive' ? 'purchase_receipt' : 'adjustment',
      receivedDate,
      purchaseDate: data.purchaseDate || '',
      reason,
      sourceId: operationId,
      purchaseQuantity: action === 'receive' ? data.quantity : undefined,
      purchaseUnit: action === 'receive' ? data.unit : undefined,
      itemsPerUnit: action === 'receive' ? data.itemsPerUnit : undefined,
      supplierId: data.supplierId || product.supplierId,
    })
    await journal(
      {
        ...ctx,
        today:
          action === 'receive'
            ? data.purchaseDate || receivedDate
            : receivedDate,
      },
      id,
      'Finished stock: ' + product.name,
      Math.abs(amount),
      amount >= 0 ? 'Inventory asset' : 'Inventory shrink/waste COGS',
      amount >= 0
        ? action === 'receive'
          ? 'Cash'
          : 'Other income'
        : 'Inventory asset',
    )
    await audit(
      'Finished stock movement',
      `${product.name}: ${quantity} each · ${reason}`,
    )
    return true
  }
  if (action === 'complete') {
    const batch = state.batches.find((b) => b.id === data.id)
    const design = state.recipes.find((r) => r.id === batch?.recipeId)
    if (!batch || design?.workflow !== 'handmade') return false
    const hash = createHash('sha256')
      .update(
        JSON.stringify([
          data.actualYield,
          data.usage,
          data.materialWaste,
          data.laborMinutes,
          data.waste,
          data.wasteReason,
        ]),
      )
      .digest('hex')
    if (batch.status === 'completed') {
      if (batch.completionHash === hash) return true
      throw new Error('Completed production is immutable; create another run.')
    }
    materialDesign(structuredClone(design), state)
    const product = state.products.find(
      (p) =>
        p.id === batch.productId &&
        p.workflow === 'handmade' &&
        p.recipeId === design.id,
    )
    if (!product)
      throw new Error(
        'Choose a handmade product linked to this design on the run.',
      )
    const actualYield = number(
      data.actualYield,
      'Completed sellable quantity',
      0.000001,
    )
    const waste = number(data.waste ?? 0, 'Finished waste')
    const actualLabor = number(
      required(data.laborMinutes, 'Actual labor minutes'),
      'Actual labor minutes',
    )
    const usage: Item[] = []
    let inputCost = 0
    for (const line of design.lines) {
      const input = state.ingredients.find((i) => i.id === line.ingredientId)!
      const used = number(
        required(data.usage?.[input.id], 'Actual material use'),
        'Actual material use',
      )
      const wasted = number(
        required(data.materialWaste?.[input.id], 'Material waste'),
        'Material waste',
      )
      const quantity = isFabric(input)
        ? fabricConvert(used + wasted, line.unit, input.unit, input)
        : convert(used + wasted, line.unit, input.unit, input.conversions)
      if (input.quantity < quantity)
        throw new Error(`${input.name} has insufficient stock.`)
      const amount = quantity * input.cost
      inputCost += amount
      usage.push({
        id: input.id,
        name: input.name,
        ingredientId: input.id,
        quantity,
        unit: input.unit,
        used,
        wasted,
        enteredUnit: line.unit,
        unitCost: input.cost,
        cost: amount,
      })
    }
    const reason = String(data.wasteReason || '').trim()
    if ((waste > 0 || usage.some((u) => u.wasted > 0)) && !reason)
      throw new Error('Explain material or finished-goods waste.')
    const labor = (actualLabor / 60) * design.laborRate
    const overhead =
      design.overhead * number(batch.count, 'Run count', 0.000001)
    const total = inputCost + labor + overhead
    for (const line of usage) {
      const input = state.ingredients.find((i) => i.id === line.id)!
      input.quantity -= line.quantity
      await save('ingredients', input)
      await save('ledger', {
        id: `run-${batch.id}-${input.id}`,
        name: input.name,
        ingredientId: input.id,
        quantity: -line.quantity,
        unit: input.unit,
        amount: -line.cost,
        type: 'batch_consumption',
        sourceId: batch.id,
        batchId: batch.id,
        reason: reason || 'Handmade production',
        actor: ctx.actor,
        occurredAt: new Date().toISOString(),
        date: today,
        actualUsed: line.used,
        materialWaste: line.wasted,
        enteredUnit: line.enteredUnit,
      })
    }
    batch.status = 'completed'
    batch.actualYield = actualYield
    batch.waste = waste
    batch.wasteReason = reason
    batch.laborMinutes = actualLabor
    batch.completionHash = hash
    batch.usage = usage
    batch.historicalCost = total
    batch.costSnapshot = {
      design: structuredClone(design),
      lines: usage,
      ingredient: inputCost,
      laborMinutes: actualLabor,
      laborRate: design.laborRate,
      labor,
      overhead,
      total,
      actualYield,
      unitsPerPackage: 1,
      perItem: total / actualYield,
      perPackage: total / actualYield,
      costingPolicy: 'actual_inputs_and_configured_allocation',
    }
    batch.completedAt = new Date().toISOString()
    await save('batches', batch)
    await finishedMovement(
      ctx,
      product,
      'run-output-' + batch.id,
      actualYield,
      total,
      {
        type: 'production_receipt',
        sourceId: batch.id,
        batchId: batch.id,
        reason: 'Completed handmade production',
      },
    )
    // Use rounded components to preserve balanced journal totals.
    const transferred = roundMoney(inputCost),
      allocated = roundMoney(total) - transferred
    if (roundMoney(total) > 0)
      await save('journals', {
        id: randomUUID(),
        name: 'Handmade production: ' + batch.name,
        sourceId: batch.id,
        date: today,
        status: 'posted',
        lines: [
          { account: 'Inventory asset', debit: roundMoney(total), credit: 0 },
          { account: 'Inventory asset', debit: 0, credit: transferred },
          {
            account: 'Production cost allocation',
            debit: 0,
            credit: allocated,
          },
        ],
      })
    await audit(
      'Handmade production completed',
      `${batch.name}: ${actualYield} items · ${total} locked cost`,
    )
    return true
  }
  return false
}
