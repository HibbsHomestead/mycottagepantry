import { expect, it } from 'vitest'
import { customerMessage } from './customer-message'
it('preserves actionable validation and translates sign-in and verification failures', () => {
  expect(customerMessage('401 SIGN_IN_REQUIRED')).toBe(
    'Please sign in to continue.',
  )
  expect(customerMessage('EMAIL_UNVERIFIED')).toMatch(/Check your email/)
  for (const text of [
    'Enter a valid email address.',
    'Enter the quantity in one package.',
    'This invitation has expired. Ask the owner to send a new one.',
  ])
    expect(customerMessage(text)).toBe(text)
})
it.each([
  'Error: SQL constraint users_id_key',
  'Error at save (/server/app.ts:12)',
  '{"error":"private"}',
  'Provider exception with api_key',
  'fetch failed',
])('filters internal failure %s', (value) => {
  expect(customerMessage(value)).toBe(
    'We couldn’t complete that request. Please try again. Contact support if it continues.',
  )
})
