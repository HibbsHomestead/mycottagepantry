import { consignmentBalance } from './finance'
import {
  recipeCost,
  productCosting,
  profitability,
  type Workspace,
  type Item,
} from './domain'
export function reportRows(name: string, state: Workspace): Item[] {
  const { ingredients, recipes, products, sales, expenses, batches, ledger } =
    state
  const productCost = (p: Item) => {
    return productCosting(p, state).perPackage
  }

  const commission = (state.consignment_sales || []).reduce(
      (a, s) => a + s.commission + s.deductions,
      0,
    ),
    consignmentFees = (state.consignment_sales || []).reduce(
      (a, s) => a + s.businessFee,
      0,
    )
  if (name === 'Consignment sales') return state.consignment_sales || []
  if (name === 'Payout history') return state.consignment_payouts || []
  if (name === 'Unpaid consignment balances')
    return (state.consignors || []).map((o) => ({
      id: o.id,
      name: o.name,
      amount: consignmentBalance(state, o.id),
    }))
  const revenue = sales.reduce((s, i) => s + i.amount, 0),
    cogs = sales.reduce(
      (s, i) =>
        s +
        (i.historicalCogs ??
          productCost(
            products.find((p) => p.id === i.productId) || products[0],
          ) * i.quantity),
      0,
    ),
    fees = sales.reduce((s, i) => s + (i.fees || 0), 0),
    operating = expenses
      .filter((e) => !e.inventory)
      .reduce((s, e) => s + e.amount, 0)
  if (name === 'Profit & loss')
    return [
      ['Net product sales', revenue],
      ['Consignment commission income', commission],
      ['Estimated COGS', -cogs],
      ['Gross profit', revenue + commission - cogs],
      ['Operating expenses', -operating],
      ['Processing fees', -fees - consignmentFees],
      [
        'Estimated net profit',
        revenue + commission - cogs - operating - fees - consignmentFees,
      ],
    ].map(([name, amount], i) => ({
      id: String(i),
      name: String(name),
      amount,
    }))
  if (name === 'Cash-flow summary')
    return [
      { id: '1', name: 'Sales receipts', amount: revenue },
      {
        id: '2',
        name: 'Tax held separately',
        amount: sales.reduce((s, i) => s + (i.tax || 0), 0),
      },
      {
        id: '3',
        name: 'Purchases and expenses paid',
        amount: -expenses.reduce((s, i) => s + i.amount, 0),
      },
      { id: '4', name: 'Processing fees', amount: -fees },
    ]
  if (name === 'Sales by product' || name === 'Product profitability')
    return products.map((p) => {
      let cost: number | null
      try {
        cost = productCost(p)
      } catch (error) {
        if (p.workflow !== 'kit') throw error
        cost = null
      }
      const transactions = sales.filter((s) => s.productId === p.id)
      let marginPercent: number | string
      try {
        if (cost === null) throw new Error('Incomplete kit estimate')
        marginPercent = profitability(p, cost, state.settings[0]).margin
      } catch {
        marginPercent = 'Unavailable — review tax configuration'
      }
      return {
        id: p.id,
        name: p.name,
        packages: transactions.reduce((s, i) => s + i.quantity, 0),
        revenue: transactions.reduce((s, i) => s + i.amount, 0),
        unitCost: cost === null ? 'Unavailable — incomplete estimate' : cost,
        retail: p.price,
        marginPercent,
      }
    })
  if (name === 'Sales by channel')
    return [...new Set(sales.map((s) => s.channel))].map((channel) => ({
      id: channel,
      name: channel,
      amount: sales
        .filter((s) => s.channel === channel)
        .reduce((a, s) => a + s.amount, 0),
    }))
  if (
    name.startsWith('Sales tax') ||
    [
      'Tax-inclusive reconciliation',
      'Tax-exclusive reconciliation',
      'Tax-exempt / zero-rated sales',
      'Refund tax adjustments',
    ].includes(name)
  ) {
    const consignmentTaxes = (state.consignment_sales || []).map((s): Item => ({
      ...s,
      amount: s.merchandise,
      customerTotal: s.merchandise + s.tax,
      taxStatus: 'manual_consignment',
      taxSnapshot: [],
      source: 'consignment',
    }))
    const transactions = [...sales, ...consignmentTaxes].filter((s) =>
      name === 'Refund tax adjustments'
        ? s.refundOf
        : name === 'Tax-exempt / zero-rated sales'
          ? ['exempt', 'zero_rated'].includes(s.taxStatus)
          : true,
    )
    if (name !== 'Sales tax collected' && !name.startsWith('Sales tax by')) {
      return transactions
        .filter((s) =>
          name === 'Tax-inclusive reconciliation'
            ? s.taxSnapshot?.some((r: any) => r.behavior === 'inclusive')
            : name === 'Tax-exclusive reconciliation'
              ? s.taxSnapshot?.some((r: any) => r.behavior === 'exclusive')
              : true,
        )
        .map((s) => ({
          id: s.id,
          name: s.name,
          date: s.date,
          enteredAmount: s.enteredAmount ?? s.amount,
          preTaxRevenue: s.amount,
          inclusiveTax: (s.taxSnapshot || [])
            .filter((r: any) => r.behavior === 'inclusive')
            .reduce((total: number, r: any) => total + r.amount, 0),
          exclusiveTax: (s.taxSnapshot || [])
            .filter((r: any) => r.behavior === 'exclusive')
            .reduce((total: number, r: any) => total + r.amount, 0),
          tax: s.tax || 0,
          customerTotal: s.customerTotal ?? s.amount + (s.tax || 0),
          taxStatus: s.taxStatus || 'legacy',
          refundOf: s.refundOf || '',
          taxSnapshot: s.taxSnapshot || [],
        }))
    }
    const rows = transactions
      .flatMap((s) =>
        (s.taxSnapshot?.length
          ? s.taxSnapshot
          : [
              {
                id: 'unallocated',
                name: s.taxStatus || 'Legacy / no applicable rate',
                jurisdiction: 'Unallocated / no tax',
                ratePercent: 0,
                behavior: 'unrecorded',
                taxableBase: s.amount,
                amount: s.tax || 0,
              },
            ]
        ).map((r: any) => ({
          id: `${s.id}-${r.id}`,
          name: s.name,
          date: s.date,
          rate: r.name,
          rateId: r.id,
          jurisdiction: r.jurisdiction,
          behavior: r.behavior,
          ratePercent: r.ratePercent,
          taxableBase: r.taxableBase,
          tax: r.amount,
          preTaxRevenue: s.amount,
          customerTotal: s.customerTotal ?? s.amount + (s.tax || 0),
          taxStatus: s.taxStatus || 'legacy',
          refundOf: s.refundOf || '',
        })),
      )
      .filter((r) =>
        name === 'Tax-inclusive reconciliation'
          ? r.behavior === 'inclusive'
          : name === 'Tax-exclusive reconciliation'
            ? r.behavior === 'exclusive'
            : true,
      )
    if (name === 'Sales tax by jurisdiction' || name === 'Sales tax by rate') {
      const key = name === 'Sales tax by rate' ? 'rateId' : 'jurisdiction'
      return [...new Set(rows.map((r) => r[key]))].map((id) => ({
        id,
        name: key === 'rateId' ? rows.find((r) => r.rateId === id)!.rate : id,
        tax: rows.filter((r) => r[key] === id).reduce((s, r) => s + r.tax, 0),
      }))
    }
    return rows
  }
  if (name === 'Expense categories')
    return [...new Set(expenses.map((s) => s.category))].map((category) => ({
      id: category,
      name: category,
      amount: expenses
        .filter((s) => s.category === category)
        .reduce((a, s) => a + s.amount, 0),
    }))
  if (name === 'Inventory valuation')
    return ingredients.map((i) => ({
      id: i.id,
      name: i.name,
      quantity: i.quantity,
      unit: i.unit,
      unitCost: i.cost,
      value: i.quantity * i.cost,
    }))
  if (name === 'Low stock & reorders')
    return ingredients
      .filter((i) => i.quantity <= i.threshold)
      .map((i) => ({
        id: i.id,
        name: i.name,
        quantity: i.quantity,
        unit: i.unit,
        reorderAt: i.threshold,
        suggestedQuantity: Math.max(i.threshold * 2 - i.quantity, 0),
        vendor: i.vendor,
      }))
  if (name === 'Batch cost variance')
    return batches.map((b) => {
      const r = recipes.find((r) => r.id === b.recipeId)!
      const planned = recipeCost(r, ingredients) * b.count
      return {
        id: b.id,
        name: b.name,
        date: b.date,
        status: b.status,
        plannedCost: planned,
        historicalCost: b.historicalCost ?? null,
        variance:
          b.historicalCost !== undefined ? b.historicalCost - planned : null,
      }
    })
  if (name === 'Waste & spoilage')
    return ledger.filter((l) => ['waste', 'spoilage'].includes(l.type))
  return ledger.filter((l) => l.type === 'purchase_receipt')
}
export function parseCsv(text: string): Record<string, any>[] {
  const rows: string[][] = []
  let row: string[] = [],
    cell = '',
    quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"'
        i++
      } else quoted = !quoted
    } else if (c === ',' && !quoted) {
      row.push(cell)
      cell = ''
    } else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      if (row.some(Boolean)) rows.push(row)
      row = []
      cell = ''
    } else cell += c
  }
  if (quoted) throw new Error('Unclosed quotation mark in CSV.')
  row.push(cell)
  if (row.some(Boolean)) rows.push(row)
  const headers = rows.shift()
  if (!headers?.includes('name'))
    throw new Error('CSV must contain a name column.')
  if (rows.length > 500) throw new Error('Import up to 500 rows at a time.')
  return rows.map((values) =>
    Object.fromEntries(
      headers.map((h, i) => {
        const value = values[i] ?? ''
        let parsed: any = value
        if (value === 'true') parsed = true
        else if (value === 'false') parsed = false
        else if (value.startsWith('[') || value.startsWith('{')) {
          try {
            parsed = JSON.parse(value)
          } catch {
            throw new Error(`Invalid JSON in ${h}.`)
          }
        }
        return [h, parsed]
      }),
    ),
  )
}
