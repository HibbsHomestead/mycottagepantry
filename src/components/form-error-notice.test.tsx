import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FormErrorNotice, safeSubmissionMessage } from './form-error-notice'
import { SubmissionForm } from './submission-form'

describe('submission notices', () => {
  it('does not render an empty banner and announces only changed content', () => {
    const { rerender } = render(<FormErrorNotice />)
    expect(screen.queryByRole('alert')).toBeNull()
    rerender(<FormErrorNotice message="Choose a supplier." />)
    const alert = screen.getByRole('alert')
    rerender(<FormErrorNotice message="Choose a supplier." />)
    expect(screen.getByRole('alert')).toBe(alert)
    expect(alert).toHaveTextContent('Choose a supplier.')
    rerender(<FormErrorNotice />)
    expect(screen.queryByRole('alert')).toBeNull()
  })
  it('preserves long business-rule messages and filters private diagnostics', () => {
    const long = 'Choose a different record name. '.repeat(50)
    expect(safeSubmissionMessage(long)).toBe(long)
    expect(safeSubmissionMessage('Failed to fetch')).toMatch(
      /connection failed/i,
    )
    expect(safeSubmissionMessage('403 Forbidden')).toMatch(/permission/)
    expect(safeSubmissionMessage('SQL stack at service()')).not.toMatch(
      /SQL|stack|service/,
    )
  })
  it('summarizes native validation and keeps inputs until corrected or reset', () => {
    const onReset = vi.fn()
    render(
      <SubmissionForm onReset={onReset}>
        <label>
          Name
          <input required defaultValue="" />
        </label>
        <FormErrorNotice />
        <button>Save</button>
      </SubmissionForm>,
    )
    const input = screen.getByRole('textbox') as HTMLInputElement
    fireEvent.invalid(input)
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Review the highlighted fields',
    )
    fireEvent.input(input, { target: { value: 'Kept value' } })
    expect(input.value).toBe('Kept value')
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.reset(input.form!)
    expect(onReset).toHaveBeenCalledOnce()
  })
})

it('blocks duplicate async submissions and permits retry after rejection', async () => {
  let reject!: (reason: Error) => void
  const submit = vi.fn((event: React.FormEvent) => {
    event.preventDefault()
    return new Promise<void>((_, fail) => {
      reject = fail
    })
  })
  render(
    <SubmissionForm onSubmit={submit}>
      <input defaultValue="Unsaved" aria-label="Value" />
      <FormErrorNotice />
      <button>Submit</button>
    </SubmissionForm>,
  )
  const form = screen.getByRole('textbox').closest('form')!
  fireEvent.submit(form)
  fireEvent.submit(form)
  expect(submit).toHaveBeenCalledOnce()
  reject(new Error('Controlled rejection'))
  await screen.findByRole('alert')
  expect(screen.getByRole('textbox')).toHaveValue('Unsaved')
  fireEvent.submit(form)
  expect(submit).toHaveBeenCalledTimes(2)
})
