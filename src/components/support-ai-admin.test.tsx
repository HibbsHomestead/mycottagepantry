import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
const request = vi.hoisted(() =>
  vi.fn(async () => ({
    suggestion: 'Please review the recipe guide.',
    articles: ['recipes'],
  })),
)
vi.mock('@/lib/support-client', () => ({ supportAiRequest: request }))
import { SupportAiSuggestion } from './support-ai-admin'

it('keeps AI drafts separate from sending and requires an explicit transfer to the composer', async () => {
  const onDraft = vi.fn()
  render(
    <SupportAiSuggestion
      ticketId="ticket"
      consent
      onDraft={onDraft}
      reply="Original reply"
    />,
  )
  fireEvent.change(screen.getByLabelText('AI assistance'), {
    target: { value: 'draft' },
  })
  fireEvent.click(
    screen.getByRole('button', { name: 'Generate AI suggestion' }),
  )
  await screen.findByText('AI suggestion · review required · not sent')
  expect(request).toHaveBeenLastCalledWith(true, {
    action: 'summarize',
    ticketId: 'ticket',
    assistance: 'draft',
  })
  expect(onDraft).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Use as reply draft' }))
  expect(onDraft).toHaveBeenCalledWith('Please review the recipe guide.')
})

it('leaves ordinary staff replies available when AI review consent is absent', () => {
  render(
    <SupportAiSuggestion ticketId="ticket" consent={false} onDraft={vi.fn()} />,
  )
  expect(
    screen.getByRole('button', { name: 'Generate AI suggestion' }),
  ).toBeDisabled()
})
