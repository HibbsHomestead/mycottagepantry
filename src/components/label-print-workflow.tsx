import { ingredientOverflowMessage } from '@/lib/label-studio'
import {
  labelSetPlan,
  labelSide,
  type LabelParts,
  type LabelOrder,
} from '@/lib/label-sets'
import type React from 'react'
import { browserPrint } from '@/lib/label-browser-print'
import { bridgeConnected, directPrint } from '@/lib/qz-bridge'
import { checkPrinterSize, type PrinterProfile } from '@/lib/label-printers'
import { downloadLabel, exportLabelPng } from '@/lib/label-client-export'
import { validateSheet, type SheetLayout } from '@/lib/label-print-layout'
import type {
  LabelDocument,
  LabelData,
  LabelSource,
} from '@/lib/label-studio'
import type { LabelFont } from '@/lib/label-font-catalog'
import type { Item, Workspace } from '@/lib/domain'
import { LabelPrintMedia } from './label-print-media'

/**
 * Shared label output workflow used by Label Studio's Print & Export section
 * and the read-only label preview. Both paths run the same print-blocking
 * checks, prepare the same server print job and render the same snapshot.
 */
export type LabelOutputType = 'pdf' | 'png' | 'print'

export type LabelOutputRequest = {
  type: LabelOutputType
  parts?: LabelParts
  order?: LabelOrder
  runIndex?: number
  doc: LabelDocument
  source: LabelSource
  brandId: string
  copies: number
  layout: SheetLayout
  selectedPrinter?: PrinterProfile
  issues: string[]
  reviewed: boolean
  customFonts: LabelFont[]
  /** Posts a workspace action and returns the updated workspace. */
  request: (
    action: string,
    payload: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<Workspace>
  signal?: AbortSignal
  timing?: (stage: string, milliseconds: number) => void
  /** Static SVG markup for a prepared job snapshot (same renderer as the canvas). */
  render: (
    document: LabelDocument,
    data: LabelData,
    assets: Item[],
  ) => string
  setStatus: (status: string) => void
  onWorkspace: (workspace: Workspace) => void
  onBrowserJob?: (job: Item) => void
  /** Label Studio saves the open design first; the preview never saves. */
  beforeOutput?: () => Promise<boolean>
  /** A read-only preview must print exactly the data and geometry it displayed. */
  preview?: { markup: string; sides?: Record<string, string> }
}

/** The specific reason output is blocked, or null when it may proceed. */
export function labelOutputBlocker({
  type,
  doc,
  copies,
  layout,
  selectedPrinter,
  issues,
  reviewed,
}: Pick<
  LabelOutputRequest,
  | 'type'
  | 'doc'
  | 'copies'
  | 'layout'
  | 'selectedPrinter'
  | 'issues'
  | 'reviewed'
>): string | null {
  try {
    if (issues.some((issue) => issue.includes(ingredientOverflowMessage)))
      throw new Error(ingredientOverflowMessage)
    if (
      issues.some((issue) =>
        /Missing information: (Label main name|Label product type|font)/.test(
          issue,
        ),
      )
    )
      throw new Error(
        'Complete the missing product name parts or load the missing font before printing or exporting.',
      )
    if (issues.length && !reviewed)
      throw new Error(
        'Review Label Check and acknowledge the warnings before printing or exporting.',
      )
    validateSheet(doc, layout)
    if (!Number.isInteger(copies) || copies < 1 || copies > 200)
      throw new Error('Choose 1–200 labels.')
    if (type !== 'png' && selectedPrinter && layout.mode !== 'sheet')
      checkPrinterSize(doc, selectedPrinter)
    const direct = type === 'print' && selectedPrinter?.method === 'qz'
    if (direct && layout.mode === 'sheet')
      throw new Error(
        'Use one label per page for this direct printer profile.',
      )
    if (direct && !bridgeConnected())
      throw new Error(
        'The bridge is disconnected. Set up direct printing or choose browser printing.',
      )
    return null
  } catch (e) {
    return (e as Error).message
  }
}

/** Runs one output job. Throws with a user-facing message on failure. */
export async function runLabelOutput(o: LabelOutputRequest) {
  const started = performance.now()
  if (o.doc.format === 'front-back') return runLabelSetOutput(o)
  const { type, doc, copies, layout, selectedPrinter } = o
  const blocked = labelOutputBlocker(o)
  if (blocked) throw new Error(blocked)
  o.timing?.('Validate output request', performance.now() - started)
  const direct = type === 'print' && selectedPrinter?.method === 'qz'
  o.setStatus('Preparing label')
  if (o.beforeOutput && !(await o.beforeOutput())) {
    return false
  }
  if (type === 'png' || (type === 'print' && !direct)) {
    o.signal?.throwIfAborted()
    const loading = performance.now()
    o.setStatus('Checking the saved design and label contents')
    const prepared = await o.request(
      'labelPrint',
      {
        templateId: doc.id,
        source: o.source,
        brandId: o.brandId,
        copies: type === 'png' ? 1 : copies,
        outputType: type === 'png' ? 'png' : 'print',
        layout,
        compact: type === 'print',
      },
      o.signal,
    )
    o.timing?.(
      'Request and validate label snapshot',
      performance.now() - loading,
    )
    const rendering = performance.now()
    const job = prepared.label_print_jobs.at(-1)!
    const markup = o.render(
        job.documentSnapshot,
        job.renderedDataSnapshot,
        prepared.graphic_assets,
      ),
      svg = new DOMParser().parseFromString(markup, 'image/svg+xml')
        .documentElement as unknown as SVGSVGElement
    if (o.preview && markup !== o.preview.markup)
      throw new Error(
        'The saved label or product data changed. Refresh and review the preview before printing again.',
      )
    o.timing?.('Render label artwork', performance.now() - rendering)
    if (type === 'png') {
      const exporting = performance.now()
      const bytes = await exportLabelPng(
        svg,
        job.documentSnapshot,
        prepared.graphic_assets,
        o.customFonts,
      )
      o.timing?.('Generate PNG', performance.now() - exporting)
      downloadLabel(bytes, doc.name + '.png', 'image/png')
      o.setStatus('PNG downloaded')
    } else {
      await browserPrint(
        svg,
        job.documentSnapshot,
        prepared.graphic_assets,
        o.customFonts,
        copies,
        layout,
        selectedPrinter,
        undefined,
        browserOutputOptions(o, started),
      )
      o.setStatus(
        'Print dialog opened · confirm printer, paper size and 100% scaling. Printing is not confirmed.',
      )
      o.onBrowserJob?.(job)
    }
  } else {
    o.setStatus('Generating label PDF')
    const exporting = performance.now()
    const response = await fetch('/api/workspace?labelPdf=1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        templateId: doc.id,
        source: o.source,
        brandId: o.brandId,
        copies,
        layout,
        printerProfileId: direct ? selectedPrinter!.id : undefined,
        mediaProfileId:
          !direct && layout.mode !== 'sheet'
            ? selectedPrinter?.id
            : undefined,
      }),
    })
    if (!response.ok) throw new Error((await response.json()).error)
    if (!response.headers.get('Content-Type')?.includes('application/pdf'))
      throw new Error(
        'Export returned an unexpected document type. Your label is preserved; try again.',
      )
    const bytes = new Uint8Array(await response.arrayBuffer())
    o.timing?.(
      'Request and generate label PDF',
      performance.now() - exporting,
    )
    if (new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-')
      throw new Error(
        'The export response was not a valid PDF. Your label is preserved.',
      )
    if (direct) {
      const jobId = response.headers.get('X-Label-Job')
      if (!jobId)
        throw new Error(
          'Print authorization is missing. No job was submitted.',
        )
      o.setStatus('Sending to printer')
      await directPrint(jobId)
      o.setStatus('Submitted to print queue · verify the physical labels')
    } else {
      downloadLabel(bytes, doc.name + '.pdf', 'application/pdf')
      o.setStatus('PDF downloaded')
    }
    const refresh = await fetch('/api/workspace')
    if (refresh.ok) o.onWorkspace((await refresh.json()).workspace)
  }
  return true
}

