import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
const api = vi.hoisted(() => vi.fn())
vi.mock('@/lib/support-client', () => ({ supportAiRequest: api }))
import { SupportHelper } from './support-helper'
import { supportAiDefaults } from '@/lib/support-ai'
const chat = {
  id: '10000000-0000-4000-8000-000000000001',
  messages: [
    { role: 'user', text: 'Inventory question', at: '2026-11-14T00:00:00Z' },
    {
      role: 'assistant',
      text: 'I cannot determine the cause. Contact support.',
      at: '2026-11-14T00:00:01Z',
      articles: ['inventory'],
    },
  ],
  diagnostics: null,
  expiresAt: '2026-12-14T00:00:00Z',
}
beforeEach(() =>
  api
    .mockReset()
    .mockImplementation(async (_staff: boolean, body: unknown) =>
      body
        ? { conversation: chat, providerFailed: true }
        : { conversations: [], policy: supportAiDefaults },
    ),
)
it('requires explicit consent, preserves draft on request failure and reviews escalation before submission', async () => {
  const user = userEvent.setup()
  render(<SupportHelper />)
  const input = await screen.findByLabelText('Your app question')
  await user.type(input, 'Inventory question')
  expect(screen.getByRole('button', { name: 'Send to AI' })).toBeDisabled()
  await user.click(screen.getByLabelText(/I agree to send/))
  api.mockRejectedValueOnce(new Error('Network unavailable'))
  await user.click(screen.getByRole('button', { name: 'Send to AI' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Network unavailable',
  )
  expect(input).toHaveValue('Inventory question')
  await user.click(screen.getByRole('button', { name: 'Send to AI' }))
  expect(
    await screen.findByText('I cannot determine the cause. Contact support.'),
  ).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Contact support' }))
  expect(api.mock.calls.some((c) => c[1]?.action === 'escalate')).toBe(false)
  expect(screen.getByLabelText('Issue summary for support')).toHaveValue(
    'Inventory question',
  )
  await user.clear(screen.getByLabelText('Issue summary for support'))
  await user.type(
    screen.getByLabelText('Issue summary for support'),
    'Reviewed issue',
  )
  api.mockResolvedValueOnce({ ticketId: 'ticket-one' })
  await user.click(
    screen.getByRole('button', { name: 'Create support request' }),
  )
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(false, {
      action: 'escalate',
      conversationId: chat.id,
      summary: 'Reviewed issue',
      diagnostics: null,
    }),
  )
  expect(
    await screen.findByRole('link', { name: 'Open support request' }),
  ).toHaveAttribute('href', '/support#ticket=ticket-one')
})
it('shows diagnostic preview only after opt-in and requires an explicit delete confirmation', async () => {
  api.mockResolvedValueOnce({
    conversations: [chat],
    policy: supportAiDefaults,
  })
  const user = userEvent.setup()
  render(<SupportHelper />)
  await screen.findByLabelText('Your app question')
  expect(
    screen.queryByText('Review diagnostic attachment'),
  ).not.toBeInTheDocument()
  await user.click(
    screen.getByLabelText('Attach sanitized error details for support review'),
  )
  expect(screen.getByText('Review diagnostic attachment')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Delete conversation' }))
  expect(api.mock.calls.some((c) => c[1]?.action === 'delete')).toBe(false)
  api.mockResolvedValueOnce({ deleted: true })
  await user.click(screen.getByRole('button', { name: 'Confirm deletion' }))
  expect(await screen.findByRole('status')).toHaveTextContent(
    'Conversation and its diagnostic attachment deleted',
  )
})

it('keeps the administrator experience private and binds questions to the selected ticket', async () => {
  const user = userEvent.setup()
  render(
    <SupportHelper
      staff
      contextTicketId="20000000-0000-4000-8000-000000000002"
    />,
  )
  await user.type(
    await screen.findByLabelText('Your app question'),
    'Inspect the selected ticket account status',
  )
  await user.click(screen.getByLabelText(/I agree to send/))
  await user.click(screen.getByRole('button', { name: 'Send to AI' }))
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        action: 'chat',
        ticketId: '20000000-0000-4000-8000-000000000002',
      }),
    ),
  )
  expect(
    screen.queryByRole('button', { name: 'Contact support' }),
  ).not.toBeInTheDocument()
  expect(
    screen.queryByText('Attach sanitized error details for support review'),
  ).not.toBeInTheDocument()
})
it('requires reviewed confirmation for recovery and displays an unverified outcome honestly', async () => {
  const action = {
    id: 'action-one',
    conversation_id: chat.id,
    tool: 'reconcile_billing',
    status: 'proposed',
  }
  api.mockResolvedValueOnce({
    conversations: [chat],
    policy: supportAiDefaults,
    actions: [action],
  })
  render(<SupportHelper staff />)
  const confirm = await screen.findByRole('button', {
    name: 'Confirm billing recovery',
  })
  expect(confirm).toBeDisabled()
  expect(api.mock.calls.some((c) => c[1]?.action === 'confirm')).toBe(false)
  await userEvent.click(screen.getByLabelText(/I reviewed this recovery/))
  api.mockResolvedValueOnce({
    verified: false,
    message: 'Recovery success could not be verified.',
  })
  await userEvent.click(confirm)
  expect(api).toHaveBeenCalledWith(true, {
    action: 'confirm',
    actionId: action.id,
    confirmation: 'RECONCILE',
  })
  expect(await screen.findByRole('status')).toHaveTextContent(
    'could not be verified',
  )
  expect(
    screen.queryByRole('button', { name: 'Confirm billing recovery' }),
  ).not.toBeInTheDocument()
})
