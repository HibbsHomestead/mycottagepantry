import { activeDemoSession } from './demo-client'

export type SessionState = 'active' | 'retrying' | 'expired' | 'signed-out' | 'absent'
type Tokens = { access_token: string; refresh_token: string; expires_at?: number }
const storageKey = 'gotrue.user'
const signalKey = 'cottage.identity.change'
const retryKey = 'cottage.identity.retry'
const lockName = 'cottage.identity'
const diagnosticUntil = Date.parse('2026-12-28T00:00:00Z')
let tabId: string | undefined
let pending: Promise<SessionState> | undefined

export function sessionDiagnostic(reason: string, status: number | null = null) {
  if (Date.now() >= diagnosticUntil) return
  tabId ??= crypto.randomUUID()
  console.info('cottage_identity', {
    reason, status, at: new Date().toISOString(), tabId,
    route: location.pathname === '/oven' ? '/oven' : location.pathname === '/login' ? '/login' : 'other',
  })
}

function stored<T>(key: string): T | undefined {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? undefined }
  catch { return undefined }
}

function store(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { return }
}

function remove(key: string) {
  try { localStorage.removeItem(key) } catch { return }
}

function cookie(name: string) {
  const value = document.cookie.split(/;\s*/).find((part) => part.startsWith(name + '='))
  try { return value ? decodeURIComponent(value.slice(name.length + 1)) : '' }
  catch { return '' }
}

function claims(token: string): { exp?: number; sub?: string } {
  try { return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) }
  catch { return {} }
}

function sdkSession() {
  return stored<{ token?: Tokens }>(storageKey)
}

function tokens() {
  const access = cookie('nf_jwt')
  const cached = sdkSession()?.token
  if (access) return { access_token: access, refresh_token: cookie('nf_refresh') || (cached?.access_token === access ? cached.refresh_token : '') }
  return cached
}

export function identitySubject() {
  return claims(tokens()?.access_token || '').sub
}

function publish(state: SessionState) {
  store(signalKey, { state, revision: crypto.randomUUID() })
  window.dispatchEvent(new CustomEvent<SessionState>(signalKey, { detail: state }))
}

function clear(state: 'expired' | 'signed-out') {
  for (const name of ['nf_jwt', 'nf_refresh'])
    document.cookie = `${name}=; path=/; secure; samesite=lax; max-age=0`
  remove(storageKey)
  publish(state)
}

function save(fresh: Tokens, expiry: number) {
  document.cookie = `nf_jwt=${encodeURIComponent(fresh.access_token)}; path=/; secure; samesite=lax`
  document.cookie = `nf_refresh=${encodeURIComponent(fresh.refresh_token)}; path=/; secure; samesite=lax`
  const previous = sdkSession()
  if (previous) store(storageKey, { ...previous, token: { ...fresh, expires_at: expiry } })
}

function expires(token: string) {
  return (claims(token).exp || 0) * 1000
}

function renewalDelay() {
  const token = tokens()?.access_token
  if (!token) return 30_000
  const retry = stored<{ next: number }>(retryKey)?.next || 0
  return Math.max(1_000, retry - Date.now(), expires(token) - Date.now() - 90_000 - Math.random() * 20_000)
}

async function renew(force = false): Promise<SessionState> {
  const observed = tokens()
  if (!observed) return 'absent'
  if (!force && cookie('nf_jwt') && expires(observed.access_token) - Date.now() > 110_000) return 'active'
  if (!navigator.locks) return 'retrying'
  return navigator.locks.request(lockName, async () => {
    const current = tokens()
    if (!current) return 'absent'
    const rotated = observed.access_token !== current.access_token || observed.refresh_token !== current.refresh_token
    if (cookie('nf_jwt') && (!force || rotated) && expires(current.access_token) - Date.now() > 110_000) return 'active'
    if (!current.refresh_token) return 'retrying'
    const retry = stored<{ next: number; failures: number }>(retryKey)
    if (retry && retry.next > Date.now()) return 'retrying'
    let status: number | null = null
    try {
      const response = await fetch('/.netlify/identity/token', {
        method: 'POST', redirect: 'error', cache: 'no-store',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: current.refresh_token }),
        signal: AbortSignal.timeout(15_000),
      })
      status = response.status
      const result = await response.json()
      const latest = tokens()
      if (latest?.refresh_token !== current.refresh_token || latest.access_token !== current.access_token)
        return latest ? 'active' : 'absent'
      if ((status === 400 || status === 401) && result.error === 'invalid_grant') {
        sessionDiagnostic('confirmed_invalid_grant', status)
        clear('expired')
        return 'expired'
      }
      if (!response.ok || typeof result.access_token !== 'string' ||
          typeof result.refresh_token !== 'string' || !result.refresh_token ||
          !identitySubject() || claims(result.access_token).sub !== identitySubject() ||
          expires(result.access_token) <= Date.now() - 110_000) throw new Error('Refresh not confirmed')
      save(result, expires(result.access_token))
      store(retryKey, null)
      publish('active')
      return 'active'
    } catch {
      const failures = Math.min((retry?.failures || 0) + 1, 6)
      store(retryKey, { failures, next: Date.now() + 1_000 * 2 ** failures + Math.random() * 1_000 })
      sessionDiagnostic('refresh_retrying', status)
      return 'retrying'
    }
  })
}