function browserOutputOptions(o: LabelOutputRequest, started: number) {
  return {
    signal: o.signal,
    progress: o.setStatus,
    timing(stage: string, milliseconds: number) {
      o.timing?.(stage, milliseconds)
      if (stage === 'App preparation to print call')
        o.timing?.(
          'Output start to browser print call',
          performance.now() - started,
        )
    },
  }
}

export function recordLabelPrintTiming(
  stage: string,
  milliseconds: number,
) {
  const name = `Label print: ${stage}`
  performance.clearMeasures?.(name)
  try {
    performance.measure?.(name, {
      start: Math.max(0, performance.now() - milliseconds),
      duration: milliseconds,
    })
  } catch {
    return
  }
}

async function runLabelSetOutput(o: LabelOutputRequest) {
  const started = performance.now()
  const plan = labelSetPlan(o.doc, o.copies, o.parts, o.order)
  const index = o.runIndex || 0
  const run = plan.runs[index]
  if (!run) throw new Error('Choose a valid print run.')
  const blocker = labelOutputBlocker({
    ...o,
    doc: run.document,
    copies: run.sequence.length,
  })
  if (blocker) throw new Error(blocker)
  o.timing?.('Validate output request', performance.now() - started)
  if (o.beforeOutput && !(await o.beforeOutput())) return false
  const direct = o.type === 'print' && o.selectedPrinter?.method === 'qz'
  const payload = {
    templateId: o.doc.id,
    source: o.source,
    brandId: o.brandId,
    copies: o.copies,
    parts: o.parts || 'both',
    order: o.order || 'grouped',
    runIndex: index,
    layout: o.layout,
  }
  o.setStatus(`Preparing ${run.name} · ${run.sequence.length} labels`)
  if (o.type === 'pdf' || direct) {
    o.setStatus(`Generating ${run.name} PDF`)
    const exporting = performance.now()
    const response = await fetch('/api/workspace?labelPdf=1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        printerProfileId: direct ? o.selectedPrinter!.id : undefined,
        mediaProfileId:
          !direct && o.layout.mode !== 'sheet'
            ? o.selectedPrinter?.id
            : undefined,
      }),
    })
    if (!response.ok) throw new Error((await response.json()).error)
    if (!response.headers.get('Content-Type')?.includes('application/pdf'))
      throw new Error('The export did not return a PDF.')
    const bytes = new Uint8Array(await response.arrayBuffer())
    o.timing?.(
      'Request and generate label PDF',
      performance.now() - exporting,
    )
    if (direct) {
      const id = response.headers.get('X-Label-Job')
      if (!id) throw new Error('Print authorization is missing.')
      await directPrint(id)
      o.setStatus(
        'Submitted selected run to queue · verify physical output before submitting another run.',
      )
    } else {
      downloadLabel(
        bytes,
        `${o.doc.name} - ${run.name}.pdf`,
        'application/pdf',
      )
      o.setStatus(
        `${run.name} PDF downloaded · ${run.sequence.length} individual labels`,
      )
    }
    return true
  }
  const loading = performance.now()
  o.setStatus('Checking the saved design and label contents')
  const prepared = await o.request(
    'labelPrint',
    {
      ...payload,
      outputType: o.type,
      compact: o.type === 'print',
    },
    o.signal,
  )
  o.timing?.(
    'Request and validate label snapshot',
    performance.now() - loading,
  )
  const rendering = performance.now()
  const job = prepared.label_print_jobs.at(-1)!
  const snapshot = job.documentSnapshot as LabelDocument
  const confirmed = labelSetPlan(snapshot, o.copies, o.parts, o.order).runs[
    index
  ]
  if (
    !confirmed ||
    JSON.stringify(confirmed.sequence) !== JSON.stringify(run.sequence) ||
    confirmed.document.width !== run.document.width ||
    confirmed.document.height !== run.document.height
  )
    throw new Error(
      'The saved template changed. Review the preview before printing.',
    )
  const designs = new Map<
    string,
    { svg: SVGSVGElement; document: LabelDocument }
  >()
  for (const side of new Set(run.sequence)) {
    const document = labelSide(snapshot, side)
    const markup = o.render(
      document,
      job.renderedDataSnapshot,
      prepared.graphic_assets,
    )
    if (o.preview?.sides && markup !== o.preview.sides[side])
      throw new Error(
        'The saved template or product changed. Review the refreshed preview before printing.',
      )
    designs.set(side, {
      document,
      svg: new DOMParser().parseFromString(markup, 'image/svg+xml')
        .documentElement as unknown as SVGSVGElement,
    })
  }
  if (o.type === 'png') {
    const exporting = performance.now()
    for (const [side, design] of designs)
      downloadLabel(
        await exportLabelPng(
          design.svg,
          design.document,
          prepared.graphic_assets,
          o.customFonts,
        ),
        `${o.doc.name} - ${side}.png`,
        'image/png',
      )
    o.setStatus(
      'Selected side PNG images downloaded · one image per side, quantities are not duplicated in PNG.',
    )
    o.timing?.('Generate PNG', performance.now() - exporting)
  } else {
    o.timing?.('Render label artwork', performance.now() - rendering)
    const first = designs.get(run.sequence[0])!
    await browserPrint(
      first.svg,
      first.document,
      prepared.graphic_assets,
      o.customFonts,
      run.sequence.length,
      o.layout,
      o.selectedPrinter,
      run.sequence.map((side) => designs.get(side)!),
      browserOutputOptions(o, started),
    )
    o.setStatus(
      `${run.name} dialog opened · ${run.sequence.length} labels. Confirm stock and 100% scaling; physical printing is not confirmed.`,
    )
    o.onBrowserJob?.(job)
  }
  return true
}

