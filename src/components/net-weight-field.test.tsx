import { useState } from 'react'
import { expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { NetWeightField } from './net-weight-field'
import type { Item } from '@/lib/domain'
import { readFile } from 'node:fs/promises'
import { PDFPage } from 'pdf-lib'
import { renderToStaticMarkup } from 'react-dom/server'
import { LabelCanvas } from './label-studio'
import { blankLabel, newElement, resolveLabelData } from '@/lib/label-studio'
import { exportLabelPdf } from '@/lib/label-export'
import { printPageHtml } from '@/lib/label-browser-print'
import { defaultSheet } from '@/lib/label-print-layout'
import { demoData } from '@/lib/demo'

it('previews decimals, rejects nonpositive weight and clears the whole generated line', () => {
  function Form() {
    const [value, setValue] = useState<Partial<Item>>({})
    return (
      <NetWeightField
        value={value}
        onChange={(key, v) => setValue({ ...value, [key]: v })}
      />
    )
  }
  render(<Form />)
  const field = screen.getByRole('spinbutton', { name: 'Net weight (oz)' })
  fireEvent.change(field, { target: { value: '9.50' } })
  expect(screen.getByText('Net Wt. 9.5oz (269g)')).toBeVisible()
  for (const value of ['0', '-1']) {
    fireEvent.change(field, { target: { value } })
    expect(field).toBeInvalid()
  }
  fireEvent.change(field, { target: { value: '' } })
  expect(field).toBeValid()
  expect(screen.queryByText('Net Wt. 9.5oz (269g)')).not.toBeInTheDocument()
})

it('flags conflicting saved text without guessing a numeric value', () => {
  render(
    <NetWeightField
      value={{ netQuantity: 'Net Wt. 16oz (516g)' }}
      onChange={() => {}}
    />,
  )
  expect(screen.getByRole('spinbutton')).toHaveValue(null)
  expect(screen.getByText(/Confirm the ounce value/)).toBeVisible()
})

it('uses identical net-weight text in canvas, browser print and actual PDF output, then omits it when cleared', async () => {
  const workspace = demoData()
  const product = workspace.products[0]
  product.netWeightOz = 9.5
  const label = {
    ...blankLabel(),
    width: 288,
    height: 144,
    elements: [
      {
        ...newElement('text', 'Net Wt. old oz suffix', 'product.netQuantity'),
        width: 250,
        condition: 'nonempty' as const,
      },
    ],
  }
  const original = structuredClone(label)
  const text = 'Net Wt. 9.5oz (269g)'
  const drawn = vi.spyOn(PDFPage.prototype, 'drawText')
  try {
    const data = resolveLabelData(workspace, {
      kind: 'product',
      id: product.id,
    })
    const svg = renderToStaticMarkup(
      <LabelCanvas document={label} data={data} />,
    )
    const html = printPageHtml(svg, label, 1, { ...defaultSheet, mode: 'roll' })
    expect(svg).toContain(text)
    expect(html).toContain(text)
    const loaders = {
      font: async (key: string) =>
        new Uint8Array(await readFile(`public/label-fonts/${key}.ttf`)),
      image: async () => new Uint8Array(),
    }
    const bytes = await exportLabelPdf(
      label,
      data,
      [],
      1,
      { ...defaultSheet, mode: 'roll' },
      loaders,
    )
    expect(bytes.length).toBeGreaterThan(1000)
    expect(drawn.mock.calls.map(([character]) => character).join('')).toBe(text)
    drawn.mockClear()
    product.netWeightOz = null
    const cleared = resolveLabelData(workspace, {
      kind: 'product',
      id: product.id,
    })
    expect(
      renderToStaticMarkup(<LabelCanvas document={label} data={cleared} />),
    ).not.toContain('Net Wt.')
    await exportLabelPdf(
      label,
      cleared,
      [],
      1,
      { ...defaultSheet, mode: 'roll' },
      loaders,
    )
    expect(drawn).not.toHaveBeenCalled()
    expect(label).toEqual(original)
  } finally {
    drawn.mockRestore()
  }
})
