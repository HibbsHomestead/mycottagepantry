import { useEffect, useRef, useState } from 'react'
import { RecipeCategorySelect } from './recipe-categories'
import { recipeCategories } from '@/lib/recipe-categories'
import { X, Plus, Upload, FileText, Link, ArrowLeft } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from './ui/dialog'
import { ReceiptDocumentPreview } from './receipt-document-preview'
import { ConversionEditor } from './financial-editors'
import {
  ContentDestination,
  RecipeContentReview,
} from './recipe-content-review'
import { RecipeRepairPreview, type RecipeRepair } from './recipe-repair-preview'
import {
  recipeDraftSchema,
  parseIngredient,
  parseQuantity,
  lineIssues,
  recipeApprovalBlockers,
  measurement,
  duplicateRecipes,
  moveRecipeContent,
  type RecipeDraft,
  type ImportLine,
} from '@/lib/recipe-import'
import {
  convert,
  money,
  units,
  unitLabel,
  type Workspace,
  type Item,
} from '@/lib/domain'
import './recipe-import.css'
type Record = {
  sourceHash?: string
  createdAt?: string
  summary?: boolean
  id: string
  draft: RecipeDraft
  status: string
  error?: string
  updatedAt: string
  sourceText: string
  sourceUrl?: string
  mime: string
  filename?: string
  method: string
  recipeId?: string
}
export function RecipeImport({
  workspace,
  canEdit,
  close,
  onWorkspace,
  openRecipe,
  onConversion,
}: {
  workspace: Workspace
  canEdit: boolean
  close: () => void
  onWorkspace: (w: Workspace) => void
  openRecipe: (r: Item) => void
  onConversion: (data: any) => Promise<void>
}) {
  const [records, setRecords] = useState<Record[]>([]),
    [active, setActive] = useState<Record | null>(null),
    [draft, setDraft] = useState<RecipeDraft>(recipeDraftSchema.parse({})),
    [mode, setMode] = useState<'text' | 'url' | 'file' | 'cookbook'>('text'),
    [text, setText] = useState(''),
    [url, setUrl] = useState(''),
    [file, setFile] = useState<File | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [fieldErrors, setFieldErrors] = useState<
      { path: string; message: string }[]
    >([]),
    [recovery, setRecovery] = useState(''),
    [notice, setNotice] = useState(''),
    [dirty, setDirty] = useState(false),
    [discard, setDiscard] = useState(false),
    [duplicateDecision, setDuplicateDecision] = useState(''),
    [target, setTarget] = useState(''),
    [zoom, setZoom] = useState(1),
    [repair, setRepair] = useState<RecipeRepair | null>(null),
    [repairConfirmed, setRepairConfirmed] = useState(false)
  const returnFocus = useRef<HTMLElement | null>(
    typeof document !== 'undefined'
      ? (document.activeElement as HTMLElement)
      : null,
  )
  const pending = useRef(false),
    editRevision = useRef(0),
    bodyRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let live = true
    fetch('/api/workspace?recipeImports=1')
      .then(async (r) => {
        const data = await r.json()
        if (!r.ok)
          throw new Error(data.error || 'Could not load import drafts.')
        if (!Array.isArray(data.imports))
          throw new Error(
            'The import queue response could not be read. Reopen the importer to retry.',
          )
        if (live) setRecords(data.imports)
      })
      .catch((e) => {
        if (live) setError(e.message)
      })
    return () => {
      live = false
    }
  }, [])
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0
  }, [active?.id])
  useEffect(() => {
    const preserveWork = (event: BeforeUnloadEvent) => {
      if (dirty || busy || (!active && (text.trim() || url.trim() || file))) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    // Includes navigation prompted by session recovery; no browser storage or
    // authentication changes are needed to warn before discarding open work.
    window.addEventListener('beforeunload', preserveWork)
    return () => window.removeEventListener('beforeunload', preserveWork)
  }, [dirty, busy, active, text, url, file])
  function select(record: Record) {
    if (!record || typeof record.id !== 'string') {
      setError(
        'The saved import response could not be read. Your current edits remain here; retry opening the draft.',
      )
      return
    }
    if (record.summary) {
      setBusy(true)
      fetch(
        '/api/workspace?recipeImports=1&id=' + encodeURIComponent(record.id),
      )
        .then(async (r) => {
          const data = await r.json()
          if (!r.ok) throw new Error(data.error || 'Could not reopen import.')
          select(data.import)
        })
        .catch((e) => setError(e.message))
        .finally(() => setBusy(false))
      return
    }

    const checked = recipeDraftSchema.safeParse({
      ...record.draft,
      sourceUrl: record.draft?.sourceUrl || record.sourceUrl || '',
    })
    if (!checked.success) {
      setError(
        'The saved import contains invalid review fields and could not be opened. The saved record is unchanged. Retry or use its original source for manual review.',
      )
      return
    }
    setActive(record)
    setDraft(checked.data)
    setRepair(null)
    setRepairConfirmed(false)
    setDirty(false)
    setError('')
    setFieldErrors([])
    setRecovery('')
    setNotice('')
    setDuplicateDecision('')
    setTarget('')
  }
  function edit(patch: Partial<RecipeDraft>) {
    editRevision.current += 1
    setDraft((d) => ({ ...d, ...patch }))
    setDirty(true)
    setRepair(null)
    setRepairConfirmed(false)
  }
  function line(index: number, patch: Partial<ImportLine>) {
    edit({
      lines: draft.lines.map((l, n) => (n === index ? { ...l, ...patch } : l)),
    })
  }
  async function send(operation: string) {
    if (pending.current) return
    pending.current = true
    const sentRevision = editRevision.current
    setBusy(true)
    setError('')
    setFieldErrors([])
    setRecovery('')
    setNotice('')
    try {
      if (['save', 'approve'].includes(operation)) {
        const checked = recipeDraftSchema.safeParse(draft)
        if (!checked.success) {
          setFieldErrors(
            checked.error.issues.map((issue) => ({
              path: issue.path.join('.'),
              message: issue.message,
            })),
          )
          throw new Error(
            'Correct the indicated fields before saving. No request was sent; your edits remain open.',
          )
        }
      }
      let body: FormData | string, headers: HeadersInit | undefined
      if (
        operation === 'create' &&
        (mode === 'file' || (mode === 'cookbook' && file))
      ) {
        if (!file) throw new Error('Choose a PDF, JPG, PNG or text file.')
        body = new FormData()
        body.set('file', file)
        if (mode === 'cookbook') body.set('provider', 'cookbook')
      } else {
        headers = { 'Content-Type': 'application/json' }
        body = JSON.stringify(
          operation === 'create'
            ? { operation, kind: mode, text, url }
            : {
                operation,
                id: active?.id,
                draft,
                expectedUpdatedAt: active?.updatedAt,
                duplicateDecision,
                targetRecipeId: target,
                confirmReplaceEdits:
                  operation === 'reprocess' && repairConfirmed,
              },
        )
      }
      const r = await fetch('/api/workspace?recipeImports=1', {
        method: 'POST',
        headers,
        body,
      }).catch(() => {
        throw new Error(
          'The save request could not complete. Your edits remain here. Check your connection and retry this same draft.',
        )
      })
      const data = await r.json().catch(() => {
        throw new Error(
          `The oven returned an unreadable response (HTTP ${r.status}). Your edits remain here; retry the same draft.`,
        )
      })
      if (!r.ok) {
        if (Array.isArray(data.fields)) setFieldErrors(data.fields)
        if (
          r.status === 401 ||
          ['SIGN_IN_REQUIRED', 'SESSION_EXPIRED'].includes(data.code)
        )
          setRecovery('/login')
        if (data.code === 'WORKSPACE_SELECTION_REQUIRED') setRecovery('/oven')
        const fields = Array.isArray(data.fields)
          ? data.fields.map((f: any) => `${f.path}: ${f.message}`).join(' ')
          : ''
        throw new Error(
          `${data.error || 'Recipe import failed.'} ${fields} (HTTP ${r.status}${data.stage ? '; ' + data.stage : ''}${data.traceId ? '; reference ' + data.traceId : ''}). Your edits remain here.`,
        )
      }
      if (operation === 'previewReprocess') {
        setRepair(data.repair)
        setRepairConfirmed(false)
        setNotice(
          'Repair preview only. Your draft and original source are unchanged.',
        )
        return
      }
      if (operation === 'create') {
        const newRecords = data.imports as Record[]
        if (
          !Array.isArray(newRecords) ||
          !newRecords.length ||
          newRecords.some(
            (record) =>
              !record?.id || !recipeDraftSchema.safeParse(record.draft).success,
          )
        )
          throw new Error(
            'The extraction response did not confirm a readable import draft. Your source remains here; reopen the importer to check saved drafts before starting another import.',
          )
        setRecords((old) => [...newRecords, ...old])
        if (newRecords.length === 1) select(newRecords[0])
        else {
          setActive(null)
          setNotice(
            `${newRecords.length} recipes found. Choose recipes in the queue to review individually; cancel any you want to skip. Nothing is approved automatically.`,
          )
        }
        setText('')
        setUrl('')
        setFile(null)
      } else {
        const record = data.import as Record
        if (
          !record ||
          record.id !== active?.id ||
          !recipeDraftSchema.safeParse(record.draft).success
        )
          throw new Error(
            'The save response did not confirm this draft. Your edits remain here. Retry the same draft; no new import is needed.',
          )
        setRecords((old) => old.map((d) => (d.id === record.id ? record : d)))
        setActive(record)
        const hasNewEdits = editRevision.current !== sentRevision
        if (!hasNewEdits) setDraft(recipeDraftSchema.parse(record.draft))
        setRepair(null)
        setRepairConfirmed(false)
        setDirty(hasNewEdits)
        setNotice(
          operation === 'approve'
            ? 'Recipe created. Stock and financial records stayed unchanged.'
            : operation === 'cancel'
              ? 'Import cancelled. No recipe was created.'
              : operation === 'reprocess'
                ? 'Import draft reprocessed. Review the repaired content before approval. No recipe was created.'
                : hasNewEdits
                  ? 'Import draft saved. Newer edits remain open and still need saving.'
                  : 'Import draft saved. No recipe was created.',
        )
        if (operation === 'approve') {
          try {
            const refreshed = await fetch('/api/workspace')
            const result = await refreshed.json()
            if (
              !refreshed.ok ||
              !Array.isArray(result.workspace?.recipes) ||
              !result.workspace.recipes.some(
                (r: Item) => r.id === record.recipeId,
              )
            )
              throw new Error()
            onWorkspace(result.workspace)
          } catch {
            setNotice(
              'Recipe creation is saved. The recipe list could not refresh. Reopen Recipes after reconnecting; retrying approval does not create another recipe.',
            )
          }
        }
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
      pending.current = false
    }
  }
  function requestClose() {
    if (dirty || (!active && (text.trim() || url.trim() || file)))
      setDiscard(true)
    else close()
  }
  const duplicates = active
      ? duplicateRecipes(
          draft,
          active.sourceUrl || '',
          workspace.recipes,
          active.sourceHash,
        )
      : [],
    issues = draft.lines.map((l, index) => [
      ...lineIssues(l, workspace.ingredients),
      ...fieldErrors
        .filter((f) => f.path.startsWith(`lines.${index}.`))
        .map((f) => `${f.path.split('.').at(-1)}: ${f.message}`),
    ]),
    incomplete = issues.filter((i) => i.length).length
  const approved = active?.status === 'approved',
    cancelled = active?.status === 'cancelled'
  const blockers = recipeApprovalBlockers(
    draft,
    active?.sourceText || '',
    workspace.ingredients,
  )
  if (duplicates.length && !duplicateDecision)
    blockers.push({
      target: 'import-duplicates',
      message: 'Choose how to handle the possible duplicate recipe.',
    })
  if (duplicateDecision === 'version' && !target)
    blockers.push({
      target: 'import-duplicates',
      message: 'Choose the existing recipe for this version.',
    })
  const canApprove = canEdit && !busy && !repair && !blockers.length
  const field = (
    label: string,
    key:
      'title' | 'description' | 'yieldUnit' | 'notes' | 'author' | 'sourceUrl',
  ) => (
    <label className="field">
      <span id={`import-label-${key}`}>{label}</span>
      <input
        aria-labelledby={`import-label-${key}`}
        id={key === 'title' ? 'import-title' : undefined}
        aria-invalid={fieldErrors.some((f) => f.path === key) || undefined}
        aria-describedby={
          fieldErrors.some((f) => f.path === key)
            ? `import-error-${key}`
            : undefined
        }
        value={draft[key]}
        onChange={(e) => edit({ [key]: e.target.value })}
      />
      {fieldErrors.some((f) => f.path === key) && (
        <small className="warning-text" id={`import-error-${key}`}>
          {fieldErrors
            .filter((f) => f.path === key)
            .map((f) => f.message)
            .join(' ')}
        </small>
      )}
    </label>
  )
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v) requestClose()
      }}
    >
      <DialogContent
        presentation="detail"
        className="recipe-import-modal"
        showCloseButton={false}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          const target = returnFocus.current?.isConnected
            ? returnFocus.current
            : document.querySelector<HTMLButtonElement>('.quick-add')
          target?.focus({ preventScroll: true })
        }}
        onEscapeKeyDown={(e) => {
          if (dirty) {
            e.preventDefault()
            setDiscard(true)
          }
        }}
      >
        <header>
          <div>
            <DialogTitle>Import recipe</DialogTitle>
            <DialogDescription>
              Import → review text → match Pantry ingredients → approve. Nothing
              posts to inventory or accounting.
            </DialogDescription>
          </div>
          <button
            className="icon-button"
            aria-label="Close recipe import"
            onClick={requestClose}
          >
            <X />
          </button>
        </header>
        <div className="recipe-import-body" ref={bodyRef} aria-busy={busy}>
          <fieldset disabled={busy} className="recipe-import-fields">
            {discard && (
              <div className="calculation-box" role="alert">
                <strong>Discard unsaved changes?</strong>
                <p>Saved import drafts and original files remain available.</p>
                <div className="button-row">
                  <button
                    className="btn secondary"
                    onClick={() => setDiscard(false)}
                  >
                    Keep reviewing
                  </button>
                  <button className="btn" onClick={close}>
                    Discard changes and close
                  </button>
                </div>
              </div>
            )}
            {!active ? (
              <>
                <div
                  className="recipe-import-methods"
                  role="group"
                  aria-label="Import method"
                >
                  {(
                    [
                      ['text', 'Paste recipe text', FileText],
                      ['cookbook', 'Import from CookBook', FileText],
                      ['file', 'Upload a recipe file', Upload],
                      ['url', 'Import from a recipe link', Link],
                    ] as const
                  ).map(([kind, label, Icon]) => (
                    <button
                      key={kind}
                      className="btn secondary"
                      aria-pressed={mode === kind}
                      onClick={() => {
                        setMode(kind)
                        setFile(null)
                      }}
                    >
                      <Icon size={18} />
                      {label}
                    </button>
                  ))}
                </div>
                {mode === 'cookbook' && (
                  <div className="calculation-box">
                    <strong>CookBook export-file import</strong>
                    <p>
                      Paste shared text or choose a shared-text .txt / ZIP
                      collection. No account connection or synchronization.
                      Native formats await a real export sample. Text, links and
                      manual review are available. Collections enter the review
                      queue; approve each recipe separately.
                    </p>
                    <input
                      aria-label="CookBook export file"
                      type="file"
                      accept=".txt,.zip"
                      onChange={(e) => setFile(e.target.files?.[0] || null)}
                    />
                  </div>
                )}
                {(mode === 'text' || mode === 'cookbook') && (
                  <label className="field">
                    <span>Recipe text</span>
                    <textarea
                      rows={12}
                      maxLength={60000}
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      placeholder={
                        'Recipe title\nYield: 12 cookies\nIngredients:\nDough:\n1 ½ cups flour\nInstructions:\n1. Mix ingredients.'
                      }
                    />
                  </label>
                )}
                {mode === 'url' && (
                  <label className="field">
                    <span>Public recipe/share URL</span>
                    <input
                      aria-label="Public recipe/share URL"
                      type="url"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder="https://…"
                    />
                    <small>
                      Accessible HTTPS pages only. Login, paywall or blocked
                      pages require a permitted upload or pasted text.
                    </small>
                  </label>
                )}
                {mode === 'file' && (
                  <label className="field">
                    <span>Recipe file</span>
                    <input
                      aria-label="Recipe file"
                      type="file"
                      accept="application/pdf,image/jpeg,image/png,text/plain,.txt"
                      onChange={(e) => setFile(e.target.files?.[0] || null)}
                    />
                    <small>
                      PDF, JPG, PNG or UTF-8 plain text · up to 4 MB. Cookbook
                      native formats require an inspected sample; CookBook
                      shared text has its own import option.
                    </small>
                  </label>
                )}
                <p className="muted">
                  No cookbook account connections are currently available.
                  Import a share link or a permitted PDF/text export. Passwords
                  are never requested.
                </p>
                <button
                  className="btn"
                  disabled={busy || !canEdit}
                  onClick={() => void send('create')}
                >
                  {busy ? 'Extracting import draft…' : 'Extract for review'}
                </button>
                <section>
                  <h3>Import review queue</h3>
                  {records.filter(
                    (r) => !['approved', 'cancelled'].includes(r.status),
                  ).length === 0 ? (
                    <p>No pending imports.</p>
                  ) : (
                    records
                      .filter(
                        (r) => !['approved', 'cancelled'].includes(r.status),
                      )
                      .map((r) => (
                        <button
                          className="import-queue-row"
                          key={r.id}
                          onClick={() => select(r)}
                        >
                          <span>
                            {r.draft.title || r.filename || 'Untitled recipe'}
                            {duplicateRecipes(
                              r.draft,
                              r.sourceUrl || '',
                              workspace.recipes,
                              r.sourceHash,
                            ).length > 0 && (
                              <small>
                                Possible duplicate — review before approving
                              </small>
                            )}
                            <small>
                              {r.method} · {r.status.replaceAll('_', ' ')}
                            </small>
                          </span>
                          <span>Review →</span>
                        </button>
                      ))
                  )}
                </section>
              </>
            ) : (
              <>
                <button
                  className="text-button"
                  onClick={() => {
                    if (dirty) {
                      setError(
                        'Save this import draft before returning to the queue.',
                      )
                      return
                    }
                    setActive(null)
                    setNotice('')
                  }}
                >
                  <ArrowLeft size={16} /> Back to import queue
                </button>
                {active.error && <p className="warning-text">{active.error}</p>}
                {approved || cancelled ? (
                  <div className="calculation-box">
                    <strong>
                      {approved ? 'Approved recipe' : 'Cancelled import'}
                    </strong>
                    {approved && (
                      <button
                        className="btn secondary"
                        onClick={() => {
                          const r = workspace.recipes.find(
                            (r) => r.id === active.recipeId,
                          )
                          if (r) openRecipe(r)
                        }}
                      >
                        Open created recipe
                      </button>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="button-row">
                      <button
                        className="btn secondary"
                        disabled={
                          busy ||
                          !canEdit ||
                          !active.sourceText ||
                          ![
                            'text/plain',
                            'application/zip',
                            'text/html',
                          ].includes(active.mime)
                        }
                        onClick={() => void send('previewReprocess')}
                      >
                        Preview reprocess from original
                      </button>
                      <p>
                        Preview extraction from preserved text without changing
                        this draft or using paid extraction.
                      </p>
                    </div>
                    {repair && (
                      <RecipeRepairPreview
                        before={draft}
                        repair={repair}
                        confirmed={repairConfirmed}
                        confirm={setRepairConfirmed}
                        apply={() => void send('reprocess')}
                        cancel={() => {
                          setRepair(null)
                          setRepairConfirmed(false)
                        }}
                        busy={busy}
                      />
                    )}
                    <div className="recipe-import-comparison">
                      <section>
                        <h3>Original source</h3>
                        <p className="muted">
                          {active.method}
                          {active.createdAt
                            ? ' · Imported ' +
                              new Date(active.createdAt).toLocaleString()
                            : ''}
                          {draft.sourceApp ? ' · ' + draft.sourceApp : ''}
                          {active.filename ? ` · ${active.filename}` : ''}
                        </p>
                        {active.sourceUrl && (
                          <a
                            href={active.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Open recipe source
                          </a>
                        )}
                        {[
                          'application/pdf',
                          'image/jpeg',
                          'image/png',
                        ].includes(active.mime) ? (
                          <>
                            <label className="field">
                              <span>Preview zoom</span>
                              <select
                                value={zoom}
                                onChange={(e) =>
                                  setZoom(Number(e.target.value))
                                }
                              >
                                <option value={0.75}>75%</option>
                                <option value={1}>100%</option>
                                <option value={1.5}>150%</option>
                              </select>
                            </label>
                            <ReceiptDocumentPreview
                              id={active.id}
                              fileEndpoint={
                                '/api/workspace?recipeImportFile=' +
                                encodeURIComponent(active.id)
                              }
                              documentLabel="recipe"
                              zoom={zoom}
                              rotation={0}
                            />
                          </>
                        ) : (
                          <pre className="recipe-source-text">
                            {active.sourceText ||
                              'No readable text available. Review the original download and enter details manually.'}
                          </pre>
                        )}
                        <a
                          href={
                            '/api/workspace?recipeImportFile=' +
                            encodeURIComponent(active.id) +
                            '&download=1'
                          }
                          download
                        >
                          Download original source
                        </a>
                      </section>
                      <section>
                        <h3>Recipe details</h3>
                        {field('Recipe title', 'title')}
                        {draft.importedCategory && (
                          <p className="form-hint">
                            Imported category: {draft.importedCategory}. Review
                            and choose a category, or keep this recipe
                            uncategorized for later review.
                          </p>
                        )}
                        <RecipeCategorySelect
                          recipe={{
                            id: 'import-preview',
                            name: draft.title,
                            recipeCategoryId: draft.recipeCategoryId,
                          }}
                          categories={recipeCategories(workspace)}
                          disabled={busy || !canEdit}
                          onChange={(category) =>
                            edit({ recipeCategoryId: category?.id || '' })
                          }
                        />
                        {field('Description', 'description')}
                        {field('Source URL', 'sourceUrl')}
                        {field('Author', 'author')}
                        <div
                          className="form-grid"
                          id="import-yield"
                          tabIndex={-1}
                        >
                          {(
                            [
                              'yieldQuantity',
                              'prepMinutes',
                              'cookMinutes',
                            ] as const
                          ).map((key) => (
                            <label className="field" key={key}>
                              <span>
                                {
                                  {
                                    yieldQuantity: 'Yield quantity',
                                    prepMinutes: 'Prep time (minutes)',
                                    cookMinutes: 'Cook time (minutes)',
                                  }[key]
                                }
                              </span>
                              <input
                                type="number"
                                min="0"
                                step="any"
                                value={draft[key] ?? ''}
                                onChange={(e) =>
                                  edit({
                                    [key]:
                                      e.target.value === ''
                                        ? null
                                        : Number(e.target.value),
                                  })
                                }
                              />
                            </label>
                          ))}
                          {field('Yield unit', 'yieldUnit')}
                        </div>
                        <p className="muted">
                          Missing yield stays blank. Prep and cook time do not
                          become paid active labor.
                        </p>
                        <label className="field">
                          <span>Notes</span>
                          <textarea
                            rows={3}
                            value={draft.notes}
                            onChange={(e) => edit({ notes: e.target.value })}
                          />
                        </label>
                      </section>
                    </div>
                    <section>
                      <h3 id="import-ingredients" tabIndex={-1}>
                        Match and review ingredients
                      </h3>
                      <p>
                        {incomplete
                          ? `Cost incomplete — ${incomplete} ingredient${incomplete === 1 ? '' : 's'} need setup.`
                          : 'All ingredient lines have matching and costing information.'}
                      </p>
                      <p className="muted">
                        Suggestions require confirmation. Original order is
                        preserved for cooking; label ordering and allergens
                        still require verified Pantry measurements and reviewed
                        ingredient declarations.
                      </p>
                      <div className="recipe-import-lines">
                        {draft.lines.map((l, n) => (
                          <IngredientReview
                            key={n}
                            value={l}
                            index={n}
                            ingredients={workspace.ingredients}
                            issues={issues[n]}
                            change={(patch) => line(n, patch)}
                            split={() => {
                              const parts = l.original
                                .split(/\n|;/)
                                .map((s) => s.trim())
                                .filter(Boolean)
                              if (parts.length < 2) {
                                line(n, { original: l.original + '\n' })
                                setNotice(
                                  'Separate ingredient lines with a newline or semicolon, then select Split line.',
                                )
                                return
                              }
                              edit({
                                lines: draft.lines.flatMap((v, i) =>
                                  i === n
                                    ? parts.map((s) =>
                                        parseIngredient(s, l.group),
                                      )
                                    : [v],
                                ),
                              })
                            }}
                            remove={() =>
                              edit({
                                lines: draft.lines.filter((_, i) => i !== n),
                              })
                            }
                            classify={(to) =>
                              edit(
                                moveRecipeContent(draft, 'ingredient', n, to),
                              )
                            }
                            onConversion={onConversion}
                          />
                        ))}
                      </div>
                      <button
                        className="btn secondary"
                        onClick={() =>
                          edit({ lines: [...draft.lines, parseIngredient('')] })
                        }
                      >
                        <Plus size={16} /> Add ingredient line
                      </button>
                    </section>
                    <div id="import-content" tabIndex={-1}>
                      <RecipeContentReview
                        draft={draft}
                        sourceText={active.sourceText || ''}
                        edit={edit}
                      />
                    </div>
                    {duplicates.length > 0 && (
                      <section
                        className="calculation-box"
                        id="import-duplicates"
                        tabIndex={-1}
                      >
                        <h3>Possible duplicate recipes</h3>
                        <p>
                          Review the existing recipe before proceeding. A
                          reviewed version creates a new recipe and preserves
                          the original, linked products and historical batches.
                        </p>
                        {duplicates.map((r) => (
                          <div key={r.id}>
                            <strong>{r.name}</strong>
                            <button
                              className="text-button"
                              onClick={() => {
                                if (dirty) {
                                  setError(
                                    'Save this import draft before opening the existing recipe.',
                                  )
                                  return
                                }
                                openRecipe(r)
                              }}
                            >
                              Open existing recipe
                            </button>
                            <details>
                              <summary>Review changes to {r.name}</summary>
                              <p>
                                Existing yield: {r.yield} {r.yieldUnit} →
                                Imported yield:{' '}
                                {draft.yieldQuantity ?? 'Not set'}{' '}
                                {draft.yieldUnit}
                              </p>
                              <p>Existing instructions</p>
                              <pre className="recipe-source-text">
                                {r.instructions || 'Not set'}
                              </pre>
                              <p>Existing ingredient lines</p>
                              {(r.lines || []).map((l: any, n: number) => (
                                <p key={n}>
                                  {l.quantity} {l.unit}{' '}
                                  {
                                    workspace.ingredients.find(
                                      (i) => i.id === l.ingredientId,
                                    )?.name
                                  }
                                </p>
                              ))}
                            </details>
                          </div>
                        ))}
                        <label className="field">
                          <span>Duplicate decision</span>
                          <select
                            aria-label="Duplicate decision"
                            value={duplicateDecision}
                            onChange={(e) =>
                              setDuplicateDecision(e.target.value)
                            }
                          >
                            <option value="">Choose after review</option>
                            <option value="copy">Import as a copy</option>
                            <option value="version">
                              Create a reviewed version of existing recipe
                            </option>
                          </select>
                        </label>
                        {duplicateDecision === 'version' && (
                          <label className="field">
                            <span>Existing recipe to version</span>
                            <select
                              aria-label="Existing recipe to version"
                              value={target}
                              onChange={(e) => setTarget(e.target.value)}
                            >
                              <option value="">Choose recipe</option>
                              {duplicates.map((r) => (
                                <option key={r.id} value={r.id}>
                                  {r.name}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                      </section>
                    )}
                  </>
                )}
              </>
            )}
          </fieldset>
        </div>
        <footer>
          {(error || notice) && (
            <div className="recipe-import-feedback">
              {error && (
                <p role="alert" className="warning-text">
                  {error}
                </p>
              )}
              {notice && <p role="status">{notice}</p>}
              {recovery && (
                <a href={recovery} target="_blank" rel="noopener noreferrer">
                  {recovery === '/login'
                    ? 'Sign in again in a new tab'
                    : 'Choose oven in a new tab'}
                </a>
              )}
              {recovery && (
                <small>
                  Keep this editor open. After recovering access on this site,
                  retry the same draft.
                </small>
              )}
            </div>
          )}
          {active && !approved && !cancelled && (
            <div className="recipe-approval-status">
              {!canEdit && (
                <p role="status">
                  Saving requires a connected oven and an Owner or Manager role.
                  Your edits remain open.
                </p>
              )}
              {repair && (
                <p>Finish or dismiss the repair preview before approving.</p>
              )}
              {!!blockers.length && (
                <details>
                  <summary>
                    Approval blocked: {blockers.length} item
                    {blockers.length === 1 ? '' : 's'} to review. Draft saving
                    is available.
                  </summary>
                  <ul>
                    {blockers.map((b, i) => (
                      <li key={i}>
                        <a
                          href={'#' + b.target}
                          onClick={(e) => {
                            e.preventDefault()
                            document
                              .getElementById(b.target)
                              ?.scrollIntoView({ block: 'center' })
                            document
                              .getElementById(b.target)
                              ?.focus({ preventScroll: true })
                          }}
                        >
                          {b.message}
                        </a>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {!blockers.length && (
                <p>
                  Ready for approval.
                  {incomplete > 0
                    ? ' Costing remains incomplete until the listed Pantry details are resolved.'
                    : ''}
                </p>
              )}
              <small>
                Save import draft keeps unfinished review. Approval creates a
                recipe; it does not verify missing costs.
              </small>
            </div>
          )}
          {active && !approved && !cancelled ? (
            <>
              <button
                className="btn secondary"
                disabled={busy || !canEdit}
                onClick={() => {
                  if (
                    window.confirm(
                      'Cancel this import? No recipe will be created. The original remains in the audit record.',
                    )
                  )
                    void send('cancel')
                }}
              >
                Cancel import
              </button>
              <button
                className="btn secondary"
                disabled={busy || !canEdit}
                onClick={() => void send('save')}
              >
                Save import draft
              </button>
              <button
                className="btn"
                disabled={!canApprove}
                onClick={() => void send('approve')}
              >
                {busy ? 'Saving…' : 'Approve & create recipe'}
              </button>
            </>
          ) : (
            <button className="btn secondary" onClick={requestClose}>
              Close
            </button>
          )}
        </footer>
      </DialogContent>
    </Dialog>
  )
}

function IngredientReview({
  value: l,
  index: n,
  ingredients,
  issues,
  change,
  split,
  remove,
  classify,
  onConversion,
}: {
  value: ImportLine
  index: number
  ingredients: Item[]
  issues: string[]
  change: (patch: Partial<ImportLine>) => void
  split: () => void
  remove: () => void
  classify: (to: Parameters<typeof moveRecipeContent>[3]) => void
  onConversion: (data: any) => Promise<void>
}) {
  const [conversionOpen, setConversionOpen] = useState(false)
  const [saved, setSaved] = useState('')
  const ingredient =
    l.decision === 'match'
      ? ingredients.find((i) => i.id === l.ingredientId)
      : undefined
  const m = measurement(l)
  const missingConversion = issues.some((t) => t.includes('Conversion needed'))
  const existingConversion = ingredient?.conversions?.find(
    (c: any) =>
      c.verified &&
      ((units[c.from]?.category === units[m.unit]?.category &&
        units[c.to]?.category === units[ingredient.unit]?.category) ||
        (units[c.to]?.category === units[m.unit]?.category &&
          units[c.from]?.category === units[ingredient.unit]?.category)),
  )
  let cost: number | null = null
  if (!issues.length && ingredient) {
    try {
      cost =
        convert(m.quantity, m.unit, ingredient.unit, ingredient.conversions) *
        (ingredient.currentCost ?? ingredient.cost)
    } catch {
      /* The issue list provides the reason. */
    }
  }
  return (
    <article
      className="recipe-ingredient-card"
      id={`import-line-${n}`}
      tabIndex={-1}
      aria-label={`Ingredient ${n + 1}: ${l.name || 'Unresolved'}`}
    >
      <div className="recipe-ingredient-heading">
        <strong>
          {n + 1}. {l.original || 'New ingredient line'}
        </strong>
        {l.group && <small>{l.group}</small>}
      </div>
      <div className="recipe-ingredient-main">
        <div className="recipe-ingredient-amount">
          <label className="field">
            <span>Quantity</span>
            <QuantityInput
              ariaLabel={`Quantity ${n + 1}`}
              value={l.quantity}
              onCommit={(quantity) => change({ quantity })}
            />
          </label>
          <label className="field">
            <span>Unit</span>
            <select
              aria-label={`Unit ${n + 1}`}
              value={l.unit}
              onChange={(e) =>
                change({ unit: e.target.value, confirmed: false })
              }
            >
              <option value="">Not set</option>
              {!units[l.unit] && l.unit && <option>{l.unit}</option>}
              {Object.keys(units).map((u) => (
                <option key={u} value={u}>
                  {unitLabel(u)}
                </option>
              ))}
            </select>
          </label>
          {l.unit === 'cup' && (
            <label className="field recipe-cup-standard">
              <span>Cup standard</span>
              <select
                aria-label={`Cup standard ${n + 1}`}
                value={l.cupStandard}
                onChange={(e) =>
                  change({
                    cupStandard: e.target.value as ImportLine['cupStandard'],
                  })
                }
              >
                <option value="">Choose standard</option>
                <option value="us">US cup · 236.588 ml</option>
                <option value="metric">Metric cup · 250 ml</option>
              </select>
            </label>
          )}
        </div>
        <label className="field">
          <span>Parsed ingredient name</span>
          <input
            aria-label={`Ingredient name ${n + 1}`}
            value={l.name}
            onChange={(e) => change({ name: e.target.value, confirmed: false })}
          />
          {l.uncertainty && (
            <small className="warning-text">{l.uncertainty}</small>
          )}
        </label>
        <div>
          <label className="field">
            <span>Pantry ingredient</span>
            <select
              aria-label={`Pantry choice ${n + 1}`}
              value={l.decision === 'new' ? 'new' : l.ingredientId || ''}
              onChange={(e) => {
                setSaved('')
                setConversionOpen(false)
                change({
                  decision:
                    e.target.value === 'new'
                      ? 'new'
                      : e.target.value
                        ? 'match'
                        : 'unresolved',
                  ingredientId: e.target.value === 'new' ? '' : e.target.value,
                  confirmed: false,
                })
              }}
            >
              <option value="">Leave unresolved in draft</option>
              <option value="new">Create new ingredient on approval</option>
              {ingredients
                .filter((i) => !['packaging', 'supply'].includes(i.usedAs))
                .map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                    {i.brand ? ` · ${i.brand}` : ''}
                  </option>
                ))}
            </select>
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              aria-label={`Confirm Pantry choice ${n + 1}`}
              checked={l.confirmed}
              onChange={(e) => change({ confirmed: e.target.checked })}
            />
            {l.decision === 'new'
              ? 'Approve new Pantry ingredient'
              : 'Confirm this match'}
          </label>
        </div>
      </div>
      <div className="recipe-ingredient-cost">
        <div aria-live="polite">
          {issues.length ? (
            issues.map((t) => (
              <p key={t} className="warning-text">
                {t}
              </p>
            ))
          ) : (
            <p>
              <strong>Complete costing · {money(cost!)}</strong>
              {ingredient?.conversions?.length > 0 &&
              units[m.unit]?.category !== units[ingredient?.unit]?.category
                ? ' · Uses an existing verified conversion.'
                : ''}
            </p>
          )}
        </div>
        {ingredient && units[m.unit] && (
          <button
            type="button"
            className="text-button"
            aria-expanded={conversionOpen}
            aria-controls={`conversion-${n}`}
            onClick={() => setConversionOpen((v) => !v)}
          >
            {conversionOpen
              ? 'Close conversion setup'
              : missingConversion
                ? 'Set up conversion'
                : 'Edit conversion'}
          </button>
        )}
      </div>
      <details className="recipe-ingredient-details">
        <summary>Ingredient details and actions</summary>
        <div className="form-grid">
          <label className="field">
            <span>Original ingredient line</span>
            <textarea
              aria-label={`Original line ${n + 1}`}
              rows={2}
              value={l.original}
              onChange={(e) => change({ original: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Group</span>
            <input
              aria-label={`Group ${n + 1}`}
              value={l.group}
              onChange={(e) => change({ group: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Preparation</span>
            <input
              aria-label={`Preparation ${n + 1}`}
              value={l.preparation}
              onChange={(e) => change({ preparation: e.target.value })}
            />
          </label>
        </div>
        <div className="button-row">
          <ContentDestination
            label={`Classify line ${n + 1}`}
            value="ingredient"
            move={classify}
          />
          <button type="button" className="text-button" onClick={split}>
            Split line {n + 1}
          </button>
          <button type="button" className="text-button" onClick={remove}>
            Remove line {n + 1}
          </button>
        </div>
      </details>
      {ingredient && units[m.unit] && (
        <div id={`conversion-${n}`} hidden={!conversionOpen}>
          <ConversionEditor
            key={
              ingredient.id +
              m.unit +
              JSON.stringify(existingConversion || null)
            }
            expanded
            initialAmountTo=""
            initialConversion={
              missingConversion ? undefined : existingConversion
            }
            ingredient={ingredient}
            from={m.unit}
            onCancel={() => setConversionOpen(false)}
            onSave={async (data) => {
              await onConversion(data)
              setSaved(
                'Conversion saved. Costing uses the current Pantry measurements.',
              )
              setConversionOpen(false)
            }}
          />
        </div>
      )}
      {saved && <p role="status">{saved}</p>}
    </article>
  )
}

function QuantityInput({
  value,
  onCommit,
  ariaLabel,
}: {
  ariaLabel?: string
  value: number | null
  onCommit: (value: number | null) => void
}) {
  const [text, setText] = useState(value == null ? '' : String(value))
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) setText(value == null ? '' : String(value))
  }, [value])
  return (
    <input
      value={text}
      aria-label={ariaLabel}
      inputMode="decimal"
      placeholder="e.g. 1 1/2"
      onFocus={() => {
        focused.current = true
      }}
      onChange={(e) => {
        setText(e.target.value)
        onCommit(parseQuantity(e.target.value))
      }}
      onBlur={() => {
        focused.current = false
        onCommit(parseQuantity(text))
      }}
    />
  )
}
