import { expect, it } from 'vitest'
import {
  accessDestination,
  safeWorkspaceReturn,
  type AccountPage,
  type AccessStatus,
} from './access-state'
it.each<AccountPage>([
  'login',
  'workspace',
  'signup',
  'onboarding',
  'verify-email',
])(
  'uses one oven decision from %s and discards stale signup intent',
  (page) => {
    expect(accessDestination({ status: 'workspace' }, page)).toBe(
      page === 'workspace' ? null : '/oven',
    )
  },
)
it.each<AccessStatus>(['identity_error', 'membership_error', 'access_denied'])(
  'does not redirect %s into login or registration',
  (status) => {
    for (const page of [
      'login',
      'workspace',
      'signup',
      'onboarding',
      'verify-email',
    ] as const)
      expect(accessDestination({ status }, page)).toBeNull()
  },
)
it('has stable terminal states instead of a login-verification or login-onboarding loop', () => {
  expect(accessDestination({ status: 'email_unverified' }, 'login')).toBe(
    '/verify-email',
  )
  expect(
    accessDestination({ status: 'email_unverified' }, 'verify-email'),
  ).toBeNull()
  expect(accessDestination({ status: 'signed_out' }, 'verify-email')).toBe(
    '/login',
  )
  expect(accessDestination({ status: 'signed_out' }, 'login')).toBeNull()
  expect(accessDestination({ status: 'no_workspace' }, 'login')).toBe(
    '/onboarding',
  )
  expect(accessDestination({ status: 'no_workspace' }, 'onboarding')).toBeNull()
})
it('requires authorized oven selection before returning to a saved section', () => {
  expect(
    accessDestination(
      { status: 'workspace_selection' },
      'login',
      '/workspace#Pantry',
    ),
  ).toBe('/oven#Pantry')
  expect(
    accessDestination({ status: 'workspace_selection' }, 'workspace'),
  ).toBeNull()
})
it('restores a validated oven destination after login', () => {
  expect(
    accessDestination({ status: 'workspace' }, 'login', '/workspace#Pantry'),
  ).toBe('/oven#Pantry')
  expect(safeWorkspaceReturn('/workspace/billing')).toBe('/oven/billing')
})
it.each([
  'https://evil.example/workspace',
  '//evil.example/workspace',
  '/login',
  '/signup?plan=cottage-kitchen',
  '/workspace?businessId=foreign',
  '/workspace#access_token=private',
  '/workspace\\evil',
  '/workspace#%ZZ',
])('rejects unsafe return intent %s', (value) =>
  expect(safeWorkspaceReturn(value)).toBe('/oven'),
)

it('preserves old and current tab-level login return intent and functional parameters', () => {
  for (const path of ['/oven', '/workspace', '/studio']) {
    expect(safeWorkspaceReturn(path + '#Pantry/Vendors')).toBe(
      '/oven#Pantry/Vendors',
    )
    expect(
      safeWorkspaceReturn(
        path + '#Inventory/Craft%20Materials?search=indigo&filter=Low+stock',
      ),
    ).toBe('/oven#Inventory/Craft%20Materials?search=indigo&filter=Low+stock')
  }
  const trace = 'b5b2cac8-b9a1-42e8-a8d7-318a6832c28b'
  expect(
    safeWorkspaceReturn(`/workspace?accessTrace=${trace}#Labels/Templates`),
  ).toBe(`/oven?accessTrace=${trace}#Labels/Templates`)
  expect(
    safeWorkspaceReturn(
      '/oven?__app_update=release-a#Production/Production%20Runs',
    ),
  ).toBe('/oven?__app_update=release-a#Production/Production%20Runs')
  expect(
    safeWorkspaceReturn(
      '/oven#Inventory/Craft%20Materials?access_token=private',
    ),
  ).toBe('/oven')
})
