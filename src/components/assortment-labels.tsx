import { useMemo, useState } from 'react'
import {
  assortmentJobCurrent,
  assortmentLabel,
  assortmentRunDefinition,
  assortmentSignature,
  fixedAssortmentContents,
  type AssortmentSpec,
  type PackedLine,
} from '@/lib/assortment-labels'
import {
  assortmentPrintFits,
  assortmentPrintHtml,
} from '@/lib/assortment-print'
import {
  knownCurrentIngredientCost,
  isMixedPack,
  money,
  type Item,
  type Workspace,
} from '@/lib/domain'
import { productionRunLines } from '@/lib/production-run'
import { supplierLabelSource } from '@/lib/supplier-label-source'
import { LabelMergeReview, LabelSourceAllergenReview, type ReviewMutation } from './label-ingredient-review'
import { printPlacement, printRotations, type PrintRotation } from '@/lib/label-printers'
import './assortment-labels.css'

const emptyLine: PackedLine = { productId: '', quantity: 1, unit: 'loose' }
type Context = { productId?: string; batchId?: string }

function initialSpec(workspace: Workspace, context?: Context): AssortmentSpec {
  const product = workspace.products.find(
    (item) => item.id === context?.productId,
  )
  const run = workspace.batches.find((item) => item.id === context?.batchId)
  const definition = assortmentRunDefinition(product, run)
  const completed = run?.status?.toLowerCase() === 'completed'
  const available = productionRunLines(run).filter((line) => line.productId === product?.id)
    .reduce((sum, line) => sum + (Number(completed ? line.actualYield : line.quantity) || 0), 0)
  const containers = Number.isInteger(available) ? Math.min(200, Math.max(1, available)) : 1
  return {
    name: definition?.name || product?.name || '',
    templateId: definition?.mixedLabelTemplateId || '',
    productId: context?.productId || '',
    batchId: context?.batchId || '',
    group: run && product?.workflow === 'kit' ? product.name.slice(0, 80) : '',
    packagingId: definition?.mixedLabelStockId || '',
    mode: product?.workflow === 'kit' && definition ? 'fixed' : 'variable',
    expectedLoose: 0,
    expectedPackages: 0,
    containers,
    copies: containers,
    componentId: '',
    lines: [{ ...emptyLine }],
    ...(definition?.workflow === 'kit' ? fixedAssortmentContents(definition) : {}),
  }
}

