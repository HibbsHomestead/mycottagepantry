import { useState, type FormEvent } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { signInIdentity } from '@/lib/identity-session'

export function WorkspaceSessionGate({
  reason, subject, resume,
}: {
  reason: 'expired' | 'signed-out' | 'changed'
  subject: string
  resume: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const fields = new FormData(event.currentTarget)
    setBusy(true)
    setError('')
    try {
      await signInIdentity(String(fields.get('email')), String(fields.get('password')), subject)
      await resume()
    } catch {
      setError('The original account and oven could not be reopened. Check your details and connection, then retry.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open>
      <DialogContent className="workspace-session-gate" overlayClassName="workspace-session-overlay" showCloseButton={false} onEscapeKeyDown={(event) => event.preventDefault()} onInteractOutside={(event) => event.preventDefault()}>
        <DialogTitle>{reason === 'expired' ? 'Session expired' : reason === 'changed' ? 'Account changed' : 'You’re signed out'}</DialogTitle>
        <DialogDescription>
          Your edits are still in this tab. Sign in with the same account to continue without leaving this page.
        </DialogDescription>
        <form onSubmit={(event) => void submit(event)} className="form-stack">
          <label>Email <input type="email" name="email" autoComplete="username" required /></label>
          <label>Password <input type="password" name="password" autoComplete="current-password" required /></label>
          {error && <p role="alert">{error}</p>}
          <button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in and continue'}</button>
        </form>
        <a href="/login?signedOut=1" onClick={(event) => {
          if (!window.confirm('Leave this tab? Changes not saved or checkpointed may be lost.')) event.preventDefault()
        }}>Leave this page</a>
      </DialogContent>
    </Dialog>
  )
}
