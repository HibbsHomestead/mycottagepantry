import { createFileRoute } from '@tanstack/react-router'
import { useAccountAccess } from '@/lib/account-access-client'
import { AccountAccessStatus } from '@/components/account-access-status'
import { WorkspaceApp } from '@/components/workspace-app'
import { WorkspacePicker } from '@/components/workspace-picker'
export const Route = createFileRoute('/oven')({
  headers: () => ({ 'Cache-Control': 'private, no-store', Vary: 'Cookie' }),
  head: () => ({
    meta: [
      { title: 'My Oven | Cottage Pantry' },
      { name: 'robots', content: 'noindex' },
    ],
  }),
  component: WorkspacePage,
})
function WorkspacePage() {
  const state = useAccountAccess('workspace')
  if (
    state.loading ||
    state.error ||
    !state.access ||
    ['identity_error', 'membership_error', 'access_denied'].includes(
      state.access.status,
    )
  )
    return <AccountAccessStatus {...state} />
  if (state.access.status === 'workspace_selection')
    return <WorkspacePicker memberships={state.access.memberships} />
  if (state.access.status === 'workspace') return <WorkspaceApp />
  return <AccountAccessStatus {...state} loading />
}
