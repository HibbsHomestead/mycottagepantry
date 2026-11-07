import { it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FontPicker } from './label-font-picker'
it('searches, previews before applying, and records favorites and recent fonts', async () => {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
  const user = userEvent.setup(),
    apply = vi.fn(),
    save = vi.fn()
  render(
    <FontPicker
      value="DM Sans"
      onChange={apply}
      onPreferences={save}
      preferences={{ favorites: [], recent: [] }}
    />,
  )
  await user.click(screen.getByRole('button', { name: 'Font: DM Sans' }))
  await user.type(
    screen.getByRole('textbox', { name: 'Search fonts' }),
    'Pacifico',
  )
  await user.click(screen.getByRole('button', { name: 'Preview Pacifico' }))
  expect(apply).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Favorite Pacifico' }))
  expect(save).toHaveBeenCalledWith({ favorites: ['Pacifico'], recent: [] })
  await user.click(screen.getByRole('button', { name: 'Apply Pacifico' }))
  expect(apply).toHaveBeenCalledWith('Pacifico')
  expect(save).toHaveBeenLastCalledWith({
    favorites: ['Pacifico'],
    recent: ['Pacifico'],
  })
  vi.unstubAllGlobals()
})

it('loads a catalog font before applying it and explains a network failure', async () => {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
  const original = Object.getOwnPropertyDescriptor(document, 'fonts')
  const load = vi.fn().mockRejectedValue(new Error('Unavailable'))
  Object.defineProperty(document, 'fonts', {
    value: { load },
    configurable: true,
  })
  try {
    const user = userEvent.setup(),
      apply = vi.fn()
    render(<FontPicker value="DM Sans" onChange={apply} />)
    await user.click(screen.getByRole('button', { name: 'Font: DM Sans' }))
    await user.click(
      screen.getByRole('button', { name: 'Google Fonts online' }),
    )
    await user.type(
      screen.getByRole('textbox', { name: 'Search fonts' }),
      'Abel',
    )
    await user.click(screen.getByRole('button', { name: 'Preview Abel' }))
    expect(load).toHaveBeenCalledWith('16px "Abel"')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No substitute is exported',
    )
    expect(screen.getByRole('button', { name: 'Apply Abel' })).toBeDisabled()
    expect(apply).not.toHaveBeenCalled()
  } finally {
    if (original) Object.defineProperty(document, 'fonts', original)
    else Reflect.deleteProperty(document, 'fonts')
    vi.unstubAllGlobals()
  }
})
