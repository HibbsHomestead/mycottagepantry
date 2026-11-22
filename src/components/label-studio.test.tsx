import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { LabelStudio } from './label-studio'
import { demoData } from '@/lib/demo'

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
})

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
    screen.getByRole('navigation', { name: 'Labels sections' }),
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
    expect(screen.getByLabelText('X position (in)')).toBeEnabled()
    expect(screen.getByLabelText('Width (in)')).toBeEnabled()
    expect(screen.getByLabelText('Rotation (°)')).toBeEnabled()
    expect(
      document.querySelector('.studio-scroll-stage svg'),
    ).toHaveTextContent('Owner saved text')
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
    Number((screen.getByLabelText('X position (in)') as HTMLInputElement).value)
  const width = () =>
    Number((screen.getByLabelText('Width (in)') as HTMLInputElement).value)
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

it('aligns with undo, synchronizes layers, and deselects only editor backgrounds or Escape', async () => {
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
  await user.selectOptions(
    screen.getByLabelText('Dynamic field'),
    'business.name',
  )
  const overlay = () => document.querySelector('[data-selection-overlay]')
  expect(overlay()).not.toBeNull()
  expect(
    document.querySelector('.studio-position-advanced'),
  ).not.toHaveAttribute('open')
  const originalX = Number(
    (screen.getByLabelText('X position (in)') as HTMLInputElement).value,
  )
  await user.click(screen.getByRole('button', { name: 'Left' }))
  expect(screen.getByLabelText('X position (in)')).toHaveValue(9 / 72)
  expect(screen.getByLabelText('Data binding')).toHaveValue('business.name')
  await user.click(screen.getByRole('button', { name: 'Undo' }))
  expect(screen.getByLabelText('X position (in)')).toHaveValue(originalX)
  await user.click(screen.getByRole('button', { name: 'Redo' }))
  expect(screen.getByLabelText('X position (in)')).toHaveValue(9 / 72)
  await user.selectOptions(
    screen.getByLabelText('Alignment reference'),
    'edges',
  )
  await user.click(screen.getByRole('button', { name: 'Left' }))
  expect(screen.getByLabelText('X position (in)')).toHaveValue(0)
  await user.click(screen.getByLabelText('Safe area', { selector: 'input' }))
  expect(screen.getByLabelText('Alignment reference')).toHaveValue('edges')
  expect(overlay()).not.toBeNull()
  await user.click(document.querySelector('.studio-position-advanced summary')!)
  fireEvent.change(screen.getByLabelText('X position (in)'), {
    target: { value: '0.75' },
  })
  screen.getByLabelText('X position (in)').focus()
  await user.keyboard('{Escape}')
  expect(overlay()).not.toBeNull()
  await user.click(screen.getByRole('tab', { name: 'Layers' }))
  const selectedLayer = document.querySelector(
    '.studio-position-layers .selected button',
  ) as HTMLButtonElement
  expect(selectedLayer).toHaveAttribute('aria-pressed', 'true')
  fireEvent.pointerDown(document.querySelector('.studio-ruler')!, { button: 0 })
  expect(overlay()).not.toBeNull()
  const dialog = document.createElement('div')
  dialog.setAttribute('role', 'dialog')
  document.body.append(dialog)
  selectedLayer.focus()
  await user.keyboard('{Escape}')
  expect(overlay()).not.toBeNull()
  dialog.remove()
  await user.keyboard('{Escape}')
  expect(overlay()).toBeNull()
  expect(screen.getByText('Select an element to edit')).toBeInTheDocument()
  const target = document.querySelector('.studio-paper [data-element]')!
  fireEvent.pointerDown(target, {
    button: 0,
    pointerId: 1,
    clientX: 0,
    clientY: 0,
  })
  fireEvent.pointerUp(document.querySelector('.studio-paper')!)
  expect(overlay()).not.toBeNull()
  const stage = document.querySelector('.studio-scroll-stage')!
  Object.defineProperty(stage, 'clientWidth', { value: 1000 })
  Object.defineProperty(stage, 'clientHeight', { value: 1000 })
  fireEvent.pointerDown(stage, {
    button: 0,
    pointerId: 2,
    clientX: 5,
    clientY: 5,
  })
  fireEvent.pointerMove(stage, { pointerId: 2, clientX: 50, clientY: 50 })
  fireEvent.pointerUp(stage, { pointerId: 2, clientX: 50, clientY: 50 })
  expect(overlay()).not.toBeNull()

  fireEvent.pointerDown(stage, {
    button: 0,
    pointerId: 3,
    clientX: 5,
    clientY: 5,
  })
  fireEvent.pointerUp(stage, {
    button: 0,
    pointerId: 3,
    clientX: 5,
    clientY: 5,
  })
  expect(overlay()).toBeNull()
  fireEvent.pointerDown(target, {
    button: 0,
    pointerId: 1,
    clientX: 0,
    clientY: 0,
  })
  fireEvent.pointerUp(document.querySelector('.studio-paper')!)
  fireEvent.pointerDown(document.querySelector('.studio-paper svg')!, {
    button: 0,
    pointerId: 4,
    clientX: 5,
    clientY: 5,
  })
  fireEvent.pointerUp(document.querySelector('.studio-paper svg')!, {
    button: 0,
    pointerId: 4,
    clientX: 5,
    clientY: 5,
  })
  expect(overlay()).toBeNull()
})