export const outputFailureStatus = (type: LabelOutputType) =>
  type === 'print'
    ? 'Failed to submit · check the queue before trying again; no automatic retry'
    : 'Export failed · label work preserved'

/** Saved printer profiles and the profile selected by the printing method. */
export function printRunDesign(
  doc: LabelDocument,
  parts: LabelParts,
  order: LabelOrder,
  runIndex: number,
) {
  try {
    return doc.format === 'front-back'
      ? labelSetPlan(doc, 1, parts, order).runs[runIndex]?.document || doc
      : doc
  } catch {
    return doc
  }
}

export function printerSelection(
  w: Workspace,
  printingMethod: string,
  design?: LabelDocument | null,
) {
  const printerProfiles: PrinterProfile[] =
    w.settings[0]?.currentPrinterProfiles || []
  const selectedPrinter = printerProfiles.find(
    (p) =>
      p.id ===
      (printingMethod === 'browser'
        ? ''
        : printingMethod ||
          printerProfiles.find((profile) => {
            if (!profile.preferred) return false
            try {
              if (design) checkPrinterSize(design, profile)
              return true
            } catch {
              return false
            }
          })?.id),
  )
  return { printerProfiles, selectedPrinter }
}

function Control({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="studio-field">
      <span>{label}</span>
      {children}
    </label>
  )
}

