import {
  labelSide,
  labelSides,
  labelSetPlan,
  type LabelSide,
} from '@/lib/label-sets'
import { LabelSetControls } from './label-set-controls'
import { withLibraryArtwork } from '@/lib/artwork-library'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { inlineLabelSvg } from '@/lib/label-client-export'
import {
  ArrowLeft,
  Minus,
  Pencil,
  Plus,
  Printer,
  StickyNote,
  TriangleAlert,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from './ui/dialog'
import { LabelCanvas } from './label-studio'
import {
  LabelPrintOptions,
  labelOutputBlocker,
  outputFailureStatus,
  printerSelection,
  runLabelOutput,
} from './label-print-workflow'
import { workspaceFonts, type LabelFont } from '@/lib/label-font-catalog'
import {
  checkLabel,
  resolveLabelData,
  type LabelData,
  type LabelDocument,
  type LabelSource,
} from '@/lib/label-studio'
import { defaultSheet, type SheetLayout } from '@/lib/label-print-layout'
import { mergeLabelWorkspace } from '@/lib/label-persistence'
import { labelRecordKind } from '@/lib/label-library'
import {
  assignableLabels,
  assignedLabel,
  missingLabelFields,
} from '@/lib/label-preview'
import type { Item, Workspace } from '@/lib/domain'
import './label-preview.css'

const inches = (pt: number) => (pt / 72).toFixed(2)
const millimetres = (pt: number) => Math.round((pt / 72) * 25.4)
const PX_PER_PT = 96 / 72

/**
 * Read-only preview of the label design assigned to a product, populated with
 * that product's data. Opening, zooming and closing never save anything.
 */
export function LabelPreviewDialog({
  open,
  onOpenChange,
  product,
  workspace: w,
  ready,
  role,
  onWorkspace,
  onEditLabel,
  onCreateLabel,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  product: Item
  workspace: Workspace
  ready: boolean
  role: string
  onWorkspace: (workspace: Workspace) => void
  onEditLabel: (labelId: string) => void
  onCreateLabel: () => void
}) {
  const [parts, setParts] = useState<'both' | LabelSide>('both')
  const [order, setOrder] = useState<'grouped' | 'paired'>('grouped')
  const [runIndex, setRunIndex] = useState(0)
  const [backUrl, setBackUrl] = useState('')
  const [view, setView] = useState<'preview' | 'choose'>('preview')
  const [zoom, setZoom] = useState(1)
  const [fit, setFit] = useState(1)
  const [copies, setCopies] = useState(1)
  const [layout, setLayout] = useState<SheetLayout>(defaultSheet)
  const [printingMethod, setPrintingMethod] = useState('')
  const [reviewed, setReviewed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [choice, setChoice] = useState('')
  const [rendered, setRendered] = useState({ key: '', url: '', error: '' })
  const stage = useRef<HTMLDivElement>(null)
  const latest = useRef(w)
  useEffect(() => {
    latest.current = w
  }, [w])
  const canEdit = ready && ['Owner', 'Manager'].includes(role)
  const assignment = assignedLabel(w, product)
  const savedDesign = assignment.status === 'ok' ? assignment.design : null
  // A structurally broken saved design is reported as a rendering error.
  const design = useMemo(() => {
    if (!savedDesign) return { doc: null, error: '' }
    const size = (v: unknown) => Number.isFinite(v) && Number(v) > 0
    if (
      !size(savedDesign.width) ||
      !size(savedDesign.height) ||
      !Array.isArray(savedDesign.elements)
    )
      return {
        doc: null,
        error: 'The saved design has no valid size or element list.',
      }
    return { doc: savedDesign, error: '' }
  }, [savedDesign])
  const doc: LabelDocument | null = design.doc
  const customFonts = useMemo(
    () => workspaceFonts(w.font_assets),
    [w.font_assets],
  )
  const brandId = w.brand_kits?.[0]?.id || ''
  const brand = (w.brand_kits || []).find((b) => b.id === brandId)
  const source: LabelSource = useMemo(
    () => ({ kind: 'product', id: product.id }),
    [product.id],
  )
  const data = useMemo(
    () => resolveLabelData(w, source, brand),
    [w, source, brand],
  )
  const assets = useMemo(
    () => withLibraryArtwork(w.graphic_assets),
    [w.graphic_assets],
  )
  const validation = useMemo(() => {
    try {
      return {
        issues: doc
          ? labelSides(doc).flatMap((side) =>
              checkLabel(
                labelSide(doc, side),
                data,
                assets,
                customFonts,
                labelSides(doc).flatMap((s) => labelSide(doc, s).elements),
              ).map((issue) =>
                doc.format === 'front-back'
                  ? `${side === 'front' ? 'Front' : 'Back'}: ${issue}`
                  : issue,
              ),
            )
          : [],
        missing: doc
          ? labelSides(doc).flatMap((side) =>
              missingLabelFields(labelSide(doc, side), data).map((field) =>
                doc.format === 'front-back' ? `${side}: ${field}` : field,
              ),
            )
          : [],
        error: '',
      }
    } catch (failure) {
      return {
        issues: [],
        missing: [],
        error:
          (failure as Error).message || 'The saved label design is incomplete.',
      }
    }
  }, [doc, data, assets, customFonts])
  const { issues, missing } = validation
  const { printerProfiles, selectedPrinter } = printerSelection(
    w,
    printingMethod,
  )
  const renderKey = JSON.stringify([doc, data, assets, customFonts])
  const rendering =
    rendered.key !== renderKey || (!rendered.url && !rendered.error)
  const renderError =
    validation.error || (rendered.key === renderKey ? rendered.error : '')
  let setBlock = ''
  let runDocument = doc
  let runCopies = copies
  if (doc?.format === 'front-back') {
    try {
      const plan = labelSetPlan(doc, copies, parts, order)
      const run = plan.runs[runIndex]
      if (!run) throw new Error('Choose a print run.')
      runDocument = run.document
      runCopies = run.sequence.length
    } catch (error) {
      setBlock = (error as Error).message
    }
  }
  const printBlocked =
    setBlock ||
    (renderError
      ? renderError
      : rendering
        ? 'Waiting for label fonts, images and rendering.'
        : !canEdit
          ? ready
            ? 'Only an Owner or Manager can print labels.'
            : 'Printing is available after your oven connects.'
          : doc
            ? labelOutputBlocker({
                type: 'print',
                doc: runDocument!,
                copies: runCopies,
                layout,
                selectedPrinter,
                issues,
                reviewed,
              })
            : null)

  useEffect(() => {
    const [document, snapshot, images, fonts] = JSON.parse(renderKey) as [
      LabelDocument | null,
      LabelData,
      Item[],
      LabelFont[],
    ]
    if (!open || !document || validation.error) return
    let cancelled = false
    let url = ''
    let back = ''
    const timeout = setTimeout(() => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
      setRendered({
        key: renderKey,
        url: '',
        error:
          'Label fonts or images did not finish loading. Close and reopen the preview to try again.',
      })
    }, 25000)
    async function prepare() {
      try {
        const markup = renderToStaticMarkup(
          <LabelCanvas
            document={labelSide(document!, 'front')}
            data={snapshot}
            assets={images}
          />,
        )
        const svg = new DOMParser().parseFromString(markup, 'image/svg+xml')
          .documentElement as unknown as SVGSVGElement
        const prepared = await inlineLabelSvg(svg, document!, images, fonts)
        url = URL.createObjectURL(
          new Blob([new XMLSerializer().serializeToString(prepared)], {
            type: 'image/svg+xml',
          }),
        )
        const image = new Image()
        image.src = url
        await image.decode()
        if (document!.format === 'front-back') {
          const backDocument = labelSide(document!, 'back')
          const backMarkup = renderToStaticMarkup(
            <LabelCanvas
              document={backDocument}
              data={snapshot}
              assets={images}
            />,
          )
          const backSvg = new DOMParser().parseFromString(
            backMarkup,
            'image/svg+xml',
          ).documentElement as unknown as SVGSVGElement
          const preparedBack = await inlineLabelSvg(
            backSvg,
            backDocument,
            images,
            fonts,
          )
          back = URL.createObjectURL(
            new Blob([new XMLSerializer().serializeToString(preparedBack)], {
              type: 'image/svg+xml',
            }),
          )
          const backImage = new Image()
          backImage.src = back
          await backImage.decode()
        }
        if (!cancelled) {
          setBackUrl(back)
          setRendered({ key: renderKey, url, error: '' })
        }
      } catch (failure) {
        if (!cancelled)
          setRendered({
            key: renderKey,
            url: '',
            error:
              (failure as Error).message || 'The label could not be rendered.',
          })
      } finally {
        clearTimeout(timeout)
        if (cancelled && url) URL.revokeObjectURL(url)
      }
    }
    void prepare()
    return () => {
      cancelled = true
      clearTimeout(timeout)
      if (url) URL.revokeObjectURL(url)
      if (back) URL.revokeObjectURL(back)
    }
    // The key includes the full design, populated data, image assets and fonts.
    // Print-job bookkeeping changes do not reload the preview.
  }, [open, renderKey, validation.error])

  function changeOpen(next: boolean) {
    if (busy) return
    if (!next) {
      setView('preview')
      setZoom(1)
      setStatus('')
      setError('')
      setReviewed(false)
    }
    onOpenChange(next)
  }

  useEffect(() => {
    const element = stage.current
    if (!element || !doc) return
    const measure = () => {
      const width = element.clientWidth - 48,
        height = element.clientHeight - 48
      if (width <= 0 || height <= 0) return
      setFit(
        Math.min(
          width / (doc.width * PX_PER_PT),
          height / (doc.height * PX_PER_PT),
          3,
        ),
      )
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [doc, view, open])

  async function request(action: string, payload: Record<string, unknown>) {
    const response = await fetch('/api/workspace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action,
        data: {
          ...payload,
          expectedScope: latest.current.settings[0]?.labelEditorScope,
        },
      }),
      signal: AbortSignal.timeout(25000),
    })
    const result = await response.json()
    if (!response.ok)
      throw new Error(result.error || 'The request failed. Try again.')
    if (!result.workspace)
      throw new Error('The server response is incomplete. Try again.')
    const merged = mergeLabelWorkspace(latest.current, result.workspace)
    latest.current = merged
    onWorkspace(merged)
    return merged
  }

  async function print() {
    if (!doc || busy) return
    setBusy(true)
    setError('')
    try {
      await runLabelOutput({
        type: 'print',
        doc,
        source,
        brandId,
        copies,
        layout,
        selectedPrinter,
        issues,
        reviewed,
        customFonts,
        parts,
        order,
        runIndex,
        preview: {
          sides:
            doc.format === 'front-back'
              ? Object.fromEntries(
                  labelSides(doc).map((side) => [
                    side,
                    renderToStaticMarkup(
                      <LabelCanvas
                        document={labelSide(doc, side)}
                        data={data}
                        assets={assets}
                      />,
                    ),
                  ]),
                )
              : undefined,
          markup: renderToStaticMarkup(
            <LabelCanvas document={doc} data={data} assets={assets} />,
          ),
        },
        request,
        render: (document, snapshot, jobAssets) =>
          renderToStaticMarkup(
            <LabelCanvas
              document={document}
              data={snapshot}
              assets={jobAssets}
            />,
          ),
        setStatus,
        onWorkspace,
      })
    } catch (e) {
      setError((e as Error).message)
      setStatus(outputFailureStatus('print'))
    } finally {
      setBusy(false)
    }
  }

  async function assign() {
    if (!choice || busy) return
    setBusy(true)
    setError('')
    try {
      await request('productLabelAssignment', {
        productId: product.id,
        labelId: choice,
      })
      setView('preview')
      setStatus('Label assigned to this product.')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const scale = fit * zoom
  const designs = assignableLabels(w)
    .filter(
      (d) =>
        labelRecordKind(d) === 'template' || d.id === product.labelDesignId,
    )
    .sort((a, b) => a.name.localeCompare(b.name))
  const labelCanvas = doc && (
    <div
      className="label-preview-paper"
      style={{
        width: doc.width * PX_PER_PT * scale,
        height: doc.height * PX_PER_PT * scale,
        borderRadius: doc.round ? '50%' : undefined,
      }}
    >
      <img src={rendered.url} alt={`Populated label for ${product.name}`} />
    </div>
  )

  let body: ReactNode
  if (!ready && !w.label_templates?.length) {
    body = (
      <div className="label-preview-state" role="status">
        <StickyNote size={22} />
        <h3>Loading label designs…</h3>
        <p>The preview appears once your oven’s saved labels have loaded.</p>
      </div>
    )
  } else if (view === 'choose') {
    body = (
      <div className="label-preview-choose">
        <fieldset>
          <legend>Choose a saved label for {product.name}</legend>
          {designs.length ? (
            designs.map((d) => (
              <label key={d.id} className="label-preview-option">
                <input
                  type="radio"
                  name="label-preview-choice"
                  value={d.id}
                  checked={choice === d.id}
                  onChange={() => setChoice(d.id)}
                />
                <span>
                  <strong>{d.name}</strong>
                  <small>
                    {labelRecordKind(d) === 'template' ? 'Template' : 'Label'} ·{' '}
                    {inches(d.width)} × {inches(d.height)} in
                  </small>
                </span>
              </label>
            ))
          ) : (
            <p className="muted">
              No saved labels yet. Create one in Label Studio.
            </p>
          )}
        </fieldset>
      </div>
    )
  } else if (assignment.status === 'none') {
    body = (
      <div className="label-preview-state">
        <StickyNote size={22} />
        <h3>Choose a label template</h3>
        <p>Choose a reusable template for {product.name} in Label Studio.</p>
      </div>
    )
  } else if (assignment.status === 'missing') {
    body = (
      <div className="label-preview-state" role="alert">
        <TriangleAlert size={22} />
        <h3>Assigned label design is unavailable</h3>
        <p>
          The design assigned to {product.name} was deleted or is no longer in
          this oven. No other design was substituted.
        </p>
      </div>
    )
  } else if (design.error || !doc) {
    body = (
      <div className="label-preview-state" role="alert">
        <TriangleAlert size={22} />
        <h3>This label could not be rendered</h3>
        <p>{design.error || 'The saved design is incomplete.'}</p>
        <p>The saved design is unchanged. Use Edit Label to correct it.</p>
      </div>
    )
  } else {
    body = (
      <div className="label-preview-layout is-print">
        <div className="label-preview-canvas-column">
          <div className="label-preview-toolbar">
            <span className="eyebrow">
              {doc.name} · {inches(doc.width)} × {inches(doc.height)} in (
              {millimetres(doc.width)} × {millimetres(doc.height)} mm)
            </span>
            <div className="label-preview-zoom" role="group" aria-label="Zoom">
              <button
                className="icon-button"
                aria-label="Zoom out"
                onClick={() => setZoom((z) => Math.max(0.25, z / 1.25))}
              >
                <Minus size={16} />
              </button>
              <button
                className="text-button"
                onClick={() => setZoom(1)}
                aria-label="Fit label to preview"
              >
                Fit · {Math.round(scale * 100)}%
              </button>
              <button
                className="icon-button"
                aria-label="Zoom in"
                onClick={() => setZoom((z) => Math.min(8, z * 1.25))}
              >
                <Plus size={16} />
              </button>
            </div>
          </div>
          <div
            className="label-preview-stage"
            ref={stage}
            aria-label={`Label preview for ${product.name}`}
          >
            {renderError ? (
              <div className="label-preview-state" role="alert">
                <h3>This label could not be rendered</h3>
                <p>{renderError}</p>
                <p>Use Edit Label to correct the saved design.</p>
              </div>
            ) : rendering ? (
              <p role="status">Loading label fonts and images…</p>
            ) : doc.format === 'front-back' ? (
              <div className="label-set-preview">
                {labelSides(doc).map((side) => {
                  const d = labelSide(doc, side)
                  return (
                    <figure key={side}>
                      <figcaption>
                        {side === 'front' ? 'Front' : 'Back'} ·{' '}
                        {inches(d.width)} × {inches(d.height)} in
                      </figcaption>
                      <img
                        style={{
                          width: '100%',
                          aspectRatio: `${d.width}/${d.height}`,
                        }}
                        src={side === 'front' ? rendered.url : backUrl}
                        alt={`${side} label for ${product.name}`}
                      />
                    </figure>
                  )
                })}
              </div>
            ) : (
              labelCanvas
            )}
          </div>
          <p className="table-note">
            Zoom changes only this view. Printing uses the saved physical size.
          </p>
        </div>
        <div className="label-preview-side">
          {missing.length > 0 && (
            <div className="label-preview-missing" role="alert">
              <strong>Missing field values</strong>
              <p>
                These fields are empty for {product.name}, so this is not a
                finished label:
              </p>
              <ul>
                {missing.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>
          )}
          {issues.length > 0 && (
            <div className="label-preview-issues">
              <strong>Label Check · {issues.length} to review</strong>
              <ul>
                {issues.map((i) => (
                  <li key={i}>
                    <TriangleAlert size={14} />
                    <span>{i}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {doc && (
            <section className="label-preview-print" aria-label="Print setup">
              <h3>Print setup</h3>
              <LabelSetControls
                document={doc}
                products={copies}
                parts={parts}
                setParts={(v) => {
                  setParts(v)
                  setRunIndex(0)
                }}
                order={order}
                setOrder={setOrder}
                runIndex={runIndex}
                setRunIndex={setRunIndex}
              />
              <LabelPrintOptions
                doc={doc}
                printerProfiles={printerProfiles}
                selectedPrinter={selectedPrinter}
                printingMethod={printingMethod}
                setPrintingMethod={setPrintingMethod}
                connected={false}
                copies={copies}
                setCopies={setCopies}
                layout={layout}
                setLayout={setLayout}
              />
              {issues.length > 0 && (
                <label className="studio-review">
                  <input
                    type="checkbox"
                    checked={reviewed}
                    onChange={(e) => setReviewed(e.target.checked)}
                  />
                  I reviewed these warnings and the final label.
                </label>
              )}
              <p className="studio-small-note">
                Match your printer paper size and use actual size / 100%
                scaling. Set driver copies to 1: the document already contains
                the requested labels.
              </p>
            </section>
          )}
          {printBlocked && (
            <p className="warning-text" role="status">
              Printing blocked: {printBlocked}
            </p>
          )}
        </div>
      </div>
    )
  }

  const designReady = !!doc && !design.error && view !== 'choose'
  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="app-dialog wide-dialog label-preview-dialog">
        <header>
          <div className="eyebrow">LABEL PREVIEW · READ-ONLY</div>
          <DialogTitle>Preview Label · {product.name}</DialogTitle>
          <DialogDescription>
            Shows the assigned design with this product’s saved data. Previewing
            and printing never change the product or design.
          </DialogDescription>
        </header>
        {body}
        {(status || error) && (
          <p className={error ? 'error-text' : 'table-note'} role="status">
            {error || status}
          </p>
        )}
        <footer className="button-row label-preview-actions">
          {view === 'choose' ? (
            <>
              <button
                className="btn secondary"
                disabled={busy}
                onClick={() => setView('preview')}
              >
                <ArrowLeft size={16} /> Back
              </button>
              <button className="btn secondary" onClick={onCreateLabel}>
                Template library
              </button>
              <button
                className="btn"
                disabled={!choice || busy || !canEdit}
                onClick={() => void assign()}
              >
                {busy ? 'Assigning…' : 'Use this label'}
              </button>
            </>
          ) : (
            <>
              <button
                className="btn secondary"
                disabled={busy}
                onClick={() => changeOpen(false)}
              >
                Close
              </button>
              {assignment.status !== 'ok' ? (
                <>
                  <button className="btn secondary" onClick={onCreateLabel}>
                    Template library
                  </button>
                  <button
                    className="btn"
                    disabled={!canEdit}
                    title={
                      canEdit
                        ? undefined
                        : 'An Owner or Manager in a connected oven can assign labels.'
                    }
                    onClick={() => {
                      setChoice('')
                      setView('choose')
                    }}
                  >
                    Choose Label
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="btn secondary"
                    disabled={busy}
                    onClick={() => onEditLabel(assignment.design.id)}
                  >
                    <Pencil size={16} /> Edit Label
                  </button>
                  {canEdit && (
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() => {
                        setChoice(assignment.design.id)
                        setView('choose')
                      }}
                    >
                      Change label
                    </button>
                  )}
                  <button
                    className="btn"
                    disabled={!designReady || busy || !!printBlocked}
                    onClick={() => void print()}
                  >
                    <Printer size={16} /> {busy ? 'Preparing…' : 'Print Label'}
                  </button>
                </>
              )}
            </>
          )}
        </footer>
      </DialogContent>
    </Dialog>
  )
}
