import { applyProductTemplateDraft } from '../../src/lib/label-preview'
import {
  barcodeText,
  barcodeFormats as scanFormats,
  barcodeMatches,
} from '../../src/lib/barcodes'
import { createHash } from 'node:crypto'
import {
  baseUnit,
  convert,
  number,
  roundMoney,
  validateDate,
  type Item,
  type Workspace,
} from '../../src/lib/domain'
import { fabricReceipt, validateFabric } from '../../src/lib/fabric'
import { resaleReceivedQuantity } from '../../src/lib/purchased-inventory'
import { resaleStockPlan } from '../../src/lib/resale-stock'
import { inventoryPackagePlan } from '../../src/lib/inventory-package'
import { itemTypes, itemUnitOptions } from '../../src/lib/add-item'
import {
  conflictMessage,
  productIdentityConflict,
} from '../../src/lib/product-edit'

type Context = {
  state: Workspace
  save: (table: string, item: Item) => Promise<void>
  audit: (name: string, detail: string) => Promise<unknown>
  today: string
}
/** Runs inside the workspace lock/transaction, including its stock-ledger constraints. */
export async function handleAddItem(
  action: string,
  table: string,
  data: Item,
  ctx: Context,
) {
  if (action !== 'save' || data.inventoryCreation !== true) return false
  const type = data.usedAs
  if (!itemTypes.some(([key]) => key === type))
    throw new Error('Choose an Item Type.')
  const target = type === 'resale' ? 'products' : 'ingredients'
  if (table !== target)
    throw new Error('Item Type does not match its inventory model.')
  if (
    !/^[a-zA-Z0-9_-]{1,100}$/.test(data.id || '') ||
    !/^[a-zA-Z0-9_-]{1,100}$/.test(data.creationRequestId || '')
  )
    throw new Error('A stable creation request is required.')
  const fingerprint = createHash('sha256')
    .update(JSON.stringify(data))
    .digest('hex')
  const existing = ctx.state[target].find((i) => i.id === data.id)
  if (existing) {
    // Identical retry of the same creation request: already saved, no duplicate.
    if (
      existing.creationRequestId === data.creationRequestId &&
      existing.creationFingerprint === fingerprint
    )
      return true
    // A stored product sent back from an editor (it carries the stored
    // fingerprint, or older records persisted the creation flag) is an UPDATE
    // of that same ID. Let the product update path handle it; never create.
    if (
      target === 'products' &&
      (data.creationFingerprint === existing.creationFingerprint ||
        existing.inventoryCreation === true)
    )
      return false
    throw new Error(
      type === 'resale'
        ? 'This product was already created by an earlier save. Your entries are still here; close this form and use Edit Product on the saved item to change it. No duplicate was created.'
        : 'This item was already created by an earlier save. Your entries are still here; open the saved item to change it. No duplicate was created.',
    )
  }
  if (
    type !== 'resale' &&
    data.barcode &&
    barcodeMatches(
      ctx.state.ingredients,
      String(data.barcode),
      data.barcodeFormat,
    ).length
  )
    throw new Error(
      'This barcode is already in your account. Open the existing item instead of creating a duplicate.',
    )
  if (type === 'resale') {
    const conflict = productIdentityConflict(ctx.state.products, data)
    if (conflict) throw new Error(conflictMessage(conflict))
  }
  if (data.barcodeFormat && !scanFormats.includes(data.barcodeFormat))
    throw new Error('Unsupported barcode format.')
  // Resale items define a sellable unit first and choose exactly one stock path.
  const plan =
    type === 'resale' &&
    data.inventoryPackageSetup !== true &&
    data.stockChoice !== undefined
      ? resaleStockPlan(data)
      : null
  // New item setup uses package cost + a separate opening count.
  // Legacy purchaseQuantity remains a received quantity on all other requests.
  const packagePlan =
    data.inventoryPackageSetup === true ? inventoryPackagePlan(data) : null
  const initial = plan ? plan.choice !== 'none' : data.initialStock === true
  const stockAction = plan
    ? plan.choice === 'existing'
      ? 'opening'
      : 'purchase'
    : packagePlan
      ? 'opening'
      : data.stockAction
  const startingWithDetails =
    plan?.choice === 'existing' && data.addPurchaseDetails === true
  const item: Item = {
    ...data,
    name: String(data.name || '').trim(),
    quantity: 0,
    cost: 0,
    currentCost: 0,
    barcode: data.barcode ? barcodeText(data.barcode) : '',
    creationFingerprint: fingerprint,
    trackInventory: data.trackInventory !== false,
  }
  if (target === 'products') applyProductTemplateDraft(ctx.state, item)
  // The creation flag describes this request only; never persist it on the record.
  delete item.inventoryCreation
  delete item.inventoryPackageSetup
  if (packagePlan) {
    item.conversions = packagePlan.conversions
    for (const key of [
      'initialStock',
      'stockAction',
      'openingCount',
      'openingCountUnit',
      'openingValueOverride',
      'openingValue',
      'referenceQuantity',
      'referencePrice',
      'purchaseDate',
      'receiptReference',
      'packageContentsConfirmed',
      'itemsPerUnit',
      'contentsUnit',
      'purchaseQuantity',
      'packagePrice',
      'amountPerPackage',
    ])
      delete item[key]
    item.purchaseUnit = packagePlan.purchaseUnit
    if (packagePlan.amountPerPackage != null) {
      item.amountPerPackage = packagePlan.amountPerPackage
      // Existing package costing expects a reference quantity in purchase units.
      // Resale's purchaseQuantity describes an actual purchase, not a reference.
      if (type !== 'resale') item.purchaseQuantity = 1
    }
    if (packagePlan.packageCost != null)
      item.packagePrice = packagePlan.packageCost
  }
  if (!item.name || item.name.length > 200)
    throw new Error('Enter an item name of up to 200 characters.')
  if (!itemUnitOptions(type, data.materialType).includes(data.unit))
    throw new Error('Choose an appropriate stock unit.')
  if (['pack', 'case', 'box', 'bolt', 'roll', 'bundle'].includes(data.unit))
    throw new Error(
      'Choose a usable stock unit; package contents belong in purchasing.',
    )
  if (
    type === 'material' &&
    !['fabric', 'yarn', 'other'].includes(data.materialType)
  )
    throw new Error('Choose a material subtype.')
  if (type !== 'ingredient' && !packagePlan) item.conversions = []
  if (type !== 'material') delete item.materialType
  if (type !== 'material' || data.materialType !== 'fabric') {
    for (const key of [
      'fabricTracking',
      'fabricWidth',
      'widthUnit',
      'pieceMode',
      'pieceId',
    ])
      delete item[key]
  }
  if (
    type !== 'ingredient' &&
    !(type === 'resale' && data.foodClass === 'food')
  ) {
    for (const key of [
      'statement',
      'subingredients',
      'sourceContains',
      'sourceMayContain',
      'allergens',
      'reviewed',
    ])
      delete item[key]
  }
  if (type !== 'resale') {
    delete item.workflow
    delete item.recipeId
    delete item.productId
    item.categoryId =
      type === 'material'
        ? 'craft-materials'
        : type === 'packaging'
          ? 'packaging'
          : type === 'supply'
            ? 'supplies'
            : data.categoryId
    if (
      type === 'ingredient' &&
      ['craft-materials', 'packaging', 'supplies'].includes(item.categoryId)
    )
      throw new Error('Choose an ingredient category.')
  } else {
    item.workflow = 'resale'
    item.unpacked = true
    item.recipeId = ''
    item.unit = 'each'
    item.price = number(data.price || 0, 'Selling price')
    item.stockCostKnown = initial
    item.taxSource = 'category'
    item.unitsPerPackage = 1
    item.packagingLines = []
    delete item.taxRateIds
    delete item.taxStatus
    delete item.taxAssignments
    if (
      item.productCategoryId &&
      !(ctx.state.settings[0]?.productCategories || []).some(
        (c: Item) => c.id === item.productCategoryId && c.active !== false,
      )
    )
      throw new Error('Choose an active product category from this oven.')
  }
  if (item.vendorId && !ctx.state.vendors.some((v) => v.id === item.vendorId))
    throw new Error('Choose a supplier from this oven.')
  if (type === 'resale') item.supplierId = item.vendorId || ''
  item.vendor =
    ctx.state.vendors.find((v) => v.id === item.vendorId)?.name || ''
  if (
    item.imageAssetId &&
    !ctx.state.graphic_assets.some((a) => a.id === item.imageAssetId)
  )
    throw new Error('Choose a photo from this oven.')
  if (
    item.currency &&
    item.currency !== (ctx.state.settings[0]?.currency || 'USD')
  )
    throw new Error(
      'Use the Oven costing currency; currency conversion is unavailable.',
    )
  item.currency = ctx.state.settings[0]?.currency || 'USD'
  item.threshold = number(item.threshold || 0, 'Reorder threshold')
  const fabric = type === 'material' && data.materialType === 'fabric'
  if (fabric) validateFabric(item)
  item.storageUnit = item.unit
  if (!fabric && type !== 'resale')
    item.unit = baseUnit(item.unit, item.conversions)
  item.threshold = convert(
    item.threshold,
    item.storageUnit,
    item.unit,
    item.conversions,
  )
  if (plan) {
    for (const key of [
      'stockChoice',
      'countMethod',
      'startingCount',
      'packCount',
      'unitsPerPack',
      'looseUnits',
      'costBasis',
      'costAmount',
      'costEstimated',
      'packagePrice',
      'purchaseQuantity',
      'purchaseUnit',
      'itemsPerUnit',
      'packageContentsConfirmed',
      'contentsUnit',
      'referencePrice',
      'referenceQuantity',
      'addPurchaseDetails',
      'initialStock',
      'stockAction',
    ])
      delete item[key]
    if (plan.choice === 'existing' && !startingWithDetails) {
      delete item.receiptReference
      delete item.purchaseDate
    }
    item.sellUnit = plan.entry.sellUnit
    item.sellUnitLabel = plan.names.singular
    item.sellUnitPlural = plan.names.plural
    item.stockEntry = plan.entry
    if (plan.choice === 'purchase')
      Object.assign(item, {
        purchaseQuantity: plan.entry.purchaseQuantity,
        purchaseUnit: plan.entry.purchaseUnit,
        itemsPerUnit: plan.entry.itemsPerUnit,
        purchaseCost: plan.totalCost,
        lastReceivedUnitCost: plan.unitCost,
        lastPurchaseDate: data.purchaseDate || data.receivedDate,
      })
  }
  if (!initial) {
    item.needsCostSetup = true
    delete item.currentCost
  }
  // Confirmed pack contents remain usable in subsequent receiving and costing.
  if (
    !packagePlan &&
    data.packageContentsConfirmed === true &&
    ['pack', 'case', 'box', 'bundle', 'roll'].includes(data.purchaseUnit) &&
    !fabric &&
    type !== 'resale'
  ) {
    const contents = number(data.itemsPerUnit, 'Confirmed contents', 0.000001)
    const targetUnit = data.contentsUnit || item.storageUnit
    convert(contents, targetUnit, item.unit, item.conversions)
    item.conversions = [
      ...(type === 'ingredient' ? item.conversions || [] : []),
      {
        from: data.purchaseUnit,
        to: targetUnit,
        amountFrom: 1,
        amountTo: contents,
        verified: true,
        note: 'Confirmed package contents',
      },
    ]
  }
  if (
    !plan &&
    !packagePlan &&
    data.initialStock !== true &&
    data.referencePrice !== '' &&
    data.referencePrice != null
  ) {
    const q = number(
      data.referenceQuantity,
      'Reference package quantity',
      0.000001,
    )
    const receipt = { ...data, quantity: q, unit: data.purchaseUnit }
    const normalized = fabric
      ? fabricReceipt(item, receipt)
      : type === 'resale'
        ? resaleReceivedQuantity(receipt)
        : convert(q, data.purchaseUnit, item.unit, item.conversions)
    item.cost = number(data.referencePrice, 'Reference cost') / normalized
    item.currentCost = item.cost
    item.needsCostSetup = false
  }
  let amount = 0
  if (packagePlan) {
    const knownCost = packagePlan.baseUnitCost
    item.needsCostSetup = knownCost == null
    if (knownCost != null) {
      item.cost = knownCost
      item.currentCost = knownCost
    } else delete item.currentCost
    if (packagePlan.resale) {
      const resale = packagePlan.resale
      for (const key of [
        'stockChoice',
        'countMethod',
        'startingCount',
        'packCount',
        'unitsPerPack',
        'looseUnits',
        'costBasis',
        'costAmount',
        'costEstimated',
        'addPurchaseDetails',
      ])
        delete item[key]
      item.sellUnit = resale.entry.sellUnit
      item.sellUnitLabel = resale.names.singular
      item.sellUnitPlural = resale.names.plural
      item.stockEntry = resale.entry
      if (packagePlan.amountPerPackage != null)
        item.itemsPerUnit = packagePlan.amountPerPackage
    }
    if (initial) {
      validateDate(data.receivedDate)
      amount = packagePlan.openingValue!
      item.quantity = packagePlan.baseQuantity
      item.cost = amount / item.quantity
      item.currentCost = knownCost ?? item.cost
      item.needsCostSetup = false
    }
  } else if (initial && plan) {
    validateDate(data.receivedDate)
    if (item.purchaseDate) validateDate(item.purchaseDate)
    amount = plan.totalCost
    item.quantity = plan.quantity
    item.cost = plan.unitCost
    item.currentCost = item.cost
  } else if (initial) {
    if (!['opening', 'purchase'].includes(data.stockAction))
      throw new Error('Choose opening balance or purchase.')
    validateDate(data.receivedDate)
    if (data.purchaseDate) validateDate(data.purchaseDate)
    if (data.packagePrice === '' || data.packagePrice == null)
      throw new Error('Confirm acquisition cost, including an explicit zero.')
    amount = number(data.packagePrice, 'Acquisition cost')
    const q = number(data.purchaseQuantity, 'Quantity received', 0.000001)
    const receipt = { ...data, quantity: q, unit: data.purchaseUnit }
    if (fabric) item.quantity = fabricReceipt(item, receipt)
    else if (type === 'resale') item.quantity = resaleReceivedQuantity(receipt)
    else if (
      data.purchaseUnit !== item.unit &&
      ['pack', 'case', 'box', 'bundle', 'roll'].includes(data.purchaseUnit)
    ) {
      if (data.packageContentsConfirmed !== true)
        throw new Error('Confirm package contents before receiving.')
      item.quantity = convert(
        q * number(data.itemsPerUnit, 'Items per package', 0.000001),
        data.contentsUnit || item.storageUnit,
        item.unit,
        item.conversions,
      )
    } else
      item.quantity = convert(q, data.purchaseUnit, item.unit, item.conversions)
    item.cost = amount / item.quantity
    item.currentCost = item.cost
  }
  await ctx.save(target, item)
  if (initial) {
    const starting = plan?.choice === 'existing'
    const label = starting
      ? 'Starting inventory'
      : stockAction === 'opening'
        ? 'Opening balance'
        : 'Initial purchase'
    await ctx.save('ledger', {
      id: 'stock-' + data.creationRequestId,
      name: item.name,
      [target === 'products' ? 'productId' : 'ingredientId']: item.id,
      quantity: item.quantity,
      unit: item.unit,
      amount,
      date: data.receivedDate,
      receivedDate: data.receivedDate,
      purchaseDate: packagePlan
        ? ''
        : plan
          ? item.purchaseDate || ''
          : data.purchaseDate || '',
      type: stockAction === 'opening' ? 'opening_balance' : 'purchase_receipt',
      reason: plan?.costEstimated ? `${label} (estimated cost)` : label,
      vendor: starting && !startingWithDetails ? '' : item.vendor,
      receiptReference: packagePlan
        ? ''
        : plan
          ? item.receiptReference || ''
          : data.receiptReference,
      ...(plan ? { stockEntry: plan.entry } : {}),
      ...(packagePlan
        ? {
            openingCount: packagePlan.openingCount,
            openingCountUnit: packagePlan.openingCountUnit,
            stockQuantity: packagePlan.stockQuantity,
            stockUnit: packagePlan.stockUnit,
            amountPerPackage: packagePlan.amountPerPackage,
            purchaseUnit: packagePlan.purchaseUnit,
            packagePrice: packagePlan.packageCost,
            suggestedValue: packagePlan.suggestedValue,
            valuationOverridden: packagePlan.override,
            ...(packagePlan.resale
              ? { stockEntry: packagePlan.resale.entry }
              : {}),
          }
        : {}),
      lot: data.lot,
      expires: data.expires,
    })
    if (roundMoney(amount) > 0)
      await ctx.save('journals', {
        id: 'opening-' + data.creationRequestId,
        name: `${plan?.choice === 'existing' ? 'Starting inventory' : stockAction === 'opening' ? 'Opening inventory' : 'Inventory purchase'}: ${item.name}`,
        sourceId: item.id,
        date:
          (packagePlan ? '' : plan ? item.purchaseDate : data.purchaseDate) ||
          data.receivedDate,
        status: 'posted',
        lines: [
          { account: 'Inventory asset', debit: roundMoney(amount), credit: 0 },
          {
            // Approved posting is unchanged: starting stock credits Owner equity.
            account: stockAction === 'opening' ? 'Owner equity' : 'Cash',
            debit: 0,
            credit: roundMoney(amount),
          },
        ],
      })
  }
  await ctx.audit('Inventory item created', `${item.name} · ${type}`)
  return true
}
