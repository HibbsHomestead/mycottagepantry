import {
  inventoryProductKeys,
  reviewedProductMetadata,
} from '../../src/lib/inventory-product'
import { validateDate } from '../../src/lib/domain'
import { createHash, randomUUID } from 'node:crypto'
import {
  number,
  roundMoney,
  type Item,
  type Workspace,
} from '../../src/lib/domain'
import {
  isFabric,
  validateFabric,
  fabricReceipt,
  fabricConvert,
  fabricPurchaseCost,
} from '../../src/lib/fabric'

type Context = {
  state: Workspace
  save: (table: string, item: Item) => Promise<void>
  audit: (name: string, detail: string) => Promise<void>
  today: string
  actor: string
}
export async function handleFabric(
  action: string,
  table: string,
  data: Item,
  ctx: Context,
) {
  if (table !== 'ingredients') return false
  const existing = ctx.state.ingredients.find(
    (i) =>
      i.id ===
      (['unit', 'conversion'].includes(action) ? data.ingredientId : data.id),
  )
  const create = action === 'save' && isFabric(data)
  if (create && data.usedAs && data.usedAs !== 'material')
    throw new Error(
      'Fabric stock uses Craft Materials. Keep the selected inventory type or remove fabric tracking details.',
    )
  if (!create && !isFabric(existing)) return false
  if (
    [
      'ingredientUpdate',
      'ingredientOffer',
      'conversion',
      'unit',
      'customUnit',
    ].includes(action)
  )
    throw new Error(
      'Use the fabric editor and confirmed fabric receipts; fabric length cannot use ingredient package conversions.',
    )
  if (
    !['save', 'fabricUpdate', 'fabricRemnant', 'receive', 'adjust'].includes(
      action,
    )
  )
    return false
  const { state, save, actor } = ctx
  const today = data.receivedDate || ctx.today
  validateDate(today)
  if (data.purchaseDate) validateDate(data.purchaseDate)
  const operation = create ? data.creationRequestId : data.operationId
  if (
    typeof operation !== 'string' ||
    !/^[a-zA-Z0-9_-]{1,100}$/.test(operation)
  )
    throw new Error(
      'A stable fabric operation ID is required. Reopen this form.',
    )
  const id = 'fabric-' + operation
  const hash = createHash('sha256')
    .update(JSON.stringify([action, data]))
    .digest('hex')
  const previous = state.ledger.find((l) => l.id === id)
  if (previous) {
    if (previous.requestHash !== hash)
      throw new Error(
        'This fabric operation ID was already used for different values.',
      )
    return true
  }
  if (create && existing)
    throw new Error('This fabric record already exists. Reopen it to edit.')
  if (!create && !existing) throw new Error('Fabric is unavailable.')
  const item: Item = create
    ? {
        ...data,
        id: data.id || randomUUID(),
        usedAs: 'material',
        categoryId: 'craft-materials',
        category: 'Craft materials',
        quantity: 0,
        cost: 0,
        conversions: [],
        trackInventory: true,
        allergens: [],
        reviewed: false,
      }
    : { ...existing! }
  if (create || action === 'fabricUpdate') {
    if (!create && data.expectedUpdatedAt !== existing!.updatedAt)
      throw new Error('This fabric changed elsewhere. Reopen before saving.')
    // Explicit metadata allowlist: editing never changes stock or valuation.
    const keys = [
      ...inventoryProductKeys,
      'brand',
      'productSourceUrl',
      'productRequestedUrl',
      'productCheckedAt',
      'listedOnlinePrice',
      'currency',
      'name',
      'fabricTracking',
      'pieceMode',
      'pieceId',
      'fabricWidth',
      'widthUnit',
      'fiber',
      'color',
      'pattern',
      'collection',
      'pieceLength',
      'pieceLengthUnit',
      'sku',
      'barcode',
      'vendorId',
      'imageAssetId',
      'storageLocation',
      'notes',
      'threshold',
    ]
    if (!create)
      for (const key of keys) if (data[key] !== undefined) item[key] = data[key]
    if (!String(item.name || '').trim() || item.name.length > 200)
      throw new Error('Enter a fabric name (up to 200 characters).')
    item.name = item.name.trim()
    validateFabric(item, create ? undefined : existing)
    if (item.vendorId && !state.vendors.some((v) => v.id === item.vendorId))
      throw new Error('Select a supplier from this oven.')
    item.vendor = state.vendors.find((v) => v.id === item.vendorId)?.name || ''
    item.currency = state.settings[0]?.currency || 'USD'
    if (
      item.imageAssetId &&
      !state.graphic_assets.some((a) => a.id === item.imageAssetId)
    )
      throw new Error('Select a photo from this oven.')
    item.threshold = number(item.threshold || 0, 'Reorder threshold')
    item.storageUnit = item.unit
    if (!create) {
      await save('ingredients', item)
      await ctx.audit('Fabric details updated', item.name)
      return true
    }
  }
  let quantity: number, amount: number
  if (action === 'fabricRemnant') {
    if (item.fabricTracking !== 'length')
      throw new Error('Remnant transfers require length-tracked fabric.')
    quantity = fabricConvert(
      number(data.quantity, 'Remnant length', 0.000001),
      data.unit,
      item.unit,
      item,
    )
    if (quantity > item.quantity + 1e-9)
      throw new Error('Remnant exceeds available parent stock.')
    const pieceId = String(data.pieceId || '').trim()
    if (!pieceId || pieceId.length > 200)
      throw new Error('Enter a remnant identifier (up to 200 characters).')
    amount = quantity * item.cost
    const remnant: Item = {
      ...item,
      id: 'remnant-' + operation,
      name: item.name + ' · ' + pieceId,
      pieceId,
      pieceMode: 'separate',
      parentMaterialId: item.id,
      storageLocation: String(data.storageLocation || '').slice(0, 200),
      quantity,
      threshold: 0,
      currentCost: item.cost,
      notes: String(data.notes || '').slice(0, 4000),
    }
    delete remnant.creationRequestId
    delete remnant.creationFingerprint
    if (state.ingredients.some((i) => i.id === remnant.id))
      throw new Error('This remnant ID already exists. Open a new transfer.')
    item.quantity = Math.max(0, item.quantity - quantity)
    await save('ingredients', item)
    await save('ingredients', remnant)
    const detail = {
      type: 'remnant_transfer',
      sourceId: operation,
      reason: 'Usable remnant transfer',
      actor,
      date: today,
      occurredAt: new Date().toISOString(),
      requestHash: hash,
      unit: item.unit,
    }
    await save('ledger', {
      ...detail,
      id,
      name: item.name,
      ingredientId: item.id,
      quantity: -quantity,
      amount: -amount,
      remnantId: remnant.id,
    })
    await save('ledger', {
      ...detail,
      id: id + '-in',
      name: remnant.name,
      ingredientId: remnant.id,
      quantity,
      amount,
      parentMaterialId: item.id,
    })
    await ctx.audit(
      'Fabric remnant transferred',
      `${item.name}: ${quantity} ${item.unit} to ${pieceId}`,
    )
    return true
  }
  const receiving = create || action === 'receive'
  if (receiving && data.productDetails)
    Object.assign(
      item,
      reviewedProductMetadata(item, data.productDetails, state.vendors),
    )
  if (
    item.imageAssetId &&
    !state.graphic_assets.some((a) => a.id === item.imageAssetId)
  )
    throw new Error('Choose a photo from this oven.')
  if (receiving) {
    const receipt = create
      ? { ...data, quantity: data.purchaseQuantity, unit: data.purchaseUnit }
      : data
    quantity = fabricReceipt(item, receipt)
    if (create && data.productCheckedAt)
      quantity *= number(
        data.receivedPackages,
        'Packages actually received',
        0.000001,
      )
    if (item.pieceMode === 'separate' && item.quantity > 1e-9)
      throw new Error(
        'This record represents one piece. Receive a different piece as a separate fabric record.',
      )
    amount = fabricPurchaseCost(
      receipt,
      create ? data.packagePrice : data.price,
    )
    item.cost =
      (item.quantity * item.cost + amount) / (item.quantity + quantity)
    item.currentCost = item.cost
    item.purchaseQuantity = number(
      receipt.quantity,
      'Purchase quantity',
      0.000001,
    )
    item.purchaseUnit = receipt.unit
    item.packagePrice =
      create && data.productCheckedAt
        ? amount /
          number(data.receivedPackages, 'Packages actually received', 0.000001)
        : amount
    item.priceMode = data.priceMode || 'total'
    item.purchaseUnitPrice =
      data.priceMode === 'per_unit'
        ? number(data.purchaseUnitPrice, 'Price per purchase unit')
        : undefined
    item.lastPurchaseDate = data.purchaseDate || today
  } else {
    if (!String(data.reason || '').trim())
      throw new Error('Explain the fabric adjustment or waste.')
    if (data.type && !['adjustment', 'waste', 'spoilage'].includes(data.type))
      throw new Error('Choose a supported adjustment type.')
    const raw = String(data.quantity).trim()
    const signed =
      raw.startsWith('-') && raw.includes('/')
        ? -number(raw.slice(1), 'Signed adjustment')
        : number(data.quantity, 'Signed adjustment', -Infinity)
    quantity =
      Math.sign(signed) *
      fabricConvert(Math.abs(signed), data.unit || item.unit, item.unit, item)
    if (!quantity) throw new Error('Enter a non-zero adjustment.')
    amount = quantity * item.cost
  }
  if (item.quantity + quantity < -1e-9)
    throw new Error('Insufficient fabric stock.')
  item.quantity = Math.max(0, item.quantity + quantity)
  await save('ingredients', item)
  await save('ledger', {
    id,
    requestHash: hash,
    name: item.name,
    ingredientId: item.id,
    quantity,
    amount,
    unit: item.unit,
    type: receiving ? 'purchase_receipt' : data.type || 'adjustment',
    reason: data.reason || 'Confirmed fabric purchase',
    sourceId: operation,
    date: today,
    receivedDate: today,
    purchaseDate: data.purchaseDate || '',
    actor,
    occurredAt: new Date().toISOString(),
    purchaseQuantity: receiving ? item.purchaseQuantity : undefined,
    purchaseUnit: receiving ? item.purchaseUnit : undefined,
    enteredQuantity: create ? data.purchaseQuantity : data.quantity,
    enteredUnit: create ? data.purchaseUnit : data.unit,
    usableLength: data.usableLength,
    usableLengthUnit: data.usableLengthUnit,
    lengthConfirmed: data.lengthConfirmed,
    priceMode: data.priceMode || 'total',
    purchaseUnitPrice: data.purchaseUnitPrice,
    vendor: item.vendor,
  })
  const value = roundMoney(Math.abs(amount))
  if (value > 0)
    await save('journals', {
      id: randomUUID(),
      name: 'Fabric stock: ' + item.name,
      sourceId: id,
      date: receiving ? data.purchaseDate || today : today,
      status: 'posted',
      lines: [
        {
          account:
            amount >= 0 ? 'Inventory asset' : 'Inventory shrink/waste COGS',
          debit: value,
          credit: 0,
        },
        {
          account:
            amount >= 0
              ? receiving
                ? 'Cash'
                : 'Other income'
              : 'Inventory asset',
          debit: 0,
          credit: value,
        },
      ],
    })
  await ctx.audit(
    'Fabric stock movement',
    `${item.name}: ${quantity} ${item.unit}`,
  )
  return true
}
