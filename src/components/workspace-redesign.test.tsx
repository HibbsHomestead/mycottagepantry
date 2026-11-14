import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { SettingsWorkspace } from './settings-workspace'
import { TaxCenter } from './tax-center'
import { demoData } from '@/lib/demo'

it('previews theme changes without saving until the save action', async () => {
  const preview = vi.fn(),
    saveAppearance = vi.fn().mockResolvedValue(undefined)
  render(
    <SettingsWorkspace
      workspace={demoData()}
      section="Appearance"
      go={vi.fn()}
      open={vi.fn()}
      appearance={{ theme: 'plum', mode: 'light' }}
      preview={preview}
      saveAppearance={saveAppearance}
      saveBusiness={vi.fn()}
      exportData={vi.fn()}
      backup={vi.fn()}
      busy={false}
      canSave
    />,
  )
  const user = userEvent.setup()
  await user.click(screen.getByRole('radio', { name: /Berry Market/ }))
  expect(preview).toHaveBeenCalledWith({ theme: 'berry', mode: 'light' })
  expect(saveAppearance).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Save appearance' }))
  expect(saveAppearance).toHaveBeenCalledOnce()
})
it('reveals custom tax dates only when selected and exports the chosen report', async () => {
  const exportData = vi.fn(),
    user = userEvent.setup()
  render(
    <TaxCenter
      workspace={demoData()}
      configure={vi.fn()}
      exportData={exportData}
    />,
  )
  expect(screen.queryByLabelText('From')).not.toBeInTheDocument()
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Tax reporting period' }),
    'Custom',
  )
  expect(screen.getByLabelText('From')).toHaveAttribute('type', 'date')
  expect(screen.getByLabelText('To')).toHaveAttribute('type', 'date')
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Tax export report' }),
    'Sales tax by jurisdiction',
  )
  await user.click(screen.getByRole('button', { name: 'Export tax report' }))
  expect(exportData).toHaveBeenCalledWith(
    'Sales tax by jurisdiction',
    expect.any(Array),
  )
})
it('keeps exports available without Square connection controls or provider requests', async () => {
  const openTaxReports = vi.fn()
  const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
    expect(options?.method).not.toBe('POST')
    return Response.json(
      url.includes('assistant')
        ? {
            configured: true,
            status: 'Configured, not tested',
            model: 'perplexity/sonar',
            checkedAt: null,
            sourcesReturned: null,
            message: null,
          }
        : {
            configured: true,
            status: 'Configured, not tested',
            lastTest: null,
            message: null,
          },
    )
  })
  vi.stubGlobal('fetch', fetcher)
  try {
    render(
      <SettingsWorkspace
        workspace={demoData()}
        section="Integrations"
        go={vi.fn()}
        open={vi.fn()}
        appearance={{ theme: 'plum', mode: 'light' }}
        preview={vi.fn()}
        saveAppearance={vi.fn()}
        saveBusiness={vi.fn()}
        exportData={vi.fn()}
        backup={vi.fn()}
        busy={false}
        canSave
        isOwner
        openTaxReports={openTaxReports}
      />,
    )
    expect(screen.queryByText('Configured, not tested')).not.toBeInTheDocument()
    expect(
      screen.queryByText(
        /SerpApi|shopping configuration|Shopping price comparison/i,
      ),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Test shopping search/i }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('Square')).not.toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Tax reports & exports' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('Not connected')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Connect Square/i }),
    ).not.toBeInTheDocument()
    await userEvent.click(
      screen.getByRole('button', { name: 'Open tax reports' }),
    )
    expect(openTaxReports).toHaveBeenCalledOnce()
    expect(fetcher).not.toHaveBeenCalled()
    expect(screen.queryByText(/Proposed sync scope/)).not.toBeInTheDocument()
  } finally {
    vi.unstubAllGlobals()
  }
})
it.each(['public demo', 'Owner', 'Manager', 'Staff'])(
  'omits shopping integration/setup for %s without requesting its status',
  async (role) => {
    const fetcher = vi.fn(async (_url: string) =>
      Response.json({
        configured: false,
        status: 'Unavailable',
        model: 'perplexity/sonar',
        checkedAt: null,
        sourcesReturned: null,
        message: null,
      }),
    )
    vi.stubGlobal('fetch', fetcher)
    try {
      render(
        <SettingsWorkspace
          workspace={demoData()}
          section="Integrations"
          go={vi.fn()}
          open={vi.fn()}
          appearance={{ theme: 'plum', mode: 'light' }}
          preview={vi.fn()}
          saveAppearance={vi.fn()}
          saveBusiness={vi.fn()}
          exportData={vi.fn()}
          backup={vi.fn()}
          busy={false}
          canSave={role === 'Owner' || role === 'Manager'}
          isOwner={role === 'Owner'}
        />,
      )
      expect(
        screen.queryByText(
          /Shopping price comparison|SerpApi|SERPAPI_API_KEY|shopping configuration/i,
        ),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', {
          name: /Test shopping search|Refresh configuration status/i,
        }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('heading', { name: 'Cottage Pantry Assistant' }),
      ).not.toBeInTheDocument()
      expect(
        screen.getByRole('heading', { name: 'Tax reports & exports' }),
      ).toBeInTheDocument()
      expect(fetcher).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  },
)

