import { reviewedProductMetadata } from './inventory-product'
import { ovenToday } from './oven-dates'
import { resaleReceivedQuantity } from './purchased-inventory'
import { validateFabric } from './fabric'
import { emptyReceiptValue } from './receipt-document'
import { fabricReceipt, isFabric } from './fabric'
import {
  baseUnit,
  convert,
  number,
  roundMoney,
  validateDate,
  type Item,
  type Workspace,
} from './domain'
export const expenseCategories = [
  'Market/vendor fees',
  'Payment processing fees',
  'Rent / commissary kitchen',
  'Supplies expense',
  'Equipment purchases',
  'Office expense',
  'Advertising / marketing',
  'Gas / mileage',
  'Licensing / permits',
  'Insurance',
  'Software',
  'Professional services',
  'Bank fees',
  'Miscellaneous expense',
]
export const financeTables = [
  'receipt_extractions',
  'finance_transactions',
  'consignors',
  'consignment_items',
  'consignment_movements',
  'consignment_sales',
  'consignment_payouts',
  'vendor_matches',
  'finance_reviews',
]
export const defaultAccounts = [
  ...[
    'Cash',
    'Bank account',
    'Inventory asset',
    'Accounts receivable',
    'Owner contributions receivable',
  ].map((name) => ({ name, type: 'asset' })),
  ...['Accounts payable', 'Sales Tax Payable', 'Consignment Payable'].map(
    (name) => ({ name, type: 'liability' }),
  ),
  ...['Owner equity', 'Owner draws', 'Retained earnings'].map((name) => ({
    name,
    type: 'equity',
  })),
  ...[
    'Sales revenue',
    'Wholesale sales',
    'Other income',
    'Consignment Commission Income',
    'Shipping income',
  ].map((name) => ({ name, type: 'income' })),
  ...[
    'Ingredient COGS',
    'Packaging COGS',
    'Production labor COGS',
    'Inventory shrink/waste COGS',
    ...expenseCategories,
  ].map((name) => ({ name, type: 'expense' })),
]
export type Posting = { account: string; debit: number; credit: number }
export type FinancePlan = {
  writes: { table: string; record: Item }[]
  journal?: Item
  description: string
}
const debit = (account: string, amount: number): Posting => ({
  account,
  debit: roundMoney(amount),
  credit: 0,
})
const credit = (account: string, amount: number): Posting => ({
  account,
  debit: 0,
  credit: roundMoney(amount),
})
const money = (v: unknown, name: string, min = 0) =>
  roundMoney(number(v, name, min))
const text = (v: unknown, fallback = '') =>
  String(v ?? fallback)
    .trim()
    .slice(0, 2000)
