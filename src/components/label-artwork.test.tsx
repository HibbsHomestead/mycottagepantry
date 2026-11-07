import { it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LabelCanvas, LabelStudio } from './label-studio'
import { ProductArtworkFields } from './product-artwork-fields'
import { demoData } from '@/lib/demo'
import { blankLabel, newElement, resolveLabelData } from '@/lib/label-studio'
import { renderToStaticMarkup } from 'react-dom/server'
it('adds a linked product graphic through the label editor', async () => {
  const user = userEvent.setup()
  render(
    <LabelStudio
      workspace={demoData()}
      onWorkspace={vi.fn()}
      ready={false}
      role="Owner"
    />,
  )
  await user.click(screen.getAllByRole('button', { name: 'Use a copy' })[0])
  await user.click(screen.getByRole('button', { name: 'Assets' }))
  await user.click(
    screen.getByRole('button', { name: 'Product label graphic' }),
  )
  expect(screen.getByRole('combobox', { name: 'Image source' })).toHaveValue(
    'product.graphic',
  )
  expect(
    screen.getByText(/No artwork linked for the selected source/),
  ).toBeInTheDocument()
})
it('offers product label graphics in the dynamic field dropdown as an image', async () => {
  const user = userEvent.setup()
  render(
    <LabelStudio
      workspace={demoData()}
      onWorkspace={vi.fn()}
      ready={false}
      role="Owner"
    />,
  )
  await user.click(screen.getAllByRole('button', { name: 'Use a copy' })[0])
  const field = screen.getByRole('combobox', { name: 'Dynamic field' })
  expect(
    screen.getByRole('option', { name: 'Product label graphic' }),
  ).toHaveValue('product.graphic')
  await user.selectOptions(field, 'product.graphic')
  expect(screen.getByRole('combobox', { name: 'Image source' })).toHaveValue(
    'product.graphic',
  )
  expect(
    screen.queryByRole('combobox', { name: 'Data binding' }),
  ).not.toBeInTheDocument()
})
it('uploads a product label graphic and keeps its link in the product draft', async () => {
  const user = userEvent.setup(),
    workspace = demoData(),
    change = vi.fn(),
    update = vi.fn()
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response(
        JSON.stringify({ workspace, asset: { id: 'graphic-asset' } }),
      ),
    )
  vi.stubGlobal('fetch', fetcher)
  try {
    render(
      <ProductArtworkFields
        assets={[]}
        value={{}}
        onChange={change}
        onWorkspace={update}
        canUpload
        onBusy={vi.fn()}
      />,
    )
    await user.click(screen.getByText('Product images & label graphics'))
    expect(
      screen.queryByRole('combobox', { name: 'Label icon' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Upload label icon')).not.toBeInTheDocument()
    await user.upload(
      screen.getByLabelText('Upload label graphic'),
      new File(['image'], 'icon.png', { type: 'image/png' }),
    )
    expect(change).toHaveBeenCalledWith('graphicAssetId', 'graphic-asset')
    expect(update).toHaveBeenCalledWith(workspace)
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Save the product',
    )
  } finally {
    vi.unstubAllGlobals()
  }
})

it('shows missing artwork only in the editor, never the printable SVG', () => {
  const doc = blankLabel(),
    data = resolveLabelData(demoData(), { kind: 'product', id: 'missing' })
  doc.elements = [{ ...newElement('image'), binding: 'product.graphic' }]
  const editor = renderToStaticMarkup(
    <LabelCanvas document={doc} data={data} editor />,
  )
  const print = renderToStaticMarkup(<LabelCanvas document={doc} data={data} />)
  expect(editor).toContain('Select / upload artwork')
  expect(print).not.toContain('Select / upload artwork')
  expect(print).not.toContain('<image')
})
it('clears the product link without deleting the library asset', async () => {
  const change = vi.fn(),
    update = vi.fn(),
    user = userEvent.setup()
  render(
    <ProductArtworkFields
      assets={[{ id: 'art', name: 'Wheat', fileUrl: '/art.png' }]}
      value={{ graphicAssetId: 'art', iconAssetId: 'old' }}
      onChange={change}
      onWorkspace={update}
      canUpload
      onBusy={vi.fn()}
    />,
  )
  await user.click(screen.getByText('Product images & label graphics'))
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Label graphic' }),
    '',
  )
  expect(change).toHaveBeenCalledWith('labelArtworkVersion', 2)
  expect(change).toHaveBeenCalledWith('graphicAssetId', '')
  expect(update).not.toHaveBeenCalled()
})
it('commits one color session as one undo step and keeps label colors independent of app appearance', async () => {
  const user = userEvent.setup()
  render(
    <LabelStudio
      workspace={demoData()}
      onWorkspace={vi.fn()}
      ready={false}
      role="Owner"
    />,
  )
  await user.click(screen.getAllByRole('button', { name: 'Use a copy' })[0])
  const { fireEvent } = await import('@testing-library/react')
  const trigger = document.querySelector('.color-trigger') as HTMLElement
  const original = trigger.getAttribute('title')
  await user.click(trigger)
  fireEvent.change(screen.getByLabelText('Picker HEX'), {
    target: { value: '#123abc' },
  })
  fireEvent.change(screen.getByLabelText('Picker HEX'), {
    target: { value: '#aabbcc' },
  })
  await user.click(screen.getByRole('button', { name: 'Apply' }))
  expect(trigger.getAttribute('title')).toContain('#aabbcc')
  await user.click(screen.getByRole('button', { name: 'Undo' }))
  expect(trigger.getAttribute('title')).toBe(original)
  await user.click(screen.getByRole('button', { name: 'Redo' }))
  expect(trigger.getAttribute('title')).toContain('#aabbcc')
  document.documentElement.dataset.mode = 'dark'
  expect(trigger.getAttribute('title')).toContain('#aabbcc')
  delete document.documentElement.dataset.mode
})
