import { it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LabelColorPicker } from './label-color-picker'
function setup() {
  const callbacks = {
    onBegin: vi.fn(),
    onPreview: vi.fn(),
    onApply: vi.fn(),
    onCancel: vi.fn(),
  }
  render(
    <LabelColorPicker
      label="Fill"
      value={{ hex: '#71315f', opacity: 1 }}
      allowNone
      {...callbacks}
    />,
  )
  return callbacks
}
it('previews a valid HEX, rejects invalid HEX, and commits only on Apply', async () => {
  const user = userEvent.setup(),
    cb = setup()
  await user.click(screen.getByRole('button', { name: 'Choose fill' }))
  fireEvent.change(screen.getByLabelText('Picker HEX'), {
    target: { value: '#123abc' },
  })
  expect(cb.onPreview).toHaveBeenLastCalledWith({ hex: '#123abc', opacity: 1 })
  fireEvent.change(screen.getByLabelText('Picker HEX'), {
    target: { value: 'invalid' },
  })
  expect(cb.onPreview).toHaveBeenCalledTimes(1)
  expect(cb.onApply).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('Picker HEX'), {
    target: { value: '#123abc' },
  })
  await user.click(screen.getByRole('button', { name: 'Apply' }))
  expect(cb.onApply).toHaveBeenCalledOnce()
  expect(cb.onApply).toHaveBeenCalledWith({ hex: '#123abc', opacity: 1 })
  expect(cb.onCancel).not.toHaveBeenCalled()
})
it('Escape cancels a live edit without committing', async () => {
  const user = userEvent.setup(),
    cb = setup()
  await user.click(screen.getByRole('button', { name: 'Choose fill' }))
  fireEvent.change(screen.getByLabelText('Color opacity'), {
    target: { value: '40' },
  })
  await user.keyboard('{Escape}')
  expect(cb.onCancel).toHaveBeenCalledOnce()
  expect(cb.onApply).not.toHaveBeenCalled()
})
it('exposes no fill separately from the white basic swatch', async () => {
  const user = userEvent.setup(),
    cb = setup()
  await user.click(screen.getByRole('button', { name: 'Choose fill' }))
  await user.click(screen.getByRole('button', { name: 'No fill' }))
  expect(cb.onPreview).toHaveBeenLastCalledWith({
    hex: 'transparent',
    opacity: 1,
  })
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(cb.onCancel).toHaveBeenCalledOnce()
})
