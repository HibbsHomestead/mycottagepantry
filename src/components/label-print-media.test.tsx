import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { LabelPrintMedia } from './label-print-media'

it('suggests a quarter turn, saves only the selected direction, and never auto-prints', async () => {
  const onSave = vi.fn().mockResolvedValue(undefined)
  const onTest = vi.fn().mockResolvedValue(undefined)
  const design = { width: 216, height: 288 }
  const { rerender } = render(
    <LabelPrintMedia design={design} onSave={onSave} onTest={onTest} />,
  )
  fireEvent.change(screen.getByLabelText('Across printhead (in)'), {
    target: { value: 4 },
  })
  fireEvent.change(screen.getByLabelText('Feed length (in)'), {
    target: { value: 3 },
  })
  expect(screen.getByText(/dimensions are swapped/)).toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'Save new print profile' }),
  ).toBeDisabled()
  expect(screen.getByLabelText('Output rotation')).toHaveValue('0')
  fireEvent.change(screen.getByLabelText('Output rotation'), {
    target: { value: '270' },
  })
  expect(
    screen.getByRole('img', { name: /leading edge/ }),
  ).toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'Print one test label' }),
  ).toBeDisabled()
  fireEvent.click(
    screen.getByRole('button', { name: 'Save new print profile' }),
  )
  await waitFor(() => expect(onSave).toHaveBeenCalledOnce())
  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({
      width: 4,
      height: 3,
      designWidth: 216,
      designHeight: 288,
      rotation: 270,
    }),
  )
  expect(onTest).not.toHaveBeenCalled()
  const saved = { ...onSave.mock.calls[0][0], id: 'saved-roll' }
  rerender(
    <LabelPrintMedia
      key={saved.id}
      design={design}
      profile={saved}
      onSave={onSave}
      onTest={onTest}
    />,
  )
  fireEvent.click(
    screen.getByRole('button', { name: 'Print one test label' }),
  )
  await waitFor(() => expect(onTest).toHaveBeenCalledExactlyOnceWith(saved))
})
