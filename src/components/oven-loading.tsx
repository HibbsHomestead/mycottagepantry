import { OpeningOven } from './opening-oven'

/** The existing oven illustration follows real pending work, never a delay. */
export function OvenLoading({
  error,
  retry,
  children,
}: {
  error?: string
  retry?: () => void
  children?: React.ReactNode
}) {
  return (
    <main className="public-auth oven-loading">
      {!error && <OpeningOven />}
      <h1>{error ? 'Oven unavailable' : 'Opening your oven…'}</h1>
      <p role={error ? 'alert' : 'status'}>
        {error || 'Loading your private business records.'}
      </p>
      {error && (
        <div className="oven-loading-actions">
          {retry && (
            <button type="button" className="public-button" onClick={retry}>
              Retry oven access
            </button>
          )}
          <a href="/login">Log in again</a>
          <a href="/recover">Account recovery</a>
          <a href="/help">Need help?</a>
        </div>
      )}
      {children}
    </main>
  )
}
