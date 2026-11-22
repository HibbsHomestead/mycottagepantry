// @vitest-environment node
import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import {
  detectSquare,
  parseSquare,
  reconcileSquare,
  squareMoney,
  squareReportTotals,
  suggestSquare,
  type SquareBatch,
} from './square-sales'
async function batch(kind: string, id = kind): Promise<SquareBatch> {
  const csv = await readFile(`public/demo/square-${kind}.csv`, 'utf8')
  const options = detectSquare(csv)
  return {
    id,
    name: kind,
    provider: 'square',
    status: 'committed',
    fingerprint: id,
    options,
    ...parseSquare(csv, options),
    choices: {},
  }
}
const amount = (rows: any[], key: string) =>
  rows.reduce((a, r) => a + (r[key] || 0), 0)
it('retains legitimate identical sales and counts multi-item transaction amounts once', async () => {
  const b = await batch('items')
  const p = reconcileSquare([b])
  expect(p.transactions).toBe(4)
  expect(p.itemRows).toBe(5)
  expect(amount(p.sales, 'amount')).toBe(34)
  expect(amount(p.sales, 'tax')).toBeCloseTo(2.04)
  expect(amount(p.sales, 'tips')).toBe(2)
  expect(amount(p.sales, 'fees')).toBeCloseTo(1.58)
  expect(squareReportTotals(b)[0].values).toMatchObject({
    net: 3400,
    tax: 204,
    tips: 200,
    fees: 158,
    refunds: 200,
    discounts: 200,
  })
})
it('merges transaction and item exports in either order without double counting, and undo retains complementary contributions', async () => {
  const a = await batch('items'),
    b = await batch('transactions')
  for (const pair of [
    [a, b],
    [b, a],
  ]) {
    const p = reconcileSquare(pair)
    expect(amount(p.sales, 'amount')).toBe(34)
    expect(p.transactions).toBe(4)
    expect(p.itemRows).toBe(5)
    expect(amount(p.sales, 'tax')).toBeCloseTo(2.04)
  }
  expect(
    amount(reconcileSquare([a, { ...b, status: 'reversed' }]).sales, 'amount'),
  ).toBe(34)
  expect(
    amount(reconcileSquare([{ ...a, status: 'reversed' }, b]).sales, 'amount'),
  ).toBe(34)
})
it('uses line identifiers for overlap and retains new sales; contradictory corrections fail closed', async () => {
  const a = await batch('items'),
    b = await batch('overlap')
  expect(amount(reconcileSquare([a, b]).sales, 'amount')).toBe(40)
  expect(reconcileSquare([a, b]).duplicates).toBe(2)
  b.rows[0].amounts.net = 900
  expect(() => reconcileSquare([a, b])).toThrow(/changed between reports/)
})
it('does not infer name matches or pack sizes and respects saved mappings and unique SKU', async () => {
  const b = await batch('items')
  const row = b.rows[0]
  const products = [
    { id: 'cookies', name: row.item, sku: 'SIM-COOKIE-3', workflow: 'food' },
  ]
  const choice = suggestSquare(row, products, []).choice
  expect(choice).toEqual({ productId: 'cookies', multiplier: 1 })
  b.choices[row.mappingKey] = choice
  expect(
    reconcileSquare([b]).sales.find((s) => s.productId === 'cookies')?.quantity,
  ).toBe(2)
  b.choices[row.mappingKey].multiplier = 3
  expect(
    reconcileSquare([b]).sales.find((s) => s.productId === 'cookies')?.quantity,
  ).toBe(6)
  expect(
    suggestSquare({ ...row, sku: '' }, products, []).choice.productId,
  ).toBe('')
  expect(
    suggestSquare(row, products, [
      {
        id: row.mappingKey,
        name: 'mapping',
        productId: 'cookies',
        multiplier: 2,
      },
    ]).choice.multiplier,
  ).toBe(2)
  expect(amount(reconcileSquare([b]).sales, 'amount')).toBe(34)
})
it('blocks ambiguous item overlaps but permits transaction enrichment, and aggregates stay out of the ledger', async () => {
  const a = await batch('items'),
    b = await batch('overlap')
  a.rows.forEach((r) => (r.lineId = ''))
  expect(() => reconcileSquare([a, b])).toThrow(/stable line-item IDs/)
  expect(reconcileSquare([a, await batch('transactions')]).transactions).toBe(4)
  expect(reconcileSquare([await batch('summary')]).sales).toEqual([])
})
it('parses currency precisely, preserves blanks and signs, rejects ambiguous money formats', () => {
  expect(squareMoney('($1,234.50)')).toBe(-123450)
  expect(squareMoney('-12.03')).toBe(-1203)
  expect(squareMoney('')).toBeNull()
  expect(() => squareMoney('12,34')).toThrow()
  expect(() => squareMoney('1.234')).toThrow()
})
it('handles BOM, quoted commas, embedded newlines, dates/time zones and invalid excluded rows', () => {
  const csv =
    '\uFEFFDate,Item,Quantity,Net Sales,Tax,Currency\r\n"21/11/2026","Cookies,\nthree",1,"$1,234.50",,USD\r\n31/11/2026,Invalid,1,3.00,,USD'
  const o = {
    ...detectSquare(csv),
    type: 'items' as const,
    dateFormat: 'DMY' as const,
  }
  const p = parseSquare(csv, o)
  expect(p.rows).toHaveLength(1)
  expect(p.rows[0].date).toBe('2026-11-21')
  expect(p.rows[0].item).toBe('Cookies,\nthree')
  expect(p.rows[0].amounts.tax).toBeNull()
  expect(p.errors[0]).toMatch(/Row 3/)
  const iso = 'Date,Net Sales\n2026-11-22T01:30:00Z,2.00'
  expect(parseSquare(iso, detectSquare(iso)).rows[0].date).toBe('2026-11-21')
})
it('preserves currencies separately and rejects unsupported files and mappings', async () => {
  const b = await batch('items')
  b.rows[1].currency = 'CAD'
  expect(() => reconcileSquare([b])).toThrow(/currency/)
  expect(() =>
    parseSquare(
      'Date,Total\n2026-11-21,10',
      detectSquare('Date,Total\n2026-11-21,10'),
    ),
  ).toThrow(/Net sales/)
  expect(() => detectSquare('Date,Date\n1,2')).toThrow(/unique/)
  expect(() => detectSquare('Date,Net Sales\n"broken,1')).toThrow(/unclosed/)
})
it('merges complementary fields on the same line and normalizes explicitly selected fee signs', async () => {
  const a = await batch('items'),
    b = await batch('items', 'complement')
  a.rows.forEach((r) => {
    r.amounts.fees = null
  })
  b.rows.forEach((r) => {
    if (r.amounts.fees !== null) r.amounts.fees *= -1
  })
  b.options.feesSign = 'deduction'
  const result = reconcileSquare([a, b])
  expect(amount(result.sales, 'amount')).toBe(34)
  expect(amount(result.sales, 'fees')).toBeCloseTo(1.58)
  expect(result.duplicates).toBe(5)
  expect(b.rows[0].amounts.fees).toBe(-62)
})
it('rejects split payments even when their reported amounts are identical', async () => {
  const a = await batch('transactions')
  a.rows[1] = { ...a.rows[0], paymentId: 'SIM-SECOND-PAYMENT', row: 99 }
  a.rows[0].paymentId = 'SIM-FIRST-PAYMENT'
  expect(() => reconcileSquare([a])).toThrow(/multiple payments/)
})
