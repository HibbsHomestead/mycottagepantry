import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { LabelPreviewDialog } from './label-preview-dialog'
import { demoData } from '@/lib/demo'
import { blankLabel, newElement, resolveLabelData } from '@/lib/label-studio'

const output = vi.hoisted(() => ({ print: vi.fn(), inline: vi.fn() }))
vi.mock('@/lib/label-browser-print', () => ({ browserPrint: output.print }))
vi.mock('@/lib/label-client-export', async (original) => ({
  ...(await original<typeof import('@/lib/label-client-export')>()),
  inlineLabelSvg: output.inline,
}))

beforeEach(() => {
  output.print.mockReset().mockResolvedValue(undefined)
  output.inline.mockReset().mockImplementation(async (svg) => svg)
  vi.stubGlobal(
    'Image',
    class {
      src = ''
      decode = async () => {}
    },
  )
  vi.stubGlobal(
    'URL',
    Object.assign(URL, {
      createObjectURL: vi.fn(() => 'blob:label-preview'),
      revokeObjectURL: vi.fn(),
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

function setup(
  assignment: 'ok' | 'none' | 'missing' = 'ok',
  missingName = false,
) {
  const workspace = demoData()
  const product = workspace.products[0]
  const doc = {
    ...blankLabel(),
    id: 'assigned',
    name: 'Assigned design',
    revision: 2,
    width: 216,
    height: 144,
    elements: [{ ...newElement('text', '', 'product.name'), rotation: 12 }],
  }
  if (missingName)
    doc.elements.push({
      ...newElement('text', '', 'product.labelMainName'),
      rotation: 0,
    })
  workspace.label_templates = [
    doc,
    { ...doc, id: 'other', name: 'Other design' },
  ]
  product.labelDesignId =
    assignment === 'none' ? '' : assignment === 'missing' ? 'deleted' : doc.id
  const callbacks = {
    onOpenChange: vi.fn(),
    onEditLabel: vi.fn(),
    onCreateLabel: vi.fn(),
    onWorkspace: vi.fn(),
  }
  const fetcher = vi.fn(async (_url: string, options?: RequestInit) => {
    const body = JSON.parse(String(options?.body))
    expect(body.action).toBe('labelPrint')
    workspace.label_print_jobs = [
      {
        id: 'prepared',
        name: doc.name,
        documentSnapshot: doc,
        renderedDataSnapshot: resolveLabelData(
          workspace,
          { kind: 'product', id: product.id },
          workspace.brand_kits?.[0],
        ),
      },
    ]
    return Response.json({ workspace })
  })
  vi.stubGlobal('fetch', fetcher)
  render(
    <LabelPreviewDialog
      open
      product={product}
      workspace={workspace}
      ready
      role="Owner"
      {...callbacks}
    />,
  )
  return {
    workspace,
    product,
    doc,
    fetcher,
    ...callbacks,
    user: userEvent.setup(),
  }
}

async function acknowledge(user: ReturnType<typeof userEvent.setup>) {
  const checkbox = screen.queryByRole('checkbox', { name: /I reviewed/ })
  if (checkbox) await user.click(checkbox)
}

it('renders the assigned geometry and real product data without saves, and closes in place', async () => {
  const p = setup()
  await screen.findByAltText(`Populated label for ${p.product.name}`)
  const svg = output.inline.mock.calls[0][0] as SVGSVGElement
  expect(svg.textContent).toContain(p.product.name)
  expect(svg.getAttribute('viewBox')).toBe('0 0 216 144')
  expect(svg.innerHTML).toContain('rotate(12')
  expect(svg.querySelector('[data-editor-only]')).toBeNull()
  expect(screen.getAllByText(/3.00 × 2.00 in/).length).toBeGreaterThan(0)
  await p.user.click(screen.getByRole('button', { name: 'Zoom in' }))
  expect(p.fetcher).not.toHaveBeenCalled()
  await p.user.click(screen.getAllByRole('button', { name: 'Close' })[0])
  expect(p.onOpenChange).toHaveBeenCalledWith(false)
  expect(p.onEditLabel).not.toHaveBeenCalled()
  expect(p.onWorkspace).not.toHaveBeenCalled()
})

it('prints through the shared workflow repeatedly without changing the design or item', async () => {
  const p = setup(),
    before = JSON.stringify([p.product, p.doc])
  await screen.findByAltText(`Populated label for ${p.product.name}`)
  await acknowledge(p.user)
  await p.user.clear(screen.getByLabelText('Number of products'))
  await p.user.type(screen.getByLabelText('Number of products'), '7')
  await p.user.selectOptions(screen.getByLabelText('Output layout'), 'sheet')
  for (let n = 1; n <= 2; n++) {
    await p.user.click(screen.getByRole('button', { name: 'Print Label' }))
    await waitFor(() => expect(output.print).toHaveBeenCalledTimes(n))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Print Label' })).toBeEnabled(),
    )
  }
  expect(output.print.mock.calls[0][1]).toMatchObject({
    id: 'assigned',
    width: 216,
    height: 144,
  })
  expect(output.print.mock.calls[0][4]).toBe(7)
  expect(output.print.mock.calls[0][5]).toMatchObject({
    mode: 'sheet',
    columns: 2,
    rows: 3,
  })
  expect(JSON.stringify([p.product, p.doc])).toBe(before)
  expect(p.onOpenChange).not.toHaveBeenCalled()
  await p.user.click(screen.getByRole('button', { name: 'Edit Label' }))
  expect(p.onEditLabel).toHaveBeenCalledWith('assigned')
})

it.each(['none', 'missing'] as const)(
  'distinguishes %s assignment without substituting or opening tools',
  (assignment) => {
    const p = setup(assignment)
    expect(
      screen.getByRole('heading', {
        name:
          assignment === 'none'
            ? 'No labels linked yet'
            : 'Assigned label design is unavailable',
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Create label' }),
    ).toBeInTheDocument()
    expect(output.inline).not.toHaveBeenCalled()
    expect(p.fetcher).not.toHaveBeenCalled()
    expect(p.onEditLabel).not.toHaveBeenCalled()
  },
)

it('reports asset rendering errors and leaves intentional editing available', async () => {
  output.inline.mockRejectedValueOnce(new Error('Could not load export font.'))
  const p = setup()
  expect(
    await screen.findByRole('heading', {
      name: 'This label could not be rendered',
    }),
  ).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Print Label' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Edit Label' })).toBeEnabled()
  expect(p.fetcher).not.toHaveBeenCalled()
})

it('keeps printing disabled until assets are ready', () => {
  output.inline.mockReturnValueOnce(new Promise(() => {}))
  const p = setup()
  expect(
    screen.getByText('Loading label fonts and images…'),
  ).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Print Label' })).toBeDisabled()
  expect(p.fetcher).not.toHaveBeenCalled()
})

it('identifies missing required values and retains the print blocker after acknowledgement', async () => {
  const p = setup('ok', true)
  await screen.findByAltText(`Populated label for ${p.product.name}`)
  expect(screen.getByText('Missing field values')).toBeInTheDocument()
  expect(screen.getByText('Product label main name')).toBeInTheDocument()
  await acknowledge(p.user)
  expect(screen.getByRole('button', { name: 'Print Label' })).toBeDisabled()
  expect(
    screen.getByText(
      /Printing blocked: Complete the missing product name parts/,
    ),
  ).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Edit Label' })).toBeEnabled()
  expect(p.fetcher).not.toHaveBeenCalled()
})

it('refuses a server snapshot that differs from the preview instead of silently printing other data', async () => {
  const p = setup()
  await screen.findByAltText(`Populated label for ${p.product.name}`)
  await acknowledge(p.user)
  p.fetcher.mockImplementationOnce(async () => {
    const data = resolveLabelData(p.workspace, {
      kind: 'product',
      id: p.product.id,
    })
    data.values['product.name'] = 'Changed elsewhere'
    return Response.json({
      workspace: {
        ...p.workspace,
        label_print_jobs: [
          {
            id: 'changed',
            name: 'Changed',
            documentSnapshot: p.doc,
            renderedDataSnapshot: data,
          },
        ],
      },
    })
  })
  await p.user.click(screen.getByRole('button', { name: 'Print Label' }))
  expect(
    await screen.findByText(/The saved label or product data changed/),
  ).toBeInTheDocument()
  expect(output.print).not.toHaveBeenCalled()
  expect(p.onOpenChange).not.toHaveBeenCalled()
})

it('selects among multiple saved labels for one product without assigning or saving anything', async () => {
  const workspace = demoData(),
    product = workspace.products[0]
  delete product.labelDesignId
  const source = { kind: 'product' as const, id: product.id }
  const first = {
    ...blankLabel(),
    id: 'small-label',
    name: 'Small label',
    workflowVersion: 1 as const,
    recordKind: 'label' as const,
    revision: 1,
    source,
    productId: product.id,
    elements: [newElement('text', '', 'product.displayName')],
  }
  const second = {
    ...first,
    id: 'large-label',
    name: 'Large label',
    width: 216,
    printSettings: {
      copies: 6,
      layout: {
        mode: 'roll' as const,
        pageWidth: 612,
        pageHeight: 792,
        columns: 1,
        rows: 1,
        margin: 0,
        gutter: 0,
      },
      parts: 'both' as const,
      order: 'grouped' as const,
    },
  }
  workspace.label_templates = [first, second]
  const fetcher = vi.fn(),
    edit = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  render(
    <LabelPreviewDialog
      open
      product={product}
      labelId={second.id}
      workspace={workspace}
      ready
      role="Owner"
      onWorkspace={vi.fn()}
      onOpenChange={vi.fn()}
      onEditLabel={edit}
      onCreateLabel={vi.fn()}
    />,
  )
  const user = userEvent.setup()
  await screen.findByAltText(`Populated label for ${product.name}`)
  expect(screen.getByLabelText('Linked label')).toHaveValue(second.id)
  expect(screen.getByLabelText('Number of products')).toHaveValue(6)
  await user.selectOptions(screen.getByLabelText('Linked label'), first.id)
  await waitFor(() =>
    expect(output.inline.mock.calls.at(-1)![0].getAttribute('viewBox')).toBe(
      '0 0 288 432',
    ),
  )
  await user.click(screen.getByRole('button', { name: 'Edit Label' }))
  expect(edit).toHaveBeenCalledWith(first.id)
  expect(fetcher).not.toHaveBeenCalled()
  expect(product.labelDesignId).toBeUndefined()
})