const number = (
  label: string,
  value: number,
  changeValue: (v: number) => void,
  min = 0,
  max = 1000,
) => (
  <Control label={label}>
    <input
      type="number"
      step="any"
      min={min}
      max={max}
      value={value}
      onChange={(e) => changeValue(Number(e.target.value))}
    />
  </Control>
)

/** Printer, quantity and label-sheet settings shared by every print entry point. */
export function LabelPrintOptions({
  doc,
  printerProfiles,
  selectedPrinter,
  printingMethod,
  setPrintingMethod,
  connected,
  copies,
  setCopies,
  layout,
  setLayout,
  onManagePrinters,
  onSaveMedia,
  onTestMedia,
}: {
  doc: LabelDocument
  printerProfiles: PrinterProfile[]
  selectedPrinter?: PrinterProfile
  printingMethod: string
  setPrintingMethod: (method: string) => void
  connected: boolean
  copies: number
  setCopies: (copies: number) => void
  layout: SheetLayout
  setLayout: (layout: SheetLayout) => void
  onManagePrinters?: () => void
  onSaveMedia?: (profile: PrinterProfile) => Promise<void>
  onTestMedia?: (profile: PrinterProfile) => Promise<void>
}) {
  return (
    <>
      <Control label="Printer / printing method">
        <select
          value={printingMethod || selectedPrinter?.id || 'browser'}
          onChange={(e) => setPrintingMethod(e.target.value)}
        >
          <option value="browser">Use browser printing</option>
          {printerProfiles.map((p) => (
            <option value={p.id} key={p.id}>
              {p.method === 'qz' ? 'Direct' : 'Browser'} · {p.name}
            </option>
          ))}
        </select>
      </Control>
      <p className="studio-small-note">
        {selectedPrinter?.method === 'qz'
          ? connected && bridgeConnected()
            ? 'Bridge connected'
            : 'Bridge disconnected · browser printing available'
          : 'Browser printing · choose any installed printer in the print dialog'}
      </p>
      {onManagePrinters && (
        <button className="text-button" onClick={onManagePrinters}>
          Set up direct printing / manage printers
        </button>
      )}
      <p className="studio-small-note">
        Select the matching paper size and actual size / 100%, not fit to
        page. Turn off browser headers and footers and any extra driver
        rotation. Use one driver copy. The app cannot override the driver.
      </p>
      {selectedPrinter &&
        (selectedPrinter.offsetX !== 0 ||
          selectedPrinter.offsetY !== 0) && (
          <p className="warning-text">
            Calibration offsets can move content outside the printable area.
            Print a test label and review alignment.
          </p>
        )}
      {number('Number of products', copies, (v) => setCopies(v), 1, 200)}
      <Control label="Output layout">
        <select
          value={layout.mode}
          onChange={(e) =>
            setLayout({
              ...layout,
              mode: e.target.value as SheetLayout['mode'],
            })
          }
        >
          <option value="single">Single labels · exact dimensions</option>
          <option value="sheet">Label sheet</option>
          <option value="roll">Roll / thermal · one label per page</option>
        </select>
      </Control>
      {layout.mode !== 'sheet' && (
        <LabelPrintMedia
          key={JSON.stringify([doc.width, doc.height, selectedPrinter])}
          design={doc}
          profile={selectedPrinter}
          onSave={onSaveMedia}
          onTest={onTestMedia}
        />
      )}
      {layout.mode === 'sheet' && (
        <details open>
          <summary>Sheet layout (inches)</summary>
          <p>
            Sheet output keeps the design orientation and uses the sheet
            dimensions below.
          </p>
          <div className="studio-two">
            {number(
              'Paper width',
              layout.pageWidth / 72,
              (v) => setLayout({ ...layout, pageWidth: v * 72 }),
              1,
              14,
            )}
            {number(
              'Paper height',
              layout.pageHeight / 72,
              (v) => setLayout({ ...layout, pageHeight: v * 72 }),
              1,
              14,
            )}
            {number(
              'Columns',
              layout.columns,
              (v) => setLayout({ ...layout, columns: v }),
              1,
              20,
            )}
            {number(
              'Rows',
              layout.rows,
              (v) => setLayout({ ...layout, rows: v }),
              1,
              20,
            )}
            {number(
              'Margins',
              layout.margin / 72,
              (v) => setLayout({ ...layout, margin: v * 72 }),
              0,
              3,
            )}
            {number(
              'Gutter',
              layout.gutter / 72,
              (v) => setLayout({ ...layout, gutter: v * 72 }),
              0,
              3,
            )}
          </div>
        </details>
      )}
    </>
  )
}
