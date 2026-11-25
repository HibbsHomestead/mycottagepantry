import { useEffect, useMemo, useRef, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { LabelCanvas } from './label-canvas'
import { RollArtworkPreview } from './label-print-media'
import { recordLabelPrintTiming } from './label-print-workflow'
import {
  assortmentReview,
  assortmentReviewDigest,
  type AssortmentGroup,
  type AssortmentLine,
  type AssortmentPlan,
  type AssortmentTarget,
} from '@/lib/label-assortments'
import { browserPrint } from '@/lib/label-browser-print'
import { defaultSheet } from '@/lib/label-print-layout'
import { checkPrinterSize, type PrinterProfile } from '@/lib/label-printers'
import { productionRunLines } from '@/lib/production-run'
import type { Item, Workspace } from '@/lib/domain'

const blankLine = (): AssortmentLine => ({
  productId: '',
  count: 1,
  unit: 'item',
  wrapped: false,
  advisory: '',
  componentLabel: false,
})
const blankGroup = (): AssortmentGroup => ({
  name: '',
  count: 1,
  lines: [blankLine()],
})
const outer: AssortmentTarget = { group: 0, component: -1 }

export function LabelAssortmentWorkflow({
  workspace,
  profiles,
  canEdit,
  initialRunId,
  onWorkspace,
}: {
  workspace: Workspace
  profiles: PrinterProfile[]
  canEdit: boolean
  initialRunId?: string
  onWorkspace: (workspace: Workspace) => void
}) {
  const [plan, setPlan] = useState<AssortmentPlan>(() => ({
    name: '',
    templateId: '',
    mode: 'fixed',
    count: 1,
    labelsPerContainer: 1,
    groups: [blankGroup()],
    runId: initialRunId,
    extraText: '',
  }))
  const [target, setTarget] = useState<AssortmentTarget>(outer)
  const [reviewedKey, setReviewedKey] = useState('')
  const [approvedKey, setApprovedKey] = useState('')
  const [selectedJob, setSelectedJob] = useState<Item>()
  const [historical, setHistorical] = useState<Item>()
  const [profileId, setProfileId] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [cancel, setCancel] = useState<AbortController>()
  const working = useRef(false)
  const current = useRef(workspace)
  const cancellation = useRef<AbortController | undefined>(undefined)
  current.current = workspace
  const scope = workspace.settings[0]?.labelEditorScope
  useEffect(() => () => cancellation.current?.abort(), [scope])
  const stocks = (workspace.label_templates || []).filter(
    (stock) =>
      !stock.deletedAt && !stock.round && stock.format !== 'front-back',
  )
  const products = (workspace.products || []).filter(
    (product) => !product.archivedAt && product.workflow !== 'kit',
  )
  const presets: (AssortmentPlan & { id: string })[] =
    workspace.settings[0]?.labelAssortmentPresets || []
  const jobs = (workspace.label_print_jobs || [])
    .filter((job) => job.assortment)
    .slice()
    .reverse()
  const run = workspace.batches.find((batch) => batch.id === plan.runId)
  const printer = profiles.find(
    (profile) => profile.id === profileId && profile.method === 'browser',
  )
  const reviewState = useMemo(() => {
    try {
      return {
        review: assortmentReview(workspace, plan, target),
        issue: '',
      }
    } catch (cause) {
      return { issue: (cause as Error).message }
    }
  }, [workspace, plan, target])
  const review = reviewState.review
  let mediaIssue = ''
  if (review && printer) {
    try {
      checkPrinterSize(review.document, printer)
    } catch (cause) {
      mediaIssue = (cause as Error).message
    }
  }
  const approved =
    !!selectedJob &&
    !!review &&
    approvedKey === review.reviewKey &&
    !jobs.find((job) => job.id === selectedJob.id)?.supersededAt
  const productName = (id: string) => {
    const product = products.find((item) => item.id === id)
    return product
      ? [product.name, product.flavor || product.variant]
          .filter(Boolean)
          .join(' · ')
      : 'Product'
  }
  function patch(change: Partial<AssortmentPlan>) {
    setPlan((previous) => ({ ...previous, ...change }))
    setReviewedKey('')
    setApprovedKey('')
  }
  function patchGroup(index: number, change: Partial<AssortmentGroup>) {
    patch({
      groups: plan.groups.map((group, position) =>
        position === index ? { ...group, ...change } : group,
      ),
    })
  }
  function patchLine(
    index: number,
    position: number,
    change: Partial<AssortmentLine>,
  ) {
    patchGroup(index, {
      lines: plan.groups[index].lines.map((line, slot) =>
        slot === position ? { ...line, ...change } : line,
      ),
    })
  }
  function selectLine(id: string) {
    const line = productionRunLines(run).find(
      (candidate) => candidate.id === id,
    )
    const product = workspace.products.find(
      (candidate) => candidate.id === line?.productId,
    )
    const count = Number(
      line?.output === ''
        ? line.quantity
        : (line?.output ?? line?.quantity ?? 1),
    )
    const components = (
      run?.status === 'completed'
        ? line?.definition?.components
        : product?.kitComponents
    ) as Item[] | undefined
    const fixed = product?.workflow === 'kit' && components?.length
    patch({
      runLineId: id,
      count,
      name: product?.name || plan.name,
      packagingId: undefined,
      ...(fixed
        ? {
            mode: 'fixed',
            groups: [
              {
                name: '',
                count,
                lines: components.map((component) => ({
                  ...blankLine(),
                  productId: component.productId,
                  count: Number(component.quantity),
                  unit: 'package',
                  wrapped: true,
                })),
              },
            ],
          }
        : plan.mode === 'fixed'
          ? { groups: [{ ...plan.groups[0], count }] }
          : {}),
    })
    setTarget(outer)
  }
  async function action(op: string, job?: Item) {
    if (working.current || !canEdit || !scope) return
    const controller = new AbortController()
    working.current = true
    cancellation.current = controller
    setBusy(true)
    setError('')
    setStatus(
      op === 'prepare'
        ? 'Checking the approved contents and packing selection'
        : 'Saving label review',
    )
    if (op === 'prepare') setCancel(controller)
    try {
      const reviewHash =
        op === 'approve' && review
          ? await assortmentReviewDigest(review.reviewKey)
          : undefined
      const response = await fetch('/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'labelAssortment',
          data: {
            op,
            plan,
            target,
            jobId: job?.id,
            reviewHash,
            expectedScope: scope,
          },
        }),
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(25000),
        ]),
      })
      const result = await response.json()
      if (!response.ok)
        throw new Error(
          result.error || 'The label request failed. Try again.',
        )
      controller.signal.throwIfAborted()
      if (current.current.settings[0]?.labelEditorScope !== scope)
        throw new Error(
          'The oven changed. Reopen Labels and review the selection again.',
        )
      if (op === 'prepare') {
        const snapshot = result.job as Item
        const markup = renderToStaticMarkup(
          <LabelCanvas
            document={snapshot.documentSnapshot}
            data={snapshot.renderedDataSnapshot}
          />,
        )
        const svg = new DOMParser().parseFromString(markup, 'image/svg+xml')
          .documentElement as unknown as SVGSVGElement
        await browserPrint(
          svg,
          snapshot.documentSnapshot,
          [],
          [],
          snapshot.copies,
          defaultSheet,
          printer,
          undefined,
          {
            signal: controller.signal,
            timing: recordLabelPrintTiming,
            progress: (message) => {
              if (message.startsWith('Opening')) setCancel(undefined)
              setStatus(message)
            },
          },
        )
        setStatus(
          'Print dialog opened. Confirm physical printing separately; no stock was deducted.',
        )
        return
      }
      const latest = current.current
      const next = { ...latest }
      if (result.presets)
        next.settings = latest.settings.map((settings, index) =>
          index === 0
            ? { ...settings, labelAssortmentPresets: result.presets }
            : settings,
        )
      if (result.job) {
        const updated = new Map<string, Item>(
          [...(result.replaced || []), result.job].map((item: Item) => [
            item.id,
            item,
          ]),
        )
        next.label_print_jobs = (latest.label_print_jobs || [])
          .map((item) => {
            const replacement = updated.get(item.id)
            updated.delete(item.id)
            return replacement || item
          })
          .concat([...updated.values()])
      }
      onWorkspace(next)
      if (op === 'approve' && review) {
        setSelectedJob(result.job)
        setApprovedKey(review.reviewKey)
      }
      setStatus(
        op === 'approve'
          ? 'Approved snapshot saved.'
          : op === 'savePreset'
            ? 'Fixed assortment preset saved.'
            : op === 'printed'
              ? 'Physical printing recorded.'
              : 'Application and verification recorded.',
      )
    } catch (cause) {
      setStatus(
        controller.signal.aborted
          ? 'Print preparation canceled. The approved snapshot is unchanged.'
          : '',
      )
      if (!controller.signal.aborted) setError((cause as Error).message)
    } finally {
      setCancel(undefined)
      setBusy(false)
      working.current = false
      cancellation.current = undefined
    }
  }
  return (
    <section
      className="studio-print-controls studio-assortments"
      aria-label="Assortment labels"
    >
      <h2>Assortment labels</h2>
      <p>
        Record what is actually packed. Each combination gets its own label
        with separate product ingredient and allergen statements. This does
        not replace inner-product labeling or verify compliance.
      </p>
      <fieldset disabled={busy} className="stack">
        {presets.length > 0 && (
          <label>
            Load a fixed preset{' '}
            <select
              value=""
              onChange={(event) => {
                const preset = presets.find(
                  (item) => item.id === event.target.value,
                )
                if (preset) {
                  patch({
                    ...preset,
                    runId: plan.runId,
                    runLineId: plan.runLineId,
                  })
                  setTarget(outer)
                }
              }}
            >
              <option value="">Choose a preset</option>
              {presets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Saved packing run (optional){' '}
          <select
            value={plan.runId || ''}
            onChange={(event) =>
              patch({
                runId: event.target.value || undefined,
                runLineId: undefined,
                packagingId: undefined,
              })
            }
          >
            <option value="">Standalone assortment</option>
            {workspace.batches
              .filter(
                (batch) =>
                  productionRunLines(batch).length &&
                  !['cancelled', 'canceled'].includes(batch.status),
              )
              .map((batch) => (
                <option key={batch.id} value={batch.id}>
                  {batch.name || batch.number || batch.date}
                </option>
              ))}
          </select>
        </label>
        {run && (
          <label>
            Packing run line{' '}
            <select
              value={plan.runLineId || ''}
              onChange={(event) => selectLine(event.target.value)}
            >
              <option value="">Choose a run line</option>
              {productionRunLines(run).map((line) => (
                <option key={line.id} value={line.id}>
                  {line.name ||
                    workspace.products.find(
                      (product) => product.id === line.productId,
                    )?.name ||
                    line.id}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Outer container or assortment name{' '}
          <input
            maxLength={100}
            value={plan.name}
            onChange={(event) => patch({ name: event.target.value })}
          />
        </label>
        <label>
          Outer packaging (optional reference){' '}
          <select
            value={plan.packagingId || ''}
            onChange={(event) =>
              patch({ packagingId: event.target.value || undefined })
            }
          >
            <option value="">No packaging reference</option>
            {workspace.ingredients
              .filter(
                (item) => item.usedAs === 'packaging' && !item.archivedAt,
              )
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Label stock{' '}
          <select
            value={plan.templateId}
            onChange={(event) => patch({ templateId: event.target.value })}
          >
            <option value="">Choose rectangular single-label stock</option>
            {stocks.map((stock) => (
              <option key={stock.id} value={stock.id}>
                {stock.name} · {stock.width / 72} × {stock.height / 72} in
              </option>
            ))}
          </select>
        </label>
        <label>
          Assortment type{' '}
          <select
            value={plan.mode}
            onChange={(event) => {
              const mode = event.target.value as AssortmentPlan['mode']
              patch({
                mode,
                groups:
                  mode === 'variable'
                    ? [blankGroup()]
                    : [{ ...blankGroup(), count: plan.count }],
              })
              setTarget(outer)
            }}
          >
            <option value="fixed">Fixed contents</option>
            <option value="variable">
              Variable · enter actual combinations
            </option>
          </select>
        </label>
        <div className="button-row">
          <label>
            Intended outer containers{' '}
            <input
              type="number"
              min="1"
              max="200"
              value={plan.count}
              onChange={(event) => {
                const count = Number(event.target.value)
                patch({
                  count,
                  ...(plan.mode === 'fixed'
                    ? { groups: [{ ...plan.groups[0], count }] }
                    : {}),
                })
              }}
            />
          </label>
          <label>
            Outer labels per container{' '}
            <input
              type="number"
              min="0"
              max="4"
              value={plan.labelsPerContainer}
              onChange={(event) =>
                patch({ labelsPerContainer: Number(event.target.value) })
              }
            />
          </label>
        </div>
        {plan.groups.map((group, index) => (
          <fieldset className="stack" key={index}>
            <legend>Combination {index + 1}</legend>
            {plan.mode === 'variable' && (
              <div className="button-row">
                <label>
                  Combination name{' '}
                  <input
                    maxLength={100}
                    value={group.name}
                    onChange={(event) =>
                      patchGroup(index, { name: event.target.value })
                    }
                  />
                </label>
                <label>
                  Containers with this combination{' '}
                  <input
                    type="number"
                    min="1"
                    max="200"
                    value={group.count}
                    onChange={(event) =>
                      patchGroup(index, {
                        count: Number(event.target.value),
                      })
                    }
                  />
                </label>
                <button
                  type="button"
                  className="btn secondary"
                  disabled={plan.groups.length === 1}
                  onClick={() => {
                    patch({
                      groups: plan.groups.filter(
                        (_, position) => index !== position,
                      ),
                    })
                    setTarget(outer)
                  }}
                >
                  Remove combination
                </button>
              </div>
            )}
            {group.lines.map((line, position) => (
              <fieldset className="stack" key={position}>
                <legend>Content {position + 1}</legend>
                <div className="button-row">
                  <label>
                    Product or flavor{' '}
                    <select
                      value={line.productId}
                      onChange={(event) =>
                        patchLine(index, position, {
                          productId: event.target.value,
                          advisory: '',
                        })
                      }
                    >
                      <option value="">Choose a product</option>
                      {products.map((product) => (
                        <option key={product.id} value={product.id}>
                          {productName(product.id)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Quantity per container{' '}
                    <input
                      type="number"
                      min="1"
                      max="200"
                      value={line.count}
                      onChange={(event) =>
                        patchLine(index, position, {
                          count: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                  <label>
                    Quantity unit{' '}
                    <select
                      value={line.unit}
                      onChange={(event) =>
                        patchLine(index, position, {
                          unit: event.target
                            .value as AssortmentLine['unit'],
                        })
                      }
                    >
                      <option value="item">Individual item</option>
                      <option value="package">Selling package</option>
                    </select>
                  </label>
                </div>
                <label>
                  <input
                    type="checkbox"
                    checked={line.wrapped}
                    onChange={(event) =>
                      patchLine(index, position, {
                        wrapped: event.target.checked,
                        componentLabel: false,
                      })
                    }
                  />{' '}
                  Individually packaged inside the outer container
                </label>
                {line.wrapped && (
                  <label>
                    <input
                      type="checkbox"
                      checked={line.componentLabel}
                      onChange={(event) =>
                        patchLine(index, position, {
                          componentLabel: event.target.checked,
                        })
                      }
                    />{' '}
                    Offer one component label per selected item or package
                  </label>
                )}
                <label>
                  Reviewed cross-contact advisory (optional){' '}
                  <input
                    maxLength={400}
                    value={line.advisory}
                    onChange={(event) =>
                      patchLine(index, position, {
                        advisory: event.target.value,
                      })
                    }
                  />
                </label>
                {group.lines.length > 1 && (
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={() => {
                      patchGroup(index, {
                        lines: group.lines.filter(
                          (_, slot) => slot !== position,
                        ),
                      })
                      setTarget(outer)
                    }}
                  >
                    Remove content
                  </button>
                )}
              </fieldset>
            ))}
            <button
              type="button"
              className="btn secondary"
              disabled={group.lines.length >= 20}
              onClick={() =>
                patchGroup(index, { lines: [...group.lines, blankLine()] })
              }
            >
              Add product or flavor
            </button>
          </fieldset>
        ))}
        {plan.mode === 'variable' && (
          <button
            type="button"
            className="btn secondary"
            disabled={plan.groups.length >= 12}
            onClick={() =>
              patch({ groups: [...plan.groups, blankGroup()] })
            }
          >
            Add actual combination
          </button>
        )}
        <label>
          Additional reviewed label text (optional){' '}
          <textarea
            maxLength={300}
            value={plan.extraText}
            onChange={(event) => patch({ extraText: event.target.value })}
          />
        </label>
        {plan.mode === 'fixed' && (
          <button
            type="button"
            className="btn secondary"
            disabled={!canEdit}
            onClick={() => void action('savePreset')}
          >
            Save as a fixed preset
          </button>
        )}
        <label>
          Label to review{' '}
          <select
            value={`${target.group}:${target.component}`}
            onChange={(event) => {
              const [group, component] = event.target.value
                .split(':')
                .map(Number)
              setTarget({ group, component })
              setReviewedKey('')
              setApprovedKey('')
            }}
          >
            {plan.groups.flatMap((group, index) => [
              <option
                key={`${index}:-1`}
                value={`${index}:-1`}
                disabled={!plan.labelsPerContainer}
              >
                {group.name || `Combination ${index + 1}`} · Outer
              </option>,
              ...group.lines.flatMap((line, position) =>
                line.componentLabel
                  ? [
                      <option
                        key={`${index}:${position}`}
                        value={`${index}:${position}`}
                      >
                        {group.name || `Combination ${index + 1}`} ·{' '}
                        {productName(line.productId)} component
                      </option>,
                    ]
                  : [],
              ),
            ])}
          </select>
        </label>
        <label>
          Browser print profile{' '}
          <select
            value={profileId}
            onChange={(event) => setProfileId(event.target.value)}
          >
            <option value="">Match design size · 0°</option>
            {profiles
              .filter((profile) => profile.method === 'browser')
              .map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
          </select>
        </label>
      </fieldset>
      {reviewState.issue && (
        <p className="warning-text">{reviewState.issue}</p>
      )}
      {review && (
        <section className="stack" aria-label="Review assortment label">
          <h3>Review {review.document.name}</h3>
          <p>
            {review.copies} label(s) · {review.document.width / 72} ×{' '}
            {review.document.height / 72} in design. Preview shown in CSS
            inches; verify physical size on your printer.
          </p>
          {review.warnings.map((warning) => (
            <p key={warning} className="warning-text">
              {warning}
            </p>
          ))}
          <div
            className="studio-assortment-paper"
            tabIndex={0}
            aria-label="Scrollable actual-size preview"
          >
            <div style={{ width: `${review.document.width / 72}in` }}>
              <LabelCanvas document={review.document} data={review.data} />
            </div>
          </div>
          {printer && !mediaIssue && (
            <RollArtworkPreview design={review.document} profile={printer}>
              <LabelCanvas
                document={{
                  ...review.document,
                  id: `${review.document.id}-roll`,
                }}
                data={review.data}
              />
            </RollArtworkPreview>
          )}
          {mediaIssue && <p className="warning-text">{mediaIssue}</p>}
          <p className="table-note">
            Select matching physical paper, actual size / 100%, one driver
            copy, and disable headers and footers. The browser and printer
            driver can override these settings.
          </p>
          <label>
            <input
              type="checkbox"
              disabled={busy || !!review.warnings.length}
              checked={reviewedKey === review.reviewKey}
              onChange={(event) =>
                setReviewedKey(event.target.checked ? review.reviewKey : '')
              }
            />{' '}
            I verified that the displayed ingredient, allergen and packaging
            information matches what was actually packed. If the current
            recipes differ from the actual contents, do not approve.
          </label>
          <div className="button-row">
            <button
              type="button"
              className="btn"
              disabled={
                busy ||
                !canEdit ||
                !!review.warnings.length ||
                reviewedKey !== review.reviewKey
              }
              onClick={() => void action('approve')}
            >
              Approve snapshot
            </button>
            <button
              type="button"
              className="btn secondary"
              disabled={busy || !canEdit || !approved || !!mediaIssue}
              onClick={() => void action('prepare', selectedJob)}
            >
              Print approved labels
            </button>
            {cancel && (
              <button
                type="button"
                className="btn secondary"
                onClick={() => cancel.abort()}
              >
                Cancel preparation
              </button>
            )}
          </div>
        </section>
      )}
      {status && <p role="status">{status}</p>}
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      <h3>Approved packing labels</h3>
      {jobs.length === 0 && (
        <p className="table-note">No assortment labels approved yet.</p>
      )}
      {jobs.map((job) => (
        <div key={job.id} className="stack">
          <p>
            {job.name} · {job.copies} copies ·{' '}
            {job.supersededAt ? 'Superseded · ' : ''}
            {job.appliedAt
              ? 'Applied and verified'
              : job.printedAt
                ? 'Printed, not applied'
                : 'Approved, printing not confirmed'}
          </p>
          <div className="button-row">
            <button
              type="button"
              className="btn secondary"
              onClick={() =>
                setHistorical(historical?.id === job.id ? undefined : job)
              }
            >
              {historical?.id === job.id
                ? 'Hide saved snapshot'
                : 'View saved snapshot'}
            </button>
            {!job.supersededAt && (
              <button
                type="button"
                className="btn secondary"
                disabled={busy}
                onClick={() => {
                  patch(job.assortment.plan)
                  setTarget(job.assortment.target)
                }}
              >
                Load selection for re-review
              </button>
            )}
            {!job.printedAt && (
              <button
                type="button"
                className="btn secondary"
                disabled={busy || !canEdit}
                onClick={() => void action('printed', job)}
              >
                Confirm physically printed
              </button>
            )}
            {job.printedAt && !job.appliedAt && (
              <button
                type="button"
                className="btn secondary"
                disabled={busy || !canEdit}
                onClick={() => void action('applied', job)}
              >
                Confirm applied and verified
              </button>
            )}
          </div>
          {historical?.id === job.id && (
            <div
              className="studio-assortment-paper"
              tabIndex={0}
              aria-label="Scrollable approved snapshot"
            >
              <div
                style={{ width: `${job.documentSnapshot.width / 72}in` }}
              >
                <LabelCanvas
                  document={{
                    ...job.documentSnapshot,
                    id: `${job.id}-snapshot`,
                  }}
                  data={job.renderedDataSnapshot}
                />
              </div>
            </div>
          )}
        </div>
      ))}
    </section>
  )
}
