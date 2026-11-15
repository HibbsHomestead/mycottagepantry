import { isFabric } from '../../src/lib/fabric'
import { createHash } from 'node:crypto'
import {
  number,
  roundMoney,
  validateDate,
  type Item,
  type Workspace,
} from '../../src/lib/domain'
import { handmadeUnits } from '../../src/lib/handmade'

type Context = {
  state: Workspace
  save: (table: string, item: Item) => Promise<void>
  today: string
  audit: (name: string, detail: string) => Promise<void>
}
export async function handleHandmadeMaterial(
  action: string,
  table: string,
  data: Item,
  ctx: Context,
) {
  if (!['handmadeMaterialSave', 'handmadeMaterialReceive'].includes(action))
    return false
  if (table !== 'ingredients' || !/^[a-zA-Z0-9_-]{8,100}$/.test(data.id))
    throw new Error('Choose a material record.')
  const { state, save } = ctx
  const old = state.ingredients.find((i) => i.id === data.id)
  if (old && old.usedAs !== 'material')
    throw new Error(
      'Only handmade materials can be changed here. Shared packaging retains its own stock record.',
    )
  if (isFabric(old))
    throw new Error(
      'Use the existing fabric stock workflow to preserve width, tracking and remnant information.',
    )
  if (action === 'handmadeMaterialSave') {
    if (!String(data.name || '').trim())
      throw new Error('Enter a material name.')
    if (!handmadeUnits.includes(data.unit))
      throw new Error('Choose a supported usage unit.')
    if (old && old.unit !== data.unit)
      throw new Error(
        'Keep the existing stock unit to preserve history. Create a separate material for a different basis.',
      )
    const item: Item = {
      ...old,
      id: data.id,
      name: String(data.name).trim().slice(0, 200),
      usedAs: 'material',
      category: 'Craft materials',
      categoryId: 'craft-materials',
      sectionCategoryId: data.sectionCategoryId === undefined ? old?.sectionCategoryId : String(data.sectionCategoryId || ''),
      materialCategory: String(data.materialCategory || '').slice(0, 200),
      supplier: String(data.supplier || '').slice(0, 200),
      sku: String(data.sku || '').slice(0, 200),
      notes: String(data.notes || '').slice(0, 5000),
      unit: data.unit,
      threshold: number(data.threshold || 0, 'Reorder threshold'),
      trackInventory: true,
      quantity: old?.quantity || 0,
      cost: old?.cost || 0,
      currentCost: old?.cost || 0,
      needsCostSetup: old ? old.needsCostSetup : true,
    }
    await save('ingredients', item)
    await ctx.audit('Handmade material saved', item.name)
    return true
  }
  if (!old) throw new Error('Save this material before receiving purchases.')
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(data.operationId || ''))
    throw new Error('A stable receipt ID is required.')
  const id = 'handmade-receipt-' + data.operationId
  const hash = createHash('sha256')
    .update(
      JSON.stringify([
        data.id,
        data.purchaseQuantity,
        data.purchaseUnit,
        data.usagePerPurchase,
        data.purchaseCost,
        data.date,
        data.supplierReference,
      ]),
    )
    .digest('hex')
  const previous = state.ledger.find((l) => l.id === id)
  if (previous) {
    if (previous.requestHash !== hash)
      throw new Error('Receipt ID already used with different values.')
    return true
  }
  const purchaseQuantity = number(
    data.purchaseQuantity,
    'Purchase quantity',
    0.000001,
  )
  const usagePerPurchase = number(
    data.usagePerPurchase,
    'Usage units per purchase unit',
    0.000001,
  )
  if (!handmadeUnits.includes(data.purchaseUnit))
    throw new Error('Choose a purchase unit.')
  if (data.purchaseUnit === old.unit && usagePerPurchase !== 1)
    throw new Error(
      'Identical purchase and stock units require a conversion of one.',
    )
  if (data.purchaseCost == null || data.purchaseCost === '')
    throw new Error(
      'Enter actual purchase cost, including zero if supplied free.',
    )
  if (old.needsCostSetup && Number(old.quantity) > 0)
    throw new Error(
      'Review the unknown opening stock value before adding purchases.',
    )
  const amount = number(data.purchaseCost, 'Actual purchase cost')
  const quantity = purchaseQuantity * usagePerPurchase
  const date = validateDate(data.date || ctx.today)
  old.cost =
    (Number(old.quantity) * Number(old.cost) + amount) /
    (Number(old.quantity) + quantity)
  old.currentCost = old.cost
  old.quantity = Number(old.quantity) + quantity
  old.needsCostSetup = false
  await save('ingredients', old)
  await save('ledger', {
    id,
    name: old.name,
    ingredientId: old.id,
    quantity,
    unit: old.unit,
    amount,
    unitCost: amount / quantity,
    purchaseQuantity,
    purchaseUnit: data.purchaseUnit,
    usagePerPurchase,
    supplierReference: String(data.supplierReference || '').slice(0, 1000),
    type: 'purchase_receipt',
    sourceId: data.operationId,
    date,
    requestHash: hash,
    reason: 'Handmade material purchase',
  })
  if (roundMoney(amount))
    await save('journals', {
      id,
      name: old.name + ' material purchase',
      sourceId: id,
      status: 'posted',
      date,
      lines: [
        { account: 'Inventory asset', debit: roundMoney(amount), credit: 0 },
        { account: 'Cash', debit: 0, credit: roundMoney(amount) },
      ],
    })
  await ctx.audit('Handmade material received', old.name)
  return true
}
