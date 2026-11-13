import { useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Item } from '@/lib/domain'
import { ItemPhotoField } from './item-photo-field'
import { PhotoBox } from './photo-box'

const original = { id: 'saved', name: 'Saved photo', fileUrl: '/saved.png' }
const replacement = {
  id: 'replacement',
  name: 'Replacement',
  fileUrl: '/replacement.png',
}
let urls: ReturnType<typeof vi.fn>, revoke: ReturnType<typeof vi.fn>
beforeEach(() => {
  urls = vi.fn(() => 'blob:immediate-preview')
  revoke = vi.fn()
  vi.stubGlobal(
    'URL',
    Object.assign(URL, { createObjectURL: urls, revokeObjectURL: revoke }),
  )
})
afterEach(() => vi.unstubAllGlobals())

function start(withPhoto = true) {
  const change = vi.fn(),
    workspace = vi.fn(),
    busy = vi.fn()
  function Draft() {
    const [item, setItem] = useState<Item>({
      id: 'draft',
      name: 'Draft flour',
      imageAssetId: withPhoto ? 'saved' : '',
    })
    return (
      <ItemPhotoField
        value={item}
        assets={[original]}
        onChange={(key, value) => {
          change(key, value)
          setItem((d) => ({ ...d, [key]: value }))
        }}
        onWorkspace={workspace}
        onBusy={busy}
      />
    )
  }
  const rendered = render(<Draft />)
  return { ...rendered, change, workspace, busy }
}
const file = () => new File(['image'], 'flour.png', { type: 'image/png' })

it('previews immediately, keeps the saved link until upload succeeds, and releases its temporary URL', async () => {
  let finish!: (response: Response) => void
  const fetcher = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve
      }),
  )
  vi.stubGlobal('fetch', fetcher)
  const { change, workspace, busy } = start()
  await userEvent.upload(screen.getByLabelText('Upload photo'), file())
  expect(screen.getByAltText('Photo of Draft flour')).toHaveAttribute(
    'src',
    'blob:immediate-preview',
  )
  expect(change).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Remove photo' })).toBeDisabled()
  finish(
    Response.json({
      asset: replacement,
      workspace: { graphic_assets: [original, replacement] },
    }),
  )
  await waitFor(() =>
    expect(change).toHaveBeenCalledWith('imageAssetId', replacement.id),
  )
  expect(screen.getByAltText('Photo of Draft flour')).toHaveAttribute(
    'src',
    replacement.fileUrl,
  )
  expect(workspace).toHaveBeenCalledOnce()
  expect(busy.mock.calls).toEqual([[true], [false]])
  expect(revoke).toHaveBeenCalledWith('blob:immediate-preview')
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(fetcher).toHaveBeenCalledWith(
    '/api/workspace?upload=1',
    expect.objectContaining({ method: 'POST', body: expect.any(FormData) }),
  )
})

it.each([400, 503])(
  'restores the saved photo and reports upload failure %s without changing its link',
  async (status) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ error: 'Photo unavailable. Try again.' }, { status }),
      ),
    )
    const { change } = start()
    await userEvent.upload(screen.getByLabelText('Upload photo'), file())
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Photo unavailable. Try again.',
    )
    expect(screen.getByAltText('Photo of Draft flour')).toHaveAttribute(
      'src',
      '/saved.png',
    )
    expect(change).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Change photo' })).toBeEnabled()
  },
)

it('rejects empty and oversized files inline without discarding the current draft photo', async () => {
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  const { change } = start()
  for (const image of [
    new File([], 'empty.png', { type: 'image/png' }),
    new File([new Uint8Array(5000001)], 'large.png', { type: 'image/png' }),
  ]) {
    await userEvent.upload(screen.getByLabelText('Upload photo'), image)
    expect(screen.getByRole('alert')).toHaveTextContent('smaller than 5 MB')
  }
  expect(fetcher).not.toHaveBeenCalled()
  expect(change).not.toHaveBeenCalled()
  expect(screen.getByAltText('Photo of Draft flour')).toHaveAttribute(
    'src',
    original.fileUrl,
  )
})

it('canceling the picker is a no-op and removing affects only the current draft', async () => {
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  const { change } = start()
  fireEvent.change(screen.getByLabelText('Upload photo'), {
    target: { files: [] },
  })
  expect(change).not.toHaveBeenCalled()
  const picker = screen.getByLabelText('Upload photo') as HTMLInputElement
  const click = vi.spyOn(picker, 'click')
  await userEvent.click(screen.getByRole('button', { name: 'Remove photo' }))
  expect(click).not.toHaveBeenCalled()
  expect(change).toHaveBeenCalledExactlyOnceWith('imageAssetId', '')
  expect(fetcher).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Add photo' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Add photo' })).toHaveFocus()
  expect(original.fileUrl).toBe('/saved.png')
})

it('retains native device choices and keyboard activation without submitting a form', async () => {
  const submit = vi.fn(),
    selected = vi.fn()
  render(
    <form onSubmit={submit}>
      <PhotoBox alt="Package" onFile={selected} />
    </form>,
  )
  const input = document.querySelector('input')!
  expect(input).not.toHaveAttribute('capture')
  expect(input).toHaveAttribute('accept', 'image/png,image/jpeg,image/webp')
  const click = vi.spyOn(input, 'click')
  const button = screen.getByRole('button', { name: 'Add photo' })
  button.focus()
  await userEvent.keyboard('{Enter}')
  await userEvent.keyboard(' ')
  expect(click).toHaveBeenCalledTimes(2)
  expect(submit).not.toHaveBeenCalled()
})