it('uses submenu thumbnails to switch sides without discarding edits or undo history', async () => {
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
  expect(
    screen.getByRole('button', { name: 'Front', pressed: true }),
  ).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
  await user.selectOptions(screen.getByLabelText('Label format'), 'front-back')
  const front = screen.getByRole('button', { name: 'Front' })
  const back = screen.getByRole('button', { name: 'Back' })
  expect(front.closest('nav')).toHaveAttribute('aria-label', 'Labels sections')
  expect(back.closest('.studio-left')).toBeNull()
  await user.selectOptions(
    screen.getByLabelText('Dynamic field'),
    'business.name',
  )
  const frontArtwork = Array.from(
    document.querySelectorAll('.studio-scroll-stage svg text'),
  )
    .map((node) => node.textContent)
    .join('')
  await user.click(back)
  expect(back).toHaveAttribute('aria-pressed', 'true')
  expect(screen.queryByLabelText('Data binding')).not.toBeInTheDocument()
  await user.selectOptions(
    screen.getByLabelText('Dynamic field'),
    'business.name',
  )
  await waitFor(() => expect(back).toHaveTextContent('Hibbs Homestead Market'))
  const backArtwork = Array.from(
    document.querySelectorAll('.studio-scroll-stage svg text'),
  )
    .map((node) => node.textContent)
    .join('')
  await user.click(front)
  expect(
    Array.from(
      document.querySelectorAll('.studio-scroll-stage svg text'),
    )
      .map((node) => node.textContent)
      .join(''),
  ).toBe(frontArtwork)
  await user.click(back)
  expect(
    Array.from(
      document.querySelectorAll('.studio-scroll-stage svg text'),
    )
      .map((node) => node.textContent)
      .join(''),
  ).toBe(backArtwork)
  expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled()
  await user.click(screen.getByRole('button', { name: 'Undo' }))
  expect(
    Array.from(
      document.querySelectorAll('.studio-scroll-stage svg text'),
    )
      .map((node) => node.textContent)
      .join(''),
  ).not.toBe(backArtwork)
})

it('moves the single side switcher above the canvas when the submenu collapses', async () => {
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
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
  await user.selectOptions(screen.getByLabelText('Label format'), 'front-back')
  const front = screen.getByRole('button', { name: 'Front' })
  expect(front.closest('nav')).toBeNull()
  expect(screen.getAllByRole('group', { name: 'Label side' })).toHaveLength(1)
  await user.click(screen.getByRole('button', { name: 'Back' }))
  expect(
    screen.getByRole('button', { name: 'Back', pressed: true }),
  ).toBeInTheDocument()
})
