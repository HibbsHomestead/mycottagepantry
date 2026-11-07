import { it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FontUploadPanel } from './label-font-upload'
import { demoData } from '@/lib/demo'
it('requires file-specific license consent and saves a font to the connected oven', async () => {
  const user = userEvent.setup(),
    workspace = demoData(),
    onWorkspace = vi.fn()
  const uploaded = {
    ...workspace,
    font_assets: [{ id: 'file-id', name: 'Uploaded font' }],
  }
  const fetcher = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        workspace: uploaded,
        asset: { font: { name: 'Uploaded font' } },
      }),
      { status: 200 },
    ),
  )
  vi.stubGlobal('fetch', fetcher)
  try {
    render(
      <FontUploadPanel
        workspace={workspace}
        onWorkspace={onWorkspace}
        canEdit
      />,
    )
    const button = screen.getByRole('button', { name: 'Upload font' })
    expect(button).toBeDisabled()
    await user.upload(
      screen.getByLabelText('Font file'),
      new File(['font'], 'apricots.ttf', { type: 'font/ttf' }),
    )
    expect(button).toBeDisabled()
    await user.click(
      screen.getByRole('checkbox', {
        name: 'I confirm I have the right to use and embed this font in printed and exported labels.',
      }),
    )
    await user.click(button)
    expect(fetcher).toHaveBeenCalledWith(
      '/api/workspace?fontUpload=1',
      expect.objectContaining({ method: 'POST' }),
    )
    const body = fetcher.mock.calls[0][1].body as FormData
    expect(body.get('licenseConsent')).toBe('true')
    expect((body.get('file') as File).name).toBe('apricots.ttf')
    expect(onWorkspace).toHaveBeenCalledWith(uploaded)
    expect(await screen.findByRole('status')).toHaveTextContent(
      'ready for labels',
    )
    expect(button).toBeDisabled()
  } finally {
    vi.unstubAllGlobals()
  }
})
