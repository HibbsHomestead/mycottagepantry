import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { InventoryErrorDetails } from './inventory-error-details'
it('offers support without rendering developer diagnostics or raw exceptions', () => {
  render(
    <InventoryErrorDetails
      error={new Error('private-item private-credential stack')}
    />,
  )
  expect(screen.getByRole('link', { name: 'Contact support' })).toHaveAttribute(
    'href',
    '/support',
  )
  expect(document.body).not.toHaveTextContent(
    /private-item|private-credential|stack|Technical details/,
  )
  expect(document.querySelector('textarea,pre')).toBeNull()
})
