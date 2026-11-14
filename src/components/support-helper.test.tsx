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
    .mockImplementation(async (_staff: boolean, body: any) =>
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
