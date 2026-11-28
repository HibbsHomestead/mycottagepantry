import { useEffect, useRef, useState } from 'react'

export type EditorKind = 'recipe' | 'product' | 'receive' | 'prep-list'
type Status = 'idle' | 'saving' | 'saved' | 'offline' | 'conflict'
const dirtyEditors = new Set<symbol>()

export const hasDirtyEditor = () => dirtyEditors.size > 0

export function useEditorLeaveGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return
    const editor = Symbol()
    dirtyEditors.add(editor)
    function warn(event: BeforeUnloadEvent) { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => {
      dirtyEditors.delete(editor)
      window.removeEventListener('beforeunload', warn)
    }
  }, [dirty])
}

export function useEditorCheckpoint<Snapshot extends object>({ kind, target, scope, snapshot, dirty }: {
  kind?: EditorKind | null
  target?: string | null
  scope?: string
  snapshot: Snapshot
  dirty: boolean
}) {
  const url = kind && scope ? `/api/workspace?editorDraft=${kind}&target=${encodeURIComponent(target || 'new')}` : ''
  const key = url ? `${scope}:${url}` : ''
  const [view, setView] = useState<{ key: string; available: Snapshot | null; status: Status }>({ key, available: null, status: 'idle' })
  if (view.key !== key) setView({ key, available: null, status: 'idle' })
  const { available, status } = view
  useEditorLeaveGuard(!!url && dirty)
  const latest = useRef({ snapshot, dirty })
  useEffect(() => { latest.current = { snapshot, dirty } }, [snapshot, dirty])
  const active = useRef<{
    url: string
    revision: string | null | undefined
    offered: boolean
    conflict: boolean
    signature?: string
    pending?: Promise<void>
    clear?: () => Promise<void>
  } | null>(null)
  useEffect(() => {
    if (!url || !scope) return
    const state: NonNullable<typeof active.current> = { url, revision: undefined, offered: false, conflict: false }
    active.current = state
    const headers = { 'Content-Type': 'application/json', 'X-Workspace-Editor-Scope': scope }
    const update = (next: Status) => {
      if (active.current === state) setView((previous) => ({ ...previous, status: next }))
    }
    async function check() {
      const response = await fetch(url, { headers, cache: 'no-store', signal: AbortSignal.timeout(12_000) })
      if (!response.ok) throw new Error('Checkpoint unavailable')
      const data = await response.json()
      state.revision = data.revision
      if (data.snapshot && active.current === state) {
        state.offered = true
        setView((previous) => ({ ...previous, available: data.snapshot }))
      }
    }
    async function write(value: Snapshot | null) {
      const response = await fetch(url, {
        method: 'POST', headers, body: JSON.stringify({ revision: state.revision, snapshot: value }),
        signal: AbortSignal.timeout(12_000),
      })
      if (response.status === 409) {
        state.conflict = true
        update('conflict')
        return
      }
      if (!response.ok) throw new Error('Checkpoint not confirmed')
      state.revision = (await response.json()).revision
      update(value ? 'saved' : 'idle')
    }
    function sync() {
      if (state.pending || state.offered || state.conflict || active.current !== state) return
      state.pending = (async () => {
        if (state.revision === undefined) await check()
        if (active.current !== state || state.offered || !latest.current.dirty) return
        const value = latest.current.snapshot
        const signature = JSON.stringify(value)
        if (state.signature === signature) return
        update('saving')
        await write(value)
        if (!state.conflict) state.signature = signature
      })().catch(() => update('offline')).finally(() => { state.pending = undefined })
    }
    state.clear = async () => {
      const wasOffered = state.offered
      state.offered = true
      await state.pending
      if (!wasOffered && state.signature && state.revision && !state.conflict)
        await write(null).catch(() => update('offline'))
    }
    sync()
    const timer = setInterval(sync, 5_000)
    window.addEventListener('online', sync)
    window.addEventListener('cottage.workspace.reconnected', sync)
    return () => {
      active.current = null
      clearInterval(timer)
      window.removeEventListener('online', sync)
      window.removeEventListener('cottage.workspace.reconnected', sync)
    }
  }, [url, scope])
  return {
    status,
    available,
    accept() {
      if (active.current?.url !== url) return null
      active.current.offered = false
      if (available) active.current.signature = JSON.stringify(available)
      setView((previous) => ({ ...previous, available: null }))
      return available
    },
    clear: () => active.current?.url === url ? active.current.clear?.() : undefined,
  }
}

export function checkpointMessage(status: Status) {
  return {
    idle: '',
    saving: 'Saving a recovery draft…',
    saved: 'Recovery draft saved. Submit to save the actual record.',
    offline: 'Recovery draft not confirmed. Keep this tab open; retrying when connected.',
    conflict: 'Another tab changed the recovery draft. Your edits are still in this tab.',
  }[status]
}