it('keeps billing inside navigation and reports successful and failed saves', async () => {
  const user = userEvent.setup()
  const saveAppearance = vi.fn().mockResolvedValue(undefined)
  const props = {
    workspace: demoData(),
    section: 'Appearance',
    go: vi.fn(),
    open: vi.fn(),
    appearance: { theme: 'plum' as const, mode: 'light' as const },
    preview: vi.fn(),
    saveAppearance,
    saveBusiness: vi.fn(),
    exportData: vi.fn(),
    backup: vi.fn(),
    busy: false,
    canSave: true,
    isOwner: true,
  }
  const { container } = render(<SettingsWorkspace {...props} />)
  expect(
    screen.getByRole('navigation', { name: 'Settings sections' }),
  ).toContainElement(
    screen.getByRole('link', { name: 'Subscription & Billing' }),
  )
  expect(container.querySelector('.settings-workspace')!.children).toHaveLength(
    2,
  )
  await user.click(screen.getByRole('button', { name: 'Save appearance' }))
  expect(await screen.findByRole('status')).toHaveTextContent(
    'Saved successfully.',
  )
  saveAppearance.mockRejectedValueOnce(
    new Error('Connection unavailable; retry.'),
  )
  await user.click(screen.getByRole('button', { name: 'Save appearance' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Connection unavailable; retry.',
  )
  expect(screen.queryByText('Saved successfully.')).not.toBeInTheDocument()
})

it('keeps an unsaved tax draft while switching sections and receiving refreshed settings', async () => {
  const user = userEvent.setup()
  const workspace = demoData()
  const props = {
    workspace,
    section: 'Taxes',
    go: vi.fn(),
    open: vi.fn(),
    appearance: { theme: 'plum' as const, mode: 'light' as const },
    preview: vi.fn(),
    saveAppearance: vi.fn(),
    saveBusiness: vi.fn(),
    exportData: vi.fn(),
    backup: vi.fn(),
    busy: false,
    canSave: true,
  }
  const { rerender } = render(<SettingsWorkspace {...props} />)
  await user.click(screen.getByRole('button', { name: 'Add tax rate' }))
  const name = screen.getAllByLabelText('Rate name')[0]
  await user.clear(name)
  await user.type(name, 'Unsaved local draft')
  rerender(<SettingsWorkspace {...props} section="Units & Costing Defaults" />)
  rerender(
    <SettingsWorkspace
      {...props}
      workspace={structuredClone(workspace)}
      section="Taxes"
    />,
  )
  expect(screen.getAllByLabelText('Rate name')[0]).toHaveValue(
    'Unsaved local draft',
  )
  expect(props.saveBusiness).not.toHaveBeenCalled()
})