export function restoreIdentitySession(force = false) {
  pending ??= (async (): Promise<SessionState> => {
    if (await activeDemoSession()) return 'absent'
    return renew(force)
  })().finally(() => { pending = undefined })
  return pending
}

export async function withWorkspaceIdentity(request: () => Promise<Response>) {
  const subject = identitySubject()
  const response = await request()
  if (response.status !== 401 || !subject) return response
  const detail = await response.clone().json().catch(() => null)
  if (detail?.code !== 'SIGN_IN_REQUIRED') return response
  sessionDiagnostic('workspace_request_sign_in_required', 401)
  const state = await restoreIdentitySession(true)
  return state === 'active' && identitySubject() === subject ? request() : response
}

export function watchIdentitySession(onState: (state: SessionState) => void) {
  let stopped = false
  let timer: ReturnType<typeof setTimeout>
  function schedule() {
    clearTimeout(timer)
    if (!stopped && tokens()) timer = setTimeout(check, renewalDelay())
  }
  async function check() {
    const result = await restoreIdentitySession().catch(() => 'retrying' as const)
    if (stopped) return
    if (result !== 'absent') onState(result)
    schedule()
  }
  function changed(state?: SessionState) {
    if (!state) return
    if (state !== 'active' && !tokens()) sessionDiagnostic(state === 'expired' ? 'tab_session_expired' : 'tab_signed_out')
    if (state === 'active' ? !!tokens() : !tokens()) onState(state)
    schedule()
  }
  function local(event: Event) { changed((event as CustomEvent<SessionState>).detail) }
  function remote(event: StorageEvent) {
    if (event.key === signalKey) changed(stored<{ state: SessionState }>(signalKey)?.state)
    if (event.key === storageKey) schedule()
  }
  function visible() { if (document.visibilityState === 'visible') void check() }
  window.addEventListener(signalKey, local)
  window.addEventListener('storage', remote)
  window.addEventListener('online', check)
  document.addEventListener('visibilitychange', visible)
  schedule()
  return () => {
    stopped = true
    clearTimeout(timer)
    window.removeEventListener(signalKey, local)
    window.removeEventListener('storage', remote)
    window.removeEventListener('online', check)
    document.removeEventListener('visibilitychange', visible)
  }
}

export async function handleIdentityCallback() {
  const handle = async () => {
    const identity = await import('@netlify/identity')
    const result = await identity.handleAuthCallback()
    if (result?.user) {
      store(retryKey, null)
      publish('active')
    }
    return result
  }
  return navigator.locks ? navigator.locks.request(lockName, handle) : handle()
}

export async function signInIdentity(email: string, password: string, expectedSubject?: string) {
  const login = async () => {
    const identity = await import('@netlify/identity')
    const user = await identity.login(email, password)
    if (expectedSubject && user.id !== expectedSubject) {
      clear('signed-out')
      throw new Error('Sign in with the same account to reopen these edits.')
    }
    store(retryKey, null)
    publish('active')
    return user
  }
  return navigator.locks ? navigator.locks.request(lockName, login) : login()
}

export async function signOutIdentity(reason: 'user_logout' | 'password_reset' = 'user_logout') {
  const logout = async () => {
    const access = cookie('nf_jwt')
    let status: number | null = null
    try {
      if (access) status = (await fetch('/.netlify/identity/logout', {
        method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${access}` },
        signal: AbortSignal.timeout(5_000),
      })).status
    } catch {
      sessionDiagnostic('provider_logout_unavailable', status)
    } finally {
      sessionDiagnostic(reason, status)
      clear('signed-out')
    }
  }
  return navigator.locks ? navigator.locks.request(lockName, logout) : logout()
}
