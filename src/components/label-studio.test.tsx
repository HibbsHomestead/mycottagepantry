import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { LabelStudio } from './label-studio'
import { demoData } from '@/lib/demo'

it('makes a copy of a starter, edits dynamic elements, and exposes label checks before print', async () => {
  const user = userEvent.setup(),
    workspace = demoData()
  render(
    <LabelStudio
      workspace={workspace}
      onWorkspace={vi.fn()}
      ready={false}
      role="Owner"
    />,
  )
  expect(
    screen.getByRole('navigation', { name: 'Label Studio sections' }),
  ).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Create label' }))
  await user.click(
    screen.getByRole('button', { name: 'Choose a starting design (optional)' }),
  )
  await user.click(screen.getByRole('button', { name: 'Homestead bold' }))
  expect(screen.getByLabelText('Label name')).toHaveValue('Homestead bold')
  expect(
    screen.getByRole('img', { name: 'Homestead bold' }),
  ).toBeInTheDocument()
  await user.selectOptions(
    screen.getByLabelText('Dynamic field'),
    'batch.number',
  )
  expect(screen.getByLabelText('Data binding')).toHaveValue('batch.number')
  await user.click(screen.getByRole('button', { name: 'Undo' }))
  expect(screen.queryByLabelText('Data binding')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Preview/Print' }))
  expect(
    screen.getByRole('heading', { name: 'Label Check' }),
  ).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Download PDF' })).toBeDisabled()
  expect(
    screen.getByRole('button', { name: 'Single PNG · 300 DPI' }),
  ).toBeInTheDocument()
})
it('shows upload formats and avoids claiming unsupported PDF/SVG upload or printer integrations', async () => {
  const user = userEvent.setup()
  render(
    <LabelStudio
      workspace={demoData()}
      onWorkspace={vi.fn()}
      ready={false}
      role="Owner"
    />,
  )
  await user.click(screen.getByRole('button', { name: 'Graphics Library' }))
  expect(
    screen.getByText(
      /SVG\/PDF uploads and background removal are not available/,
    ),
  ).toBeInTheDocument()
  expect(screen.getByLabelText('Upload graphic')).toHaveAttribute(
    'accept',
    'image/png,image/jpeg,image/webp',
  )
})
it('offers the saved business disclaimer on either side with editable typography and geometry', async () => {
  const user = userEvent.setup()
  const workspace = demoData()
  workspace.settings[0].disclaimer = 'Owner saved text'
  render(
    <LabelStudio
      workspace={workspace}
      onWorkspace={vi.fn()}
      ready={false}
      role="Owner"
    />,
  )
  await user.click(screen.getByRole('button', { name: 'Create label' }))
  await user.selectOptions(screen.getByLabelText('Label format'), 'front-back')
  for (const side of ['Front', 'Back']) {
    await user.click(screen.getByRole('button', { name: side }))
    await user.selectOptions(
      screen.getByLabelText('Dynamic field'),
      'business.cottageFoodDisclaimer',
    )
    expect(
      screen.getAllByRole('option', {
        name: 'Business cottage-food disclaimer',
      }),
    ).toHaveLength(2)
    expect(screen.getByLabelText('Data binding')).toHaveValue(
      'business.cottageFoodDisclaimer',
    )
    expect(screen.getByLabelText('Size (pt)')).toBeEnabled()
    expect(screen.getByLabelText('X (pt)')).toBeEnabled()
    expect(screen.getByLabelText('Width (pt)')).toBeEnabled()
    expect(screen.getByLabelText('Rotation (°)')).toBeEnabled()
    expect(document.querySelector('.studio-scroll-stage svg')).toHaveTextContent(
      'Owner saved text',
    )
  }
})
it('moves, resizes and rotates on the canvas with one undo step per drag', async () => {
  const { fireEvent } = await import('@testing-library/react')
  const user = userEvent.setup()
  render(
    <LabelStudio
      workspace={demoData()}
      onWorkspace={vi.fn()}
      ready={false}
      role="Owner"
    />,
  )
  await user.click(screen.getByRole('button', { name: 'Create label' }))
  await user.click(
    screen.getByRole('button', { name: 'Choose a starting design (optional)' }),
  )
  await user.click(screen.getByRole('button', { name: 'Homestead bold' }))
  const paper = document.querySelector('.studio-paper') as HTMLElement,
    target = paper.querySelector('g[data-element] rect, g[data-element] text')!
  const at = (x: number, y: number) => ({
    clientX: x,
    clientY: y,
    pointerId: 1,
    button: 0,
  })
  fireEvent.pointerDown(target, at(0, 0))
  fireEvent.pointerUp(paper, at(0, 0))
  const rotation = () =>
    Number((screen.getByLabelText('Rotation (°)') as HTMLInputElement).value)
  const x = () =>
    Number((screen.getByLabelText('X (pt)') as HTMLInputElement).value)
  const width = () =>
    Number((screen.getByLabelText('Width (pt)') as HTMLInputElement).value)
  expect(rotation()).toBe(0)
  const id = target.closest('[data-element]')!.getAttribute('data-element')!
  const overlay = () =>
    paper.querySelector(`[data-selection-overlay="${id}"]`) as Element
  expect(overlay().querySelector('[data-handle="rotate"]')).not.toBeNull()
  expect(overlay().querySelectorAll('[data-handle]')).toHaveLength(9)
  // Plain clicks do not create undo steps; a drag does.
  const startX = x()
  fireEvent.pointerDown(target, at(0, 0))
  fireEvent.pointerMove(paper, at(40, 0))
  fireEvent.pointerMove(paper, at(80, 0))
  fireEvent.pointerUp(paper, at(80, 0))
  expect(x()).not.toBe(startX)
  // Resize from the east edge.
  const startWidth = width()
  fireEvent.pointerDown(
    overlay().querySelector('[data-handle="e"] rect')!,
    at(0, 0),
  )
  fireEvent.pointerMove(paper, at(5000, 0))
  fireEvent.pointerUp(paper, at(5000, 0))
  expect(width()).not.toBe(startWidth)
  // Rotate with the handle and show the live angle.
  const knob = overlay().querySelector('[data-handle="rotate"] circle')!
  fireEvent.pointerDown(knob, at(0, 0))
  fireEvent.pointerMove(paper, at(4000, 4000))
  expect(document.querySelector('[data-rotation-readout]')).not.toBeNull()
  fireEvent.pointerMove(paper, at(4000, 3000))
  fireEvent.pointerUp(paper, at(4000, 3000))
  expect(document.querySelector('[data-rotation-readout]')).toBeNull()
  expect(rotation()).not.toBe(0)
  const undo = screen.getByRole('button', { name: 'Undo' })
  await user.click(undo)
  expect(rotation()).toBe(0)
  await user.click(undo)
  expect(width()).toBe(startWidth)
  await user.click(undo)
  expect(x()).toBe(startX)
  await user.click(screen.getByRole('button', { name: 'Redo' }))
  expect(x()).not.toBe(startX)
})