const owned = (w: Workspace, t: string, id: string) => {
  const row = w[t]?.find((r) => r.id === id)
  if (!row) throw new Error('Choose a record from this oven.')
  return row
}
const date = (v: string) => {
  validateDate(v)
  return v
}
const category = (v: string) => {
  if (!expenseCategories.includes(v))
    throw new Error('Choose an expense category.')
  return v
}
export function balanced(lines: Posting[]) {
  const d = lines.reduce(
      (s, l) => s + Math.round(number(l.debit, 'Debit') * 100),
      0,
    ),
    c = lines.reduce(
      (s, l) => s + Math.round(number(l.credit, 'Credit') * 100),
      0,
    )
  if (!d || d !== c)
    throw new Error('Transaction does not balance. Review the totals.')
  return lines.filter((l) => l.debit || l.credit)
}
export function consignmentMath(d: Record<string, any>) {
  const quantity = number(d.quantity, 'Quantity', 1)
  if (!Number.isInteger(quantity)) throw new Error('Use a whole item quantity.')
  const gross = money(d.gross, 'Gross sales'),
    discounts = money(d.discounts || 0, 'Discounts'),
    refunds = money(d.refunds || 0, 'Refunds'),
    deductions = money(d.deductions || 0, 'Approved deductions'),
    fees = money(d.fees || 0, 'Processing fees'),
    tax = money(d.tax || 0, 'Sales tax')
  const merchandise = roundMoney(gross - discounts - refunds)
  if (merchandise < 0)
    throw new Error('Discounts and refunds exceed gross sales.')
  if (d.deductions > 0 && !d.deductionApproval)
    throw new Error('Record the consignor’s approval for deductions.')
  const commissionType = d.commissionType === 'fixed' ? 'fixed' : 'percentage',
    rate = number(d.commissionRate, 'Commission rate')
  if (commissionType === 'percentage' && rate > 100)
    throw new Error('Commission cannot exceed 100%.')
  const commission = roundMoney(
    commissionType === 'fixed' ? rate * quantity : (merchandise * rate) / 100,
  )
  const feeBearer = d.feeBearer || 'business'
  if (!['business', 'consignor', 'shared'].includes(feeBearer))
    throw new Error('Choose who pays processing fees.')
  const consignorFee = roundMoney(
    feeBearer === 'consignor' ? fees : feeBearer === 'shared' ? fees / 2 : 0,
  )
  if (consignorFee > 0 && !d.feeAgreement)
    throw new Error('Record the agreed processing-fee treatment.')
  const payable = roundMoney(
    merchandise - commission - deductions - consignorFee,
  )
  if (payable < 0 || fees > merchandise + tax)
    throw new Error('Deductions exceed the available sale proceeds.')
  return {
    quantity,
    gross,
    discounts,
    refunds,
    merchandise,
    commissionType,
    commissionRate: rate,
    commission,
    deductions,
    fees,
    consignorFee,
    businessFee: roundMoney(fees - consignorFee),
    tax,
    payable,
    cash: roundMoney(merchandise + tax - fees),
  }
}
export function duplicateReceipts(w: Workspace, r: Record<string, any>) {
  return (w.receipt_extractions || []).filter(
    (x) =>
      x.id !== r.id &&
      x.status !== 'cancelled' &&
      ((r.fileHash && x.fileHash === r.fileHash) ||
        (!emptyReceiptValue(r.total) &&
          !emptyReceiptValue(x.total) &&
          text(r.vendor) &&
          r.date &&
          text(x.vendor).toLowerCase() === text(r.vendor).toLowerCase() &&
          x.date === r.date &&
          Number(x.total) === Number(r.total) &&
          (!r.receiptNumber || x.receiptNumber === r.receiptNumber))),
  )
}
export function consignmentBalance(w: Workspace, id: string) {
  return roundMoney(
    (w.consignment_sales || [])
      .filter((s) => s.consignorId === id)
      .reduce((a, s) => a + s.payable, 0) -
      (w.consignment_payouts || [])
        .filter((p) => p.consignorId === id)
        .reduce((a, p) => a + p.amount, 0),
  )
}
function receiptNewInventory(
  l: Record<string, any>,
  id: string,
  vendors: Item[] = [],
) {
  if (
    l.usedAs &&
    !['ingredient', 'material', 'packaging', 'supply', 'resale'].includes(
      l.usedAs,
    )
  )
    throw new Error('Choose a supported purchasable inventory type.')
  const itemTable = l.usedAs === 'resale' ? 'products' : 'ingredients'
  const unit = itemTable === 'products' ? 'each' : baseUnit(l.unit)
  if (!text(l.description))
    throw new Error('Enter the new inventory item name.')
  const item: Item = {
    id: id,
    name: text(l.description),
    unit,
    storageUnit: itemTable === 'products' ? 'each' : l.unit,
    quantity: 0,
    cost: 0,
    currentCost: 0,
    threshold: 0,
    ...Object.fromEntries(
      [
        'brand',
        'manufacturerSku',
        'retailerSku',
        'barcode',
        'productSourceUrl',
        'productRequestedUrl',
        'productCheckedAt',
        'notes',
        'variant',
        'materialType',
        'fiber',
        'color',
        'pattern',
        'fabricWidth',
        'widthUnit',
        'yarnLength',
        'yarnLengthUnit',
        'yarnWeight',
        'yarnWeightUnit',
        'dimensions',
        'itemsPerPackage',
        'subingredients',
        'sourceContains',
        'sourceMayContain',
        'currency',
        'listedOnlinePrice',
        'imageAssetId',
        'purchaseQuantity',
        'purchaseUnit',
        'onlinePackageQuantity',
        'onlinePackageUnit',
      ]
        .filter((key) => l[key] != null)
        .map((key) => [key, l[key]]),
    ),
    ...(itemTable === 'products'
      ? {
          workflow: 'resale',
          stockCostKnown: false,
          price:
            l.retailPrice === '' || l.retailPrice == null
              ? null
              : number(l.retailPrice, 'Retail selling price'),
          sku: text(l.sku),
          recipeId: null,
          unitsPerPackage: 1,
          unpacked: true,
          packagingLines: [],
        }
      : {}),
    ...(l.materialType === 'fabric'
      ? {
          fabricTracking: l.fabricTracking || 'length',
          pieceMode: l.pieceMode || 'aggregate',
        }
      : {}),
    usedAs: ['ingredient', 'packaging', 'supply', 'material'].includes(l.usedAs)
      ? l.usedAs
      : 'ingredient',
    category: text(l.category, 'Receipt purchase'),
    allergens: [],
    reviewed: false,
    conversions: [],
  }

  Object.assign(item, reviewedProductMetadata(item, l, vendors))
  if (isFabric(item)) validateFabric(item)
  return { itemTable, item }
}
export function planFinance(
  w: Workspace,
  action: string,
  d: Record<string, any>,
  newId: () => string,
): FinancePlan {
  if (
    d.requestId &&
    (w.journals || []).some((j) => j.requestId === d.requestId)
  )
    return { writes: [], description: 'Transaction already recorded' }
  const writes: FinancePlan['writes'] = [],
    id = newId(),
    today = ovenToday(w.settings[0])
  const put = (table: string, record: Item) => {
    if (!(w[table] || []).some((r) => r.id === record.id))
      delete record.createdBy
    writes.push({ table, record })
    return record
  }
  const journal = (
    name: string,
    when: string,
    lines: Posting[],
    sourceId = id,
  ) => ({
    id: newId(),
    name,
    date: when,
    status: 'posted',
    sourceId,
    lines: balanced(lines),
  })
  let description = '',
    entry: Item | undefined
  if (action === 'financeReconcile') {
    const original = owned(w, 'finance_transactions', d.id)
    if (!text(d.reference))
      throw new Error('Enter the payment or statement reference you checked.')
    if (money(d.amount, 'Verified amount') !== Math.abs(original.amount))
      throw new Error(
        'The verified amount does not match this record. Use a correction to resolve the difference.',
      )
    put('finance_reviews', {
      id,
      name: original.name,
      transactionId: original.id,
      date: date(d.date || today),
      amount: Math.abs(original.amount),
      reference: text(d.reference),
      notes: text(d.notes),
      status: 'reviewed',
    })
    description = 'Financial record reconciled against payment evidence'
  } else if (action === 'consignorSave') {
    if (d.id) owned(w, 'consignors', d.id)
    if (!text(d.name)) throw new Error('A consignor name is required.')
    const rate = number(d.commissionRate ?? 10, 'Commission rate'),
      type = d.commissionType === 'fixed' ? 'fixed' : 'percentage'
    if (type === 'percentage' && rate > 100)
      throw new Error('Commission cannot exceed 100%.')
    put('consignors', {
      id: d.id || id,
      name: text(d.name),
      businessName: text(d.businessName),
      email: text(d.email),
      phone: text(d.phone),
      address: text(d.address),
      method: text(d.method),
      commissionType: type,
      commissionRate: rate,
      taxNotes: text(d.taxNotes),
      notes: text(d.notes),
      active: d.active !== false,
    })
    description = 'Consignor saved'
  } else if (action === 'consignmentReceive') {
    const owner = owned(w, 'consignors', d.consignorId)
    const previous = d.itemId
      ? owned(w, 'consignment_items', d.itemId)
      : undefined
    if (previous && previous.consignorId !== owner.id)
      throw new Error('This item belongs to another consignor.')
    const quantity = number(d.quantity, 'Quantity', 1)
    if (!Number.isInteger(quantity))
      throw new Error('Use a whole item quantity.')
    const returning = d.movement === 'return'
    if (returning && (!previous || previous.available < quantity))
      throw new Error('Not enough consignment stock to return.')
    const item = put('consignment_items', {
      ...previous,
      id: previous?.id || id,
      name: text(previous?.name || d.name),
      consignorId: owner.id,
      sku: text(d.sku || previous?.sku),
      description: text(d.description || previous?.description),
      category: text(d.category || previous?.category),
      price: money(d.price ?? previous?.price, 'Retail price'),
      available:
        (previous?.available || 0) + (returning ? -quantity : quantity),
      received: (previous?.received || 0) + (returning ? 0 : quantity),
      returned: (previous?.returned || 0) + (returning ? quantity : 0),
      sold: previous?.sold || 0,
      active: true,
    })
    if (!item.name) throw new Error('An item name is required.')
    put('consignment_movements', {
      id: newId(),
      name: item.name,
      itemId: item.id,
      consignorId: owner.id,
      quantity: returning ? -quantity : quantity,
      date: date(d.date || today),
      type: returning ? 'return' : 'receipt',
      notes: text(d.notes),
    })
    description = returning
      ? 'Consignment items returned'
      : 'Consignment items received'
  } else if (action === 'consignmentSale') {
    const item = owned(w, 'consignment_items', d.itemId),
      owner = owned(w, 'consignors', item.consignorId)
    const calc = consignmentMath({
      ...d,
      commissionType: d.commissionType || owner.commissionType,
      commissionRate: d.commissionRate ?? owner.commissionRate,
    })
    if (item.available < calc.quantity)
      throw new Error('Not enough consignment items available.')
    const when = date(d.date),
      sale = put('consignment_sales', {
        id,
        name: item.name,
        itemId: item.id,
        consignorId: owner.id,
        date: when,
        channel: text(d.channel),
        ...calc,
        deductionApproval: text(d.deductionApproval),
        feeAgreement: text(d.feeAgreement),
        method: text(d.method),
        paid: 0,
        status: 'unpaid',
        taxSnapshot: {
          amount: calc.tax,
          source: 'User-confirmed tax collected',
          notes: text(d.taxNotes),
        },
      })
    put('consignment_items', {
      ...item,
      available: item.available - calc.quantity,
      sold: item.sold + calc.quantity,
    })
    put('consignment_movements', {
      id: newId(),
      name: item.name,
      itemId: item.id,
      consignorId: owner.id,
      quantity: -calc.quantity,
      date: when,
      type: 'sale',
      saleId: sale.id,
    })
    entry = journal('Consignment sale: ' + item.name, when, [
      debit('Cash', calc.cash),
      debit('Payment processing fees', calc.businessFee),
      credit('Consignment Payable', calc.payable),
      credit(
        'Consignment Commission Income',
        calc.commission + calc.deductions,
      ),
      credit('Sales Tax Payable', calc.tax),
    ])
    description = 'Consignment sale recorded'
  } else if (action === 'consignmentRefund') {
    const original = owned(w, 'consignment_sales', d.id)
    if (original.refundOf) throw new Error('Choose an original sale to refund.')
    if ((w.consignment_sales || []).some((s) => s.refundOf === original.id))
      throw new Error('This sale is already refunded.')
    if (!text(d.reason)) throw new Error('Record a refund reason.')
    const when = date(d.date),
      item = owned(w, 'consignment_items', original.itemId)
    put('consignment_sales', {
      ...original,
      id,
      name: 'Refund: ' + original.name,
      date: when,
      quantity: -original.quantity,
      gross: -original.gross,
      discounts: -original.discounts,
      refunds: original.merchandise,
      merchandise: -original.merchandise,
      commission: -original.commission,
      deductions: -original.deductions,
      consignorFee: -original.consignorFee,
      businessFee: original.consignorFee,
      fees: 0,
      tax: -original.tax,
      payable: -original.payable,
      paid: 0,
      status: 'refunded',
      refundOf: original.id,
      reason: text(d.reason),
      taxSnapshot: { ...original.taxSnapshot, amount: -original.tax },
      cash: -(original.merchandise + original.tax),
    })
    put('consignment_items', {
      ...item,
      available: item.available + original.quantity,
      sold: item.sold - original.quantity,
    })
    put('consignment_movements', {
      id: newId(),
      name: item.name,
      itemId: item.id,
      consignorId: item.consignorId,
      quantity: original.quantity,
      date: when,
      type: 'refund_return',
      saleId: id,
    })
    entry = journal('Consignment refund: ' + item.name, when, [
      debit('Consignment Payable', original.payable),
      debit(
        'Consignment Commission Income',
        original.commission + original.deductions,
      ),
      debit('Payment processing fees', original.consignorFee),
      debit('Sales Tax Payable', original.tax),
      credit('Cash', original.merchandise + original.tax),
    ])
    description = 'Consignment sale refunded; original retained'
  } else if (action === 'consignmentPayout') {
    const owner = owned(w, 'consignors', d.consignorId),
      amount = money(d.amount, 'Payout amount', 0.01),
      when = date(d.date)
    if (!text(d.method)) throw new Error('Choose a payment method.')
    if (amount > consignmentBalance(w, owner.id))
      throw new Error('Payout exceeds the outstanding balance.')
    let left = amount
    const allocations: Record<string, any>[] = []
    for (const s of (w.consignment_sales || [])
      .filter(
        (s) =>
          s.consignorId === owner.id &&
          (!Array.isArray(d.saleIds) || d.saleIds.includes(s.id)) &&
          !s.refundOf &&
          !(w.consignment_sales || []).some((r) => r.refundOf === s.id) &&
          s.paid < s.payable,
      )
      .sort((a, b) => a.date.localeCompare(b.date))) {
      const applied = Math.min(roundMoney(s.payable - s.paid), left)
      if (!applied) continue
      put('consignment_sales', {
        ...s,
        paid: roundMoney(s.paid + applied),
        status:
          roundMoney(s.paid + applied) === s.payable
            ? 'paid'
            : 'partially_paid',
      })
      allocations.push({ ...s, applied })
      left = roundMoney(left - applied)
    }
    if (left > 0)
      throw new Error(
        'Payout exceeds the selected unpaid sales. Review the amount and selection.',
      )
    const proofId = d.receiptId
      ? owned(w, 'receipt_extractions', d.receiptId).id
      : undefined
    put('consignment_payouts', {
      id,
      name: owner.name,
      consignorId: owner.id,
      consignorSnapshot: { ...owner },
      date: when,
      amount,
      method: text(d.method),
      reference: text(d.reference),
      receiptId: proofId,
      allocations,
      remainingBalance: roundMoney(consignmentBalance(w, owner.id) - amount),
    })
    entry = journal('Payout to ' + owner.name, when, [
      debit('Consignment Payable', amount),
      credit('Cash', amount),
    ])
    description = 'Consignor payout recorded'
  } else if (action === 'financeEntry') {
    const when = date(d.date),
      amount = money(d.amount, 'Amount', 0.01),
      kind = text(d.kind)
    if (
      ![
        'contribution',
        'draw',
        'vendorPayment',
        'expense',
        'bill',
        'transfer',
      ].includes(kind)
    )
      throw new Error('Choose a transaction type.')
    if (kind !== 'transfer' && !text(d.name))
      throw new Error('Enter an owner, vendor, or description.')
    let lines: Posting[] = []
    const c =
      kind === 'expense' || kind === 'bill' ? category(d.category) : undefined
    let bill: Item | undefined
    if (kind === 'vendorPayment') {
      bill = owned(w, 'finance_transactions', d.billId)
      if (bill.kind !== 'bill' || bill.reversedBy)
        throw new Error('Choose an unpaid bill.')
      if (amount > roundMoney(bill.amount - (bill.paid || 0)))
        throw new Error('Payment exceeds the bill balance.')
      put('finance_transactions', {
        ...bill,
        paid: roundMoney((bill.paid || 0) + amount),
      })
    }
    if (kind === 'transfer') {
      if (
        !['Cash', 'Bank account'].includes(d.sourceAccount) ||
        !['Cash', 'Bank account'].includes(d.destinationAccount)
      )
        throw new Error('Choose business cash or bank accounts.')
      if (d.sourceAccount === d.destinationAccount)
        throw new Error('Choose different source and destination accounts.')
      lines = [
        debit(d.destinationAccount, amount),
        credit(d.sourceAccount, amount),
      ]
    }
    if (kind === 'contribution')
      lines = [debit('Cash', amount), credit('Owner equity', amount)]
    if (kind === 'draw')
      lines = [debit('Owner draws', amount), credit('Cash', amount)]
    if (kind === 'vendorPayment')
      lines = [debit('Accounts payable', amount), credit('Cash', amount)]
    if (kind === 'expense' || kind === 'bill')
      lines = [
        debit(c!, amount),
        credit(kind === 'bill' ? 'Accounts payable' : 'Cash', amount),
      ]
    let splits: any[] = []
    if (
      (kind === 'expense' || kind === 'bill') &&
      Array.isArray(d.splits) &&
      d.splits.length
    ) {
      if (d.splits.length > 30)
        throw new Error('Use at most 30 split categories.')
      splits = d.splits.map((s: any) => ({
        category: category(s.category),
        amount: money(s.amount, 'Split amount', 0.01),
      }))
      if (roundMoney(splits.reduce((a, s) => a + s.amount, 0)) !== amount)
        throw new Error(
          'Split categories must add up to the transaction amount.',
        )
      lines = [
        ...splits.map((s) => debit(s.category, s.amount)),
        credit(kind === 'bill' ? 'Accounts payable' : 'Cash', amount),
      ]
    }
    const receiptId = d.receiptId
      ? owned(w, 'receipt_extractions', d.receiptId).id
      : undefined
    if (
      receiptId &&
      (owned(w, 'receipt_extractions', receiptId).status === 'posted' ||
        (w.finance_transactions || []).some(
          (t) =>
            t.receiptId === receiptId && !t.reversedBy && t.kind !== 'reversal',
        ))
    )
      throw new Error(
        'This receipt already supports a posted transaction. Use its existing activity or a correction.',
      )

    const tx = put('finance_transactions', {
      id,
      name:
        kind === 'transfer'
          ? `Transfer from ${d.sourceAccount} to ${d.destinationAccount}`
          : text(d.name),
      sourceAccount: kind === 'transfer' ? d.sourceAccount : undefined,
      destinationAccount:
        kind === 'transfer' ? d.destinationAccount : undefined,
      kind,
      date: when,
      amount,
      category: c,
      method: text(d.method),
      notes: text(d.notes),
      deductible: d.deductible !== false,
      splits,
      receiptId,
      billId: bill?.id,
      paid: 0,
      status: 'posted',
    })
    if (kind === 'expense' || kind === 'bill')
      for (const split of splits.length ? splits : [{ amount, category: c }])
        put('expenses', {
          ...tx,
          ...split,
          id: newId(),
          transactionId: id,
          inventory: false,
        })
    entry = journal(tx.name, when, lines)
    description = 'Financial activity recorded'
  } else if (
    action === 'receiptCreateItem' ||
    action === 'receiptDraft' ||
    action === 'receiptCancel' ||
    action === 'receiptPost'
  ) {
    const old = owned(w, 'receipt_extractions', d.id)
    if (old.status !== 'draft')
      throw new Error(
        'This receipt is closed. Use a correction rather than editing it.',
      )
    const receipt: Item = {
      ...old,
      vendor: text(d.vendor ?? old.vendor),
      name: text(d.vendor ?? old.vendor) || old.name,
      date: Object.hasOwn(d, 'date') ? d.date : old.date,
      receivedDate: d.receivedDate || old.receivedDate || today,
      receiptNumber: text(d.receiptNumber ?? old.receiptNumber),
      currency: text(d.currency ?? old.currency).toUpperCase(),
      discounts: emptyReceiptValue(d.discounts ?? old.discounts)
        ? null
        : money(d.discounts ?? old.discounts, 'Discounts'),
      adjustment: emptyReceiptValue(d.adjustment ?? old.adjustment)
        ? 0
        : money(d.adjustment ?? old.adjustment, 'Adjustment', -0.05),
      adjustmentReason: text(d.adjustmentReason ?? old.adjustmentReason),
      subtotal: emptyReceiptValue(
        Object.hasOwn(d, 'subtotal') ? d.subtotal : old.subtotal,
      )
        ? null
        : money(d.subtotal ?? old.subtotal, 'Subtotal'),
      tax: emptyReceiptValue(Object.hasOwn(d, 'tax') ? d.tax : old.tax)
        ? null
        : money(d.tax ?? old.tax, 'Tax'),
      total: emptyReceiptValue(Object.hasOwn(d, 'total') ? d.total : old.total)
        ? null
        : money(d.total ?? old.total, 'Total'),
      otherCharges: emptyReceiptValue(
        Object.hasOwn(d, 'otherCharges') ? d.otherCharges : old.otherCharges,
      )
        ? null
        : money(d.otherCharges ?? old.otherCharges, 'Other charges'),
      method: text(d.method ?? old.method),
      lines: d.lines ?? old.lines,
      status: action === 'receiptCancel' ? 'cancelled' : 'draft',
      previewCrop:
        Array.isArray(d.previewCrop) && d.previewCrop.length === 4
          ? d.previewCrop.map((v: any) => Math.min(40, number(v, 'Crop')))
          : old.previewCrop,
      history: [
        ...(old.history || []),
        {
          action: action === 'receiptCancel' ? 'cancelled' : 'edited',
          at: new Date().toISOString(),
          previousReview: {
            vendor: old.vendor,
            date: old.date,
            receivedDate: old.receivedDate,
            subtotal: old.subtotal,
            tax: old.tax,
            total: old.total,
            lines: structuredClone(old.lines || []),
          },
        },
      ],
    }
    if (!Array.isArray(receipt.lines) || receipt.lines.length > 150)
      throw new Error('Use no more than 150 receipt lines.')
    if (action === 'receiptCreateItem') {
      const index = number(d.lineIndex, 'Receipt line index')
      const l = receipt.lines[index]
      if (!l || !l.createNew)
        throw new Error('Choose a new inventory item on this receipt line.')
      if (
        l.itemCreationId &&
        old.lines?.[index]?.itemCreationId === l.itemCreationId &&
        old.lines[index].createNew === false
      )
        return {
          writes: [],
          description: 'Inventory item already created and matched.',
        }
      const created = receiptNewInventory(l, newId(), w.vendors)
      put(created.itemTable, created.item)
      receipt.lines = receipt.lines.map((line: any, n: number) =>
        n === index
          ? {
              ...line,
              createNew: false,
              itemId: created.item.id,
              itemTable: created.itemTable,
              unit: line.unit,
              stockQuantityConfirmed: false,
            }
          : line,
      )
      receipt.history.push({
        action: 'created and matched inventory item; no stock received',
        itemId: created.item.id,
        itemTable: created.itemTable,
        at: new Date().toISOString(),
      })
    }
    if (action === 'receiptPost') {
      if (old.extractionStatus === 'processing')
        throw new Error('Wait for extraction to finish before posting.')
      for (const key of ['subtotal', 'tax', 'total'])
        if (emptyReceiptValue(receipt[key]))
          throw new Error(
            'Enter ' + key + '; unknown amounts cannot be posted as zero.',
          )
      for (const line of receipt.lines)
        if (emptyReceiptValue(line.amount))
          throw new Error('Enter every line amount before posting.')
      if (old.matchedTransactionId)
        throw new Error('This receipt is already matched to a purchase.')
      if (
        (w.finance_transactions || []).some(
          (t) =>
            t.receiptId === old.id && !t.reversedBy && t.kind !== 'reversal',
        )
      )
        throw new Error(
          'This receipt is already attached to a posted transaction. Review that activity before posting it again.',
        )
      date(receipt.date)
      date(receipt.receivedDate)
      if (
        receipt.currency &&
        receipt.currency !== (w.settings[0]?.currency || 'USD')
      )
        throw new Error(
          'Receipt currency differs from the oven currency. Currency conversion is not supported; no entries were posted.',
        )
      if (
        Math.abs(receipt.adjustment) > 0.05 ||
        (receipt.adjustment !== 0 && !receipt.adjustmentReason)
      )
        throw new Error(
          'Rounding adjustments require an explanation and must be within five cents. Record other fees explicitly.',
        )
      if (!receipt.vendor || !receipt.lines.length)
        throw new Error('Enter a vendor and at least one receipt line.')
      if (duplicateReceipts(w, receipt).some((x) => x.status === 'posted'))
        throw new Error(
          'A matching receipt is already posted. Review it before creating another transaction.',
        )
      if (duplicateReceipts(w, receipt).length && !d.duplicateReviewed)
        throw new Error(
          'Review the possible duplicate and confirm before posting.',
        )
      if (
        money(
          receipt.subtotal +
            receipt.tax +
            (receipt.otherCharges ?? 0) +
            receipt.adjustment,
          'Total',
        ) !== receipt.total
      )
        throw new Error(
          'Subtotal plus tax, other charges and explicit rounding must equal the receipt total.',
        )
      if (
        money(
          receipt.lines.reduce(
            (s: number, l: any) => s + money(l.amount, 'Line amount'),
            0,
          ),
          'Line total',
        ) !== receipt.subtotal
      )
        throw new Error(
          'Line amounts must equal the subtotal. Include discounts as reductions in each line amount.',
        )
      const lines: Posting[] = [],
        stock = new Map<string, Item>()
      let allocatedTax = 0,
        allocatedCharges = 0
      const lineSnapshots: Record<string, any>[] = []
      for (const [index, l] of receipt.lines.entries()) {
        const taxShare =
          index === receipt.lines.length - 1
            ? roundMoney(receipt.tax - allocatedTax)
            : roundMoney(
                receipt.subtotal
                  ? (receipt.tax * l.amount) / receipt.subtotal
                  : 0,
              )
        allocatedTax = roundMoney(allocatedTax + taxShare)
        const otherChargesShare =
          index === receipt.lines.length - 1
            ? roundMoney(
                (receipt.otherCharges ?? 0) +
                  receipt.adjustment -
                  allocatedCharges,
              )
            : roundMoney(
                receipt.subtotal
                  ? (((receipt.otherCharges ?? 0) + receipt.adjustment) *
                      l.amount) /
                      receipt.subtotal
                  : 0,
              )
        allocatedCharges = roundMoney(allocatedCharges + otherChargesShare)
        const amount = roundMoney(
          Number(l.amount) + taxShare + otherChargesShare,
        )
        if (!['inventory', 'expense', 'personal'].includes(l.decision))
          throw new Error('Choose what to do with every receipt line.')
        if (l.decision === 'inventory') {
          let item: Item
          const itemTable =
            l.itemTable === 'products' || (l.createNew && l.usedAs === 'resale')
              ? 'products'
              : 'ingredients'
          if (l.createNew) {
            item = receiptNewInventory(l, newId(), w.vendors).item
          } else
            item = {
              ...(stock.get(itemTable + ':' + l.itemId) ||
                owned(w, itemTable, l.itemId)),
            }
          if (l.productDetails)
            Object.assign(
              item,
              reviewedProductMetadata(item, l.productDetails, w.vendors),
            )
          if (
            itemTable === 'products' &&
            (item.workflow !== 'resale' || item.trackInventory === false)
          )
            throw new Error(
              'Choose purchased resale merchandise from this oven; handmade stock requires production.',
            )
          if (isFabric(item) && l.createNew) validateFabric(item)
          if (item.compoundRecipeId)
            throw new Error(
              'Receive purchased ingredients, not compound preps.',
            )
          if (Object.hasOwn(l, 'printedQuantity') && !l.stockQuantityConfirmed)
            throw new Error(
              'Confirm the actual received quantity and unit for each inventory line; printed package counts do not establish stock contents.',
            )
          const q =
            itemTable === 'products'
              ? resaleReceivedQuantity(l)
              : isFabric(item)
                ? fabricReceipt(item, {
                    ...l,
                    quantity: l.quantity,
                    unit: l.unit,
                  })
                : convert(
                    number(l.quantity, 'Received quantity', 0.000001),
                    l.unit,
                    item.unit,
                    item.conversions,
                  )
          if (
            isFabric(item) &&
            item.pieceMode === 'separate' &&
            item.quantity > 1e-9
          )
            throw new Error(
              'Receive a different fabric piece as a separate record, not into an existing piece.',
            )
          const priorCost = item.cost,
            priorQuantity = item.quantity
          item.cost = (item.quantity * item.cost + amount) / (item.quantity + q)
          item.currentCost = item.cost
          item.quantity += q
          item.needsCostSetup = false
          if (itemTable === 'products') item.stockCostKnown = true
          stock.set(itemTable + ':' + item.id, item)
          put('ledger', {
            id: newId(),
            name: item.name + ' received',
            ...(itemTable === 'products'
              ? { productId: item.id }
              : { ingredientId: item.id }),
            quantity: q,
            unit: item.unit,
            amount,
            date: receipt.receivedDate,
            receivedDate: receipt.receivedDate,
            purchaseDate: receipt.date,
            type: 'purchase_receipt',
            receiptId: old.id,
            transactionId: id,
            reason: 'Confirmed receipt',
            vendor: receipt.vendor,
            priorCost,
            priorQuantity,
            unitCost: amount / q,
            purchaseQuantity: l.quantity,
            purchaseUnit: l.unit,
            lot: text(l.lot),
            expires: text(l.expires),
          })
          if (itemTable === 'ingredients' && (l.lot || l.expires))
            put('lots', {
              id: newId(),
              name: text(l.lot) || item.name,
              ingredientId: item.id,
              quantity: q,
              unit: item.unit,
              expires: text(l.expires),
              receiptId: old.id,
              date: receipt.date,
            })
          lines.push(debit('Inventory asset', amount))
          put('vendor_matches', {
            id: newId(),
            name: receipt.vendor,
            vendor: receipt.vendor.toLowerCase(),
            description: text(l.description).toLowerCase(),
            itemId: item.id,
            itemTable,
            decision: 'inventory',
          })
          lineSnapshots.push({
            ...l,
            itemId: item.id,
            itemTable,
            createNew: false,
            normalizedQuantity: q,
            priorCost,
            newCost: item.cost,
            taxShare,
            otherChargesShare,
            postedAmount: amount,
          })
        } else if (l.decision === 'expense') {
          const c = category(l.category)
          put('expenses', {
            id: newId(),
            name: text(l.description) || receipt.vendor,
            date: receipt.date,
            vendor: receipt.vendor,
            category: c,
            amount,
            inventory: false,
            receiptId: old.id,
            transactionId: id,
            deductible: l.deductible !== false,
          })
          lines.push(debit(c, amount))
          put('vendor_matches', {
            id: newId(),
            name: receipt.vendor,
            vendor: receipt.vendor.toLowerCase(),
            description: text(l.description).toLowerCase(),
            category: c,
            decision: 'expense',
          })
          lineSnapshots.push({
            ...l,
            taxShare,
            otherChargesShare,
            postedAmount: amount,
          })
        } else {
          lines.push(debit('Owner draws', amount))
          lineSnapshots.push({
            ...l,
            taxShare,
            otherChargesShare,
            postedAmount: amount,
          })
        }
      }
      for (const [key, item] of stock)
        put(key.startsWith('products:') ? 'products' : 'ingredients', item)
      lines.push(credit('Cash', receipt.total))
      entry = journal('Receipt: ' + receipt.vendor, receipt.date, lines)
      put('finance_transactions', {
        id,
        name: receipt.vendor,
        kind: 'receipt',
        date: receipt.date,
        amount: receipt.total,
        receiptId: old.id,
        status: 'posted',
        journalId: entry.id,
        lineSnapshots,
      })
      receipt.status = 'posted'
      receipt.transactionId = id
      receipt.journalId = entry.id
      receipt.postedLines = lineSnapshots
      receipt.lines = lineSnapshots
      receipt.history.push(
        { action: 'confirmed', at: new Date().toISOString() },
        { action: 'posted', at: new Date().toISOString(), transactionId: id },
      )
    }
    put('receipt_extractions', receipt)
    description =
      action === 'receiptPost'
        ? 'Receipt confirmed and posted'
        : action === 'receiptCancel'
          ? 'Receipt cancelled'
          : 'Receipt draft saved'
  } else if (action === 'financeReverse') {
    const original = owned(w, 'finance_transactions', d.id)
    if (original.reversedBy)
      throw new Error('This transaction is already reversed.')
    if (original.kind === 'bill' && (original.paid || 0) > 0)
      throw new Error('Reverse related vendor payments first.')
    if (!text(d.reason)) throw new Error('Enter a correction reason.')
    const source = (w.journals || []).find((j) => j.sourceId === original.id)
    if (!source) throw new Error('The original journal is unavailable.')
    const when = date(d.date || today)
    let reverseLines: Posting[] = source.lines.map((l: Posting) => ({
      account: l.account,
      debit: l.credit,
      credit: l.debit,
    }))
    if (original.kind === 'receipt') {
      reverseLines = [debit('Cash', original.amount)]
      const stock = new Map<string, Item>()
      let currentInventoryValue = 0,
        originalInventoryValue = 0
      for (const line of original.lineSnapshots || []) {
        if (line.decision === 'inventory') {
          const item = {
            ...(stock.get(
              (line.itemTable || 'ingredients') + ':' + line.itemId,
            ) ||
              owned(
                w,
                line.itemTable === 'products' ? 'products' : 'ingredients',
                line.itemId,
              )),
          }
          if (item.quantity < line.normalizedQuantity)
            throw new Error(
              'Not enough stock to reverse this receipt. Review consumed stock before making a correction.',
            )
          const value = roundMoney(line.normalizedQuantity * item.cost)
          item.quantity -= line.normalizedQuantity
          stock.set((line.itemTable || 'ingredients') + ':' + item.id, item)
          currentInventoryValue = roundMoney(currentInventoryValue + value)
          originalInventoryValue = roundMoney(
            originalInventoryValue + line.postedAmount,
          )
          reverseLines.push(credit('Inventory asset', value))
          put('ledger', {
            id: newId(),
            name: 'Receipt correction: ' + item.name,
            ...(line.itemTable === 'products'
              ? { productId: item.id }
              : { ingredientId: item.id }),
            quantity: -line.normalizedQuantity,
            unit: item.unit,
            amount: -value,
            date: when,
            type: 'receipt_reversal',
            receiptId: original.receiptId,
            transactionId: id,
            reason: text(d.reason),
            originalTransactionId: original.id,
            unitCost: item.cost,
          })
        } else
          reverseLines.push(
            credit(
              line.decision === 'personal' ? 'Owner draws' : line.category,
              line.postedAmount,
            ),
          )
      }
      const variance = roundMoney(
        currentInventoryValue - originalInventoryValue,
      )
      if (variance > 0)
        reverseLines.push(debit('Miscellaneous expense', variance))
      else if (variance < 0)
        reverseLines.push(credit('Miscellaneous expense', -variance))
      for (const [key, item] of stock)
        put(key.startsWith('products:') ? 'products' : 'ingredients', item)
    }
    entry = journal('Reversal: ' + original.name, when, reverseLines)
    put('finance_transactions', { ...original, reversedBy: id })
    put('finance_transactions', {
      id,
      name: 'Reversal: ' + original.name,
      kind: 'reversal',
      date: when,
      amount: -original.amount,
      originalId: original.id,
      receiptId: original.receiptId,
      reason: text(d.reason),
      status: 'posted',
    })
    for (const exp of (w.expenses || []).filter(
      (e) => e.transactionId === original.id,
    ))
      put('expenses', {
        ...exp,
        id: newId(),
        amount: -exp.amount,
        date: when,
        transactionId: id,
      })
    if (original.kind === 'vendorPayment') {
      const bill = owned(w, 'finance_transactions', original.billId)
      put('finance_transactions', {
        ...bill,
        paid: roundMoney(bill.paid - original.amount),
      })
    }
    description = 'Correction posted; original preserved'
  } else throw new Error('Unknown finance action.')
  if (entry && d.requestId) {
    entry.requestId = text(d.requestId).slice(0, 120)
    entry.sourceAction = action
  }
  return { writes, journal: entry, description }
}