export function AssortmentLabels({
  workspace,
  context,
  canManage,
  save,
  onReviewAllergens,
  onOpenSource,
}: {
  workspace: Workspace
  context?: Context
  canManage: boolean
  save: (data: Record<string, unknown>) => Promise<unknown>
  onReviewAllergens?: ReviewMutation
  onOpenSource?: (kind: string, item?: Item) => void
}) {
  const [spec, setSpec] = useState(() => initialSpec(workspace, context))
  const [initialPreview, setPreview] = useState<ReturnType<typeof assortmentLabel>>()
  const [previewVersion, setPreviewVersion] = useState(0)
  const [fitResult, setFit] = useState<{ signature: string; fits: boolean }>()
  const [reviewedSignature, setReviewed] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [inspected, setInspected] = useState<string>()
  const [revises, setRevises] = useState<string>()
  const records = [...(workspace.label_print_jobs || [])].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  )
  const jobs = records.filter(
    (job) =>
      job.assortmentKind === 'approved' &&
      (!context?.batchId || job.batchId === context.batchId),
  )
  const fixed = records.filter((job) => job.assortmentKind === 'fixed')
  const products = workspace.products.filter(
    (product) => product.workflow !== 'kit' && !product.archived,
  )
  const stock = (workspace.label_templates || []).filter(
    (item) => !item.deletedAt && !item.round && item.format !== 'front-back',
  )
  const outer = workspace.products.find((item) => item.id === spec.productId)
  const material = workspace.ingredients.find(
    (item) => item.id === spec.packagingId,
  )
  const materialCost = material
    ? knownCurrentIngredientCost(material)
    : undefined
  const run = workspace.batches.find((item) => item.id === spec.batchId)
  const runProductIds = new Set(
    productionRunLines(run).map((line) => line.productId),
  )
  const selectedStock = stock.find((item) => item.id === spec.templateId)
  const media = selectedStock && printPlacement({ width: Number(selectedStock.width), height: Number(selectedStock.height) }, undefined, spec.rotation).media
  const freshPreview = useMemo(() => {
    if (!initialPreview) return undefined
    try {
      return assortmentLabel(workspace, spec)
    } catch {
      return undefined
    }
  }, [initialPreview, workspace, spec])
  const preview = freshPreview || initialPreview
  const signature = preview ? assortmentSignature(preview.snapshot) : ''
  const fit = fitResult?.signature === signature ? fitResult.fits : undefined
  const reviewed = Boolean(signature && signature === reviewedSignature)
  function change(patch: Partial<AssortmentSpec>) {
    setSpec((value) => ({ ...value, ...patch }))
    setPreview(undefined)
    setFit(undefined)
    setReviewed('')
    setNotice('')
  }
  function changeLine(index: number, patch: Partial<PackedLine>) {
    change({
      lines: spec.lines.map((line, position) =>
        position === index ? { ...line, ...patch } : line,
      ),
    })
  }
  async function submit(data: Record<string, unknown>, success: string) {
    setBusy(true)
    setNotice('')
    try {
      await save(data)
      setNotice(success)
      if (data.op === 'approve') setRevises(undefined)
    } catch (error) {
      setNotice((error as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function print(job: Item, copies: number) {
    const popup = window.open('', '_blank')
    if (!popup) {
      setNotice('Allow the print window to open, then try again.')
      return
    }
    popup.opener = null
    setBusy(true)
    setNotice('')
    try {
      await save({ op: 'check-print', jobId: job.id, copies })
      popup.document.open()
      popup.document.write(
        assortmentPrintHtml(
          job.assortmentSnapshot,
          copies,
          Boolean(job.assortmentSpec.componentId),
        ),
      )
      popup.document.close()
      if (!assortmentPrintFits(popup.document))
        throw new Error(
          'This content overflows the stock. Review a larger stock size before printing.',
        )
      popup.focus()
      popup.print()
      setNotice(
        'Print opened. Confirm the number actually printed after checking the output.',
      )
    } catch (error) {
      popup.close()
      setNotice((error as Error).message)
    } finally {
      setBusy(false)
    }
  }
  function field(
    label: string,
    key: 'expectedLoose' | 'expectedPackages' | 'containers' | 'copies',
    min = 0,
  ) {
    return (
      <label className="field">
        {label}
        <input
          type="number"
          min={min}
          max="200"
          value={spec[key]}
          onChange={(event) => {
            const value = event.target.valueAsNumber || 0
            change({ [key]: value, ...(key === 'containers' && !spec.componentId && spec.copies === spec.containers ? { copies: value } : {}) })
          }}
        />
      </label>
    )
  }
  return (
    <section className="panel assortment-labels" aria-label="Assortment labels">
      <h2>Assortment labels</h2>
      <p>
        Build a label for the products actually packed in each outer container.
        Selling packages and loose items are counted separately. Check the
        reviewed source against the actual packed lot or supplier label. This
        layout does not establish compliance or replace required inner labels.
      </p>
      {notice && <p role="status">{notice}</p>}
      <div className="assortment-grid">
        <label className="field">
          Assortment name
          <input
            value={spec.name}
            onChange={(event) => change({ name: event.target.value })}
          />
        </label>
        <label className="field">
          Saved fixed assortment
          <select
            value=""
            onChange={(event) => {
              const saved = fixed.find((item) => item.id === event.target.value)
              if (saved) {
                setRevises(undefined)
                change({
                  ...saved.assortmentSpec,
                  batchId: spec.batchId,
                  group: spec.group,
                  productId: spec.batchId
                    ? spec.productId
                    : saved.productId || '',
                })
              }
            }}
          >
            <option value="">Choose explicitly to load</option>
            {fixed.map((record) => (
              <option key={record.id} value={record.id}>
                {record.name} · {new Date(record.createdAt).toLocaleString()}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Run
          <select
            value={spec.batchId}
            onChange={(event) =>
              change({ batchId: event.target.value, group: '', productId: '' })
            }
          >
            <option value="">No production run</option>
            {workspace.batches
              .filter(
                (batch) =>
                  productionRunLines(batch).length > 0 &&
                  batch.status !== 'cancelled',
              )
              .map((batch) => (
                <option key={batch.id} value={batch.id}>
                  {batch.name}
                </option>
              ))}
          </select>
        </label>
        <label className="field">
          Outer container product
          <select
            value={spec.productId}
            onChange={(event) => {
              const productId = event.target.value
              const product = workspace.products.find((item) => item.id === productId)
              setRevises(undefined)
              if (product?.workflow === 'kit') {
                const selection = initialSpec(workspace, { productId, batchId: spec.batchId })
                change({ ...selection, templateId: selection.templateId || spec.templateId })
              } else change({ productId })
            }}
          >
            <option value="">No catalog product</option>
            {workspace.products
              .filter((item) => !item.archived && (!spec.batchId || runProductIds.has(item.id)))
              .map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
          </select>
        </label>
        {spec.batchId && (
          <label className="field">
            Packing group
            <input
              placeholder="e.g. Morning assortment A"
              value={spec.group}
              onChange={(event) => change({ group: event.target.value })}
            />
          </label>
        )}
        <label className="field">
          Contents type
          <select
            value={spec.mode}
            onChange={(event) => change({ mode: event.target.value === 'fixed' ? 'fixed' : 'variable' })}
          >
            <option value="variable" disabled={isMixedPack(outer) && !spec.batchId}>Actual production packing selection</option>
            <option value="fixed">Fixed assortment</option>
          </select>
        </label>
        <label className="field">
          Output rotation
          <select value={spec.rotation ?? 0} onChange={(event) => change({ rotation: Number(event.target.value) as PrintRotation })}>
            {printRotations.map((rotation) => <option key={rotation} value={rotation}>{rotation}°</option>)}
          </select>
          {media && <small>Physical media (across × feed): {Number((media.width / 72).toFixed(2))} × {Number((media.height / 72).toFixed(2))} in</small>}
        </label>
        <label className="field">
          Label stock size
          <select
            value={spec.templateId}
            onChange={(event) => change({ templateId: event.target.value })}
          >
            <option value="">Choose a saved rectangular stock size</option>
            {stock.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {(item.width / 72).toFixed(2)} ×{' '}
                {(item.height / 72).toFixed(2)} in
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Label material (Packaging)
          <select
            value={spec.packagingId}
            onChange={(event) => change({ packagingId: event.target.value })}
          >
            <option value="">Not linked</option>
            {workspace.ingredients
              .filter((item) => item.usedAs === 'packaging' && !item.archived)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
          </select>
        </label>
        {material && (
          <p className="table-note">
            Packaging cost:{' '}
            {materialCost === undefined
              ? 'Unavailable'
              : `${money(materialCost)} per ${material.unit}`}
            . Label jobs do not post stock usage.
          </p>
        )}
        {field('Intended loose items per container', 'expectedLoose')}
        {field(
          'Intended individually packaged units per container',
          'expectedPackages',
        )}
        {field('Outer containers in this packing group', 'containers', 1)}
        {field('Total label copies for this job', 'copies', 1)}
      </div>
      {outer?.workflow === 'kit' && spec.batchId && (
        <p className="form-hint">Fixed contents come from the saved production output, not the current catalog. If this group was packed differently, choose Actual production packing selection, enter that group’s contents, and review a new preview.</p>
      )}
      {outer?.workflow === 'kit' && spec.mode === 'fixed' && (
        <button
          type="button"
          className="btn secondary"
          onClick={() => {
            const definition = assortmentRunDefinition(outer, run)
            change(fixedAssortmentContents(definition))
          }}
        >
          {isMixedPack(outer) ? 'Reload saved mixed-pack contents' : 'Use configured basket contents as individually packaged units'}
        </button>
      )}
      <h3>Actual contents per outer container</h3>
      {spec.lines.map((line, index) => {
        const product = products.find((item) => item.id === line.productId)
        const supplier = supplierLabelSource(product)
        return (
          <fieldset key={index} className="assortment-line">
            <legend>Included product {index + 1}</legend>
            <div className="assortment-grid">
              <label className="field">
                Product / flavor
                <select
                  value={line.productId}
                  onChange={(event) =>
                    changeLine(index, {
                      ...emptyLine,
                      productId: event.target.value,
                      quantity: line.quantity,
                      unit: line.unit,
                      declaration: '',
                      contains: '',
                      advisory: '',
                      supplierReviewed: false,
                    })
                  }
                >
                  <option value="">Choose actual product</option>
                  {products.map((item) => (
                    <option key={item.id} value={item.id}>
                      {[item.name, item.flavor, item.variant]
                        .filter(Boolean)
                        .join(' · ')}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Quantity
                <input
                  type="number"
                  min="1"
                  max="200"
                  value={line.quantity}
                  onChange={(event) =>
                    changeLine(index, {
                      quantity: event.target.valueAsNumber || 0,
                    })
                  }
                />
              </label>
              <label className="field">
                Packed as
                <select
                  value={line.unit}
                  onChange={(event) =>
                    changeLine(index, {
                      unit:
                        event.target.value === 'package' ? 'package' : 'loose',
                    })
                  }
                >
                  <option value="loose">Loose individual items</option>
                  <option value="package">
                    Individually packaged selling units
                  </option>
                </select>
              </label>
              {product &&
                !product.recipeId &&
                !supplier &&
                product.workflow !== 'handmade' && (
                  <>
                    <label className="field">
                      Reviewed supplier ingredient statement
                      <textarea
                        value={line.declaration || ''}
                        onChange={(event) =>
                          changeLine(index, {
                            declaration: event.target.value,
                            supplierReviewed: false,
                          })
                        }
                      />
                    </label>
                    <label className="field">
                      Reviewed intentional allergens (optional text)
                      <input
                        value={line.contains || ''}
                        onChange={(event) =>
                          changeLine(index, {
                            contains: event.target.value,
                            supplierReviewed: false,
                          })
                        }
                      />
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={line.supplierReviewed || false}
                        onChange={(event) =>
                          changeLine(index, {
                            supplierReviewed: event.target.checked,
                          })
                        }
                      />{' '}
                      Supplier ingredients and allergen information reviewed
                    </label>
                  </>
                )}
              {supplier && <p>Manufacturer wording comes from the product’s Ingredients &amp; allergens section.</p>}
              {product && !supplier && (
                <label className="field">
                  Reviewed cross-contact advisory (optional)
                  <input
                    value={line.advisory || ''}
                    onChange={(event) =>
                      changeLine(index, {
                        advisory: event.target.value,
                        supplierReviewed: false,
                      })
                    }
                  />
                </label>
              )}
            </div>
            <button
              className="text-button"
              type="button"
              onClick={() =>
                change({
                  lines: spec.lines.filter((_, position) => index !== position),
                })
              }
            >
              Remove included product {index + 1}
            </button>
          </fieldset>
        )
      })}
      <div className="button-row">
        <button
          type="button"
          className="btn secondary"
          onClick={() => change({ lines: [...spec.lines, { ...emptyLine }] })}
        >
          Add product or flavor
        </button>
        <label className="field">
          Job label
          <select
            value={spec.componentId}
            onChange={(event) => change({ componentId: event.target.value })}
          >
            <option value="">Outer container</option>
            {[
              ...new Set(
                spec.lines
                  .filter((line) => line.unit === 'package' && line.productId)
                  .map((line) => line.productId),
              ),
            ].map((id) => (
              <option key={id} value={id}>
                Component: {products.find((product) => product.id === id)?.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn secondary"
          onClick={() => {
            const multiplier = spec.componentId
              ? spec.lines.find(
                  (line) =>
                    line.productId === spec.componentId &&
                    line.unit === 'package',
                )?.quantity || 1
              : 1
            change({ copies: spec.containers * multiplier })
          }}
        >
          {spec.componentId ? 'Set one copy per included selling package' : 'Set one copy per outer container'}
        </button>
      </div>
      <div className="button-row">
        <button
          type="button"
          className="btn"
          onClick={() => {
            setNotice('')
            setFit(undefined)
            setReviewed('')
            try {
              setPreview(assortmentLabel(workspace, spec))
              setPreviewVersion((version) => version + 1)
            } catch (error) {
              setPreview(undefined)
              setNotice((error as Error).message)
            }
          }}
        >
          Build actual-size preview
        </button>
        {canManage &&
          spec.mode === 'fixed' &&
          !spec.batchId &&
          !spec.componentId && (
            <button
              type="button"
              className="btn secondary"
              disabled={busy}
              onClick={() =>
                void submit(
                  { op: 'save-fixed', spec },
                  'Fixed assortment saved for explicit reuse.',
                )
              }
            >
              Save fixed assortment
            </button>
          )}
      </div>
      {preview && (
        <div className="assortment-preview">
          <h3>Actual-size preview · {preview.snapshot.stock.name}</h3>
          <p className="form-hint">Scroll inside the preview if the actual-size label is wider than your screen.</p>
          <iframe
            key={`${previewVersion}:${signature}`}
            title="Actual-size assortment label"
            sandbox="allow-same-origin"
            srcDoc={assortmentPrintHtml(
              preview.snapshot,
              1,
              Boolean(spec.componentId),
            )}
            style={{
              height: Math.min(
                650,
                (printPlacement(preview.snapshot.stock, undefined, preview.snapshot.layout.rotation).media.height * 4) / 3 + 20,
              ),
            }}
            onLoad={(event) =>
              setFit({ signature, fits: !!event.currentTarget.contentDocument && assortmentPrintFits(event.currentTarget.contentDocument) })
            }
          />
          {!freshPreview && (
            <p role="alert">
              Source information changed. Build a fresh preview.
            </p>
          )}
          {fit === false && (
            <p role="alert">
              Content overflows this stock. Choose a larger label or another reviewed template. Text is not shortened or shrunk below the configured minimum.
            </p>
          )}
          {preview.snapshot.warnings.length > 0 && (
            <div role="alert">
              <strong>Label information needs review</strong>
              <ul>
                {preview.snapshot.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          )}
          {[...new Set(preview.snapshot.sections.map(({ productId }) => productId))].map((id) => (
            <div key={id}>
              <LabelMergeReview workspace={workspace} source={{ kind: 'product', id }} mutate={canManage ? onReviewAllergens : undefined} onOpenSource={canManage ? onOpenSource : undefined} />
              <LabelSourceAllergenReview workspace={workspace} source={{ kind: 'product', id }} mutate={canManage ? onReviewAllergens : undefined} onOpenSource={onOpenSource} />
            </div>
          ))}
          {canManage && (
            <div className="button-row">
              <label>
                <input
                  type="checkbox"
                  checked={reviewed}
                  onChange={(event) => setReviewed(event.target.checked ? signature : '')}
                />{' '}
                I reviewed the actual contents, source information, layout, and
                applicable packaging requirements.
              </label>
              <button
                type="button"
                className="btn"
                disabled={
                  busy ||
                  !freshPreview ||
                  fit !== true ||
                  !reviewed ||
                  !!preview.snapshot.warnings.length
                }
                onClick={() =>
                  void submit(
                    {
                      op: 'approve',
                      spec,
                      reviewed,
                      revises,
                      signature,
                    },
                    'New label job approved. Earlier snapshots are unchanged.',
                  )
                }
              >
                Approve label job
              </button>
            </div>
          )}
        </div>
      )}
      <h3>Approved label jobs</h3>
      {!jobs.length && <p>No approved assortment jobs yet.</p>}
      {jobs.map((job) => {
        const events = records.filter(
          (record) => record.assortmentJobId === job.id,
        )
        const total = (kind: string) =>
          events
            .filter((event) => event.assortmentKind === kind)
            .reduce((sum, event) => sum + event.copies, 0)
        const current = assortmentJobCurrent(workspace, job)
        const count = counts[job.id] ?? job.copies
        return (
          <section className="assortment-line" key={job.id}>
            <h4>
              {job.name} · {job.assortmentSpec.group || 'Standalone'}
            </h4>
            <p>
              {job.assortmentSpec.componentId
                ? 'Component label'
                : 'Outer label'}{' '}
              · {job.copies} approved · {total('printed')} printed (including
              reprints) · {total('applied')} applied / verified
            </p>
            {!current && (
              <p className="warning-text">
                Needs re-review. This snapshot is retained, but cannot be
                reprinted as a current job.
              </p>
            )}
            <div className="button-row">
              <button
                type="button"
                className="btn secondary"
                onClick={() =>
                  setInspected(inspected === job.id ? undefined : job.id)
                }
              >
                View saved snapshot
              </button>
              <button
                type="button"
                className="btn secondary"
                onClick={() => {
                  setRevises(
                    !job.batchId &&
                      !records.some((record) =>
                        record.assortmentSupersedes?.includes(job.id),
                      )
                      ? job.id
                      : undefined,
                  )
                  change(job.assortmentSpec)
                }}
              >
                Review as new job
              </button>
              {canManage && (
                <>
                  <label className="field">
                    Copies to print or confirm
                    <input
                      type="number"
                      min="1"
                      max={job.copies}
                      value={count}
                      onChange={(event) =>
                        setCounts({
                          ...counts,
                          [job.id]: event.target.valueAsNumber || 0,
                        })
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className="btn secondary"
                    disabled={
                      !current ||
                      busy ||
                      !Number.isInteger(count) ||
                      count < 1 ||
                      count > job.copies
                    }
                    onClick={() => print(job, count)}
                  >
                    {total('printed') ? 'Reprint' : 'Print approved copies'}
                  </button>
                  <button
                    type="button"
                    className="btn secondary"
                    disabled={!current || busy}
                    onClick={() =>
                      void submit(
                        { op: 'printed', jobId: job.id, copies: count },
                        'Printed copies confirmed.',
                      )
                    }
                  >
                    Confirm printed
                  </button>
                  <button
                    type="button"
                    className="btn secondary"
                    disabled={
                      !current ||
                      busy ||
                      Math.min(job.copies, total('printed')) -
                        total('applied') <
                        count
                    }
                    onClick={() =>
                      void submit(
                        { op: 'applied', jobId: job.id, copies: count },
                        'Applied and verified copies recorded.',
                      )
                    }
                  >
                    Confirm applied / verified
                  </button>
                </>
              )}
            </div>
            {inspected === job.id && (
              <iframe
                title="Saved assortment label snapshot"
                sandbox="allow-same-origin"
                srcDoc={assortmentPrintHtml(
                  job.assortmentSnapshot,
                  1,
                  Boolean(job.assortmentSpec.componentId),
                )}
              />
            )}
          </section>
        )
      })}
    </section>
  )
}
