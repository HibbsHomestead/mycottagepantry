import { sectionTabs } from './workspace-navigation'
/** Shared account decision contract. No browser profile or SDK cache grants access. */
export type Membership = { id: string; name: string; role: string }
export type AccessStatus =
  | 'signed_out'
  | 'email_unverified'
  | 'workspace'
  | 'workspace_selection'
  | 'no_workspace'
  | 'access_denied'
  | 'identity_error'
  | 'membership_error'
export type AccessEvent = {
  stage:
    | 'backend_identity'
    | 'session_verification'
    | 'membership_lookup'
    | 'workspace_resolution'
    | 'access_decision'
  result: string
  httpStatus?: number
  category?: 'timeout' | 'dns' | 'connection' | 'tls' | 'network' | 'unknown'
  attempt?: number
  elapsedMs?: number
  retrying?: boolean
  endpointHost?: string
}
export type AccountAccess = {
  status: AccessStatus
  reason: string
  traceId: string
  membership: Membership | null
  memberships: Membership[]
  privateTest: boolean
  events: AccessEvent[]
  environment: {
    origin: string
    deploymentId: string | null
    context: string | null
  }
}
export type AccountPage =
  'login' | 'workspace' | 'onboarding' | 'signup' | 'verify-email'
export const tracePattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i

export function safeWorkspaceReturn(value: string | null | undefined) {
  if (
    !value ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\')
  )
    return '/oven'
  try {
    const url = new URL(value, 'https://access.invalid')
    if (url.origin !== 'https://access.invalid') return '/oven'
    const path = url.pathname.replace(/^\/(workspace|studio)(?=\/|$)/, '/oven')
    if (!['/oven', '/oven/billing'].includes(path)) return '/oven'
    // Preserve existing functional query parameters, but never carry account IDs
    // or token-like values through a login return URL.
    for (const key of url.searchParams.keys())
      if (!['accessTrace', '__app_update'].includes(key)) return '/oven'
    if (
      url.searchParams.has('accessTrace') &&
      !tracePattern.test(url.searchParams.get('accessTrace')!)
    )
      return '/oven'
    const [hashPath, hashQuery] = url.hash.slice(1).split('?')
    const parts = hashPath.split('/').map(decodeURIComponent)
    const [section, tab] = parts
    const legacy = [
      'Pantry',
      'Recipes',
      'Products & Pricing',
      'Finances',
      'Reports',
    ]
    if (
      parts.length > 2 ||
      (section && !sectionTabs[section] && !legacy.includes(section))
    )
      return '/oven'
    if (
      tab &&
      sectionTabs[section] &&
      !sectionTabs[section].includes(tab) &&
      ![
        'Batch planner',
        'Batch runs',
        'Waste / adjustments',
        'My Labels',
        'Low stock',
        'Expiring soon',
      ].includes(tab)
    )
      return '/oven'
    const filters = new URLSearchParams(hashQuery)
    if ([...filters.keys()].some((key) => !['search', 'filter'].includes(key)))
      return '/oven'
    return (
      path +
      url.search +
      (section
        ? '#' +
          parts.map(encodeURIComponent).join('/') +
          (filters.size ? '?' + filters.toString() : '')
        : '')
    )
  } catch {
    return '/oven'
  }
}

export function accessDestination(
  access: Pick<AccountAccess, 'status'>,
  page: AccountPage,
  returnTo?: string | null,
): string | null {
  switch (access.status) {
    case 'workspace':
      return page === 'workspace' ? null : safeWorkspaceReturn(returnTo)
    case 'workspace_selection':
      return page === 'workspace' ? null : safeWorkspaceReturn(returnTo)
    case 'signed_out':
      return page === 'login' || page === 'signup' ? null : '/login'
    case 'email_unverified':
      return page === 'verify-email' ? null : '/verify-email'
    case 'no_workspace':
      return page === 'onboarding' ? null : '/onboarding'
    default:
      return null // Errors and denials never turn into registration.
  }
}

export function hasIdentityCallback(hash: string) {
  const params = new URLSearchParams(hash.slice(1))
  return [
    'confirmation_token',
    'recovery_token',
    'invite_token',
    'email_change_token',
    'access_token',
    'error',
  ].some((key) => params.has(key))
}
