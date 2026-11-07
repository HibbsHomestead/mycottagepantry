import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AppUpdateNotice, refreshApplication } from './app-update-notice'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
  window.history.replaceState(null, '', '/')
})

it('detects a release newer than the bundled tab on the first check and refreshes only on request', async () => {
  const refresh = vi.fn()
  const fetcher = vi
    .fn()
    .mockResolvedValue(Response.json({ version: 'new-build' }))
  vi.stubGlobal('fetch', fetcher)
  render(<AppUpdateNotice version="old-build" refresh={refresh} />)
  expect(await screen.findByRole('status')).toHaveTextContent('Save your work')
  expect(fetcher).toHaveBeenCalledWith(
    expect.stringMatching(/^\/app-version.json\?t=/),
    expect.objectContaining({ cache: 'no-store' }),
  )
  expect(refresh).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Refresh app' }))
  expect(refresh).toHaveBeenCalledOnce()
  expect(refresh).toHaveBeenCalledWith('new-build')
  // The click is not used as the source of truth.
  expect(screen.getByRole('status')).toBeVisible()
})

it('keeps the notice hidden for the current version and rechecks after focus or reconnection', async () => {
  const fetcher = vi
    .fn()
    .mockImplementation(async () => Response.json({ version: 'current' }))
  vi.stubGlobal('fetch', fetcher)
  render(<AppUpdateNotice version="current" />)
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  fetcher.mockImplementation(async () => Response.json({ version: 'next' }))
  fireEvent(window, new Event('focus'))
  expect(await screen.findByRole('status')).toBeVisible()
  fetcher.mockImplementation(async () => Response.json({ version: 'current' }))
  fireEvent(window, new Event('online'))
  await waitFor(() =>
    expect(screen.queryByRole('status')).not.toBeInTheDocument(),
  )
})

it.each(['offline', 'html', 'malformed', 'null', 'empty', '404', '500'])(
  'tolerates %s checks and recovers without reloading',
  async (scenario) => {
    const refresh = vi.fn()
    const fetcher = vi.fn().mockImplementation(async () => {
      if (scenario === 'offline') throw new Error('Offline')
      if (scenario === 'html') return new Response('<html>Old release</html>')
      if (scenario === '404') return new Response('', { status: 404 })
      if (scenario === '500') return new Response('', { status: 500 })
      if (scenario === 'null') return Response.json(null)
      if (scenario === 'empty') return Response.json({ version: '' })
      return Response.json({ version: 123 })
    })
    vi.stubGlobal('fetch', fetcher)
    render(<AppUpdateNotice version="current" refresh={refresh} />)
    await act(async () => {})
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    fetcher.mockImplementation(async () => Response.json({ version: 'next' }))
    fireEvent(window, new Event('focus'))
    expect(await screen.findByRole('status')).toBeVisible()
    expect(refresh).not.toHaveBeenCalled()
  },
)

it('checks periodically and removes its timers on unmount', async () => {
  vi.useFakeTimers()
  const fetcher = vi
    .fn()
    .mockImplementation(async () => Response.json({ version: 'current' }))
  vi.stubGlobal('fetch', fetcher)
  const { unmount } = render(<AppUpdateNotice version="current" />)
  await act(async () => {})
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
  })
  expect(fetcher).toHaveBeenCalledTimes(2)
  unmount()
  expect(vi.getTimerCount()).toBe(0)
})

it('re-evaluates the running build after refresh, stays current on remount, and detects another deployment', async () => {
  let published = 'release-one'
  const refresh = vi.fn()
  const fetcher = vi.fn(async () => Response.json({ version: published }))
  vi.stubGlobal('fetch', fetcher)
  let app = render(<AppUpdateNotice version="release-one" refresh={refresh} />)
  await act(async () => {})
  expect(screen.queryByRole('status')).not.toBeInTheDocument()

  published = 'release-two'
  fireEvent(window, new Event('focus'))
  expect(await screen.findByRole('status')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Refresh app' }))
  expect(refresh).toHaveBeenCalledWith('release-two')

  app.unmount()
  app = render(<AppUpdateNotice version="release-two" refresh={refresh} />)
  await act(async () => {})
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  app.unmount()
  render(<AppUpdateNotice version="release-two" refresh={refresh} />)
  await act(async () => {})
  expect(screen.queryByRole('status')).not.toBeInTheDocument()

  published = 'release-three'
  fireEvent(window, new Event('focus'))
  expect(await screen.findByRole('status')).toBeVisible()
  expect(refresh).toHaveBeenCalledOnce()
})

it('does not retain an obsolete notification when the running version changes', async () => {
  const fetcher = vi.fn(async () => Response.json({ version: 'new-build' }))
  vi.stubGlobal('fetch', fetcher)
  const app = render(<AppUpdateNotice version="old-build" />)
  expect(await screen.findByRole('status')).toBeVisible()
  fetcher.mockImplementation(() => new Promise(() => {}))
  app.rerender(<AppUpdateNotice version="new-build" />)
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

it('ignores a late response from a previous running version', async () => {
  let finish!: (response: Response) => void
  const fetcher = vi
    .fn()
    .mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
    .mockImplementation(async () => Response.json({ version: 'new-build' }))
  vi.stubGlobal('fetch', fetcher)
  const app = render(<AppUpdateNotice version="old-build" />)
  app.rerender(<AppUpdateNotice version="new-build" />)
  await act(async () => finish(Response.json({ version: 'another-build' })))
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

it('skips offline checks and checks after reconnection', async () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  const fetcher = vi.fn(async () => Response.json({ version: 'current' }))
  vi.stubGlobal('fetch', fetcher)
  render(<AppUpdateNotice version="current" />)
  await act(async () => {})
  expect(fetcher).not.toHaveBeenCalled()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  fireEvent(window, new Event('online'))
  await waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

it('removes only its URL marker and preserves the route, query and history state', async () => {
  window.history.replaceState(
    { router: 'retained' },
    '',
    '/workspace?filter=bread&__app_update=current#Labels/Editor',
  )
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ version: 'current' })),
  )
  render(<AppUpdateNotice version="current" />)
  await act(async () => {})
  expect(
    window.location.pathname + window.location.search + window.location.hash,
  ).toBe('/workspace?filter=bread#Labels/Editor')
  expect(window.history.state).toEqual({ router: 'retained' })
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

it('requests fresh HTML for the accepted version without changing saved storage', () => {
  const replace = vi.fn()
  const clearLocal = vi.spyOn(Storage.prototype, 'clear')
  const removeLocal = vi.spyOn(Storage.prototype, 'removeItem')
  refreshApplication('next-build', {
    href: 'https://example.test/workspace?filter=bread#Labels/Editor',
    replace,
  })
  expect(replace).toHaveBeenCalledExactlyOnceWith(
    'https://example.test/workspace?filter=bread&__app_update=next-build#Labels/Editor',
  )
  expect(clearLocal).not.toHaveBeenCalled()
  expect(removeLocal).not.toHaveBeenCalled()
})
