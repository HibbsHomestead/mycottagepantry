import { AddItemDialog } from './add-item-dialog'
import { ovenToday, ovenTimestamp } from '@/lib/oven-dates'
import {
  inventoryGroups,
  purchasableInventory,
} from '@/lib/purchased-inventory'
import { ProductLinkImport } from './product-link-import'
import { InventoryProductFields } from './inventory-product-fields'
import { FabricFields } from './fabric-fields'
import { ReceiptDocumentPreview } from './receipt-document-preview'
import { fabricUnitOptions, isFabric } from '@/lib/fabric'
import {
  receiptDifferences,
  receiptReadingLabel,
} from '../lib/receipt-document'
import { CardDisclosure } from './ui/card'
import { useState, useEffect, useRef, type ReactNode } from 'react'
import {
  Upload,
  Camera,
  Plus,
  FileText,
  Download,
  Check,
  RotateCw,
  ZoomIn,
  ZoomOut,
  Crop,
  Users,
  Receipt,
  ArrowRight,
  X,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  money,
  csv,
  ingredientUnits,
  unitLabel,
  calculateTax,
  applicableTaxes,
  type Item,
  type Workspace,
} from '@/lib/domain'
import {
  consignmentMath,
  consignmentBalance,
  duplicateReceipts,
  expenseCategories,
} from '@/lib/finance'
import './finance-workspace.css'
const freshLine = () => ({
  description: '',
  quantity: null,
  unit: '',
  amount: null,
  decision: '',
  category: 'Miscellaneous expense',
})
const names: Record<string, string> = {
  transfer: 'Transfer between business accounts',
  contribution: 'Record owner contribution',
  draw: 'Record owner draw',
  expense: 'Record an expense',
  bill: 'Record a vendor bill',
  vendorPayment: 'Record vendor payment',
  consignorSave: 'Add consignor',
  consignmentReceive: 'Receive consignment items',
  consignmentSale: 'Record consignment sale',
  consignmentPayout: 'Create payout',
  financeReverse: 'Correct a transaction',
  consignmentRefund: 'Refund consignment sale',
  simpleSale: 'Record a sale',
  financeReconcile: 'Reconcile record',
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  )
}
function exportRows(name: string, rows: Item[]) {
  const a = document.createElement('a'),
    url = URL.createObjectURL(
      new Blob([csv(rows)], { type: 'text/csv;charset=utf-8' }),
    )
  a.href = url
  a.download = name + '.csv'
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function Badge({ confidence }: { confidence?: number }) {
  return (
    <span
      className={
        'badge ' +
        (confidence == null || confidence < 0.6
          ? 'warning'
          : confidence < 0.85
            ? 'warning'
            : 'success')
      }
    >
      {confidence == null
        ? 'Needs review'
        : confidence >= 0.85
          ? '✓ High confidence'
          : confidence >= 0.6
            ? 'Review · medium'
            : '! Needs review'}
    </span>
  )
}
export function FinanceWorkspace({
  workspace: w,
  onWorkspace,
  section,
  ready,
  role,
  initialEntry,
  onEntryOpened,
  onCreatePantryItem,
}: {
  workspace: Workspace
  onWorkspace: (w: Workspace) => void
  section: string
  ready: boolean
  role: string
  initialEntry?: string
  onEntryOpened?: () => void
  onCreatePantryItem?: (kind: 'ingredient' | 'packaging') => void
}) {
  const [tab, setTab] = useState('Consignors'),
    [receipt, setReceipt] = useState<Item | null>(null),
    [localReceiptFile, setLocalReceiptFile] = useState<File | null>(null),
    [modal, setModal] = useState(''),
    [draft, setDraft] = useState<Record<string, any>>({}),
    [review, setReview] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [statement, setStatement] = useState<Item | null>(null),
    [journal, setJournal] = useState<Item | null>(null),
    [exportType, setExportType] = useState('Current tab'),
    [picker, setPicker] = useState(false)
  const entryDrafts = useRef<
    Record<string, { action: string; data: Record<string, any> }>
  >({})
  const activeType = useRef('')
  const saving = useRef(false)
  useEffect(() => {
    if (initialEntry) {
      if (initialEntry === 'transaction') setPicker(true)
      else if (initialEntry === 'sale')
        open('simpleSale', {
          saleLines: [
            {
              productId: w.products[0]?.id || '',
              quantity: 1,
              amount: w.products[0]?.price || 0,
              discounts: 0,
            },
          ],
          channel: 'Farmers market',
          fees: 0,
          requestId: crypto.randomUUID(),
        })
      else open('financeEntry', { kind: initialEntry })
      onEntryOpened?.()
    }
  }, [initialEntry])
  const canWrite = ready && ['Owner', 'Manager'].includes(role)
  const today = () => ovenToday(w.settings[0])
  const receipts = w.receipt_extractions || [],
    owners = w.consignors || [],
    items = w.consignment_items || [],
    sales = w.consignment_sales || [],
    payouts = w.consignment_payouts || [],
    transactions = w.finance_transactions || []
  async function request(action: string, data: Record<string, any> = {}) {
    const response = await fetch('/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, data }),
      }),
      result = response.headers
        .get('content-type')
        ?.includes('application/json')
        ? await response.json()
        : {
            error:
              'The server returned an access or error page. Sign in and retry.',
          }
    if (!response.ok)
      throw new Error(result.error || 'Unable to save. Please try again.')
    onWorkspace(result.workspace)
    return result.workspace as Workspace
  }
  async function run(
    action: string,
    data: Record<string, any> = {},
    close = true,
  ) {
    if (!canWrite || saving.current) return
    saving.current = true
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const result = await request(action, data)
      if (close) {
        delete entryDrafts.current[activeType.current]
        setModal('')
        setReceipt(null)
        setReview(false)
      }
      setMessage(
        action === 'receiptDraft'
          ? 'Draft saved. Nothing has been posted.'
          : 'Saved successfully.',
      )
      return result
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to save.')
    } finally {
      saving.current = false
      setBusy(false)
    }
  }
  async function upload(file: File) {
    if (!canWrite || saving.current) return
    if (file.size > 4 * 1024 * 1024) {
      setError(
        'Choose a receipt up to 4 MiB. Larger originals must be split before upload.',
      )
      return
    }
    saving.current = true
    setBusy(true)
    setError('')
    setMessage('Uploading receipt…')
    setLocalReceiptFile(file)
    setReceipt({
      id: 'uploading',
      name: file.name,
      status: 'draft',
      fileHash: 'local-preview',
      previewMime: file.type,
      extractionStatus: 'manual',
      lines: [],
    })
    try {
      const body = new FormData()
      body.set('file', file)
      const response = await fetch('/api/workspace?receiptUpload=1', {
          method: 'POST',
          body,
        }),
        result = response.headers
          .get('content-type')
          ?.includes('application/json')
          ? await response.json()
          : {
              error:
                'The server returned an access or error page. Sign in and retry.',
            }
      if (!response.ok)
        throw new Error(result.error || 'Receipt upload failed.')
      const saved = result.receipt
      setReceipt(saved)
      setLocalReceiptFile(null)
      onWorkspace({
        ...w,
        receipt_extractions: [
          ...receipts.filter((r) => r.id !== saved.id),
          saved,
        ],
      })
      if (saved.extractionStatus !== 'manual') {
        setReceipt({ ...saved, extractionStatus: 'processing' })
        setMessage('Reading receipt…')
        const result = await request('receiptExtract', { id: saved.id })
        const extracted = result.receipt_extractions.find(
          (r) => r.id === saved.id,
        )
        if (!extracted)
          throw new Error(
            'The reader did not return the receipt draft. Reopen the saved original and retry.',
          )
        setReceipt(extracted)
        setMessage(receiptReadingLabel(extracted))
      } else
        setMessage(
          'Original saved. Receipt reading is unavailable; enter details manually.',
        )
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Receipt upload or reading failed. The saved original remains in your inbox.',
      )
      setReceipt((r) =>
        r && r.id !== 'uploading'
          ? {
              ...r,
              extractionStatus: 'failed',
              extractionMessage:
                'Reading did not finish. Retry reading or enter details manually; your original is preserved.',
            }
          : r
            ? { ...r, extractionStatus: 'upload_failed' }
            : r,
      )
    } finally {
      saving.current = false
      setBusy(false)
    }
  }
  function open(action: string, initial: Record<string, any> = {}) {
    activeType.current =
      action === 'simpleSale'
        ? 'sale'
        : action === 'financeEntry'
          ? initial.kind || ''
          : action
    setModal(action)
    setReview(false)
    setError('')
    setDraft({
      requestId: crypto.randomUUID(),
      date: today(),
      method: 'Bank transfer',
      commissionType: 'percentage',
      commissionRate: 10,
      quantity: 1,
      feeBearer: 'business',
      category: 'Miscellaneous expense',
      ...initial,
    })
  }
  const input = (
    key: string,
    label: string,
    type = 'text',
    extra: Record<string, any> = {},
  ) => (
    <Field label={label}>
      <input
        type={type}
        value={draft[key] ?? ''}
        onChange={(e) => {
          setReview(false)
          setDraft({ ...draft, [key]: e.target.value })
        }}
        {...extra}
      />
    </Field>
  )
  const select = (
    key: string,
    label: string,
    options: { id: string; name: string }[],
    change?: (value: string) => void,
  ) => (
    <Field label={label}>
      <select
        value={draft[key] || ''}
        onChange={(e) => {
          setReview(false)
          setDraft({ ...draft, [key]: e.target.value })
          change?.(e.target.value)
        }}
      >
        <option value="">Choose…</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </Field>
  )
  const chooseOwner = (id: string) => {
    const o = owners.find((o) => o.id === id)
    setDraft((d) => ({
      ...d,
      consignorId: id,
      commissionType: o?.commissionType || 'percentage',
      commissionRate: o?.commissionRate ?? 10,
      amount: consignmentBalance(w, id),
      saleIds: undefined,
    }))
  }
  let math: ReturnType<typeof consignmentMath> | undefined,
    mathError = ''
  if (modal === 'consignmentSale')
    try {
      math = consignmentMath(draft)
    } catch (e) {
      mathError = e instanceof Error ? e.message : ''
    }
  const periodSales = sales.filter(
      (s) => s.date?.slice(0, 7) === today().slice(0, 7),
    ),
    owed = owners.reduce((a, o) => a + consignmentBalance(w, o.id), 0)
  return (
    <div className="finance-workspace">
      {error && (
        <p className="finance-feedback error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="finance-feedback" role="status">
          {message}
        </p>
      )}
      {section === 'Receipt inbox' ? (
        <>
          <div
            className="panel action-banner finance-upload"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              if (e.dataTransfer.files[0]) void upload(e.dataTransfer.files[0])
            }}
          >
            <div className="action-banner-icon">
              <Receipt size={24} />
            </div>
            <div className="action-banner-copy">
              <h2>Keep receipts with your records.</h2>
              <p>
                Upload an original, review the extracted details, then confirm.
                Nothing posts until you approve it.
              </p>
              <small>
                JPG, PNG, HEIC or PDF · up to 4 MiB · up to 20 PDF pages ·
                private originals
              </small>
              <small>
                Receipt reading uses Google via Netlify. Document contents are
                sent for processing and incur metered usage. Up to 10 readings
                per oven per day; 3 per receipt.
              </small>
            </div>
            <div className="button-row action-banner-actions">
              <label className="btn">
                <Upload size={17} /> Upload receipt
                <input
                  aria-label="Upload receipt"
                  type="file"
                  accept=".jpg,.jpeg,.png,.heic,.heif,.pdf"
                  disabled={!canWrite || busy}
                  onChange={(e) => {
                    if (e.target.files?.[0]) void upload(e.target.files[0])
                    e.target.value = ''
                  }}
                  className="sr-only"
                />
              </label>
              <label className="btn secondary">
                <Camera size={17} /> Take photo
                <input
                  aria-label="Take receipt photo"
                  type="file"
                  accept="image/*"
                  capture="environment"
                  disabled={!canWrite || busy}
                  className="sr-only"
                  onChange={(e) => {
                    if (e.target.files?.[0]) void upload(e.target.files[0])
                  }}
                />
              </label>
              <button
                className="btn secondary"
                disabled={!canWrite || busy}
                onClick={async () => {
                  const result = await run('receiptManual', {}, false)
                  if (result)
                    setReceipt(result.receipt_extractions.at(-1) || null)
                }}
              >
                Add manually
              </button>
            </div>
          </div>
          <div className="panel">
            <div className="panel-heading">
              <div>
                <h2>Receipt inbox</h2>
                <p>
                  {receipts.filter((r) => r.status === 'draft').length} drafts
                  need your review
                </p>
              </div>
            </div>
            {!receipts.length ? (
              <p className="finance-empty">
                Drop your first receipt above, or enter one manually.
              </p>
            ) : (
              <div className="finance-list">
                {[...receipts].reverse().map((r) => (
                  <button
                    className="finance-list-row finance-list-row--receipt"
                    key={r.id}
                    onClick={() => {
                      setError('')
                      setReceipt(structuredClone(r))
                    }}
                  >
                    <FileText />
                    <span>
                      <strong>{r.vendor || r.name}</strong>
                      <small>
                        {r.date || 'Date needs review'} ·{' '}
                        {r.receiptNumber || receiptReadingLabel(r)}
                      </small>
                    </span>
                    <strong>
                      {r.total == null ? 'Not extracted' : money(r.total)}
                    </strong>
                    <span
                      className={
                        'badge ' +
                        (r.status === 'posted' ? 'success' : 'warning')
                      }
                    >
                      {r.status === 'posted'
                        ? '✓ Posted'
                        : r.status === 'cancelled'
                          ? 'Cancelled'
                          : '! Draft'}
                    </span>
                    <ArrowRight size={17} />
                  </button>
                ))}
              </div>
            )}
            <p className="panel-note">
              Email forwarding is not connected. Upload files or use your phone
              camera.
            </p>
          </div>
        </>
      ) : section === 'Consignment' ? (
        <>
          <section className="stat-grid">
            {[
              [
                'Sales this month',
                periodSales.reduce((a, s) => a + s.merchandise, 0),
              ],
              [
                'Commission this month',
                periodSales.reduce((a, s) => a + s.commission, 0),
              ],
              ['Owed to consignors', owed],
              [
                'Consignors awaiting payout',
                owners.filter((o) => consignmentBalance(w, o.id) > 0).length,
              ],
            ].map(([label, value], i) => (
              <article className="stat-card" key={label}>
                <span>{label}</span>
                <strong>{i === 3 ? value : money(Number(value))}</strong>
                <small>
                  {i < 2 ? 'Current calendar month' : 'All outstanding records'}
                </small>
              </article>
            ))}
          </section>
          <div className="page-tabs">
            {[
              'Consignors',
              'Consignment items',
              'Sales',
              'Payouts',
              'Statements',
              'Settings',
            ].map((t) => (
              <button
                key={t}
                className={tab === t ? 'active' : ''}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="toolbar">
            <h2>{tab}</h2>
            <div className="button-row">
              <button
                className="btn secondary"
                onClick={() =>
                  exportRows(
                    'consignment-' + tab.toLowerCase(),
                    tab === 'Consignors'
                      ? owners.map((o) => ({
                          ...o,
                          balance: consignmentBalance(w, o.id),
                        }))
                      : tab === 'Consignment items'
                        ? items
                        : tab === 'Sales'
                          ? sales
                          : payouts,
                  )
                }
              >
                <Download size={16} /> Export CSV
              </button>
              {tab !== 'Settings' && (
                <button
                  className="btn"
                  disabled={!canWrite}
                  onClick={() =>
                    open(
                      tab === 'Consignors'
                        ? 'consignorSave'
                        : tab === 'Consignment items'
                          ? 'consignmentReceive'
                          : tab === 'Sales'
                            ? 'consignmentSale'
                            : 'consignmentPayout',
                    )
                  }
                >
                  <Plus size={16} />
                  {tab === 'Consignors'
                    ? 'Add consignor'
                    : tab === 'Consignment items'
                      ? 'Receive items'
                      : tab === 'Sales'
                        ? 'Record consignment sale'
                        : 'Create payout'}
                </button>
              )}
            </div>
          </div>
          <div className="panel">
            {tab === 'Consignors' ? (
              owners.length ? (
                <div className="finance-list">
                  {owners.map((o) => (
                    <div className="finance-list-row" key={o.id}>
                      <Users />
                      <span>
                        <strong>{o.name}</strong>
                        <small>
                          {o.businessName || o.email || 'Consignor'} ·{' '}
                          {o.commissionType === 'fixed'
                            ? money(o.commissionRate) + ' per item'
                            : o.commissionRate + '% commission'}
                        </small>
                      </span>
                      <strong>{money(consignmentBalance(w, o.id))} owed</strong>
                      <button
                        className="btn secondary"
                        onClick={() => open('consignorSave', o)}
                      >
                        Edit
                      </button>
                      <button
                        className="btn"
                        disabled={!canWrite || consignmentBalance(w, o.id) <= 0}
                        onClick={() =>
                          open('consignmentPayout', {
                            consignorId: o.id,
                            amount: consignmentBalance(w, o.id),
                            method: o.method || 'Bank transfer',
                          })
                        }
                      >
                        Pay consignor
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="finance-empty">
                  Add the maker who owns the goods. We calculate your commission
                  and what you owe.
                </p>
              )
            ) : tab === 'Consignment items' ? (
              items.length ? (
                <div className="finance-list">
                  {items.map((i) => (
                    <div className="finance-list-row" key={i.id}>
                      <span>
                        <strong>{i.name}</strong>
                        <small>
                          {owners.find((o) => o.id === i.consignorId)?.name} ·{' '}
                          {i.received} received · {i.sold} sold · {i.returned}{' '}
                          returned
                        </small>
                      </span>
                      <strong>{i.available} available</strong>
                      <span>{money(i.price)}</span>
                      <button
                        className="btn secondary"
                        disabled={!canWrite}
                        onClick={() =>
                          open('consignmentReceive', {
                            itemId: i.id,
                            consignorId: i.consignorId,
                            price: i.price,
                            movement: 'return',
                          })
                        }
                      >
                        Return items
                      </button>
                      <button
                        className="btn"
                        disabled={!canWrite || !i.available}
                        onClick={() => {
                          const o = owners.find((o) => o.id === i.consignorId)
                          open('consignmentSale', {
                            itemId: i.id,
                            gross: i.price,
                            commissionType: o?.commissionType,
                            commissionRate: o?.commissionRate,
                          })
                        }}
                      >
                        Record sale
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="finance-empty">
                  Receive goods without adding their value to your own inventory
                  assets.
                </p>
              )
            ) : tab === 'Sales' ? (
              sales.length ? (
                <div className="finance-list">
                  {sales.map((s) => (
                    <div className="finance-list-row" key={s.id}>
                      <span>
                        <strong>{s.name}</strong>
                        <small>
                          {s.date} · {s.quantity} sold ·{' '}
                          {owners.find((o) => o.id === s.consignorId)?.name}
                        </small>
                      </span>
                      <span>
                        Sales {money(s.merchandise)}
                        <small>
                          Commission {money(s.commission)} · tax {money(s.tax)}
                        </small>
                      </span>
                      <strong>{money(s.payable - s.paid)} remaining</strong>
                      <span
                        className={
                          'badge ' +
                          (s.status === 'paid' ? 'success' : 'warning')
                        }
                      >
                        {s.status.replace('_', ' ')}
                      </span>
                      <button
                        className="btn secondary"
                        onClick={() =>
                          setJournal(
                            w.journals?.find((j) => j.sourceId === s.id) ||
                              null,
                          )
                        }
                      >
                        View calculation
                      </button>
                      {!s.refundOf &&
                        !sales.some((r) => r.refundOf === s.id) && (
                          <button
                            className="btn secondary"
                            disabled={!canWrite}
                            onClick={() =>
                              open('consignmentRefund', {
                                id: s.id,
                                name: s.name,
                                amount: s.merchandise + s.tax,
                              })
                            }
                          >
                            Refund sale
                          </button>
                        )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="finance-empty">
                  Your consignment sales appear here. Only your retained
                  commission counts as income.
                </p>
              )
            ) : tab === 'Settings' ? (
              <>
                <h3>Consignment reports</h3>
                <div className="button-row">
                  <Field label="Report">
                    <select
                      value={exportType}
                      onChange={(e) => setExportType(e.target.value)}
                    >
                      {[
                        'Current tab',
                        'Sales by consignor',
                        'Commission income',
                        'Unpaid balances',
                        'Payout history',
                        'Sales by channel',
                      ].map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </Field>
                  <button
                    className="btn secondary"
                    onClick={() =>
                      exportRows(
                        'consignment-report',
                        exportType === 'Payout history'
                          ? payouts
                          : exportType === 'Unpaid balances'
                            ? owners.map((o) => ({
                                id: o.id,
                                name: o.name,
                                balance: consignmentBalance(w, o.id),
                              }))
                            : exportType === 'Sales by channel'
                              ? channelRows(w)
                              : owners.map((o) => ({
                                  id: o.id,
                                  name: o.name,
                                  grossSales: sales
                                    .filter((s) => s.consignorId === o.id)
                                    .reduce((a, s) => a + s.merchandise, 0),
                                  commission: sales
                                    .filter((s) => s.consignorId === o.id)
                                    .reduce((a, s) => a + s.commission, 0),
                                  owed: consignmentBalance(w, o.id),
                                })),
                      )
                    }
                  >
                    Download CSV
                  </button>
                </div>
                <h3>Clear agreements, transparent payouts</h3>
                <p>
                  Set each consignor’s default commission on their record. Each
                  sale can override it. Processing fees stay with your business
                  unless you record an explicit agreement to pass them on or
                  share them.
                </p>
                <p>
                  Consignment stock is tracked separately from your owned pantry
                  inventory. Payouts reduce the amount owed; they are not
                  operating expenses.
                </p>
              </>
            ) : payouts.length ? (
              <div className="finance-list">
                {payouts.map((p) => (
                  <div className="finance-list-row" key={p.id}>
                    <span>
                      <strong>{p.name}</strong>
                      <small>
                        {p.date} · {p.method} · {p.reference || 'No reference'}
                      </small>
                    </span>
                    <strong>{money(p.amount)}</strong>
                    <button
                      className="btn secondary"
                      onClick={() => setStatement(p)}
                    >
                      View / download statement
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="finance-empty">
                Confirmed payouts create a permanent statement for you and the
                consignor.
              </p>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="panel">
            <div className="panel-heading">
              <div>
                <h2>Balances from posted records</h2>
                <p>
                  Recorded liabilities and equity. Opening balances and all
                  business activity must be entered for a complete balance
                  sheet.
                </p>
              </div>
              <button
                className="btn secondary"
                onClick={() =>
                  exportRows('posted-account-balances', postedBalances(w))
                }
              >
                Export balances
              </button>
            </div>
            <div className="finance-form-grid">
              {postedBalances(w)
                .filter((a) =>
                  [
                    'Sales Tax Payable',
                    'Consignment Payable',
                    'Accounts payable',
                    'Owner equity',
                    'Owner draws',
                  ].includes(a.name),
                )
                .map((a) => (
                  <div className="financial-line" key={a.id}>
                    <span>{a.name}</span>
                    <strong>{money(a.balance)}</strong>
                  </div>
                ))}
            </div>
          </div>
          <div className="panel panel-body">
            <h2>Keep business money simple</h2>
            <p>
              Enter the details, review the summary, then confirm. The
              accounting happens in the background.
            </p>
            <div className="button-row">
              <button
                className="btn secondary"
                disabled={!canWrite || busy}
                onClick={() => setPicker(true)}
              >
                <Plus size={18} />
                Record a transaction
              </button>
            </div>
          </div>
          <div className="panel">
            <div className="panel-heading">
              <div>
                <h2>Activity & reconciliation</h2>
                <p>
                  Review source documents and accounting records in one place.
                </p>
              </div>
              <button
                className="btn secondary"
                onClick={() => exportRows('financial-activity', transactions)}
              >
                Export CSV
              </button>
            </div>
            {!transactions.length ? (
              <p className="finance-empty">
                Your confirmed receipts, expenses, owner activity, and vendor
                payments appear here.
              </p>
            ) : (
              <div className="finance-list">
                {[...transactions].reverse().map((t) => (
                  <div className="finance-list-row" key={t.id}>
                    <span>
                      <strong>{t.name}</strong>
                      <small>
                        {t.date} · {t.kind} ·{' '}
                        {t.reversedBy ? 'Reversed' : 'Posted'}{' '}
                        {t.kind === 'bill'
                          ? ` · ${money(t.amount - (t.paid || 0))} unpaid`
                          : ''}{' '}
                        {(w.finance_reviews || []).some(
                          (r) => r.transactionId === t.id,
                        )
                          ? ' · ✓ Reconciled'
                          : ''}
                      </small>
                    </span>
                    <strong>{money(t.amount)}</strong>
                    <button
                      className="btn secondary"
                      disabled={!canWrite}
                      onClick={() =>
                        open('financeReconcile', {
                          id: t.id,
                          name: t.name,
                          amount: Math.abs(t.amount),
                        })
                      }
                    >
                      Reconcile
                    </button>
                    {t.receiptId && (
                      <button
                        className="btn secondary"
                        onClick={() =>
                          setReceipt(
                            structuredClone(
                              receipts.find((r) => r.id === t.receiptId)!,
                            ),
                          )
                        }
                      >
                        Receipt
                      </button>
                    )}
                    <button
                      className="btn secondary"
                      onClick={() =>
                        setJournal(
                          w.journals?.find(
                            (j) =>
                              j.sourceId === t.id ||
                              t.saleIds?.includes(j.sourceId),
                          ) || null,
                        )
                      }
                    >
                      Journal details
                    </button>
                    {!t.reversedBy &&
                      !['reversal', 'receipt', 'productSale'].includes(
                        t.kind,
                      ) && (
                        <button
                          className="btn secondary"
                          disabled={!canWrite}
                          onClick={() =>
                            open('financeReverse', {
                              id: t.id,
                              name: t.name,
                              amount: t.amount,
                            })
                          }
                        >
                          Correct
                        </button>
                      )}
                  </div>
                ))}
              </div>
            )}
            <CardDisclosure label="View accounting details">
              {(w.journals || []).map((j) => (
                <button
                  className="finance-list-row"
                  key={j.id}
                  onClick={() => setJournal(j)}
                >
                  <span>
                    {j.name}
                    <small>{j.date}</small>
                  </span>
                  <span>View details →</span>
                </button>
              ))}
            </CardDisclosure>
          </div>
        </>
      )}
      <p className="finance-disclaimer">
        For recordkeeping, not legal, tax, payroll, or accounting advice.
        Consult a qualified accountant or tax professional about consignment
        agreements, sales tax, 1099 reporting, and local requirements.
      </p>
      <Dialog open={picker} onOpenChange={setPicker}>
        <DialogContent className="finance-dialog">
          <DialogHeader>
            <DialogTitle>Record a transaction</DialogTitle>
            <DialogDescription>
              What would you like to record?
            </DialogDescription>
          </DialogHeader>
          <div className="transaction-picker">
            {[
              {
                name: 'Sales & purchases',
                choices: [
                  ['sale', 'Sale / income', ''],
                  ['expense', 'Expense / purchase', ''],
                ],
              },
              {
                name: 'Bills & payments',
                choices: [
                  ['bill', 'Vendor bill', 'Record an amount you owe.'],
                  ['vendorPayment', 'Vendor payment', 'Pay an existing bill.'],
                ],
              },
              {
                name: 'Owner & account activity',
                choices: [
                  [
                    'contribution',
                    'Owner contribution',
                    'Money you put into the business.',
                  ],
                  [
                    'draw',
                    'Owner withdrawal',
                    'Money you take out of the business.',
                  ],
                  [
                    'transfer',
                    'Transfer between business accounts',
                    'Move money between your Cash and Bank account records.',
                  ],
                ],
              },
              {
                name: 'Consignment',
                choices: [
                  ['consignmentSale', 'Consignment sale', ''],
                  [
                    'consignmentPayout',
                    'Consignor payout',
                    'Record payment to someone whose items you sold.',
                  ],
                ],
              },
            ].map((group) => (
              <section key={group.name}>
                <h3>{group.name}</h3>
                {group.choices.map(([kind, label, help]) => (
                  <button
                    className="transaction-choice"
                    key={kind}
                    disabled={!canWrite || busy}
                    onClick={() => {
                      setPicker(false)
                      activeType.current = kind
                      const saved = entryDrafts.current[kind]
                      if (saved) open(saved.action, saved.data)
                      else if (kind === 'sale')
                        open('simpleSale', {
                          saleLines: [
                            {
                              productId: w.products[0]?.id || '',
                              quantity: 1,
                              amount: w.products[0]?.price || 0,
                              discounts: 0,
                            },
                          ],
                          channel: 'Farmers market',
                          fees: 0,
                        })
                      else if (
                        kind === 'consignmentSale' ||
                        kind === 'consignmentPayout'
                      )
                        open(kind)
                      else open('financeEntry', { kind })
                    }}
                  >
                    <span>
                      {label}
                      {help && <small>{help}</small>}
                    </span>
                    <ArrowRight size={18} />
                  </button>
                ))}
              </section>
            ))}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!modal}
        onOpenChange={(v) => {
          if (!v && !busy) setModal('')
        }}
      >
        <DialogContent className="finance-dialog">
          <DialogHeader>
            <DialogTitle>
              {modal === 'financeEntry'
                ? names[draft.kind]
                : names[modal] || 'Review activity'}
            </DialogTitle>
            <DialogDescription>
              {review
                ? 'Review the amounts below. Confirm to create the permanent record.'
                : 'Enter the details. Nothing posts until you review and confirm.'}
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="finance-feedback error">
              {error}
            </p>
          )}
          {[
            'simpleSale',
            'financeEntry',
            'consignmentSale',
            'consignmentPayout',
          ].includes(modal) && (
            <button
              className="btn secondary"
              disabled={busy}
              onClick={() => {
                entryDrafts.current[activeType.current || draft.kind || modal] =
                  {
                    action: modal,
                    data: structuredClone(draft),
                  }
                setModal('')
                setPicker(true)
              }}
            >
              Back to transaction types
            </button>
          )}
          <div className="finance-form-grid">
            {modal === 'simpleSale' ? (
              <>
                {input('date', 'Sale date', 'date')}
                {input('channel', 'Sales channel')}
                {input('method', 'Payment method')}
                {input('customer', 'Customer (optional)')}
                {input('fees', 'Processing fees ($)', 'number', {
                  min: 0,
                  step: '.01',
                })}
                {select(
                  'receiptId',
                  'Receipt / attachment (optional)',
                  receipts,
                )}
                <div className="finance-full">
                  {(draft.saleLines || []).map((l: any, index: number) => {
                    const update = (key: string, value: any) => {
                      setReview(false)
                      setDraft({
                        ...draft,
                        saleLines: draft.saleLines.map((x: any, i: number) =>
                          i === index ? { ...x, [key]: value } : x,
                        ),
                      })
                    }
                    const product = w.products.find((p) => p.id === l.productId)
                    let tax: any,
                      warning = ''
                    try {
                      tax = calculateTax(
                        Number(l.amount || 0) - Number(l.discounts || 0),
                        applicableTaxes(
                          product || { id: '', name: '' },
                          w.settings[0],
                          draft.date,
                        ),
                      )
                    } catch (e) {
                      warning = e instanceof Error ? e.message : ''
                    }
                    return (
                      <div className="receipt-line" key={index}>
                        <div className="finance-form-grid">
                          <Field label="Product">
                            <select
                              value={l.productId}
                              onChange={(e) => {
                                const p = w.products.find(
                                  (p) => p.id === e.target.value,
                                )
                                setReview(false)
                                setDraft({
                                  ...draft,
                                  saleLines: draft.saleLines.map(
                                    (x: any, i: number) =>
                                      i === index
                                        ? {
                                            ...x,
                                            productId: e.target.value,
                                            amount:
                                              (p?.price || 0) *
                                              Number(x.quantity || 1),
                                          }
                                        : x,
                                  ),
                                })
                              }}
                            >
                              {w.products.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name}
                                </option>
                              ))}
                            </select>
                          </Field>
                          <Field label="Quantity">
                            <input
                              type="number"
                              min=".000001"
                              step="any"
                              value={l.quantity ?? ''}
                              onChange={(e) => {
                                setReview(false)
                                setDraft({
                                  ...draft,
                                  saleLines: draft.saleLines.map(
                                    (x: any, i: number) =>
                                      i === index
                                        ? {
                                            ...x,
                                            quantity: e.target.value,
                                            amount:
                                              (product?.price || 0) *
                                              Number(e.target.value),
                                          }
                                        : x,
                                  ),
                                })
                              }}
                            />
                          </Field>
                          <Field label="Gross entered price ($)">
                            <input
                              type="number"
                              min="0"
                              step=".01"
                              value={l.amount ?? ''}
                              onChange={(e) => update('amount', e.target.value)}
                            />
                          </Field>
                          <Field label="Discounts ($)">
                            <input
                              type="number"
                              min="0"
                              step=".01"
                              value={l.discounts}
                              onChange={(e) =>
                                update('discounts', e.target.value)
                              }
                            />
                          </Field>
                          <Field label="Completed batch (optional)">
                            <select
                              value={l.batchId || ''}
                              onChange={(e) =>
                                update('batchId', e.target.value)
                              }
                            >
                              <option value="">Current cost estimate</option>
                              {w.batches
                                .filter(
                                  (b) =>
                                    b.status === 'completed' &&
                                    b.productId === l.productId,
                                )
                                .map((b) => (
                                  <option key={b.id} value={b.id}>
                                    {b.name}
                                  </option>
                                ))}
                            </select>
                          </Field>
                          <button
                            className="btn secondary"
                            disabled={draft.saleLines.length === 1}
                            onClick={() => {
                              setReview(false)
                              setDraft({
                                ...draft,
                                saleLines: draft.saleLines.filter(
                                  (_: any, i: number) => i !== index,
                                ),
                              })
                            }}
                          >
                            Remove product
                          </button>
                        </div>
                        {tax && (
                          <div className="finance-calculation">
                            <p>
                              Pre-tax revenue {money(tax.revenue)} · tax
                              liability {money(tax.tax)} · customer total{' '}
                              <strong>{money(tax.customerTotal)}</strong>
                            </p>
                            {tax.snapshot.map((t: any) => (
                              <p key={t.id}>
                                {t.name} · {t.behavior} · {t.ratePercent}% of{' '}
                                {money(t.taxableBase)} = {money(t.amount)}
                              </p>
                            ))}
                          </div>
                        )}
                        {warning && <p role="alert">{warning}</p>}
                      </div>
                    )
                  })}
                  <button
                    className="btn secondary"
                    onClick={() => {
                      setReview(false)
                      setDraft({
                        ...draft,
                        saleLines: [
                          ...draft.saleLines,
                          {
                            productId: w.products[0]?.id || '',
                            quantity: 1,
                            amount: w.products[0]?.price || 0,
                            discounts: 0,
                          },
                        ],
                      })
                    }}
                  >
                    Add product
                  </button>
                  <p>
                    Tax follows each product’s saved inclusive/exclusive
                    configuration. Collected tax is held as a liability.
                    Processing fees are allocated across the sale lines.
                  </p>
                </div>
              </>
            ) : modal === 'consignorSave' ? (
              <>
                {input('name', 'Consignor name')}
                {input('businessName', 'Business name (optional)')}
                {input('email', 'Email', 'email')}
                {input('phone', 'Phone')}
                {input('address', 'Mailing address')}
                {input('method', 'Preferred payout method')}
                {select('commissionType', 'Default commission', [
                  { id: 'percentage', name: 'Percentage of merchandise sales' },
                  { id: 'fixed', name: 'Fixed amount per item' },
                ])}
                {input(
                  'commissionRate',
                  draft.commissionType === 'fixed'
                    ? 'Commission per item ($)'
                    : 'Commission (%)',
                  'number',
                  { min: 0, step: '0.01' },
                )}
                {input('taxNotes', 'Tax reporting notes')}
                {input('notes', 'Notes')}
              </>
            ) : modal === 'consignmentReceive' ? (
              <>
                {select('consignorId', 'Consignor', owners)}
                {select(
                  'itemId',
                  'Existing item (or enter a new name)',
                  items.filter((i) => i.consignorId === draft.consignorId),
                )}
                {!draft.itemId && (
                  <>
                    {input('name', 'New product name')}
                    {input('sku', 'SKU')}
                    {input('description', 'Description')}
                    {input('category', 'Category')}
                  </>
                )}
                {input(
                  'quantity',
                  draft.movement === 'return'
                    ? 'Quantity to return'
                    : 'Quantity received',
                  'number',
                  { min: 1, step: 1 },
                )}
                {input('price', 'Retail price ($)', 'number', {
                  min: 0,
                  step: '.01',
                })}
                {input('date', 'Date', 'date')}
                {input('notes', 'Notes')}
              </>
            ) : modal === 'consignmentSale' ? (
              <>
                {select('itemId', 'Consignment item', items, (id) => {
                  const i = items.find((i) => i.id === id),
                    o = owners.find((o) => o.id === i?.consignorId)
                  setDraft((d) => ({
                    ...d,
                    itemId: id,
                    gross: (i?.price || 0) * Number(d.quantity || 1),
                    commissionType: o?.commissionType || 'percentage',
                    commissionRate: o?.commissionRate ?? 10,
                  }))
                })}
                {input('date', 'Sale date', 'date')}
                {input('channel', 'Market / sales channel')}
                {input('quantity', 'Quantity', 'number', { min: 1, step: 1 })}
                {input('gross', 'Gross merchandise sales ($)', 'number', {
                  min: 0,
                  step: '.01',
                })}
                {input('discounts', 'Discounts ($)', 'number', {
                  min: 0,
                  step: '.01',
                })}
                {input('refunds', 'Refunds in this sale ($)', 'number', {
                  min: 0,
                  step: '.01',
                })}
                {input('tax', 'Sales tax collected separately ($)', 'number', {
                  min: 0,
                  step: '.01',
                })}
                {input('taxNotes', 'Tax rate / jurisdiction notes')}
                {select('commissionType', 'Commission type', [
                  { id: 'percentage', name: 'Percentage' },
                  { id: 'fixed', name: 'Fixed per item' },
                ])}
                {input(
                  'commissionRate',
                  draft.commissionType === 'fixed'
                    ? 'Commission per item ($)'
                    : 'Commission (%)',
                  'number',
                  { min: 0, step: '.01' },
                )}
                <details className="finance-full">
                  <summary>Fees & approved deductions</summary>
                  <div className="finance-form-grid">
                    {input('fees', 'Processing fees ($)', 'number', {
                      min: 0,
                      step: '.01',
                    })}
                    {select('feeBearer', 'Who pays the fees?', [
                      { id: 'business', name: 'My business' },
                      { id: 'consignor', name: 'Consignor (agreed)' },
                      { id: 'shared', name: 'Shared equally (agreed)' },
                    ])}
                    {draft.feeBearer !== 'business' &&
                      input(
                        'feeAgreement',
                        'Fee agreement / approval reference',
                      )}
                    {input(
                      'deductions',
                      'Other approved deductions retained ($)',
                      'number',
                      { min: 0, step: '.01' },
                    )}
                    {Number(draft.deductions) > 0 &&
                      input(
                        'deductionApproval',
                        'Consignor approval reference',
                      )}
                  </div>
                </details>
                {math && (
                  <div className="finance-calculation finance-full">
                    <strong>
                      Commission: {money(math.merchandise)}{' '}
                      {math.commissionType === 'percentage'
                        ? `× ${math.commissionRate}%`
                        : `→ ${math.quantity} × ${money(math.commissionRate)}`}{' '}
                      = {money(math.commission)}
                    </strong>
                    <p>
                      Owed to consignor: {money(math.merchandise)} −{' '}
                      {money(math.commission)} commission −{' '}
                      {money(math.deductions)} approved deductions −{' '}
                      {money(math.consignorFee)} agreed fees ={' '}
                      <b>{money(math.payable)}</b>
                    </p>
                    <p>
                      Sales tax held separately: {money(math.tax)}. Business
                      processing fee expense: {money(math.businessFee)}.
                    </p>
                  </div>
                )}
                {mathError && <p className="finance-full">{mathError}</p>}
              </>
            ) : modal === 'financeEntry' && draft.kind === 'transfer' ? (
              <>
                {select(
                  'sourceAccount',
                  'From account',
                  [
                    { id: 'Cash', name: 'Cash on hand' },
                    { id: 'Bank account', name: 'Bank account' },
                  ].filter((a) => a.id !== draft.destinationAccount),
                )}
                {select(
                  'destinationAccount',
                  'To account',
                  [
                    { id: 'Cash', name: 'Cash on hand' },
                    { id: 'Bank account', name: 'Bank account' },
                  ].filter((a) => a.id !== draft.sourceAccount),
                )}
                {input('date', 'Transfer date', 'date')}
                {input('amount', 'Amount ($)', 'number', {
                  min: '.01',
                  step: '.01',
                })}
                {input('notes', 'Notes (optional)')}
                <p className="finance-full">
                  This records a transfer you made. It does not move money
                  through a bank.
                </p>
              </>
            ) : modal === 'consignmentPayout' ? (
              <>
                {select('consignorId', 'Consignor', owners, chooseOwner)}
                {input('amount', 'Payout amount ($)', 'number', {
                  min: '.01',
                  step: '.01',
                })}
                {input('date', 'Payout date', 'date')}
                {input('method', 'Payment method')}
                {input('reference', 'Payment reference')}
                {select(
                  'receiptId',
                  'Proof of payment (uploaded receipt)',
                  receipts,
                )}
                <div className="finance-full finance-calculation">
                  <strong>
                    Outstanding:{' '}
                    {money(consignmentBalance(w, draft.consignorId))}
                  </strong>
                  {sales
                    .filter(
                      (s) =>
                        s.consignorId === draft.consignorId &&
                        s.paid < s.payable,
                    )
                    .map((s) => (
                      <p key={s.id}>
                        <label>
                          <input
                            type="checkbox"
                            checked={
                              !draft.saleIds || draft.saleIds.includes(s.id)
                            }
                            disabled={review || busy}
                            onChange={(e) => {
                              const eligible = sales.filter(
                                (x) =>
                                  x.consignorId === draft.consignorId &&
                                  x.paid < x.payable,
                              )
                              const current =
                                draft.saleIds || eligible.map((x) => x.id)
                              const saleIds = e.target.checked
                                ? [...current, s.id]
                                : current.filter((id: string) => id !== s.id)
                              setDraft({
                                ...draft,
                                saleIds,
                                amount: eligible
                                  .filter((x) => saleIds.includes(x.id))
                                  .reduce(
                                    (sum, x) => sum + x.payable - x.paid,
                                    0,
                                  ),
                              })
                            }}
                          />{' '}
                          Include sale{' '}
                        </label>
                        {s.date} · {s.name} · {s.quantity} sold · sales{' '}
                        {money(s.merchandise)} · commission{' '}
                        {money(s.commission)} · remaining{' '}
                        {money(s.payable - s.paid)}
                      </p>
                    ))}
                  <p>
                    This records a payment you made; no money is transferred.
                    Payments cover oldest unpaid sales first. Remaining after
                    payout:{' '}
                    {money(
                      consignmentBalance(w, draft.consignorId) -
                        Number(draft.amount || 0),
                    )}
                  </p>
                </div>
              </>
            ) : modal === 'financeReconcile' ? (
              <>
                {input('date', 'Review date', 'date')}
                {input('amount', 'Verified amount ($)', 'number', {
                  min: 0,
                  step: '.01',
                })}
                {input('reference', 'Payment / statement reference checked')}
                {input('notes', 'Review notes')}
                <p className="finance-full">
                  Compare {draft.name} with your receipt or payment statement.
                  Confirmation saves a separate review record and preserves the
                  original transaction.
                </p>
              </>
            ) : modal === 'financeReverse' || modal === 'consignmentRefund' ? (
              <>
                {input('date', 'Correction date', 'date')}
                {input('reason', 'Why is this being reversed?')}
                <p className="finance-full">
                  Reverse {money(draft.amount)} for {draft.name}. The original
                  stays in the audit history. Receipt reversals remove received
                  stock at its current average cost and show any cost difference
                  as an adjustment. A consignment refund returns items and
                  reverses the original tax and commission. Record a replacement
                  afterward if needed.
                </p>
              </>
            ) : (
              <>
                {input('date', 'Date', 'date')}
                {input(
                  'name',
                  draft.kind === 'contribution' || draft.kind === 'draw'
                    ? 'Owner'
                    : 'Vendor / description',
                )}
                {input('amount', 'Amount ($)', 'number', {
                  min: '.01',
                  step: '.01',
                })}
                {input('method', 'Payment method')}
                {['expense', 'bill'].includes(draft.kind) && (
                  <>
                    {select(
                      'category',
                      'Category',
                      expenseCategories.map((c) => ({ id: c, name: c })),
                    )}
                    <Field label="Tax deductible">
                      <select
                        value={draft.deductible === false ? 'no' : 'yes'}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            deductible: e.target.value === 'yes',
                          })
                        }
                      >
                        <option value="yes">Yes</option>
                        <option value="no">No</option>
                      </select>
                    </Field>
                  </>
                )}
                {draft.kind === 'vendorPayment' &&
                  select(
                    'billId',
                    'Bill being paid',
                    transactions
                      .filter(
                        (t) =>
                          t.kind === 'bill' &&
                          !t.reversedBy &&
                          t.amount > (t.paid || 0),
                      )
                      .map((t) => ({
                        id: t.id,
                        name: `${t.name} · ${money(t.amount - (t.paid || 0))} unpaid`,
                      })),
                  )}
                {select('receiptId', 'Receipt attachment (optional)', receipts)}
                {input('notes', 'Notes')}
                {['expense', 'bill'].includes(draft.kind) && (
                  <details className="finance-full">
                    <summary>Split across categories (optional)</summary>
                    {(draft.splits || []).map((s: any, i: number) => (
                      <div className="finance-form-grid" key={i}>
                        <Field label="Split category">
                          <select
                            value={s.category}
                            onChange={(e) => {
                              setReview(false)
                              setDraft({
                                ...draft,
                                splits: draft.splits.map((x: any, j: number) =>
                                  j === i
                                    ? { ...x, category: e.target.value }
                                    : x,
                                ),
                              })
                            }}
                          >
                            {expenseCategories.map((c) => (
                              <option key={c}>{c}</option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Split amount ($)">
                          <input
                            type="number"
                            min=".01"
                            step=".01"
                            value={s.amount}
                            onChange={(e) => {
                              setReview(false)
                              setDraft({
                                ...draft,
                                splits: draft.splits.map((x: any, j: number) =>
                                  j === i
                                    ? { ...x, amount: e.target.value }
                                    : x,
                                ),
                              })
                            }}
                          />
                        </Field>
                        <button
                          className="btn secondary"
                          onClick={() => {
                            setReview(false)
                            setDraft({
                              ...draft,
                              splits: draft.splits.filter(
                                (_: any, j: number) => j !== i,
                              ),
                            })
                          }}
                        >
                          Remove split
                        </button>
                      </div>
                    ))}
                    <button
                      className="btn secondary"
                      onClick={() => {
                        setReview(false)
                        setDraft({
                          ...draft,
                          splits: [
                            ...(draft.splits || []),
                            { category: draft.category, amount: 0 },
                          ],
                        })
                      }}
                    >
                      Add category split
                    </button>
                    <p>Split amounts must equal the transaction amount.</p>
                  </details>
                )}
                <p className="finance-full">
                  {draft.kind === 'contribution'
                    ? 'This adds owner equity, not sales revenue.'
                    : draft.kind === 'draw'
                      ? 'This is an owner draw, not a business expense.'
                      : draft.kind === 'vendorPayment'
                        ? 'This reduces the bill balance, without counting the expense twice.'
                        : draft.kind === 'bill'
                          ? 'This records an unpaid bill. Record a vendor payment when you pay it.'
                          : 'Operating expenses stay separate from pantry inventory and recipe costs.'}
                </p>
              </>
            )}
          </div>
          {review && (
            <div className="finance-calculation">
              <strong>Ready to confirm</strong>
              <p>
                {draft.kind === 'transfer'
                  ? `Transfer from ${draft.sourceAccount || '—'} to ${draft.destinationAccount || '—'}`
                  : draft.name ||
                    items.find((i) => i.id === draft.itemId)?.name ||
                    owners.find((o) => o.id === draft.consignorId)?.name}{' '}
                · {draft.date}{' '}
                {draft.amount ? `· ${money(Number(draft.amount))}` : ''}
              </p>
              <p>
                Confirmation saves a permanent activity record
                {[
                  'consignorSave',
                  'consignmentReceive',
                  'financeReconcile',
                ].includes(modal)
                  ? '.'
                  : ' and balanced accounting entry.'}
              </p>
            </div>
          )}
          <div className="finance-sticky-actions">
            <button
              className="btn secondary"
              disabled={busy}
              onClick={() => setModal('')}
            >
              Cancel
            </button>
            {review ? (
              <>
                <button
                  className="btn secondary"
                  disabled={busy}
                  onClick={() => setReview(false)}
                >
                  Edit details
                </button>
                <button
                  className="btn"
                  disabled={busy || !canWrite}
                  onClick={() => void run(modal, draft)}
                >
                  <Check size={17} />
                  {busy
                    ? 'Saving…'
                    : modal === 'consignmentPayout' ||
                        draft.kind === 'vendorPayment'
                      ? 'Confirm payment record'
                      : 'Confirm & post'}
                </button>
              </>
            ) : (
              <button
                className="btn"
                disabled={
                  busy || !canWrite || (modal === 'consignmentSale' && !math)
                }
                onClick={() => setReview(true)}
              >
                Review <ArrowRight size={17} />
              </button>
            )}
          </div>
        </DialogContent>
      </Dialog>
      {receipt && (
        <ReceiptReview
          receipt={receipt}
          localFile={localReceiptFile}
          workspace={w}
          onWorkspace={onWorkspace}
          busy={busy}
          canWrite={canWrite}
          onCreatePantryItem={onCreatePantryItem}
          error={error}
          onRetryUpload={
            localReceiptFile ? () => void upload(localReceiptFile) : undefined
          }
          onClose={() => {
            if (!busy) setReceipt(null)
          }}
          onSave={async (action, data) => {
            if (action === 'receiptExtract') {
              if (saving.current || !canWrite) return
              saving.current = true
              setBusy(true)
              setError('')
              const id = data.id
              try {
                // Commit current corrections before the provider wait. Never replace them silently.
                await request('receiptDraft', data)
                setReceipt(
                  (r) => r && { ...r, ...data, extractionStatus: 'processing' },
                )
                const result = await request('receiptExtract', {
                  id,
                  preserveEdits: true,
                })
                const next = result.receipt_extractions.find((r) => r.id === id)
                if (next) setReceipt(next)
                return result
              } catch (e) {
                setError(
                  e instanceof Error
                    ? e.message
                    : 'Reading failed. Your entries are preserved.',
                )
                setReceipt(
                  (r) => r && { ...r, ...data, extractionStatus: 'failed' },
                )
              } finally {
                saving.current = false
                setBusy(false)
              }
              return
            }
            const result = await run(
              action,
              data,
              ['receiptPost', 'receiptCancel', 'receiptMatch'].includes(action),
            )
            const next = result?.receipt_extractions.find(
              (r) => r.id === data.id,
            )
            if (
              next &&
              !['receiptPost', 'receiptCancel', 'receiptMatch'].includes(action)
            )
              setReceipt(next)
            return result
          }}
        />
      )}
      <Dialog
        open={!!statement}
        onOpenChange={(v) => {
          if (!v) setStatement(null)
        }}
      >
        <DialogContent className="finance-dialog finance-statement">
          <DialogHeader>
            <DialogTitle>Consignment payout statement</DialogTitle>
            <DialogDescription>
              Payment record and itemized payout allocation.
            </DialogDescription>
          </DialogHeader>
          {statement && (
            <>
              <div className="finance-print-document">
                <h2>{w.settings[0]?.name || 'Cottage Pantry'}</h2>
                <h3>{statement.consignorSnapshot?.name || statement.name}</h3>
                <p>
                  Payout {statement.date} · {statement.method} · Reference:{' '}
                  {statement.reference || '—'}
                </p>
                <p>
                  Period: {statement.allocations?.[0]?.date} –{' '}
                  {statement.allocations?.at(-1)?.date}
                </p>
                <div className="finance-statement-table">
                  <table>
                    <thead>
                      <tr>
                        {[
                          'Date',
                          'Item',
                          'Qty',
                          'Gross',
                          'Discounts / refunds',
                          'Commission',
                          'Deductions / fees',
                          'Paid now',
                        ].map((h) => (
                          <th key={h}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {statement.allocations?.map((s: any) => (
                        <tr key={s.id}>
                          <td>{s.date}</td>
                          <td>{s.name}</td>
                          <td>{s.quantity}</td>
                          <td>{money(s.gross)}</td>
                          <td>{money(s.discounts + s.refunds)}</td>
                          <td>
                            {money(s.commission)} (
                            {s.commissionType === 'fixed'
                              ? money(s.commissionRate) + '/item'
                              : s.commissionRate + '%'}
                            )
                          </td>
                          <td>{money(s.deductions + s.consignorFee)}</td>
                          <td>{money(s.applied)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <h3>Total payout: {money(statement.amount)}</h3>
                <p>
                  Remaining balance at payout:{' '}
                  {money(statement.remainingBalance)}
                </p>
              </div>
              <div className="button-row finance-no-print">
                <button className="btn" onClick={() => window.print()}>
                  Print / save PDF
                </button>
                <button
                  className="btn secondary"
                  onClick={() =>
                    exportRows('payout-statement', statement.allocations)
                  }
                >
                  Download CSV
                </button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!journal}
        onOpenChange={(v) => {
          if (!v) setJournal(null)
        }}
      >
        <DialogContent className="finance-dialog">
          <DialogHeader>
            <DialogTitle>{journal?.name || 'Journal details'}</DialogTitle>
            <DialogDescription>
              Accountant view · posted records are preserved. Corrections use
              separate reversing entries.
            </DialogDescription>
          </DialogHeader>
          {journal && (
            <>
              <p>
                {journal.date} · Source {journal.sourceId || journal.id}
              </p>
              <table>
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Debit</th>
                    <th>Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {journal.lines?.map((l: any, i: number) => (
                    <tr key={i}>
                      <td>{l.account}</td>
                      <td>{money(l.debit)}</td>
                      <td>{money(l.credit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
function ReceiptReview({
  receipt: initial,
  localFile,
  workspace: w,
  onWorkspace,
  busy,
  canWrite,
  error,
  onClose,
  onSave,
  onRetryUpload,
}: {
  receipt: Item
  onRetryUpload?: () => void
  onWorkspace?: (w: Workspace) => void
  localFile?: File | null
  workspace: Workspace
  busy: boolean
  canWrite: boolean
  error: string
  onClose: () => void
  onSave: (action: string, data: any) => Promise<any>
  onCreatePantryItem?: (kind: 'ingredient' | 'packaging') => void
}) {
  const createdSelection = useRef<Item | null>(null)
  const [creatingLine, setCreatingLine] = useState<number | null>(null)
  const [r, setR] = useState<Item>(() => ({
      ...structuredClone(initial),
      receivedDate: initial.receivedDate || ovenToday(w.settings[0]),
    })),
    [active, setActive] = useState(-1),
    [zoom, setZoom] = useState(1),
    [rotation, setRotation] = useState(0),
    [crop, setCrop] = useState(false),
    [matchId, setMatchId] = useState(''),
    [itemSearch, setItemSearch] = useState<Record<number, string>>({}),
    [importBusy, setImportBusy] = useState(false)
  // An upload may finish after the review panel opens.
  const [version, setVersion] = useState(
    initial.id + ':' + initial.updatedAt + ':' + initial.extractionStatus,
  )
  if (
    initial.id + ':' + initial.updatedAt + ':' + initial.extractionStatus !==
    version
  ) {
    setVersion(
      initial.id + ':' + initial.updatedAt + ':' + initial.extractionStatus,
    )
    setR({
      ...structuredClone(initial),
      receivedDate: initial.receivedDate || ovenToday(w.settings[0]),
    })
  }
  const inventoryItems = purchasableInventory(w)
  const matchedItem = (l: any) =>
    inventoryItems.find(
      (x) =>
        x.id === l.itemId && x.itemTable === (l.itemTable || 'ingredients'),
    )
  const patchLine = (index: number, patch: Record<string, any>) =>
    setR((old) => ({
      ...old,
      lines: old.lines.map((l: any, n: number) =>
        n === index ? { ...l, ...patch } : l,
      ),
    }))
  const closed = r.status !== 'draft',
    lines = r.lines || [],
    duplicates = duplicateReceipts(w, r)
  const update = (key: string, v: any) => setR({ ...r, [key]: v })
  const line = (index: number, key: string, v: any) =>
    setR({
      ...r,
      lines: lines.map((l: any, i: number) =>
        i === index ? { ...l, [key]: v } : l,
      ),
    })
  const pdf = r.previewMime === 'application/pdf',
    heic = r.previewMime === 'image/heic'
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v) onClose()
      }}
    >
      <DialogContent className="receipt-review-dialog">
        <DialogHeader>
          <DialogTitle>
            {closed ? 'Receipt record' : 'Review receipt'}
          </DialogTitle>
          <DialogDescription>
            {closed
              ? 'The original file and confirmed values are preserved.'
              : 'Check extracted fields, decide what each line is for, and confirm when ready.'}
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="finance-feedback error">
            {error}
          </p>
        )}
        <div className="receipt-review-grid">
          <section className="receipt-preview">
            <div className="button-row">
              <button
                className="btn secondary"
                aria-label="Zoom out"
                onClick={() => setZoom(Math.max(0.5, zoom - 0.25))}
              >
                <ZoomOut size={17} />
              </button>
              <span>{Math.round(zoom * 100)}%</span>
              <button
                className="btn secondary"
                aria-label="Zoom in"
                onClick={() => setZoom(Math.min(3, zoom + 0.25))}
              >
                <ZoomIn size={17} />
              </button>
              <button
                className="btn secondary"
                disabled={pdf || heic}
                onClick={() => setRotation(rotation + 90)}
              >
                <RotateCw size={17} />
                Rotate
              </button>
              <button
                className="btn secondary"
                disabled={pdf || heic}
                onClick={() => setCrop(!crop)}
              >
                <Crop size={17} />
                {crop ? 'Full view' : 'Crop preview'}
              </button>
            </div>
            {crop && !pdf && !heic && (
              <div className="finance-form-grid">
                {['Top', 'Right', 'Bottom', 'Left'].map((side, index) => (
                  <Field key={side} label={side + ' crop (%)'}>
                    <input
                      type="range"
                      min="0"
                      max="40"
                      value={(r.previewCrop || [8, 8, 8, 8])[index]}
                      onChange={(e) =>
                        update(
                          'previewCrop',
                          (r.previewCrop || [8, 8, 8, 8]).map(
                            (v: number, i: number) =>
                              i === index ? Number(e.target.value) : v,
                          ),
                        )
                      }
                    />
                  </Field>
                ))}
              </div>
            )}
            <div className="receipt-preview-scroll">
              {!r.fileHash ? (
                <p>Manual receipt. No source file attached.</p>
              ) : (
                <ReceiptDocumentPreview
                  id={r.id}
                  localFile={localFile}
                  zoom={zoom}
                  rotation={rotation}
                  crop={crop ? r.previewCrop || [8, 8, 8, 8] : undefined}
                  highlight={active >= 0 ? lines[active] : undefined}
                />
              )}
            </div>
            <small>
              Preview controls do not alter your saved original.
              {active >= 0 && !lines[active]?.bbox
                ? ' This extracted line has no position data to highlight.'
                : ''}
            </small>
          </section>
          <section className="receipt-fields">
            {r.extractionMessage && (
              <p className="finance-feedback">{r.extractionMessage}</p>
            )}
            {r.pendingExtraction && (
              <div className="finance-feedback">
                <strong>Review replacement values</strong>
                <p>
                  Your current entries stay in place until you explicitly apply
                  the replacement. Saving a draft first preserves your
                  corrections in history.
                </p>
                <pre style={{ whiteSpace: 'pre-wrap' }}>
                  {JSON.stringify(r.pendingExtraction, null, 2)}
                </pre>
                <button
                  className="btn secondary"
                  disabled={busy}
                  onClick={() =>
                    void (async () => {
                      const result = await onSave('receiptDraft', r)
                      const saved = result?.receipt_extractions.find(
                        (item: Item) => item.id === r.id,
                      )
                      if (saved)
                        await onSave('receiptApplyExtraction', {
                          id: r.id,
                          updatedAt: saved.updatedAt,
                        })
                    })()
                  }
                >
                  Apply replacement values
                </button>
                <button
                  className="btn secondary"
                  disabled={busy}
                  onClick={() =>
                    void (async () => {
                      const result = await onSave('receiptDraft', r)
                      if (result)
                        await onSave('receiptDismissExtraction', { id: r.id })
                    })()
                  }
                >
                  Keep my edits
                </button>
              </div>
            )}
            <p role="status">{receiptReadingLabel(r)}</p>
            {r.extractionStatus === 'upload_failed' && (
              <p>
                Your file is still available in this panel but has not been
                saved.{' '}
                <button
                  className="btn secondary"
                  disabled={busy}
                  onClick={onRetryUpload}
                >
                  Retry upload
                </button>
              </p>
            )}
            {!closed && r.fileHash && r.id !== 'uploading' && (
              <div className="button-row">
                <button
                  className="btn secondary"
                  disabled={
                    busy ||
                    !canWrite ||
                    w.settings[0]?.receiptReading?.enabled === false
                  }
                  onClick={() => void onSave('receiptExtract', r)}
                >
                  {['failed', 'not_configured', 'partial'].includes(
                    r.extractionStatus,
                  )
                    ? 'Retry reading'
                    : 'Read receipt again'}
                </button>
                <span>
                  Manual entry stays available. Retrying preserves corrections.
                </span>
              </div>
            )}
            {w.settings[0]?.receiptReading?.enabled === false && (
              <p>
                Receipt reading is unavailable. Enter details manually; your
                original is saved.
              </p>
            )}
            {r.lastReadSummary && (
              <p className="finance-feedback">
                {r.lastReadSummary.pageCount} page(s) inspected ·{' '}
                {r.lastReadSummary.processingMethod === 'embedded_text'
                  ? 'Embedded text'
                  : 'Text and document OCR'}
                {r.lastReadSummary.unverifiedPages?.length
                  ? ` · Review page(s) ${r.lastReadSummary.unverifiedPages.join(', ')}`
                  : ''}
                . {r.lastReadSummary.warnings?.join(' ')}
              </p>
            )}
            <p>
              Added at:{' '}
              {ovenTimestamp(
                r.addedAt || r.createdAt || r.history?.[0]?.at,
                w.settings[0],
              )}
            </p>
            <div className="finance-form-grid">
              {[
                ['vendor', 'Vendor', 'text'],
                ['date', 'Purchase date', 'date'],
                ['receivedDate', 'Received date', 'date'],
                ['receiptNumber', 'Receipt / invoice number', 'text'],
                ['currency', 'Printed currency (ISO code, optional)', 'text'],
                [
                  'discounts',
                  'Printed discounts (already reflected in subtotal)',
                  'number',
                ],
                ['subtotal', 'Subtotal after discounts ($)', 'number'],
                ['tax', 'Sales tax paid ($)', 'number'],
                ['otherCharges', 'Other charges ($, optional)', 'number'],
                ['total', 'Total paid ($)', 'number'],
                [
                  'adjustment',
                  'Explicit rounding / adjustment ($, signed)',
                  'number',
                ],
                ['adjustmentReason', 'Adjustment explanation', 'text'],
                ['method', 'Payment method', 'text'],
              ].map(([key, label, type]) => (
                <Field key={key} label={label}>
                  <input
                    type={type}
                    aria-label={label}
                    value={r[key] ?? ''}
                    disabled={closed || busy || r.id === 'uploading'}
                    step={type === 'number' ? '.01' : undefined}
                    min={
                      type === 'number' && key !== 'adjustment' ? 0 : undefined
                    }
                    onChange={(e) => update(key, e.target.value)}
                  />
                  {!closed && (
                    <>
                      <Badge confidence={r.confidence?.[key]} />
                      <small>
                        {r.extractionSnapshot?.[key] != null &&
                        String(r[key]) === String(r.extractionSnapshot[key])
                          ? 'Read from document · verify against original'
                          : 'Owner entry / correction'}
                      </small>
                    </>
                  )}
                </Field>
              ))}
            </div>
            <div className="panel-heading">
              <div>
                <h3>Receipt lines</h3>
                <p>
                  Split a line by adjusting its amount and adding another. Line
                  amounts must total the subtotal.
                </p>
              </div>
              {!closed && (
                <button
                  className="btn secondary"
                  disabled={busy}
                  onClick={() => update('lines', [...lines, freshLine()])}
                >
                  <Plus size={16} />
                  Add line
                </button>
              )}
            </div>
            {lines.map((l: any, i: number) => (
              <div
                className={'receipt-line ' + (active === i ? 'selected' : '')}
                key={i}
                onFocus={() => setActive(i)}
              >
                <div className="panel-heading">
                  <button
                    className="btn secondary"
                    onClick={() => setActive(i)}
                  >
                    Line {i + 1} · show on receipt
                  </button>
                  <Badge confidence={l.confidence} />
                  {!closed && (
                    <button
                      className="btn secondary"
                      disabled={busy}
                      onClick={() => {
                        const half = Math.round(Number(l.amount) * 50) / 100
                        update(
                          'lines',
                          lines.flatMap((x: any, j: number) =>
                            j === i
                              ? [
                                  {
                                    ...x,
                                    amount: half,
                                    quantity:
                                      x.quantity == null || x.quantity === ''
                                        ? null
                                        : Number(x.quantity) / 2,
                                    stockQuantityConfirmed: false,
                                  },
                                  {
                                    ...x,
                                    amount:
                                      Math.round(
                                        (Number(x.amount) - half) * 100,
                                      ) / 100,
                                    quantity:
                                      x.quantity == null || x.quantity === ''
                                        ? null
                                        : Number(x.quantity) / 2,
                                    stockQuantityConfirmed: false,
                                    decision: '',
                                  },
                                ]
                              : [x],
                          ),
                        )
                      }}
                    >
                      Split line
                    </button>
                  )}
                  {!closed && (
                    <button
                      className="btn secondary"
                      aria-label={'Remove line ' + (i + 1)}
                      disabled={busy}
                      onClick={() =>
                        update(
                          'lines',
                          lines.filter((_: any, j: number) => j !== i),
                        )
                      }
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>
                <div className="finance-form-grid">
                  <Field label="Description">
                    <input
                      disabled={closed || busy || r.id === 'uploading'}
                      value={l.description}
                      onChange={(e) => line(i, 'description', e.target.value)}
                    />
                  </Field>
                  <Field label="Line total before receipt tax ($)">
                    <input
                      type="number"
                      min="0"
                      step=".01"
                      disabled={closed || busy || r.id === 'uploading'}
                      value={l.amount ?? ''}
                      onChange={(e) => line(i, 'amount', e.target.value)}
                    />
                  </Field>
                  <Field label="Printed purchase count">
                    <input
                      type="number"
                      min="0"
                      step="any"
                      disabled={closed || busy || r.id === 'uploading'}
                      value={l.printedQuantity ?? ''}
                      onChange={(e) =>
                        line(i, 'printedQuantity', e.target.value)
                      }
                    />
                  </Field>
                  <Field label="Printed purchase unit">
                    <input
                      disabled={closed || busy || r.id === 'uploading'}
                      value={l.printedUnit ?? ''}
                      onChange={(e) => line(i, 'printedUnit', e.target.value)}
                    />
                  </Field>
                  <Field label="Printed unit price">
                    <input
                      type="number"
                      min="0"
                      step=".01"
                      disabled={closed || busy || r.id === 'uploading'}
                      value={l.unitPrice ?? ''}
                      onChange={(e) => line(i, 'unitPrice', e.target.value)}
                    />
                  </Field>
                  <Field label="Printed line discount">
                    <input
                      type="number"
                      min="0"
                      step=".01"
                      disabled={closed || busy || r.id === 'uploading'}
                      value={l.discounts ?? ''}
                      onChange={(e) => line(i, 'discounts', e.target.value)}
                    />
                  </Field>
                  <Field label="What is this for?">
                    <select
                      disabled={closed || busy || r.id === 'uploading'}
                      value={l.decision}
                      onChange={(e) => line(i, 'decision', e.target.value)}
                    >
                      <option value="">Review and choose…</option>
                      <option value="inventory">
                        Receive / match inventory item
                      </option>
                      <option value="expense">
                        Other expense · exclude from inventory
                      </option>
                      <option value="personal">
                        Personal / non-business (owner draw)
                      </option>
                    </select>
                  </Field>
                  {l.suggestedDecision && !closed && (
                    <p>
                      {l.suggestionSource === 'name'
                        ? 'Suggested name match — review'
                        : 'Previously confirmed match'}
                      :{' '}
                      {l.suggestedDecision === 'inventory'
                        ? inventoryItems.find((x) => x.id === l.suggestedItemId)
                            ?.name
                        : l.suggestedCategory}
                      .{' '}
                      <button
                        className="btn secondary"
                        onClick={() =>
                          setR({
                            ...r,
                            lines: lines.map((x: any, j: number) =>
                              j === i
                                ? {
                                    ...x,
                                    decision: l.suggestedDecision,
                                    itemId: l.suggestedItemId,
                                    itemTable:
                                      l.suggestedItemTable || 'ingredients',
                                    category: l.suggestedCategory || l.category,
                                  }
                                : x,
                            ),
                          })
                        }
                      >
                        Use suggestion
                      </button>
                    </p>
                  )}
                  {l.decision === 'inventory' && (
                    <>
                      <Field label="Search inventory items">
                        <input
                          disabled={closed || busy}
                          value={itemSearch[i] || ''}
                          onChange={(e) =>
                            setItemSearch((old) => ({
                              ...old,
                              [i]: e.target.value,
                            }))
                          }
                          placeholder="Search name, variant, SKU or type"
                        />
                      </Field>
                      <Field label="Match inventory item">
                        <select
                          disabled={closed || busy || r.id === 'uploading'}
                          value={
                            l.createNew
                              ? 'new'
                              : l.itemId
                                ? `${l.itemTable || 'ingredients'}:${l.itemId}`
                                : ''
                          }
                          onChange={(e) => {
                            if (e.target.value === 'new') {
                              setCreatingLine(i)
                              return
                            }
                            const chosen = inventoryItems.find(
                              (x) =>
                                `${x.itemTable}:${x.id}` === e.target.value,
                            )
                            patchLine(i, {
                              createNew: e.target.value === 'new',
                              itemCreationId: crypto.randomUUID(),
                              itemId: chosen?.id || '',
                              itemTable: chosen?.itemTable || 'ingredients',
                              quantity: null,
                              stockQuantityConfirmed: false,
                              unit: chosen?.storageUnit || chosen?.unit || '',
                              packageContentsConfirmed: false,
                            })
                          }}
                        >
                          <option value="">
                            Choose an existing inventory item…
                          </option>
                          <option value="new">
                            Create new inventory item…
                          </option>
                          {inventoryGroups.map(({ kind, label }) => (
                            <optgroup key={kind} label={label}>
                              {inventoryItems
                                .filter(
                                  (x) =>
                                    x.inventoryKind === kind &&
                                    (x.id === l.itemId ||
                                      `${x.name} ${x.variant || ''} ${x.sku || ''} ${label}`
                                        .toLowerCase()
                                        .includes(
                                          (itemSearch[i] || '').toLowerCase(),
                                        )),
                                )
                                .map((x) => (
                                  <option
                                    key={`${x.itemTable}:${x.id}`}
                                    value={`${x.itemTable}:${x.id}`}
                                  >
                                    {x.name}
                                    {x.variant ? ` · ${x.variant}` : ''}
                                    {x.sku ? ` · SKU ${x.sku}` : ''} · {label}
                                  </option>
                                ))}
                            </optgroup>
                          ))}
                          {l.itemId && !matchedItem(l) && (
                            <option
                              value={`${l.itemTable || 'ingredients'}:${l.itemId}`}
                            >
                              Saved item unavailable — reload the Oven before
                              posting
                            </option>
                          )}
                        </select>
                      </Field>
                      {!l.createNew && matchedItem(l) && !closed && (
                        <details className="finance-full">
                          <summary>
                            Use saved supplier URL / update product details
                          </summary>
                          <ProductLinkImport
                            settings={w.settings[0]}
                            draft={{ ...matchedItem(l), ...l.productDetails }}
                            existing
                            onWorkspace={(updated) => onWorkspace?.(updated)}
                            onBusyChange={setImportBusy}
                            apply={(patch) =>
                              patchLine(i, {
                                productDetails: {
                                  ...l.productDetails,
                                  ...patch,
                                },
                              })
                            }
                          />
                        </details>
                      )}
                      {l.createNew && (
                        <>
                          <Field label="New item type">
                            <select
                              disabled={closed || busy}
                              value={l.usedAs || 'ingredient'}
                              onChange={(e) =>
                                patchLine(i, {
                                  usedAs: e.target.value,
                                  itemTable:
                                    e.target.value === 'resale'
                                      ? 'products'
                                      : 'ingredients',
                                  unit: '',
                                  stockQuantityConfirmed: false,
                                })
                              }
                            >
                              {inventoryGroups.map(({ kind, label }) => (
                                <option key={kind} value={kind}>
                                  {label}
                                </option>
                              ))}
                            </select>
                          </Field>
                          {!closed && (
                            <div className="finance-full">
                              <ProductLinkImport
                                settings={w.settings[0]}
                                draft={{
                                  ...l,
                                  name: l.description,
                                  workflow:
                                    l.usedAs === 'resale'
                                      ? 'resale'
                                      : undefined,
                                }}
                                onWorkspace={(updated) =>
                                  onWorkspace?.(updated)
                                }
                                onBusyChange={setImportBusy}
                                apply={(patch) => {
                                  const { name, ...details } = patch
                                  patchLine(i, {
                                    ...details,
                                    ...(name ? { description: name } : {}),
                                  })
                                }}
                              />
                              <InventoryProductFields
                                value={l}
                                change={(key, value) => line(i, key, value)}
                              />
                            </div>
                          )}
                          {l.usedAs === 'resale' && (
                            <>
                              <Field label="Internal SKU (optional)">
                                <input
                                  value={l.sku || ''}
                                  disabled={closed || busy}
                                  onChange={(e) =>
                                    line(i, 'sku', e.target.value)
                                  }
                                />
                              </Field>
                              <Field label="Retail selling price (optional; never inferred)">
                                <input
                                  type="number"
                                  value={l.retailPrice ?? ''}
                                  disabled={closed || busy}
                                  onChange={(e) =>
                                    line(i, 'retailPrice', e.target.value)
                                  }
                                />
                              </Field>
                            </>
                          )}
                          {l.usedAs === 'material' && (
                            <>
                              <Field label="Material type">
                                <select
                                  value={l.materialType || 'other'}
                                  disabled={closed || busy}
                                  onChange={(e) =>
                                    patchLine(i, {
                                      materialType: e.target.value,
                                      fabricTracking: 'length',
                                      pieceMode: 'aggregate',
                                    })
                                  }
                                >
                                  <option value="other">Other</option>
                                  <option value="fabric">Fabric</option>
                                  <option value="yarn">Yarn</option>
                                </select>
                              </Field>
                              {l.materialType === 'fabric' && (
                                <div className="finance-full">
                                  <FabricFields
                                    value={l}
                                    change={(key, value) => line(i, key, value)}
                                  />
                                </div>
                              )}
                            </>
                          )}
                          <p className="finance-full">
                            Create an empty item and match it to this line, or
                            create it when confirming the receipt. Other matches
                            stay in this draft. Stock is received only on
                            confirmation.
                          </p>
                          {!closed && (
                            <button
                              className="btn secondary"
                              disabled={busy || importBusy}
                              onClick={() =>
                                void onSave('receiptCreateItem', {
                                  ...r,
                                  lineIndex: i,
                                })
                              }
                            >
                              Create item and match line
                            </button>
                          )}
                        </>
                      )}
                      {(l.itemTable === 'products' ||
                        (l.createNew && l.usedAs === 'resale')) && (
                        <>
                          {l.unit && l.unit !== 'each' && (
                            <>
                              <Field label="Items per purchase package">
                                <input
                                  type="number"
                                  min="1"
                                  step="1"
                                  disabled={closed || busy}
                                  value={l.itemsPerUnit ?? ''}
                                  onChange={(e) =>
                                    patchLine(i, {
                                      itemsPerUnit: e.target.value,
                                      packageContentsConfirmed: false,
                                    })
                                  }
                                />
                              </Field>
                              <label className="finance-full">
                                <input
                                  type="checkbox"
                                  disabled={closed || busy}
                                  checked={l.packageContentsConfirmed === true}
                                  onChange={(e) =>
                                    line(
                                      i,
                                      'packageContentsConfirmed',
                                      e.target.checked,
                                    )
                                  }
                                />{' '}
                                I confirmed the items in each purchase package.
                              </label>
                            </>
                          )}
                          <p className="finance-full" role="status">
                            {l.quantity || '—'} {l.unit || 'purchase units'} ×{' '}
                            {l.unit === 'each' ? 1 : l.itemsPerUnit || '—'}{' '}
                            items ={' '}
                            {l.quantity && (l.unit === 'each' || l.itemsPerUnit)
                              ? Number(l.quantity) *
                                (l.unit === 'each' ? 1 : Number(l.itemsPerUnit))
                              : '—'}{' '}
                            sellable units. Retail selling price stays
                            unchanged.
                          </p>
                        </>
                      )}
                      <Field label="Actual quantity received">
                        <input
                          type="text"
                          value={l.quantity ?? ''}
                          disabled={closed || busy || r.id === 'uploading'}
                          onChange={(e) => line(i, 'quantity', e.target.value)}
                        />
                      </Field>
                      <Field label="Unit received">
                        <select
                          value={l.unit}
                          disabled={closed || busy || r.id === 'uploading'}
                          onChange={(e) => line(i, 'unit', e.target.value)}
                        >
                          <option value="">Confirm stock unit…</option>
                          {(l.itemTable === 'products' ||
                          (l.createNew && l.usedAs === 'resale')
                            ? ['each', 'pack', 'case', 'box', 'bundle']
                            : isFabric(l.createNew ? l : matchedItem(l))
                              ? [
                                  ...fabricUnitOptions(
                                    (l.createNew ? l : matchedItem(l))
                                      ?.fabricTracking,
                                  ),
                                  ...((l.createNew ? l : matchedItem(l))
                                    ?.fabricTracking === 'length'
                                    ? ['bolt', 'roll']
                                    : []),
                                ]
                              : Object.keys(
                                  ingredientUnits(
                                    w.ingredients.find(
                                      (item) => item.id === l.itemId,
                                    )?.conversions,
                                  ),
                                )
                          ).map((u) => (
                            <option key={u} value={u}>
                              {unitLabel(u)}
                            </option>
                          ))}
                        </select>
                      </Field>
                      {isFabric(l.createNew ? l : matchedItem(l)) && (
                        <>
                          <p className="finance-full">
                            Fabric:{' '}
                            {(l.createNew ? l : matchedItem(l))?.fabricWidth}{' '}
                            {(l.createNew ? l : matchedItem(l))?.widthUnit}{' '}
                            wide. Different widths or separate pieces need their
                            own Craft Materials record before matching.
                          </p>
                          {['bolt', 'roll'].includes(l.unit) && (
                            <>
                              <Field label="Usable length per bolt / roll">
                                <input
                                  value={l.usableLength ?? ''}
                                  disabled={closed || busy}
                                  onChange={(e) =>
                                    line(i, 'usableLength', e.target.value)
                                  }
                                />
                              </Field>
                              <Field label="Usable length unit">
                                <select
                                  value={l.usableLengthUnit || ''}
                                  disabled={closed || busy}
                                  onChange={(e) =>
                                    line(i, 'usableLengthUnit', e.target.value)
                                  }
                                >
                                  <option value="">Confirm length unit…</option>
                                  {fabricUnitOptions('length').map((u) => (
                                    <option key={u}>{u}</option>
                                  ))}
                                </select>
                              </Field>
                              <label className="finance-full">
                                <input
                                  type="checkbox"
                                  disabled={closed || busy}
                                  checked={l.lengthConfirmed === true}
                                  onChange={(e) =>
                                    line(i, 'lengthConfirmed', e.target.checked)
                                  }
                                />{' '}
                                I confirmed the usable length per bolt / roll.
                              </label>
                            </>
                          )}
                        </>
                      )}
                      <Field label="Lot (optional)">
                        <input
                          value={l.lot || ''}
                          disabled={closed || busy || r.id === 'uploading'}
                          onChange={(e) => line(i, 'lot', e.target.value)}
                        />
                      </Field>
                      <Field label="Expiration (optional)">
                        <input
                          type="date"
                          value={l.expires || ''}
                          disabled={closed || busy || r.id === 'uploading'}
                          onChange={(e) => line(i, 'expires', e.target.value)}
                        />
                      </Field>
                      <label className="finance-full">
                        <input
                          type="checkbox"
                          disabled={closed || busy || r.id === 'uploading'}
                          checked={!!l.stockQuantityConfirmed}
                          onChange={(e) =>
                            line(i, 'stockQuantityConfirmed', e.target.checked)
                          }
                        />{' '}
                        I confirmed the received quantity and stock unit,
                        including package contents where applicable.
                      </label>
                      <p className="finance-full">
                        Use the actual purchased quantity, not the OCR package
                        count. Receipt tax is allocated proportionally to line
                        cost. Current stock cost uses a weighted average; prior
                        costs stay in history.
                      </p>
                    </>
                  )}
                  {l.decision === 'expense' && (
                    <Field label="Expense category">
                      <select
                        value={l.category}
                        disabled={closed || busy || r.id === 'uploading'}
                        onChange={(e) => line(i, 'category', e.target.value)}
                      >
                        {expenseCategories.map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </select>
                    </Field>
                  )}
                </div>
              </div>
            ))}
            <details>
              <summary>View calculation & history</summary>
              <p>
                Line subtotal:{' '}
                {receiptDifferences(r).lineTotal == null
                  ? 'Unknown'
                  : money(receiptDifferences(r).lineTotal!)}{' '}
                · Tax:{' '}
                {r.tax == null || r.tax === ''
                  ? 'Unknown'
                  : money(Number(r.tax))}{' '}
                · Total:{' '}
                {r.total == null || r.total === ''
                  ? 'Unknown'
                  : money(Number(r.total))}
              </p>
              <p>
                Line/subtotal difference:{' '}
                {receiptDifferences(r).subtotalDifference == null
                  ? 'Enter missing amounts'
                  : money(receiptDifferences(r).subtotalDifference!)}{' '}
                · Receipt total difference:{' '}
                {receiptDifferences(r).totalDifference == null
                  ? 'Enter missing amounts'
                  : money(receiptDifferences(r).totalDifference!)}
              </p>
              {r.postedLines?.map((l: any, i: number) => (
                <p key={i}>
                  {l.description}: {money(l.postedAmount)} · allocated tax{' '}
                  {money(l.taxShare)} · other charges{' '}
                  {money(l.otherChargesShare ?? 0)}{' '}
                  {l.normalizedQuantity
                    ? `· received ${l.normalizedQuantity} base units · previous unit cost ${l.priorCost} → ${l.newCost}`
                    : ''}
                </p>
              ))}
              {r.history?.map((h: any, i: number) => (
                <p key={i}>
                  {h.action} · {h.at}
                </p>
              ))}
            </details>
            {!closed && (
              <details>
                <summary>Attach to an existing purchase instead</summary>
                <p>
                  This links the original receipt without changing inventory or
                  posting another transaction. Save your draft first.
                </p>
                <label>
                  Existing purchase
                  <select
                    value={matchId}
                    onChange={(e) => setMatchId(e.target.value)}
                  >
                    <option value="">Choose a purchase</option>
                    {(w.finance_transactions || [])
                      .filter(
                        (t) =>
                          ['expense', 'bill'].includes(t.kind) &&
                          !t.reversedBy &&
                          !t.receiptId,
                      )
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} · {t.date} · {money(t.amount)}
                        </option>
                      ))}
                  </select>
                </label>
                <button
                  className="btn secondary"
                  disabled={busy || !canWrite || !matchId}
                  onClick={() =>
                    void onSave('receiptMatch', {
                      id: r.id,
                      transactionId: matchId,
                    })
                  }
                >
                  Confirm attachment only
                </button>
              </details>
            )}
            {duplicates.length > 0 && (
              <div className="finance-feedback">
                <strong>Possible duplicate receipt</strong>
                {duplicates.map((d) => (
                  <p key={d.id}>
                    {d.vendor || d.name} · {d.date} · {money(d.total)} ·{' '}
                    {d.status}
                  </p>
                ))}
                {!closed && (
                  <label>
                    <input
                      type="checkbox"
                      checked={!!r.duplicateReviewed}
                      onChange={(e) =>
                        update('duplicateReviewed', e.target.checked)
                      }
                    />{' '}
                    I reviewed these matches. Posted duplicates cannot be posted
                    again.
                  </label>
                )}
              </div>
            )}
          </section>
        </div>
        {!closed &&
          ((receiptDifferences(r).subtotalDifference ?? 0) !== 0 ||
            (receiptDifferences(r).totalDifference ?? 0) !== 0) && (
            <p role="alert" className="finance-feedback error">
              Amounts need review. Line/subtotal difference:{' '}
              {receiptDifferences(r).subtotalDifference == null
                ? 'unknown'
                : money(receiptDifferences(r).subtotalDifference!)}
              . Subtotal + tax + charges + adjustment / total difference:{' '}
              {receiptDifferences(r).totalDifference == null
                ? 'unknown'
                : money(receiptDifferences(r).totalDifference!)}
              . Resolve these differences before posting.
            </p>
          )}
        <div className="finance-sticky-actions">
          <button className="btn secondary" disabled={busy} onClick={onClose}>
            Close
          </button>
          {!closed && (
            <>
              <button
                className="btn secondary"
                disabled={busy || !canWrite || r.id === 'uploading'}
                onClick={() => void onSave('receiptCancel', r)}
              >
                Cancel receipt
              </button>
              <button
                className="btn secondary"
                disabled={busy || !canWrite || r.id === 'uploading'}
                onClick={() => void onSave('receiptDraft', r)}
              >
                Save as draft
              </button>
              <button
                className="btn"
                disabled={
                  busy ||
                  !canWrite ||
                  !lines.length ||
                  r.id === 'uploading' ||
                  r.extractionStatus === 'processing'
                }
                onClick={() => {
                  if (!importBusy) void onSave('receiptPost', r)
                }}
              >
                <Check size={17} />
                {busy ? 'Processing…' : 'Confirm & post'}
              </button>
            </>
          )}
        </div>
      </DialogContent>
      {creatingLine !== null && (
        <AddItemDialog
          workspace={w}
          initialName={lines[creatingLine]?.description || ''}
          receiptLine
          onWorkspace={(updated) => onWorkspace?.(updated)}
          close={() => setCreatingLine(null)}
          save={async (table, data) => {
            const response = await fetch('/api/workspace', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'save', table, data }),
            })
            const result = await response.json()
            if (!response.ok)
              throw new Error(result.error || 'Item could not be saved.')
            const saved = result.workspace?.[table]?.find(
              (i: Item) => i.id === data.id,
            )
            if (!saved)
              throw new Error(
                'The server did not confirm the saved item. Retry this form to avoid duplicates.',
              )
            createdSelection.current = saved
            onWorkspace?.(result.workspace)
          }}
          onCreated={(id, table) => {
            const item =
              createdSelection.current?.id === id
                ? createdSelection.current
                : w[table]?.find((i) => i.id === id)
            patchLine(creatingLine, {
              unit: item?.storageUnit || item?.unit || '',
              createNew: false,
              itemId: id,
              itemTable: table,
              stockQuantityConfirmed: false,
            })
            setCreatingLine(null)
          }}
        />
      )}
    </Dialog>
  )
}

function postedBalances(w: Workspace): Item[] {
  const values = new Map<string, number>()
  for (const j of w.journals || [])
    for (const l of j.lines || [])
      values.set(
        l.account,
        (values.get(l.account) || 0) +
          Number(l.debit || 0) -
          Number(l.credit || 0),
      )
  return [...values].map(([name, total]) => ({
    id: name,
    name,
    balance: [
      'Sales Tax Payable',
      'Consignment Payable',
      'Accounts payable',
      'Owner equity',
      'Sales revenue',
      'Consignment Commission Income',
    ].includes(name)
      ? -total
      : total,
  }))
}
function channelRows(w: Workspace): Item[] {
  const channels = [
    ...new Set([
      ...(w.sales || []).map((s) => s.channel || 'Unspecified'),
      ...(w.consignment_sales || []).map((s) => s.channel || 'Unspecified'),
    ]),
  ]
  return channels.map((name) => ({
    id: name,
    name,
    ownProductSales: (w.sales || [])
      .filter((s) => (s.channel || 'Unspecified') === name)
      .reduce((a, s) => a + s.amount, 0),
    consignmentMerchandiseSales: (w.consignment_sales || [])
      .filter((s) => (s.channel || 'Unspecified') === name)
      .reduce((a, s) => a + s.merchandise, 0),
    commissionIncome: (w.consignment_sales || [])
      .filter((s) => (s.channel || 'Unspecified') === name)
      .reduce((a, s) => a + s.commission, 0),
  }))
}
