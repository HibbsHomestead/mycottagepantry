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
it('never exposes account-action controls from a support conversation, including older proposals', async () => {
  api.mockResolvedValueOnce({
    conversations: [chat],
    policy: supportAiDefaults,
    actions: [
      {
        id: 'old-action',
        conversation_id: chat.id,
        tool: 'reconcile_billing',
        status: 'proposed',
      },
    ],
  })
  render(<SupportHelper staff />)
  await screen.findByLabelText('Your app question')
  expect(
    screen.queryByRole('button', { name: 'Confirm billing recovery' }),
  ).not.toBeInTheDocument()
  expect(
    screen.getByText(
      /Account actions are unavailable through support conversations/,
    ),
  ).toBeInTheDocument()
  expect(api.mock.calls.some((c) => c[1]?.action === 'confirm')).toBe(false)
})

it('shows the exact server proposal and sends approval only after an explicit button click', async () => {
  const proposal = {
    id: '10000000-0000-4000-8000-000000000002',
    business_id: 'my-oven',
    target_id: 'settings-one',
    before: { timezone: 'America/Chicago' },
    after: { timezone: 'America/New_York' },
    status: 'proposed',
    expires_at: '2099-12-14T00:00:00Z',
    verified_at: null,
  }
  api.mockResolvedValue({
    conversations: [{ ...chat, corrections: [proposal] }],
    policy: supportAiDefaults,
  })
  const user = userEvent.setup()
  render(<SupportHelper />)
  const approve = await screen.findByRole('button', {
    name: 'Approve exact change to America/New_York',
  })
  expect(screen.getByText(/Business timezone setting/)).toBeInTheDocument()
  expect(api.mock.calls.some((c) => c[1]?.action === 'confirm')).toBe(false)
  api.mockResolvedValueOnce({
    stage: 'Fix verified',
    message: 'Saved timezone read back.',
  })
  await user.click(approve)
  expect(api).toHaveBeenCalledWith(false, {
    action: 'confirm',
    actionId: proposal.id,
    confirmation: 'APPLY_TIMEZONE',
    timezone: 'America/New_York',
  })
  expect(await screen.findByRole('status')).toHaveTextContent('Fix verified')
})

it('requires separate screenshot sharing consent and sends only the selected attachment ID', async () => {
  const user = userEvent.setup()
  render(
    <SupportHelper
      screenshots={[
        {
          id: '10000000-0000-4000-8000-000000000009',
          label: 'Ticket screenshot 1',
        },
      ]}
    />,
  )
  await user.type(
    await screen.findByLabelText('Your app question'),
    'What does this inventory screenshot show?',
  )
  await user.click(screen.getByLabelText(/I agree to send/))
  await user.selectOptions(
    screen.getByLabelText('Screenshot from selected ticket'),
    '10000000-0000-4000-8000-000000000009',
  )
  expect(screen.getByRole('button', { name: 'Send to AI' })).toBeDisabled()
  expect(api.mock.calls.some((c) => c[1]?.screenshotAttachmentId)).toBe(false)
  await user.click(screen.getByLabelText(/I reviewed this screenshot/))
  await user.click(screen.getByRole('button', { name: 'Send to AI' }))
  expect(api).toHaveBeenCalledWith(
    false,
    expect.objectContaining({
      screenshotAttachmentId: '10000000-0000-4000-8000-000000000009',
      screenshotConsent: true,
    }),
  )
})
