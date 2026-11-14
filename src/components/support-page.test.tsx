import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
const api = vi.hoisted(() => ({
  request: vi.fn(),
  post: vi.fn(),
  upload: vi.fn(),
}))
vi.mock('@/lib/support-client', () => ({
  supportAiRequest: vi.fn(async () => ({
    policy: {
      enabled: true,
      userDaily: 20,
      businessDaily: 60,
      globalDaily: 400,
      cooldownSeconds: 10,
      retentionDays: 30,
    },
    usage: [],
  })),
  supportRequest: api.request,
  supportPost: api.post,
  uploadSupportScreenshot: api.upload,
}))
vi.mock('@/lib/session.functions', () => ({
  getSessionStatus: async () => ({ signedIn: true }),
}))
import { SupportPage } from './support-page'
const ticket = {
  id: '20000000-0000-4000-8000-000000000001',
  number: 17,
  subject: 'Help with a recipe',
  category: 'Question',
  status: 'new',
  createdAt: '2026-10-31T10:00:00Z',
  updatedAt: '2026-10-31T10:00:00Z',
}
const detail = {
  ticket,
  messages: [
    {
      id: '30000000-0000-4000-8000-000000000001',
      body: 'Please help with Method',
      kind: 'customer',
      own: true,
      createdAt: ticket.createdAt,
      attachments: [],
    },
  ],
}
beforeEach(() => {
  window.history.replaceState(null, '', '/support')
  api.request
    .mockReset()
    .mockImplementation(async (path: string) =>
      path.includes('ticket=') ? detail : { staff: false, admin: false },
    )
  api.post
    .mockReset()
    .mockImplementation(async (_staff: boolean, action: string) =>
      action === 'list' ? { tickets: [], hasMore: false } : detail,
    )
  api.upload.mockReset()
})
it('lets a verified requester create and reply without any private-note controls', async () => {
  const user = userEvent.setup()
  render(<SupportPage />)
  await user.click(await screen.findByRole('button', { name: 'New ticket' }))
  expect(screen.getByText(/Do not submit passwords/)).toBeInTheDocument()
  await user.type(screen.getByLabelText('Subject'), ticket.subject)
  await user.type(screen.getByLabelText('Message'), 'Please help with Method')
  await user.click(screen.getByRole('button', { name: 'Submit ticket' }))
  expect(await screen.findByText(/Ticket #17/)).toBeInTheDocument()
  expect(
    screen.queryByLabelText(/Private internal note/),
  ).not.toBeInTheDocument()
  await user.type(
    screen.getByLabelText('Reply in Cottage Pantry'),
    'One more question',
  )
  await user.click(screen.getByRole('button', { name: 'Send reply' }))
  expect(api.post).toHaveBeenCalledWith(
    false,
    'reply',
    expect.objectContaining({ message: 'One more question', internal: false }),
  )
  expect(api.upload).not.toHaveBeenCalled()
})
it('shows an honest signed-out error and keeps a public help route', async () => {
  api.request.mockRejectedValue(
    new Error('Log in to Cottage Pantry to get help.'),
  )
  render(<SupportPage />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Log in')
  expect(
    screen.getByRole('link', { name: 'Cannot sign in? Help & contact' }),
  ).toHaveAttribute('href', '/help')
  expect(screen.queryByRole('form')).not.toBeInTheDocument()
})
it('renders customer text as text and clearly distinguishes private notes in the restricted inbox', async () => {
  window.history.replaceState(null, '', '/platform-support#ticket=' + ticket.id)
  api.request.mockImplementation(async (path: string) =>
    path.includes('ticket=')
      ? {
          ...detail,
          messages: [
            ...detail.messages,
            {
              ...detail.messages[0],
              id: 'note',
              kind: 'internal',
              body: '<script>private note</script>',
            },
          ],
          notifications: [
            {
              id: 'n',
              kind: 'acknowledgment',
              status: 'accepted',
              attempts: 1,
            },
          ],
        }
      : { staff: true, admin: false },
  )
  render(<SupportPage staff />)
  expect(
    await screen.findByText('<script>private note</script>'),
  ).toBeInTheDocument()
  expect(document.querySelector('script')).toBeNull()
  expect(screen.getByText('Private internal note')).toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Notification settings' }),
  ).not.toBeInTheDocument()
  await userEvent.click(screen.getByLabelText(/Private internal note —/))
  await userEvent.type(
    screen.getByLabelText('Private note'),
    'Internal follow-up',
  )
  await userEvent.click(
    screen.getByRole('button', { name: 'Save private note' }),
  )
  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith(
      true,
      'reply',
      expect.objectContaining({ internal: true }),
    ),
  )
})
