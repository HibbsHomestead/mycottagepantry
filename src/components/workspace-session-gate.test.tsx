import { useState } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { WorkspaceSessionGate } from './workspace-session-gate'
import { useEditorCheckpoint } from '@/lib/editor-checkpoint'

const auth = vi.hoisted(() => ({ signIn: vi.fn() }))
vi.mock('@/lib/identity-session', () => ({ signInIdentity: auth.signIn }))

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('keeps editor state mounted while the same account signs back in', async () => {
  auth.signIn.mockResolvedValue({ id: 'fixture-owner' })
  function OvenFixture() {
    const [directions, setDirections] = useState('')
    const [expired, setExpired] = useState(false)
    return <>
      <label>Directions <textarea value={directions} onChange={(event) => setDirections(event.target.value)} /></label>
      <button type="button" onClick={() => setExpired(true)}>Expire fixture</button>
      {expired && <WorkspaceSessionGate reason="expired" subject="fixture-owner" resume={async () => setExpired(false)} />}
    </>
  }
  render(<OvenFixture />)
  const longForm = 'Fold the fixture dough and record each step. '.repeat(100)
  fireEvent.change(screen.getByLabelText('Directions'), { target: { value: longForm } })
  fireEvent.click(screen.getByRole('button', { name: 'Expire fixture' }))
  expect(screen.getByRole('dialog', { name: 'Session expired' })).toBeVisible()
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'fixture@example.invalid' } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'unused-fixture-value' } })
  fireEvent.submit(screen.getByRole('button', { name: 'Sign in and continue' }).closest('form')!)
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(auth.signIn).toHaveBeenCalledWith('fixture@example.invalid', 'unused-fixture-value', 'fixture-owner')
  expect(screen.getByLabelText('Directions')).toHaveValue(longForm)
})

it('retries the latest whole-draft checkpoint when the connection returns and restores it on reopen', async () => {
  let checkpoint: { directions: string } | null = null
  let connected = false
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
    if (!connected) throw new Error('Offline fixture')
    if (init?.method === 'POST') checkpoint = JSON.parse(String(init.body)).snapshot
    return Response.json({ revision: checkpoint ? 'fixture-etag' : null, snapshot: checkpoint })
  })
  vi.stubGlobal('fetch', fetcher)
  function DraftFixture({ directions = '' }: { directions?: string }) {
    const result = useEditorCheckpoint({ kind: 'recipe', scope: 'fixture-scope', snapshot: { directions }, dirty: !!directions })
    const [restored, setRestored] = useState('')
    return <>
      <p role="status">{result.status}</p>
      {result.available && <button onClick={() => setRestored(result.accept()?.directions || '')}>Restore</button>}
      <output aria-label="Restored directions">{restored}</output>
    </>
  }
  const view = render(<DraftFixture directions="Direction before offline" />)
  await waitFor(() => expect(screen.getByRole('status', { name: '' })).toHaveTextContent('offline'))
  view.rerender(<DraftFixture directions="Latest direction while offline" />)
  connected = true
  act(() => window.dispatchEvent(new Event('cottage.workspace.reconnected')))
  await waitFor(() => expect(checkpoint).toEqual({ directions: 'Latest direction while offline' }))
  view.unmount()
  render(<DraftFixture />)
  fireEvent.click(await screen.findByRole('button', { name: 'Restore' }))
  expect(screen.getByLabelText('Restored directions')).toHaveTextContent('Latest direction while offline')
})
