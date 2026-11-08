import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { LookupActionContext, LookupError } from './lookup-error'
import {
  photoEvidenceSchema,
  photoLabels,
  photoSides,
  preparePackagePhoto,
  type PhotoEvidence,
} from '@/lib/package-photo'
import type { Item } from '@/lib/domain'
import { DraftFieldReview } from './draft-field-review'
import './catalog-lookup.css'
type Photo = { file: File; blob: Blob; url: string; turns: number }
export function PackagePhotoImport({
  draft,
  apply,
  packageSetup = false,
  processingReady = true,
}: {
  draft: Record<string, Item[string]>
  apply: (patch: Record<string, Item[string]>) => void
  packageSetup?: boolean
  processingReady?: boolean
}) {
  const lookupContext = useContext(LookupActionContext)
  const compact = lookupContext !== null
  const [failure, setFailure] = useState<{
    code?: string
    status?: number
  }>({})
  const [photos, setPhotos] = useState<Record<string, Photo>>({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [evidence, setEvidence] = useState<PhotoEvidence | null>(null),
    [usage, setUsage] = useState('')
  const current = useRef(photos)
  useLayoutEffect(() => {
    current.current = photos
  }, [photos])
  const pending = useRef(false),
    abort = useRef<AbortController | null>(null),
    generation = useRef(0)
  useEffect(
    () => () => {
      generation.current++
      abort.current?.abort()
      Object.values(current.current).forEach((p) => URL.revokeObjectURL(p.url))
    },
    [],
  )
  function cancel() {
    generation.current++
    abort.current?.abort()
    pending.current = false
    setBusy(false)
    setEvidence(null)
    setUsage('')
  }
  async function choose(id: string, file: File, turns = 0) {
    if (pending.current) return
    pending.current = true
    lookupContext?.start('photo')
    setFailure({})
    setBusy(true)
    setError('')
    const version = ++generation.current
    try {
      const blob = await preparePackagePhoto(file, turns)
      if (version !== generation.current) return
      const old = current.current[id]
      if (old) URL.revokeObjectURL(old.url)
      setPhotos((p) => ({
        ...p,
        [id]: { file, blob, url: URL.createObjectURL(blob), turns },
      }))
      setEvidence(null)
      setUsage('')
    } catch (e) {
      if (version === generation.current) setError((e as Error).message)
    } finally {
      if (version === generation.current) {
        pending.current = false
        setBusy(false)
      }
    }
  }
  function photoInput(id: (typeof photoSides)[number]) {
    return (
      <div key={id}>
        <label className="field">
          <span>{photoLabels[id]}</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) void choose(id, file)
            }}
          />
        </label>
        {photos[id] && (
          <>
            <small>Selected: {photos[id].file.name}</small>
            <img src={photos[id].url} alt={photoLabels[id] + ' preview'} />
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() =>
                void choose(id, photos[id].file, (photos[id].turns + 1) % 4)
              }
            >
              Rotate {photoLabels[id]}
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => {
                cancel()
                URL.revokeObjectURL(photos[id].url)
                setPhotos((p) =>
                  Object.fromEntries(
                    Object.entries(p).filter(([key]) => key !== id),
                  ),
                )
              }}
            >
              Remove {photoLabels[id]}
            </button>
          </>
        )}
      </div>
    )
  }
  return (
    <details className="package-photo-import">
      <summary>
        {compact ? 'Read package photos' : 'Read package photos (optional)'}
      </summary>
      {!processingReady && (
        <p className="form-hint" role="status">
          Your private pilot is configured. Paid processing is disabled pending
          provider token-bound verification.
        </p>
      )}
      <div className="package-photo-grid">
        {photoSides.slice(0, 2).map(photoInput)}
      </div>
      <details>
        <summary>Additional close-ups (up to 2)</summary>
        <div className="package-photo-grid">
          {photoSides.slice(2).map(photoInput)}
        </div>
      </details>
      <p className="form-hint">
        Either side alone works. JPEG, PNG or WebP; up to four prepared photos,
        4 MiB total. Existing product images stay unchanged.
      </p>
      <details>
        <summary>Photo privacy and estimated cost</summary>
        <p className="form-hint">
          Images are sent once to OpenAI through Netlify AI Gateway for reading
          and are not saved by Cottage Pantry. Remove or close this form to
          release local previews. OpenAI may retain inputs for abuse monitoring
          for up to 30 days; Remove does not delete provider copies. Each
          request reserves at most $0.05 against your private pilot limit.
          Actual estimated usage is recorded; there are no automatic retries.
          Nutrition is not imported.
        </p>
      </details>
      <div className="button-row">
        <button
          type="button"
          className="btn secondary"
          disabled={!processingReady || busy || !Object.keys(photos).length}
          onClick={async () => {
            if (pending.current) return
            pending.current = true
            lookupContext?.start('photo')
            setFailure({})
            setBusy(true)
            setError('')
            setEvidence(null)
            const version = ++generation.current
            const controller = new AbortController()
            abort.current = controller
            try {
              const form = new FormData()
              for (const [id, p] of Object.entries(photos))
                form.append(id, p.blob, id + '.jpg')
              const res = await fetch('/api/workspace?packagePhotos=1', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Idempotency-Key': crypto.randomUUID() },
                body: form,
                signal: controller.signal,
              })
              const data = await res.json().catch(() => null)
              if (!res.ok) {
                setFailure({ code: data?.code, status: res.status })
                throw new Error(
                  data?.error ||
                    `Photo reading failed (HTTP ${res.status}). Retry; your draft is preserved.`,
                )
              }
              const result = photoEvidenceSchema.parse({
                fields: data.fields,
                warnings: data.warnings,
              })
              if (version === generation.current) {
                setEvidence(result)
                setUsage(
                  data.usage
                    ? `${data.usage.inputTokens} input and ${data.usage.outputTokens} output tokens used.`
                    : '',
                )
              }
            } catch (e) {
              if (!controller.signal.aborted && version === generation.current)
                setError(
                  e instanceof Error
                    ? e.message
                    : 'Reading failed. Retry or enter details manually.',
                )
            } finally {
              if (version === generation.current) {
                pending.current = false
                setBusy(false)
              }
            }
          }}
        >
          Extract from photos
        </button>
        {busy && (
          <button type="button" className="text-button" onClick={cancel}>
            Cancel reading
          </button>
        )}
      </div>
      {busy && <p role="status">Reading selected package photos…</p>}
      {error &&
        (compact ? (
          lookupContext.active === 'photo' && (
            <LookupError
              message="Package photo reading failed."
              code={failure.code}
              status={failure.status}
            />
          )
        ) : (
          <p role="alert">{error}</p>
        ))}
      {usage && <p className="form-hint">{usage}</p>}
      {evidence && (
        <>
          {evidence.warnings.map((w, i) => (
            <p className="form-hint" key={i}>
              {w}
            </p>
          ))}
          <DraftFieldReview
            key={JSON.stringify(evidence)}
            draft={draft}
            packageSetup={packageSetup}
            candidates={evidence.fields.map((f) => ({
              field: f.field,
              value: f.value,
              uncertain: f.uncertain,
              photoId: f.photoId,
              evidence: `${photoLabels[f.photoId]}: “${f.quote}”`,
            }))}
            source="Package photo reading — check visible text and any uncertain alternatives"
            apply={apply}
            onApplied={() => setEvidence(null)}
          />
        </>
      )}
    </details>
  )
}
