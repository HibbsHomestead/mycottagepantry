import {
  labelLayout,
  labelSide,
  labelSides,
  layoutKeys,
  type LabelSide,
} from '@/lib/label-sets'
import { LabelSetControls, PairedLabelPreview } from './label-set-controls'
import { LabelCanvas } from './label-canvas'
import { withLibraryArtwork } from '@/lib/artwork-library'
import { LabelPrinterSettings } from './label-printer-settings'
import {
  LabelPrintOptions,
  outputFailureStatus,
  printerSelection,
  runLabelOutput,
  type LabelOutputType,
} from './label-print-workflow'
import { browserPrint } from '@/lib/label-browser-print'
import { bridgeConnected, directPrint } from '@/lib/qz-bridge'
import { printerSize, type PrinterProfile } from '@/lib/label-printers'
import { LabelColorPicker } from './label-color-picker'
import {
  LabelTextToolbar,
  LabelGeometryToolbar,
} from './label-property-toolbar'
import { recentColorList, type LabelColor } from '@/lib/label-colors'
import { downloadLabel } from '@/lib/label-client-export'
import { renderToStaticMarkup } from 'react-dom/server'
import { FontUploadPanel } from './label-font-upload'
import {
  fontFileUrl,
  fontFaceKey,
  labelFonts as fontCatalog,
  workspaceFonts,
} from '@/lib/label-font-catalog'
import { labelFontMetrics } from '@/lib/label-font-metrics'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Plus,
  ArrowRight,
  ArrowLeft,
  Save,
  Printer,
  Download,
  Check,
  TriangleAlert,
  Type,
  ImagePlus,
  Shapes,
  Layers,
  LockKeyhole,
  UnlockKeyhole,
  Eye,
  EyeOff,
  Copy,
  Trash2,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  Upload,
  Wheat,
  Palette,
  Search,
  Grid2X2,
  SlidersHorizontal,
} from 'lucide-react'
import {
  labelFilters,
  labelTypes,
  labelSizes,
  newElement,
  blankLabel,
  withLabelBackgrounds,
  systemLabelTemplates,
  bindings,
  bakeryGraphics,
  resolveLabelData,
  elementText,
  elementAssetId,
  imageBindings,
  imageBindingNames,
  validateLabelDocument,
  labelTextLines,
  checkLabel,
  type LabelDocument,
  type LabelElement,
  type LabelSource,
} from '@/lib/label-studio'
import {
  keepsAspect,
  elementAngle,
  setElementAngle,
  normalizeAngle,
  pointerAngle,
  resizeElement,
  snapAngle,
  type ResizeHandle,
} from '@/lib/label-transform'
import { defaultSheet, type SheetLayout } from '@/lib/label-print-layout'
import type { Workspace, Item } from '@/lib/domain'
import './label-studio.css'
import { FontPicker, fontCss, type FontPreferences } from './label-font-picker'
import { fontPairings, applyFontPairing } from '@/lib/label-font-pairings'
import {
  labelContent,
  confirmLabelSave,
  mergeLabelWorkspace,
} from '@/lib/label-persistence'
import { applySelectionFont, editStaticText } from '@/lib/label-rich-text'
import { labelRecordKind } from '@/lib/label-library'
import {
  duplicateSavedLabel,
  labelSource,
  manualLabelFields,
  preservedManualTextWarnings,
  sourceKey,
  sourceProductId,
  validateSavedLabelContext,
} from '@/lib/saved-labels'
import { DeleteDesignDialog } from './label-library-dialogs'
const sections = [
  'Labels',
  'Brand Kit',
  'Graphics Library',
  'Print & Export',
  'Label Settings',
]
function textFontName(element: LabelElement, range?: [number, number]) {
  if (element.binding || !element.textRuns?.length) return element.font
  let offset = 0
  const fonts = new Set(
    element.textRuns
      .filter((run) => {
        const start = offset
        offset += run.text.length
        return !range || (start < range[1] && offset > range[0])
      })
      .map((run) => run.font),
  )
  return fonts.size > 1 ? 'Mixed fonts' : [...fonts][0] || element.font
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
export { LabelCanvas } from './label-canvas'
export function LabelStudio({
  workspace: w,
  onWorkspace,
  ready,
  role,
  initialProductId,
  initialLabelId,
  initialCreateRequest,
  onCreateRequestHandled,
  initialSection,
  onSectionChange,
  onDirtyChange,
}: {
  workspace: Workspace
  onWorkspace: (w: Workspace) => void
  ready: boolean
  role: string
  initialProductId?: string
  /** Saved design to open in the editor (explicit Edit Label from a preview). */
  initialLabelId?: string
  initialCreateRequest?: number
  onCreateRequestHandled?: () => void
  initialSection?: string
  onSectionChange?: (section: string) => void
  onDirtyChange?: (dirty: boolean) => void
}) {
  const [editorSide, setEditorSide] = useState<LabelSide>('front')
  const [partsDraft, setParts] = useState<'both' | LabelSide>('both')
  const [orderDraft, setOrder] = useState<'grouped' | 'paired'>('grouped')
  const [runIndex, setRunIndex] = useState(0)
  const [section, setSection] = useState(
      initialSection && sections.includes(initialSection)
        ? initialSection
        : 'Labels',
    ),
    [doc, setDoc] = useState<LabelDocument | null>(null),
    [selected, setSelectedValue] = useState(''),
    [left, setLeft] = useState('Elements'),
    [filter, setFilter] = useState('All styles'),
    [query, setQuery] = useState(''),
    [sourceDraft, setSource] = useState<LabelSource>({
      kind: 'product',
      id: initialProductId || '',
    }),
    [colorEditing, setColorEditing] = useState(false),
    [recentColors, setRecentColors] = useState<LabelColor[]>(
      w.settings[0]?.currentLabelColors || [],
    ),
    [zoom, setZoom] = useState(1),
    [safe, setSafe] = useState(true),
    [grid, setGrid] = useState(false),
    [snap, setSnap] = useState(true),
    [angleSnap, setAngleSnap] = useState(false),
    [rotating, setRotating] = useState(false),
    [bleed, setBleed] = useState(false),
    [status, setStatus] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [saveBusy, setSaveBusy] = useState(false),
    [draftStatus, setDraftStatus] = useState(''),
    [saveFailed, setSaveFailed] = useState(false),
    [textSelection, setTextSelection] = useState<[number, number]>([0, 0]),
    [brandDraftId, setBrandId] = useState(w.brand_kits?.[0]?.id || ''),
    [printingMethodDraft, setPrintingMethod] = useState(''),
    [connected, setConnected] = useState(false),
    [copiesDraft, setCopies] = useState(1),
    [layoutDraft, setLayout] = useState<SheetLayout>(defaultSheet),
    [reviewed, setReviewed] = useState(false),
    [brandDraft, setBrandDraft] = useState<Item>({
      id: '',
      name: 'Everyday brand',
      colors: ['#742b60', '#f8efdf', '#292630'],
      headingFont: 'Oswald',
      bodyFont: 'DM Sans',
      contact: {},
    }),
    [assetQuery, setAssetQuery] = useState(''),
    [uploadCategory, setUploadCategory] = useState('logo'),
    [imageTarget, setImageTarget] = useState('library'),
    [imageProductId, setImageProductId] = useState(w.products[0]?.id || ''),
    [collection, setCollection] = useState('My graphics'),
    [displayUnit, setDisplayUnit] = useState<'in' | 'mm' | 'px'>('in')
  const source =
    doc?.workflowVersion === 1 && doc.source ? doc.source : sourceDraft
  const parts =
    doc?.workflowVersion === 1
      ? (doc.printSettings?.parts ?? 'both')
      : partsDraft
  const order =
    doc?.workflowVersion === 1
      ? (doc.printSettings?.order ?? 'grouped')
      : orderDraft
  const brandId = doc?.workflowVersion === 1 ? doc.brandId || '' : brandDraftId
  const printingMethod =
    doc?.workflowVersion === 1
      ? doc.printSettings?.printingMethod || 'browser'
      : printingMethodDraft
  const copies =
    doc?.workflowVersion === 1 ? (doc.printSettings?.copies ?? 1) : copiesDraft
  const layout =
    doc?.workflowVersion === 1
      ? (doc.printSettings?.layout ?? defaultSheet)
      : layoutDraft
  const editorDoc = doc
    ? labelSide(doc, editorSide === 'back' && doc.back ? 'back' : 'front')
    : blankLabel()
  const [deleteTargets, setDeleteTargets] = useState<LabelDocument[] | null>(
    null,
  )
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [libraryStatus, setLibraryStatus] = useState('')
  const [showStarters, setShowStarters] = useState(false)
  const libraryRecords = ((w.label_templates || []) as LabelDocument[]).filter(
    (t) => !t.deletedAt,
  )
  const filteredRecords = libraryRecords
    .filter(
      (t) =>
        t.name.toLowerCase().includes(query.toLowerCase()) &&
        (filter === 'All styles' || t.tags?.includes(filter)),
    )
    .sort((a, b) =>
      String(b.savedAt || b.updatedAt || '').localeCompare(
        String(a.savedAt || a.updatedAt || ''),
      ),
    )
  const selectableLabels = filteredRecords.filter(
    (d) => d.workflowVersion === 1,
  )
  const selectedLabels = selectableLabels.filter((d) =>
    selectedIds.includes(d.id),
  )
  const svgRef = useRef<SVGSVGElement | null>(null),
    outputBusy = useRef(false),
    colorOriginal = useRef<LabelDocument | null>(null),
    history = useRef<LabelDocument[]>([]),
    future = useRef<LabelDocument[]>([]),
    clipboard = useRef<LabelElement | null>(null),
    saving = useRef(false),
    saveInFlight = useRef<Promise<boolean> | null>(null),
    revision = useRef(0),
    lastSaved = useRef(''),
    current = useRef(doc),
    drag = useRef<{
      id: string
      x: number
      y: number
      master?: LabelDocument
      original: LabelDocument
      mode: 'move' | 'resize' | 'rotate'
      handle?: ResizeHandle
      angle: number
      moved: boolean
    } | null>(null)
  current.current = doc
  const draftSession = useRef(crypto.randomUUID())
  const draftSequence = useRef(0)
  const sequenceContent = useRef('')
  if (doc && labelContent(doc) !== sequenceContent.current) {
    sequenceContent.current = labelContent(doc)
    draftSequence.current++
  }
  const checkpoint = useRef('')
  const draftInFlight = useRef(false)
  const saveAttempt = useRef<{
    content: string
    operationId: string
    expectedRevision: number
  } | null>(null)
  const recoveryInput = useRef<HTMLInputElement>(null)
  const scope = w.settings[0]?.labelEditorScope
  const initialScope = useRef(scope)
  const latestScope = useRef(scope)
  latestScope.current = scope
  const latestWorkspace = useRef(w)
  latestWorkspace.current = w
  if (!initialScope.current && scope) initialScope.current = scope
  const dirty = !!doc && labelContent(doc) !== lastSaved.current
  useEffect(() => {
    onDirtyChange?.(dirty)
    return () => onDirtyChange?.(false)
  }, [dirty, onDirtyChange])
  const customFonts = useMemo(
    () => workspaceFonts(w.font_assets),
    [w.font_assets],
  )
  const availableFonts = [...fontCatalog, ...customFonts]
  const assets = withLibraryArtwork(w.graphic_assets),
    brand = (w.brand_kits || []).find((b) => b.id === brandId),
    data = resolveLabelData(w, source, brand),
    issues = doc
      ? labelSides(doc)
          .flatMap((side) =>
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
          .concat(preservedManualTextWarnings(doc))
      : [],
    element = editorDoc?.elements.find((e) => e.id === selected),
    canEdit = ready && ['Owner', 'Manager'].includes(role)
  function setSelected(id: string) {
    setTextSelection([0, 0])
    setSelectedValue(id)
  }
  const [, refreshFontMetrics] = useState(0)
  const usedFontSignature = JSON.stringify(
    (doc
      ? labelSides(doc).flatMap((side) => labelSide(doc, side).elements)
      : []
    )
      .filter((e) => e.type === 'text')
      .flatMap((e) => [
        e,
        ...(e.textRuns || []).map((r) => ({ ...e, font: r.font })),
      ])
      .map((e) => [e.font, e.bold, e.binding]),
  )
  useEffect(() => {
    let active = true
    const keys = [
      ...new Set(
        (doc
          ? labelSides(doc).flatMap((side) => labelSide(doc, side).elements)
          : []
        )
          .filter((e) => e.type === 'text')
          .flatMap((e) => [
            e,
            ...(e.textRuns || []).map((r) => ({ ...e, font: r.font })),
          ])
          .flatMap((e) => {
            const font = availableFonts.find((f) => f.name === e.font)
            return font && font.source !== 'bundled'
              ? (e.binding === 'recipe.ingredients'
                  ? [false, true]
                  : [e.bold]
                ).map((bold) => fontFaceKey(font, bold))
              : []
          })
          .filter(Boolean),
      ),
    ]
    Promise.all(
      keys
        .filter((key) => !labelFontMetrics[key])
        .map(async (key) => {
          const response = await fetch(fontFileUrl(key) + '&metrics=1')
          if (!response.ok)
            throw new Error(
              'A label font could not load. Choose a bundled font or try again before printing.',
            )
          const metrics = await response.json()
          labelFontMetrics[key] = metrics
          const font = availableFonts.find(
            (f) =>
              fontFaceKey(f, false) === key || fontFaceKey(f, true) === key,
          )
          if (font)
            labelFontMetrics[
              font.name + (key.endsWith('-bold') ? '-bold' : '')
            ] = metrics
        }),
    )
      .then(() => {
        if (active) refreshFontMetrics((n) => n + 1)
      })
      .catch((e) => {
        if (active) setError(e.message)
      })
    return () => {
      active = false
    }
  }, [usedFontSignature, w.font_assets])
  const bindingSignature = JSON.stringify(data)
  useEffect(() => setReviewed(false), [bindingSignature])
  async function request(
    action: string,
    payload: Record<string, any>,
    trace?: string,
  ) {
    if (!canEdit)
      throw new Error(
        'An Owner or Manager in a connected oven can save labels.',
      )
    if (initialScope.current !== scope)
      throw new Error(
        'Oven changed. Export this label before reopening the correct oven.',
      )
    const response = await fetch('/api/workspace', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(trace ? { 'X-Label-Save-Trace': trace } : {}),
      },
      body: JSON.stringify({
        action,
        data: { ...payload, expectedScope: initialScope.current },
      }),
      signal: AbortSignal.timeout(25000),
    })
    const result = await response.json()
    if (!response.ok)
      throw new Error(
        result.error || 'The request failed. Keep this editor open and retry.',
      )
    if (!result.workspace?.label_templates)
      throw new Error(
        'The server response is incomplete. Keep this editor open and retry.',
      )
    if (trace) confirmLabelSave(result.workspace, payload.document, trace)
    if (initialScope.current !== latestScope.current)
      throw new Error(
        'The oven changed while saving. Export this label and reopen its original oven to verify the result.',
      )
    // Checkpoints never replace the label list with a possibly older response.
    if (action !== 'labelDraft') {
      const merged = mergeLabelWorkspace(
        latestWorkspace.current,
        result.workspace,
      )
      latestWorkspace.current = merged
      onWorkspace(merged)
    }
    return result.workspace as Workspace
  }
  function saveFontPreferences(preferences: FontPreferences) {
    request('labelFontPreferences', preferences).catch((e) =>
      setError(e.message),
    )
  }
  function commit(next: LabelDocument) {
    if (doc && doc.workflowVersion !== 1) {
      setError('Duplicate this preserved design to edit an independent label.')
      return
    }
    if (doc) {
      history.current = [...history.current.slice(-39), doc]
      future.current = []
    }
    current.current = next
    draftSequence.current++
    setDoc(next)
    setStatus('Unsaved changes')
    setLibraryStatus('')

    setReviewed(false)
  }
  function change(patch: Partial<LabelDocument>) {
    if (!doc) return
    if (editorSide === 'back' && doc.back) {
      const designPatch = Object.fromEntries(
        Object.entries(patch).filter(([key]) =>
          layoutKeys.includes(key as (typeof layoutKeys)[number]),
        ),
      )
      const sharedPatch = Object.fromEntries(
        Object.entries(patch).filter(
          ([key]) => !layoutKeys.includes(key as (typeof layoutKeys)[number]),
        ),
      )
      commit({ ...doc, ...sharedPatch, back: { ...doc.back, ...designPatch } })
    } else commit({ ...doc, ...patch })
  }
  function patchElement(patch: Partial<LabelElement>) {
    if (doc && element && !element.locked)
      change({
        elements: editorDoc.elements.map((e) =>
          e.id === selected ? { ...e, ...patch } : e,
        ),
      })
  }
  function add(e: LabelElement) {
    if (!doc) return
    change({ elements: [...editorDoc.elements, e] })
    setSelected(e.id)
  }
  /** Pointer position in label points, accounting for zoom and scrolling. */
  function labelPoint(event: { clientX: number; clientY: number }) {
    const svg = svgRef.current,
      ctm = svg?.getScreenCTM?.()
    if (svg && ctm && typeof DOMPoint !== 'undefined') {
      const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(
        ctm.inverse(),
      )
      return { x: p.x, y: p.y }
    }
    const rect = svg?.getBoundingClientRect(),
      scale =
        rect && rect.width && doc
          ? editorDoc.width / rect.width
          : 72 / 96 / zoom
    return {
      x: (event.clientX - (rect?.left || 0)) * scale,
      y: (event.clientY - (rect?.top || 0)) * scale,
    }
  }
  function undo() {
    const prev = history.current.pop()
    if (prev && doc) {
      future.current.push(doc)
      setDoc(prev)
    }
  }
  function redo() {
    const next = future.current.pop()
    if (next && doc) {
      history.current.push(doc)
      setDoc(next)
    }
  }
  function duplicate() {
    if (!element) return
    add({
      ...element,
      id: crypto.randomUUID(),
      x: element.x + 9,
      y: element.y + 9,
      locked: false,
    })
  }
  function choose(t: LabelDocument, saved = false, replaceConfirmed = false) {
    if (saving.current) {
      setError('Wait for the current save to finish.')
      return
    }
    if (
      current.current &&
      labelContent(current.current) !== lastSaved.current &&
      !replaceConfirmed &&
      !window.confirm(
        'This label has unsaved changes. Export a recovery file or save before replacing it. Continue?',
      )
    )
      return
    setEditorSide('front')
    setRunIndex(0)
    const nextSource = labelSource(w, t, initialProductId)
    const next = saved
      ? withLabelBackgrounds(structuredClone(t))
      : duplicateSavedLabel(t, nextSource)
    setSource(nextSource)
    setBrandId(next.brandId || '')
    setParts(next.printSettings?.parts || 'both')
    setOrder(next.printSettings?.order || 'grouped')
    setCopies(next.printSettings?.copies || 1)
    setPrintingMethod(next.printSettings?.printingMethod || 'browser')
    setLayout(structuredClone(next.printSettings?.layout || defaultSheet))
    revision.current = saved ? t.revision : 0
    lastSaved.current = saved && t.revision > 0 ? labelContent(next) : ''
    saveAttempt.current = null
    draftSession.current = crypto.randomUUID()
    draftSequence.current = 0
    checkpoint.current = ''
    current.current = next
    history.current = []
    future.current = []
    setDoc(next)
    setSelected('')
    setTextSelection([0, 0])
    setDisplayUnit(next.displayUnit || 'in')
    setSection('Editor')
    setStatus(
      saved
        ? `Saved${t.savedAt || t.updatedAt ? ' · ' + new Date(t.savedAt || t.updatedAt!).toLocaleString() : ' · existing oven record'}`
        : canEdit
          ? 'Unsaved changes'
          : 'Preview only',
    )
    setSaveFailed(false)

    setError('')
    setReviewed(false)
    return true
  }
  function navigateStudio(next: string) {
    if (
      section === 'Editor' &&
      next !== 'Editor' &&
      next !== 'Print & Export' &&
      dirty &&
      !window.confirm(
        'This design has unsaved changes. Save or export an editable recovery file before leaving the editor. Continue?',
      )
    )
      return
    setSection(next)
    onSectionChange?.(next)
    if (next === 'Labels') {
      setQuery('')
      setFilter('All styles')
    }
  }
  useEffect(() => {
    if (initialSection && sections.includes(initialSection))
      setSection(initialSection)
  }, [initialSection])
  function duplicateLabel(record: LabelDocument) {
    if (choose(record, false)) {
      setStatus(
        'Unsaved independent copy · Save creates a new label; Cancel creates no record.',
      )
    }
  }
  function createLabel(starter?: LabelDocument) {
    const initialSource: LabelSource =
      starter && doc?.workflowVersion === 1 && revision.current === 0
        ? source
        : { kind: 'product', id: initialProductId || '' }
    const fresh = starter
      ? duplicateSavedLabel(starter, initialSource)
      : {
          ...blankLabel(),
          id: crypto.randomUUID(),
          workflowVersion: 1 as const,
          recordKind: 'label' as const,
          renderVersion: 2 as const,
          source: initialSource,
          productId: initialSource.id || undefined,
          manualTextReviewedFor: sourceKey(initialSource),
        }
    fresh.name = starter ? starter.name : 'Untitled label'
    if (
      choose(
        fresh,
        true,
        !!starter &&
          revision.current === 0 &&
          !doc?.elements.length &&
          !doc?.back?.elements.length,
      )
    )
      setShowStarters(false)
  }
  const createdRequest = useRef(0)
  useEffect(() => {
    if (
      initialCreateRequest &&
      createdRequest.current !== initialCreateRequest &&
      !initialLabelId
    ) {
      createdRequest.current = initialCreateRequest
      createLabel()
      onCreateRequestHandled?.()
    }
  }, [initialCreateRequest])
  const openedLabel = useRef('')
  useEffect(() => {
    if (!initialLabelId || openedLabel.current === initialLabelId) return
    const record = libraryRecords.find((t) => t.id === initialLabelId)
    if (!record) return
    openedLabel.current = initialLabelId
    choose(record, record.workflowVersion === 1)
    // Open once per explicit request; later library refreshes keep the editor.
  }, [initialLabelId, libraryRecords.length])
  function cancelEditor() {
    if (saveBusy) return
    current.current = null
    setDoc(null)
    lastSaved.current = ''
    revision.current = 0
    saveAttempt.current = null
    setSelected('')
    setDraftStatus('')
    setError('')
    setStatus('')
    setSection('Labels')
    onSectionChange?.('Labels')
  }
  function changeSource(next: LabelSource) {
    setSource(next)
    setReviewed(false)
    if (doc?.workflowVersion === 1)
      change({
        source: next,
        productId: sourceProductId(next) || undefined,
        manualTextReviewedFor: undefined,
      })
  }
  function updatePrint(
    patch: Partial<NonNullable<LabelDocument['printSettings']>>,
  ) {
    if (doc?.workflowVersion === 1)
      change({
        printSettings: {
          copies,
          layout,
          parts,
          order,
          printingMethod,
          ...patch,
        },
      })
  }
  async function deleteDesigns() {
    if (!deleteTargets?.length) return
    if (saveInFlight.current) await saveInFlight.current
    const ids = deleteTargets.map((t) => t.id)
    const workspace = await request('labelDelete', {
      ids,
      recordKind: labelRecordKind(deleteTargets[0]),
    })
    if (
      ids.some(
        (id) =>
          !workspace.label_templates.some((t) => t.id === id && t.deletedAt),
      )
    )
      throw new Error(
        'The server did not confirm deletion. Refresh the list and retry.',
      )
    setSelectedIds((old) => old.filter((id) => !ids.includes(id)))
    const closed = !!current.current && ids.includes(current.current.id)
    if (closed) {
      current.current = null
      setDoc(null)
      revision.current = 0
      lastSaved.current = ''
      history.current = []
      future.current = []
      saveAttempt.current = null
      setSelected('')
      setDraftStatus('')
      setStatus('')
      setSection('Labels')
    }
    setLibraryStatus(
      `${ids.length} ${labelRecordKind(deleteTargets[0]) === 'template' ? 'template' : 'label'}${ids.length === 1 ? '' : 's'} deleted.${closed ? ' The deleted design’s editor is closed.' : ''}`,
    )
  }
  async function saveDocument(): Promise<boolean> {
    if (saveInFlight.current) {
      const result = await saveInFlight.current
      if (!result) return false
      if (
        current.current &&
        labelContent(current.current) === lastSaved.current
      )
        return true
      return saveDocument()
    }
    const latest = current.current
    if (!latest) return false
    if (latest.workflowVersion !== 1) {
      setError(
        'This existing design is preserved. Duplicate it to save independent changes.',
      )
      return false
    }
    try {
      validateSavedLabelContext(w, latest)
    } catch (failure) {
      setError((failure as Error).message)
      return false
    }
    const content = labelContent(latest)
    if (content === lastSaved.current) return true
    const attempt =
      saveAttempt.current?.content === content
        ? saveAttempt.current
        : {
            content,
            operationId: crypto.randomUUID(),
            expectedRevision: revision.current,
          }
    saveAttempt.current = attempt
    const sequence = draftSequence.current
    saving.current = true
    setSaveBusy(true)
    setError('')
    setSaveFailed(false)
    setStatus('Saving…')
    const pending = (async () => {
      try {
        const workspace = await request(
            'labelSave',
            {
              document: latest,
              expectedRevision: attempt.expectedRevision,
              operationId: attempt.operationId,
              sessionId: draftSession.current,
              sequence,
            },
            attempt.operationId,
          ),
          saved = confirmLabelSave(workspace, latest, attempt.operationId)
        revision.current = saved.revision
        lastSaved.current = content
        const unchanged =
          !!current.current && labelContent(current.current) === content
        if (unchanged) {
          current.current = { ...current.current!, revision: saved.revision }
          setDoc(current.current)
          setStatus('Saved · ' + new Date(saved.savedAt).toLocaleString())
          setDraftStatus(
            'Recovery checkpoint retained in history; this layout is saved to your oven.',
          )
        } else
          setStatus(
            'Unsaved changes · earlier edits saved at ' +
              new Date(saved.savedAt).toLocaleTimeString(),
          )

        return unchanged
      } catch (e) {
        setError(
          `${(e as Error).name === 'TimeoutError' ? 'Save timed out; the result is uncertain. Retry safely with the same save reference.' : (e as Error).message} Your layout remains open. Retry or export an editable recovery file.`,
        )
        setStatus('Save failed — changes remain unsaved')
        setSaveFailed(true)
        return false
      }
    })()
    saveInFlight.current = pending
    try {
      return await pending
    } finally {
      saving.current = false
      saveInFlight.current = null
      setSaveBusy(false)
    }
  }
  async function preserveDraft() {
    const latest = current.current
    if (
      !latest ||
      latest.workflowVersion !== 1 ||
      revision.current < 1 ||
      deleteTargets ||
      !canEdit ||
      draftInFlight.current ||
      labelContent(latest) === lastSaved.current ||
      labelContent(latest) === checkpoint.current
    )
      return
    draftInFlight.current = true
    const content = labelContent(latest)
    try {
      await request('labelDraft', {
        id: crypto.randomUUID(),
        sessionId: draftSession.current,
        sequence: draftSequence.current,
        document: latest,
        baseRevision: revision.current,
        source,
        displayUnit,
      })
      checkpoint.current = content
      setDraftStatus(
        'Recovery checkpoint preserved · ' +
          new Date().toLocaleTimeString() +
          '. Changes still need a confirmed label save.',
      )
    } catch (e) {
      setDraftStatus(
        'Recovery checkpoint failed: ' +
          (e as Error).message +
          ' Export an editable recovery file now; keep this editor open.',
      )
    } finally {
      draftInFlight.current = false
    }
  }
  const preserveLatest = useRef(preserveDraft)
  preserveLatest.current = preserveDraft
  useEffect(() => {
    if (!canEdit) return
    const periodic = setInterval(() => void preserveLatest.current(), 10000)
    return () => clearInterval(periodic)
  }, [canEdit])
  useEffect(() => {
    if (!dirty || !canEdit || colorEditing) return
    const timer = setTimeout(() => void preserveDraft(), 700)
    return () => {
      clearTimeout(timer)
    }
  }, [doc, canEdit, colorEditing])
  function exportRecovery() {
    if (!current.current) return
    downloadLabel(
      new TextEncoder().encode(
        JSON.stringify(
          {
            format: 'cottage-pantry-label-recovery',
            version: 1,
            document: current.current,
            source,
            displayUnit,
            exportedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
      ),
      current.current.name + '.label.json',
      'application/json',
    )
  }
  function recover(
    document: LabelDocument,
    sourceData?: LabelSource,
    unit?: 'in' | 'mm' | 'px',
  ) {
    if (
      !choose(
        { ...document, name: document.name.slice(0, 75) + ' · recovered copy' },
        false,
      )
    )
      return
    if (sourceData) changeSource(sourceData)
    if (unit) setDisplayUnit(unit)

    setStatus(
      'Recovered draft · unsaved copy. Review and Save to confirm persistence.',
    )
  }
  useEffect(() => {
    if (!doc) return
    const before = (e: BeforeUnloadEvent) => {
      if (
        current.current &&
        labelContent(current.current) !== lastSaved.current
      ) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', before)
    const leave = (event: MouseEvent) => {
      const anchor = (event.target as HTMLElement)?.closest?.('a[href]')
      if (
        anchor &&
        current.current &&
        labelContent(current.current) !== lastSaved.current &&
        !window.confirm(
          'Your label has unsaved changes. Save or export an editable recovery file before leaving. Leave anyway?',
        )
      ) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    document.addEventListener('click', leave, true)
    return () => {
      window.removeEventListener('beforeunload', before)
      document.removeEventListener('click', leave, true)
    }
  }, [!!doc])
  useEffect(() => {
    if (!doc || colorEditing || section !== 'Editor') return
    const key = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement).closest(
          'input,textarea,select,[contenteditable]',
        )
      )
        return
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        e.shiftKey ? redo() : undo()
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        redo()
      }
      // Arrow keys and Space belong to focused inspector controls and menus.
      // Using them must not nudge or delete the active canvas element.
      if (
        (e.target as HTMLElement).closest(
          'button,summary,[role="menuitem"],[role="radio"],[role="slider"]',
        )
      )
        return
      if (mod && e.key.toLowerCase() === 'c' && element) {
        e.preventDefault()
        clipboard.current = structuredClone(element)
      }
      if (mod && e.key.toLowerCase() === 'v' && clipboard.current) {
        e.preventDefault()
        add({
          ...clipboard.current,
          id: crypto.randomUUID(),
          x: clipboard.current.x + 9,
          y: clipboard.current.y + 9,
          locked: false,
        })
      }
      if (
        (e.key === 'Delete' || e.key === 'Backspace') &&
        element &&
        !element.locked
      ) {
        e.preventDefault()
        change({
          elements: editorDoc.elements.filter((x) => x.id !== element.id),
        })
        setSelected('')
      }
      if (
        element &&
        !element.locked &&
        ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)
      ) {
        e.preventDefault()
        const step = e.shiftKey ? 9 : 1
        patchElement({
          x:
            element.x +
            (e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0),
          y:
            element.y +
            (e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0),
        })
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [doc, selected, section, colorEditing])
  const sourceRows =
    source.kind === 'product'
      ? w.products
      : source.kind === 'batch'
        ? w.batches
        : w.ingredients
  function dimensions(width: number, height: number) {
    if (!doc) return
    const sx = width / editorDoc.width,
      sy = height / editorDoc.height
    change({
      width,
      height,
      round: editorDoc.round && Math.abs(width - height) < 0.01,
      elements: editorDoc.elements.map((e) => ({
        ...e,
        x: e.x * sx,
        y: e.y * sy,
        width: e.width * sx,
        height: e.height * sy,
        fontSize: Math.max(1, e.fontSize * Math.min(sx, sy)),
      })),
    })
  }
  async function linkArtwork(
    assetId: string,
    target = imageTarget,
    logoBrandId?: string,
  ) {
    if (target === 'library') return
    await request('labelImageAssignment', {
      assetId,
      target,
      productId: imageProductId,
      brandId: logoBrandId,
    })
    setStatus('Artwork linked. Labels using this field update automatically.')
  }
  async function upload(
    file: File,
    target = imageTarget,
    logoBrandId?: string,
  ) {
    setBusy(true)
    setError('')
    try {
      if (!canEdit) throw new Error('Connect as an Owner or Manager to upload.')
      if (target.startsWith('product') && !imageProductId)
        throw new Error('Choose a product before uploading its artwork.')
      const f = new FormData()
      f.set('file', file)
      f.set('category', target === 'businessLogo' ? 'logo' : uploadCategory)
      f.set('collection', collection)
      f.set('tags', uploadCategory)
      const response = await fetch('/api/workspace?upload=1', {
          method: 'POST',
          body: f,
        }),
        result = await response.json()
      if (!response.ok) throw new Error(result.error)
      onWorkspace(result.workspace)
      setStatus('Graphic uploaded')
      if (target === 'businessLogo')
        setBrandDraft((b) => ({ ...b, primaryLogoAssetId: result.asset.id }))
      await linkArtwork(result.asset.id, target, logoBrandId)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function output(type: LabelOutputType) {
    if (!doc || outputBusy.current || colorEditing) return
    if (doc.workflowVersion === 1 && (dirty || revision.current < 1)) {
      setError('Save this label before printing or exporting.')
      return
    }
    outputBusy.current = true
    setBusy(true)
    setError('')
    try {
      await runLabelOutput({
        type,
        doc,
        source,
        brandId,
        copies,
        layout,
        selectedPrinter,
        issues,
        reviewed,
        customFonts,
        request,
        render: (document, data, assets) =>
          renderToStaticMarkup(
            <LabelCanvas document={document} data={data} assets={assets} />,
          ),
        setStatus,
        onWorkspace,
        beforeOutput: async () => !dirty,
        parts,
        order,
        runIndex,
      })
    } catch (e) {
      setError((e as Error).message)
      setStatus(outputFailureStatus(type))
    } finally {
      setBusy(false)
      outputBusy.current = false
    }
  }
  async function testPrinter(profile: PrinterProfile) {
    if (outputBusy.current)
      throw new Error('Wait for the current print action to finish.')
    outputBusy.current = true
    try {
      if (profile.method === 'qz') {
        if (!bridgeConnected())
          throw new Error('Connect the bridge or use browser printing.')
        const res = await fetch('/api/workspace?printerTest=1', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ profileId: profile.id }),
          }),
          result = await res.json()
        if (!res.ok) throw new Error(result.error)
        await directPrint(result.jobId)
      } else {
        const size = printerSize(profile),
          test = {
            ...blankLabel(),
            ...size,
            name: 'Printer calibration test',
            elements: [
              {
                ...newElement('border'),
                x: 4,
                y: 4,
                width: size.width - 8,
                height: size.height - 8,
              },
              {
                ...newElement('text', 'Cottage Pantry — test label'),
                font: 'DM Sans',
                fontSize: Math.min(12, size.width / 16),
                x: 8,
                y: 8,
                width: size.width - 16,
                height: size.height - 16,
              },
            ],
          }
        const svg = new DOMParser().parseFromString(
          renderToStaticMarkup(<LabelCanvas document={test} data={data} />),
          'image/svg+xml',
        ).documentElement as unknown as SVGSVGElement
        await browserPrint(
          svg,
          test,
          [],
          [],
          1,
          { ...defaultSheet, mode: 'roll' },
          profile,
        )
      }
    } finally {
      outputBusy.current = false
    }
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
  const documentColors: LabelColor[] = doc
    ? [
        {
          hex: editorDoc.background,
          opacity: editorDoc.backgroundOpacity ?? 1,
        },
        ...editorDoc.elements
          .filter((e) => e.type !== 'image')
          .flatMap((e) => [
            { hex: e.color, opacity: e.colorOpacity ?? 1 },
            { hex: e.fill, opacity: e.fillOpacity ?? 1 },
          ]),
      ].filter(
        (c, index, all) =>
          all.findIndex((v) => v.hex === c.hex && v.opacity === c.opacity) ===
          index,
      )
    : []
  function color(
    label: string,
    value: string,
    opacity: number,
    apply: (d: LabelDocument, c: LabelColor) => LabelDocument,
    allowNone = false,
    textToolbar = false,
    disabled = false,
  ) {
    // Color callbacks edit a layout. Route both live preview and Apply to the
    // selected side, just as change() does for the other layout controls.
    const applyToSide = (document: LabelDocument, color: LabelColor) => {
      if (editorSide === 'back' && document.back) {
        const next = apply({ ...document, ...document.back }, color)
        return {
          ...document,
          back: {
            ...document.back,
            ...Object.fromEntries(layoutKeys.map((key) => [key, next[key]])),
          },
        }
      }
      return apply(document, color)
    }
    return (
      <LabelColorPicker
        label={label}
        value={{ hex: value, opacity }}
        allowNone={allowNone}
        textToolbar={textToolbar}
        disabled={disabled}
        documentColors={documentColors}
        recent={recentColors}
        brand={
          (brand?.colorSwatches?.length ? brand.colorSwatches : null) ||
          brand?.colors?.map((hex: string) => ({ hex, opacity: 1 })) ||
          []
        }
        canSaveBrand={canEdit && !!brand}
        onSaveBrand={async (c, name) => {
          await request('labelBrandColor', { brandId, color: c, name })
        }}
        onBegin={() => {
          colorOriginal.current = current.current
          setColorEditing(true)
        }}
        onPreview={(c) => {
          if (current.current) {
            const next = applyToSide(current.current, c)
            current.current = next
            setDoc(next)
          }
        }}
        onCancel={() => {
          if (colorOriginal.current) {
            current.current = colorOriginal.current
            setDoc(colorOriginal.current)
          }
          colorOriginal.current = null
          setColorEditing(false)
        }}
        onApply={(c) => {
          if (!current.current) return
          const next = applyToSide(current.current, c)
          if (colorOriginal.current) {
            history.current = [
              ...history.current.slice(-39),
              colorOriginal.current,
            ]
            future.current = []
            colorOriginal.current = null
            current.current = next
            setDoc(next)
            setReviewed(false)
          } else commit(next)
          setColorEditing(false)
          setRecentColors((prev) => recentColorList(prev, c))
          if (canEdit && revision.current > 0)
            request('labelColorRecent', { color: c }).catch((e) =>
              setError(e.message),
            )
        }}
      />
    )
  }
  function elementColor(
    label: string,
    key: 'color' | 'fill',
    opacityKey: 'colorOpacity' | 'fillOpacity',
    allowNone = false,
    textToolbar = false,
  ) {
    if (!element || (element.locked && !textToolbar)) return null
    const id = element.id
    return color(
      label,
      element[key],
      element[opacityKey] ?? 1,
      (d, c) => ({
        ...d,
        elements: d.elements.map((e) =>
          e.id === id ? { ...e, [key]: c.hex, [opacityKey]: c.opacity } : e,
        ),
      }),
      allowNone,
      textToolbar,
      element.locked || (textToolbar && element.type !== 'text'),
    )
  }
  const { printerProfiles, selectedPrinter } = printerSelection(
    w,
    printingMethod,
  )
  const sourceControls = (
    <div className="studio-source">
      <Control label="Populate from">
        <select
          value={source.kind}
          onChange={(e) => {
            const kind = e.target.value as LabelSource['kind']
            changeSource({ kind, id: '' })
            setReviewed(false)
          }}
        >
          <option value="product">Product & recipe</option>
          <option value="batch">Batch run</option>
          <option value="ingredient">Pantry item</option>
        </select>
      </Control>
      <Control label={source.kind === 'product' ? 'Product' : 'Choose record'}>
        <select
          value={source.id}
          onChange={(e) => {
            changeSource({ kind: source.kind, id: e.target.value })
            setReviewed(false)
          }}
        >
          <option value="">Choose…</option>
          {sourceRows.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
              {source.kind === 'batch' ? ' · ' + r.date : ''}
            </option>
          ))}
        </select>
      </Control>
      {source.kind === 'batch' && (
        <Control label="Packaged product">
          <select
            value={source.productId || ''}
            onChange={(e) =>
              changeSource({ ...source, productId: e.target.value })
            }
          >
            <option value="">Choose product…</option>
            {w.products
              .filter(
                (p) =>
                  p.recipeId ===
                  w.batches.find((b) => b.id === source.id)?.recipeId,
              )
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </Control>
      )}
    </div>
  )
  const labelCheck = (
    <div className="studio-check">
      <div className="studio-panel-title">
        <h3>Label Check</h3>
        <span className={`status ${issues.length ? 'amber' : 'green'}`}>
          {issues.length ? <TriangleAlert size={14} /> : <Check size={14} />}
          {issues.length ? `${issues.length} to review` : 'Checks complete'}
        </span>
      </div>
      <p>Recordkeeping guidance. Confirm your local requirements.</p>
      {issues.length ? (
        <ul>
          {issues.map((i) => (
            <li key={i}>
              <TriangleAlert size={14} />
              <span>{i}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p>
          Review the final label and your local requirements before printing.
        </p>
      )}
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
    </div>
  )
  return (
    <div className="label-studio">
      <style>{fontCss()}</style>
      <style>
        {fontCss(
          [
            ...(doc
              ? labelSides(doc).flatMap((side) => labelSide(doc, side).elements)
              : []
            ).flatMap((e) => [
              e.font,
              ...(e.textRuns || []).map((r) => r.font),
            ]),
            ...libraryRecords.flatMap((t) =>
              labelSides(t)
                .flatMap((side) => labelSide(t, side).elements)
                .flatMap((e) => [
                  e.font,
                  ...(e.textRuns || []).map((r) => r.font),
                ]),
            ),
            brandDraft.headingFont,
            brandDraft.bodyFont,
            brandDraft.complianceFont,
            brandDraft.secondaryHeadingFont,
            brandDraft.accentFont,
          ].filter(Boolean),
          customFonts,
        )}
      </style>
      <nav className="studio-nav" aria-label="Label Studio sections">
        {sections.map((s) => (
          <button
            key={s}
            className={section === s ? 'active' : ''}
            aria-current={section === s ? 'page' : undefined}
            onClick={() => navigateStudio(s)}
          >
            {s}
          </button>
        ))}
        {doc && (
          <button
            className={section === 'Editor' ? 'active' : ''}
            onClick={() => setSection('Editor')}
          >
            Editor <ArrowRight size={15} />
          </button>
        )}
      </nav>
      {libraryStatus && (
        <p className="studio-notice" role="status">
          {libraryStatus}
        </p>
      )}
      {deleteTargets && (
        <DeleteDesignDialog
          documents={deleteTargets}
          kind={labelRecordKind(deleteTargets[0])}
          openDocumentId={doc?.id}
          affectedProducts={w.products
            .filter((p) => deleteTargets.some((t) => t.id === p.labelDesignId))
            .map((p) => p.name)}
          onDelete={deleteDesigns}
          onClose={() => setDeleteTargets(null)}
        />
      )}
      <div className="studio-recovery-bar">
        <button
          className="btn secondary"
          onClick={() => recoveryInput.current?.click()}
        >
          Import editable recovery file
        </button>
        <input
          ref={recoveryInput}
          type="file"
          accept=".json,application/json"
          aria-label="Editable label recovery file"
          hidden
          onChange={async (event) => {
            const file = event.target.files?.[0]
            if (!file) return
            try {
              if (file.size > 1_000_000)
                throw new Error('Recovery files must be at most 1 MB.')
              const value = JSON.parse(await file.text())
              if (
                value.format !== 'cottage-pantry-label-recovery' ||
                value.version !== 1
              )
                throw new Error(
                  'Choose a Cottage Pantry editable recovery file.',
                )
              recover(
                validateLabelDocument(value.document, customFonts),
                value.source,
                value.displayUnit,
              )
            } catch (e) {
              setError((e as Error).message)
            }
            event.target.value = ''
          }}
        />
        {doc && (
          <button className="btn secondary" onClick={exportRecovery}>
            Export editable recovery file
          </button>
        )}
      </div>
      {draftStatus && (
        <p
          role={
            draftStatus.startsWith('Recovery checkpoint failed')
              ? 'alert'
              : 'status'
          }
          className="studio-notice"
        >
          {draftStatus}
        </p>
      )}
      {!!w.label_recovery_drafts?.length && (
        <details className="studio-recovery-panel" open={!doc}>
          <summary>
            Recover interrupted label sessions ({w.label_recovery_drafts.length}
            )
          </summary>
          <p>
            These are private recovery checkpoints, not confirmed saved labels.
            Restore a separate editable copy to compare with the latest saved
            version. Existing labels remain intact.
          </p>
          {w.label_recovery_drafts.map((draft) => (
            <div key={draft.id}>
              <strong>{draft.name}</strong> ·{' '}
              {new Date(draft.savedAt).toLocaleString()} · based on revision{' '}
              {draft.baseRevision}
              <button
                className="text-button"
                disabled={saveBusy}
                onClick={() =>
                  recover(draft.document, draft.source, draft.displayUnit)
                }
              >
                Recover as editable copy
              </button>
            </div>
          ))}
        </details>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
          {saveFailed && (
            <button
              className="btn secondary"
              disabled={saveBusy}
              onClick={() => void saveDocument()}
            >
              Retry save
            </button>
          )}
        </p>
      )}
      {!canEdit && (
        <p className="studio-notice">
          Preview available. Connect as an Owner or Manager to save, upload, and
          export.
        </p>
      )}
      {section === 'Labels' && (
        <>
          <div className="studio-gallery-heading">
            <div>
              <span className="eyebrow">LABELS</span>
              <h2>Your labels</h2>
              <p>
                Create, choose a product, design, save and print. Duplicate a
                label to reuse its design.
              </p>
            </div>
            <button
              className="btn"
              disabled={saveBusy}
              onClick={() => createLabel()}
            >
              <Plus size={18} /> Create label
            </button>
          </div>
          <div className="studio-gallery-toolbar">
            <label className="search-field">
              <Search size={18} />
              <span className="sr-only">Search labels</span>
              <input
                placeholder="Search labels…"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                }}
              />
            </label>
            <Control label="Style filter">
              <select
                value={filter}
                onChange={(e) => {
                  setFilter(e.target.value)
                }}
              >
                {labelFilters.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </Control>
          </div>
          {!filteredRecords.length && (
            <p className="calm-empty">
              No labels to show. Create a label or clear the search.
            </p>
          )}
          {!!selectableLabels.length && (
            <div className="studio-selection-toolbar">
              <label>
                <input
                  type="checkbox"
                  aria-label="Select All filtered labels"
                  checked={
                    selectedLabels.length > 0 &&
                    selectedLabels.length === selectableLabels.length
                  }
                  onChange={(event) =>
                    setSelectedIds(
                      event.target.checked
                        ? selectableLabels.map((d) => d.id)
                        : [],
                    )
                  }
                />{' '}
                Select All
              </label>
              <span role="status">{selectedLabels.length} selected</span>
              <button
                className="text-button studio-delete-button"
                disabled={!canEdit || saveBusy || !selectedLabels.length}
                onClick={() => setDeleteTargets(selectedLabels)}
              >
                Delete Selected
              </button>
            </div>
          )}
          <div className="studio-label-list">
            {filteredRecords.map((t) => {
              const linkedSource = labelSource(w, t, initialProductId)
              const linkedProducts = w.products.filter(
                (p) => p.labelDesignId === t.id || p.id === t.productId,
              )
              const labelData = resolveLabelData(
                w,
                linkedSource,
                w.brand_kits?.find((b) => b.id === t.brandId),
              )
              const product = w.products.find(
                (p) => p.id === sourceProductId(linkedSource),
              )
              return (
                <article className="studio-label-row" key={t.id}>
                  <div className="studio-label-thumbnail">
                    <PairedLabelPreview
                      document={t}
                      data={labelData}
                      assets={assets}
                    />
                  </div>
                  <div className="studio-label-description">
                    {t.workflowVersion === 1 && (
                      <label className="studio-small-note">
                        <input
                          type="checkbox"
                          aria-label={'Select ' + t.name}
                          checked={selectedIds.includes(t.id)}
                          onChange={(event) =>
                            setSelectedIds((ids) =>
                              event.target.checked
                                ? [...ids, t.id]
                                : ids.filter((id) => id !== t.id),
                            )
                          }
                        />{' '}
                        Select
                      </label>
                    )}
                    <h3>{t.name}</h3>
                    <p>
                      {linkedProducts.length > 1
                        ? `${linkedProducts.length} linked products · Preserved shared design`
                        : product?.name ||
                          (t.workflowVersion === 1
                            ? 'No product link'
                            : 'Preserved design')}{' '}
                      · {(t.width / 72).toFixed(1)} ×{' '}
                      {(t.height / 72).toFixed(1)} in
                      {t.format === 'front-back' ? ' · Front + Back' : ''}
                    </p>
                  </div>
                  <div className="studio-library-actions">
                    <button
                      className="text-button"
                      aria-label={'Preview/Print ' + t.name}
                      onClick={() => {
                        if (choose(t, true)) setSection('Print & Export')
                      }}
                    >
                      Preview/Print
                    </button>
                    <button
                      className="text-button"
                      aria-label={'Edit ' + t.name}
                      onClick={() =>
                        t.workflowVersion === 1
                          ? choose(t, true)
                          : duplicateLabel(t)
                      }
                    >
                      Edit
                    </button>
                    <button
                      className="text-button"
                      aria-label={'Duplicate ' + t.name}
                      disabled={!canEdit || saveBusy}
                      onClick={() => duplicateLabel(t)}
                    >
                      <Copy size={16} /> Duplicate
                    </button>
                    {t.workflowVersion === 1 && (
                      <button
                        className="text-button studio-delete-button"
                        aria-label={'Delete ' + t.name}
                        disabled={!canEdit || saveBusy}
                        onClick={() => setDeleteTargets([t])}
                      >
                        <Trash2 size={16} /> Delete
                      </button>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
          {libraryRecords.some((t) => t.workflowVersion !== 1) && (
            <p className="studio-small-note">
              Existing designs and shared product links are preserved pending
              conversion review. Edit opens an independent unsaved copy;
              preview/print uses the original.
            </p>
          )}
        </>
      )}
      {section === 'Editor' && doc && (
        <>
          <div className="studio-editor-toolbar">
            <button
              className="icon-button"
              aria-label="Back to labels"
              onClick={() => navigateStudio('Labels')}
            >
              <ArrowLeft size={20} />
            </button>
            <Control label="Label name">
              <input
                value={doc.name}
                onChange={(e) => change({ name: e.target.value })}
              />
            </Control>
            <span className="studio-save-state" role="status">
              {saveBusy
                ? 'Saving…'
                : saveFailed
                  ? status
                  : dirty && !status.startsWith('Recovered')
                    ? 'Unsaved changes'
                    : status}
            </span>
            <button className="icon-button" aria-label="Undo" onClick={undo}>
              <Undo2 size={19} />
            </button>
            <button className="icon-button" aria-label="Redo" onClick={redo}>
              <Redo2 size={19} />
            </button>
            <button
              className="btn secondary"
              disabled={
                busy || saveBusy || !canEdit || doc.workflowVersion !== 1
              }
              onClick={() => void saveDocument()}
            >
              <Save size={17} /> Save
            </button>
            <button
              className="btn secondary"
              disabled={saveBusy}
              onClick={cancelEditor}
            >
              Cancel
            </button>
            <button
              className="text-button"
              disabled={saveBusy || !canEdit}
              onClick={() => duplicateLabel(doc)}
            >
              <Copy size={16} /> Duplicate
            </button>
            <button
              className="btn"
              onClick={() => setSection('Print & Export')}
            >
              <Printer size={17} /> Preview/Print
            </button>
          </div>
          {doc.workflowVersion !== 1 && (
            <p className="studio-notice">
              This existing design is preserved. Duplicate it to edit an
              independent label.
            </p>
          )}
          {doc.workflowVersion === 1 && doc.revision === 0 && (
            <>
              <p className="studio-small-note">
                Unsaved draft. Save creates a label; Cancel creates no record.
              </p>
              <button
                className="text-button"
                onClick={() => setShowStarters(!showStarters)}
              >
                Choose a starting design (optional)
              </button>
              {showStarters && (
                <div className="studio-starters">
                  {systemLabelTemplates.map((t) => (
                    <button
                      className="btn secondary"
                      key={t.id}
                      onClick={() => createLabel(t)}
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          {sourceControls}
          {doc.workflowVersion === 1 &&
            manualLabelFields(doc).length > 0 &&
            doc.manualTextReviewedFor !== sourceKey(source) && (
              <section className="studio-manual-review" role="alert">
                <h3>Review manually entered text</h3>
                <p>
                  The selected product changed or this design has no recorded
                  product source. Product-linked fields update automatically.
                  This editable text stays as entered:
                </p>
                <ul>
                  {manualLabelFields(doc).map((field) => (
                    <li key={field.id}>
                      {field.side === 'back' ? 'Back' : 'Front'}: {field.text}
                    </li>
                  ))}
                </ul>
                <label>
                  <input
                    type="checkbox"
                    checked={false}
                    onChange={() =>
                      change({ manualTextReviewedFor: sourceKey(source) })
                    }
                  />{' '}
                  I reviewed this manual text for the selected product.
                </label>
              </section>
            )}
          <div className="studio-set-toolbar">
            <Control label="Label format">
              <select
                value={doc.format || 'single'}
                onChange={(e) => {
                  if (e.target.value === 'front-back')
                    change({
                      format: 'front-back',
                      renderVersion: 2,
                      back: { ...labelLayout(doc), elements: [] },
                    })
                  else if (
                    !doc.back?.elements.length ||
                    window.confirm(
                      'Remove the Back layout from this draft? The saved version remains in history.',
                    )
                  ) {
                    change({ format: 'single', back: undefined })
                    setEditorSide('front')
                  }
                }}
              >
                <option value="single">Single label</option>
                <option value="front-back">Front + Back labels</option>
              </select>
            </Control>
            {doc.format === 'front-back' && (
              <div role="group" aria-label="Label side">
                {labelSides(doc).map((side) => (
                  <button
                    className="btn secondary"
                    key={side}
                    aria-pressed={editorSide === side}
                    onClick={() => {
                      setEditorSide(side)
                      setSelected('')
                      history.current = []
                      future.current = []
                    }}
                  >
                    {side === 'front' ? 'Front' : 'Back'}
                  </button>
                ))}
              </div>
            )}
          </div>
          {doc.format === 'front-back' && (
            <PairedLabelPreview document={doc} data={data} assets={assets} />
          )}
          <div className="studio-editor">
            <aside className="studio-left panel">
              <div className="studio-left-tabs">
                {['Elements', 'Assets', 'Layers'].map((t, i) => {
                  const Icon = [Type, ImagePlus, Layers][i]
                  return (
                    <button
                      key={t}
                      className={left === t ? 'active' : ''}
                      onClick={() => setLeft(t)}
                    >
                      <Icon size={17} />
                      {t}
                    </button>
                  )
                })}
              </div>
              {left === 'Elements' && (
                <div className="studio-element-list">
                  <h3>Add to your label</h3>
                  <button onClick={() => add(newElement())}>
                    <Type size={18} />
                    <span>Static text</span>
                  </button>
                  <Control label="Dynamic field">
                    <select
                      value=""
                      onChange={(e) => {
                        if (e.target.value)
                          add({
                            ...newElement(
                              imageBindings.includes(e.target.value)
                                ? 'image'
                                : 'text',
                              '',
                              e.target.value,
                            ),
                            ...(imageBindings.includes(e.target.value)
                              ? { width: 90, height: 90 }
                              : {}),
                            condition: 'nonempty',
                          })
                      }}
                    >
                      <option value="">Choose a field…</option>
                      <optgroup label="Text fields">
                        {bindings
                          .filter((b) => !imageBindings.includes(b))
                          .map((b) => (
                            <option key={b} value={b}>
                              {imageBindingNames[b] || b}
                            </option>
                          ))}
                      </optgroup>
                      <optgroup label="Images & graphics">
                        {imageBindings.map((b) => (
                          <option key={b} value={b}>
                            {imageBindingNames[b]}
                          </option>
                        ))}
                      </optgroup>
                    </select>
                  </Control>
                  <button
                    onClick={() =>
                      add({ ...newElement('shape'), width: 100, height: 50 })
                    }
                  >
                    <Shapes size={18} />
                    <span>Shape</span>
                  </button>
                  <button onClick={() => add(newElement('line'))}>
                    — Line / divider
                  </button>
                  <button
                    onClick={() =>
                      add({
                        ...newElement('border'),
                        width: editorDoc.width - 36,
                        height: editorDoc.height - 36,
                      })
                    }
                  >
                    <Grid2X2 size={18} />
                    <span>Border</span>
                  </button>
                  <div className="studio-small-note">
                    Select an element to edit it. Drag to move; use its corner
                    to resize. Arrow keys move precisely. Ctrl/Cmd+C and V copy
                    and paste.
                  </div>
                  <details>
                    <summary>Original bakery illustrations</summary>
                    <div className="studio-graphic-grid">
                      {Object.keys(bakeryGraphics).map((g) => (
                        <button
                          title={g}
                          aria-label={'Add ' + g}
                          key={g}
                          onClick={() =>
                            add({
                              ...newElement('illustration'),
                              graphic: g,
                              width: 60,
                              height: 60,
                            })
                          }
                        >
                          <svg viewBox="0 0 100 100">
                            <path d={bakeryGraphics[g]} />
                          </svg>
                          <small>{g}</small>
                        </button>
                      ))}
                    </div>
                  </details>
                </div>
              )}
              {left === 'Assets' && (
                <div className="studio-element-list">
                  <h3>Linked image fields</h3>
                  <p className="studio-small-note">
                    Follow the selected product or business automatically.
                  </p>
                  {imageBindings.map((binding) => (
                    <button
                      key={binding}
                      className="btn secondary"
                      onClick={() =>
                        add({
                          ...newElement('image'),
                          binding,
                          condition: 'nonempty',
                          width: 90,
                          height: 90,
                        })
                      }
                    >
                      <ImagePlus size={17} />
                      <span>{imageBindingNames[binding]}</span>
                    </button>
                  ))}

                  <button
                    className="btn secondary"
                    onClick={() => setSection('Graphics Library')}
                  >
                    <Upload size={17} />
                    <span>Upload graphics</span>
                  </button>
                  {assets.map((a) => (
                    <button
                      className="studio-asset-row"
                      key={a.id}
                      onClick={() =>
                        add({
                          ...newElement('image'),
                          assetId: a.id,
                          width: 90,
                          height: (90 * a.heightPx) / a.widthPx,
                        })
                      }
                    >
                      <img src={a.fileUrl} alt="" />
                      <span>{a.name}</span>
                    </button>
                  ))}
                </div>
              )}
              {left === 'Layers' && (
                <div className="studio-layer-list">
                  {[...editorDoc.elements].reverse().map((e) => (
                    <div
                      key={e.id}
                      className={selected === e.id ? 'selected' : ''}
                    >
                      <button onClick={() => setSelected(e.id)}>
                        {e.binding || e.text || e.type}
                      </button>
                      <button
                        aria-label={
                          (e.hidden ? 'Show ' : 'Hide ') + (e.binding || e.type)
                        }
                        onClick={() =>
                          change({
                            elements: editorDoc.elements.map((x) =>
                              x.id === e.id ? { ...x, hidden: !x.hidden } : x,
                            ),
                          })
                        }
                      >
                        {e.hidden ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                      <button
                        aria-label={
                          (e.locked ? 'Unlock ' : 'Lock ') +
                          (e.binding || e.type)
                        }
                        onClick={() =>
                          change({
                            elements: editorDoc.elements.map((x) =>
                              x.id === e.id ? { ...x, locked: !x.locked } : x,
                            ),
                          })
                        }
                      >
                        {e.locked ? (
                          <LockKeyhole size={16} />
                        ) : (
                          <UnlockKeyhole size={16} />
                        )}
                      </button>
                    </div>
                  ))}
                  {!editorDoc.elements.length && (
                    <p>Add text, graphics, or shapes to begin.</p>
                  )}
                </div>
              )}
            </aside>
            <div className="studio-stage-area">
              <div className="studio-canvas-tools">
                <button
                  className="icon-button"
                  aria-label="Zoom out"
                  onClick={() => setZoom((z) => Math.max(0.25, z - 0.1))}
                >
                  <ZoomOut size={18} />
                </button>
                <span>{Math.round(zoom * 100)}%</span>
                <button
                  className="icon-button"
                  aria-label="Zoom in"
                  onClick={() => setZoom((z) => Math.min(2, z + 0.1))}
                >
                  <ZoomIn size={18} />
                </button>
                <label>
                  <input
                    type="checkbox"
                    checked={safe}
                    onChange={(e) => setSafe(e.target.checked)}
                  />
                  Safe area
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={grid}
                    onChange={(e) => setGrid(e.target.checked)}
                  />
                  Grid
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={snap}
                    onChange={(e) => setSnap(e.target.checked)}
                  />
                  Snap
                </label>
                <label title="Snap rotation to 15° steps. Hold Shift while rotating to toggle.">
                  <input
                    type="checkbox"
                    checked={angleSnap}
                    onChange={(e) => setAngleSnap(e.target.checked)}
                  />
                  Snap angles
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={bleed}
                    onChange={(e) => setBleed(e.target.checked)}
                  />
                  Bleed guide
                </label>
              </div>
              <div className="studio-scroll-stage">
                <div
                  className={`studio-paper ${bleed ? 'with-bleed' : ''}`}
                  style={{
                    width: ((editorDoc.width * 96) / 72) * zoom,
                    height: ((editorDoc.height * 96) / 72) * zoom,
                  }}
                  onPointerDown={(event) => {
                    const target = event.target as Element,
                      id = target
                        .closest('[data-element]')
                        ?.getAttribute('data-element'),
                      e = editorDoc.elements.find((x) => x.id === id)
                    if (!e) {
                      setSelected('')
                      return
                    }
                    setSelected(e.id)
                    if (e.locked || event.button > 0) return
                    event.preventDefault()
                    event.currentTarget.setPointerCapture?.(event.pointerId)
                    const handle =
                        target
                          .closest('[data-handle]')
                          ?.getAttribute('data-handle') || '',
                      point = labelPoint(event)
                    drag.current = {
                      id: e.id,
                      x: point.x,
                      y: point.y,
                      original: structuredClone(editorDoc),
                      master: structuredClone(doc),
                      mode:
                        handle === 'rotate'
                          ? 'rotate'
                          : handle
                            ? 'resize'
                            : 'move',
                      handle:
                        handle && handle !== 'rotate'
                          ? (handle as ResizeHandle)
                          : undefined,
                      angle: pointerAngle(e, point),
                      moved: false,
                    }
                    if (handle === 'rotate') setRotating(true)
                  }}
                  onPointerMove={(event) => {
                    const move = drag.current
                    if (!move) return
                    const point = labelPoint(event),
                      dx = point.x - move.x,
                      dy = point.y - move.y,
                      original = move.original.elements.find(
                        (e) => e.id === move.id,
                      )!
                    if (!move.moved && Math.hypot(dx, dy) < 0.5) return
                    move.moved = true
                    const round = (v: number) =>
                      snap ? Math.round(v / 3) * 3 : v
                    let patch: Partial<LabelElement> | null = null
                    if (move.mode === 'rotate') {
                      const raw =
                        elementAngle(original) +
                        pointerAngle(original, point) -
                        move.angle
                      patch = setElementAngle(
                        original,
                        angleSnap !== event.shiftKey
                          ? snapAngle(raw)
                          : normalizeAngle(raw),
                      )
                    } else if (move.mode === 'resize' && move.handle)
                      patch = resizeElement(original, move.handle, point, {
                        // Shift temporarily toggles proportional resizing.
                        keepAspect: keepsAspect(original) !== event.shiftKey,
                        snap:
                          snap && !original.rotation
                            ? (v) => Math.round(v / 3) * 3
                            : undefined,
                      })
                    const nextSide = {
                      ...move.original,
                      elements: move.original.elements.map((e) => {
                        if (patch)
                          return e.id === move.id ? { ...e, ...patch } : e
                        if (
                          (e.id === move.id ||
                            (original.groupId &&
                              original.groupId === e.groupId)) &&
                          !e.locked
                        )
                          return {
                            ...e,
                            x: round(e.x + dx),
                            y: round(e.y + dy),
                          }
                        return e
                      }),
                    }
                    setDoc(
                      editorSide === 'back' && doc.back
                        ? { ...doc, back: labelLayout(nextSide) }
                        : { ...doc, ...labelLayout(nextSide) },
                    )
                  }}
                  onPointerUp={() => {
                    const move = drag.current
                    if (move) {
                      drag.current = null
                      setRotating(false)
                      // One continuous drag is one undo step; a plain click
                      // that only selects adds nothing to history.
                      if (move.moved) {
                        history.current = [
                          ...history.current.slice(-39),
                          move.master || move.original,
                        ]
                        future.current = []
                        setStatus('Unsaved changes')
                        setReviewed(false)
                      }
                    }
                  }}
                  onPointerCancel={() => {
                    if (drag.current) {
                      setDoc(drag.current.master || drag.current.original)
                      drag.current = null
                      setRotating(false)
                    }
                  }}
                >
                  <div className="studio-ruler" aria-hidden="true">
                    {Array.from(
                      { length: Math.ceil(editorDoc.width / 72) },
                      (_, i) => (
                        <span key={i}>{i}″</span>
                      ),
                    )}
                  </div>
                  <LabelCanvas
                    document={editorDoc}
                    data={data}
                    assets={assets}
                    svgRef={svgRef}
                    editor
                    selected={selected}
                    select={setSelected}
                    safe={safe}
                    grid={grid}
                    zoom={zoom}
                    rotating={rotating}
                  />
                </div>
              </div>
              <p className="studio-dimension">
                {(editorDoc.width / 72).toFixed(2)} ×{' '}
                {(editorDoc.height / 72).toFixed(2)} inches · dimensions, not
                screen size · ⅛″ safe margin
              </p>
              <details className="studio-mobile-data">
                <summary>Preview data & Label Check</summary>
                {sourceControls}
                {labelCheck}
              </details>
            </div>
            <aside className="studio-inspector panel">
              <div className="studio-panel-title">
                <SlidersHorizontal size={18} />
                <h3>{element ? 'Element settings' : 'Label setup'}</h3>
              </div>
              {element ? (
                <div className="studio-inspector-fields studio-element-fields">
                  <div className="studio-selection-heading">
                    <p className="studio-small-note" title={element.binding}>
                      {element.binding
                        ? 'Linked text / artwork'
                        : element.type === 'text'
                          ? 'Manually entered text'
                          : element.type}
                      {element.locked ? ' · locked' : ''}
                    </p>
                    <div className="studio-actions">
                      <button
                        className="icon-button"
                        aria-label="Duplicate element"
                        title="Duplicate element"
                        onClick={duplicate}
                      >
                        <Copy size={17} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label="Delete element"
                        title="Delete element"
                        disabled={element.locked}
                        onClick={() => {
                          change({
                            elements: editorDoc.elements.filter(
                              (e) => e.id !== selected,
                            ),
                          })
                          setSelected('')
                        }}
                      >
                        <Trash2 size={17} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label={
                          element.locked ? 'Unlock element' : 'Lock element'
                        }
                        title={
                          element.locked ? 'Unlock element' : 'Lock element'
                        }
                        onClick={() =>
                          change({
                            elements: editorDoc.elements.map((e) =>
                              e.id === selected
                                ? { ...e, locked: !e.locked }
                                : e,
                            ),
                          })
                        }
                      >
                        {element.locked ? (
                          <LockKeyhole size={17} />
                        ) : (
                          <UnlockKeyhole size={17} />
                        )}
                      </button>
                    </div>
                  </div>
                  <LabelTextToolbar
                    key={`text-${element.id}`}
                    element={element}
                    onPatch={patchElement}
                    supportsBold={
                      !!availableFonts
                        .find((f) => f.name === element.font)
                        ?.weights.includes(700)
                    }
                    fontPicker={
                      <FontPicker
                        onUploadRequest={() => setSection('Brand Kit')}
                        customFonts={customFonts}
                        compact
                        displayValue={textFontName(element)}
                        value={element.font}
                        disabled={element.locked || element.type !== 'text'}
                        preview={elementText(element, data)}
                        preferences={w.settings[0].currentFontPreferences}
                        onPreferences={
                          canEdit ? saveFontPreferences : undefined
                        }
                        onChange={(font) =>
                          patchElement({
                            font,
                            ...(!element.binding && element.textRuns
                              ? {
                                  textRuns: applySelectionFont(
                                    element,
                                    0,
                                    element.text.length,
                                    font,
                                  ),
                                }
                              : {}),
                            bold:
                              element.bold &&
                              !!availableFonts
                                .find((f) => f.name === font)
                                ?.weights.includes(700),
                          })
                        }
                      />
                    }
                    colorPicker={elementColor(
                      'Text color',
                      'color',
                      'colorOpacity',
                      false,
                      true,
                    )}
                  />
                  <LabelGeometryToolbar
                    key={`geometry-${element.id}`}
                    element={element}
                    onPatch={patchElement}
                    atFront={editorDoc.elements.at(-1)?.id === selected}
                    atBack={editorDoc.elements[0]?.id === selected}
                    onLayer={(layer) =>
                      change({
                        elements:
                          layer === 'front'
                            ? [
                                ...editorDoc.elements.filter(
                                  (e) => e.id !== selected,
                                ),
                                element,
                              ]
                            : [
                                element,
                                ...editorDoc.elements.filter(
                                  (e) => e.id !== selected,
                                ),
                              ],
                      })
                    }
                  />
                  {element.type === 'text' && (
                    <>
                      <Control label="Data binding">
                        <select
                          value={element.binding || ''}
                          disabled={element.locked}
                          onChange={(e) =>
                            patchElement({
                              binding: e.target.value || undefined,
                              textRuns: undefined,
                            })
                          }
                        >
                          <option value="">Static text</option>
                          {bindings
                            .filter((b) => !imageBindings.includes(b))
                            .map((b) => (
                              <option key={b} value={b}>
                                {imageBindingNames[b] || b}
                              </option>
                            ))}
                        </select>
                      </Control>
                      {!element.binding && (
                        <Control label="Text">
                          <textarea
                            value={element.text}
                            disabled={element.locked}
                            onChange={(e) =>
                              patchElement(
                                editStaticText(element, e.target.value),
                              )
                            }
                            onSelect={(e) =>
                              setTextSelection([
                                e.currentTarget.selectionStart,
                                e.currentTarget.selectionEnd,
                              ])
                            }
                          />
                        </Control>
                      )}
                    </>
                  )}
                  {element.type === 'image' && (
                    <>
                      <Control label="Image source">
                        <select
                          value={element.binding || 'static'}
                          onChange={(e) =>
                            patchElement({
                              binding:
                                e.target.value === 'static'
                                  ? undefined
                                  : e.target.value,
                              assetId: undefined,
                            })
                          }
                        >
                          <option value="static">Fixed uploaded graphic</option>
                          {imageBindings.map((b) => (
                            <option key={b} value={b}>
                              {imageBindingNames[b] || b}
                            </option>
                          ))}
                        </select>
                      </Control>
                      {element.binding ? (
                        <p className="studio-small-note">
                          Linked to{' '}
                          {imageBindingNames[element.binding] ||
                            element.binding}
                          .{' '}
                          {assets.find(
                            (a) => a.id === elementAssetId(element, data),
                          )?.name ||
                            'No artwork linked for the selected source.'}
                        </p>
                      ) : (
                        <>
                          <Control label="Graphic">
                            <select
                              value={element.assetId}
                              onChange={(e) =>
                                patchElement({ assetId: e.target.value })
                              }
                            >
                              {assets.map((a) => (
                                <option key={a.id} value={a.id}>
                                  {a.name}
                                </option>
                              ))}
                            </select>
                          </Control>
                        </>
                      )}
                      <Control label="Image fit">
                        <select
                          value={element.fit || 'contain'}
                          onChange={(e) =>
                            patchElement({
                              fit: e.target.value as 'contain' | 'cover',
                            })
                          }
                        >
                          <option value="contain">
                            Fit whole image (preserve aspect ratio)
                          </option>
                          <option value="cover">Crop to fill frame</option>
                        </select>
                      </Control>
                      {element.binding === 'product.graphic' &&
                        !elementAssetId(element, data) && (
                          <button
                            className="btn secondary"
                            onClick={() => {
                              setImageTarget('productGraphic')
                              setImageProductId(
                                source.kind === 'product'
                                  ? source.id
                                  : source.productId || '',
                              )
                              setSection('Graphics Library')
                            }}
                          >
                            Upload / select product label graphic
                          </button>
                        )}
                    </>
                  )}
                  {element.type !== 'image' &&
                    element.type !== 'text' &&
                    elementColor(
                      element.type === 'illustration'
                        ? 'Vector stroke color'
                        : 'Stroke / border color',
                      'color',
                      'colorOpacity',
                    )}
                  {element.type === 'shape' &&
                    elementColor('Shape fill', 'fill', 'fillOpacity', true)}
                  <details className="studio-advanced">
                    <summary>Advanced</summary>
                    <div className="studio-advanced-fields">
                      {element.type === 'text' && (
                        <>
                          {!element.binding && (
                            <div
                              className="studio-field"
                              role="group"
                              aria-label="Font for selected text"
                            >
                              <span>Font for selected text</span>
                              <small>
                                Select a word or range in Text to change its
                                font.
                              </small>
                              <FontPicker
                                value={element.font}
                                displayValue={textFontName(
                                  element,
                                  textSelection,
                                )}
                                customFonts={customFonts}
                                disabled={
                                  element.locked ||
                                  textSelection[1] <= textSelection[0]
                                }
                                preview={element.text.slice(...textSelection)}
                                onUploadRequest={() => setSection('Brand Kit')}
                                onChange={(font) => {
                                  try {
                                    patchElement({
                                      textRuns: applySelectionFont(
                                        element,
                                        ...textSelection,
                                        font,
                                      ),
                                    })
                                  } catch (e) {
                                    setError((e as Error).message)
                                  }
                                }}
                              />
                            </div>
                          )}
                          <Control label="Font pairing">
                            <select
                              value=""
                              onChange={(e) => {
                                const pairing = fontPairings.find(
                                  (p) => p.name === e.target.value,
                                )
                                if (pairing)
                                  change({
                                    elements: applyFontPairing(
                                      editorDoc.elements,
                                      pairing,
                                    ),
                                  })
                              }}
                            >
                              <option value="">
                                Apply a pairing · locked elements stay unchanged
                              </option>
                              {fontPairings.map((p) => (
                                <option key={p.name}>{p.name}</option>
                              ))}
                            </select>
                          </Control>
                          <button
                            className="text-button"
                            disabled={element.locked}
                            onClick={() => {
                              let size = element.fontSize
                              while (
                                size > 7 &&
                                labelTextLines(
                                  { ...element, fontSize: size },
                                  data,
                                ).length *
                                  size *
                                  element.lineHeight >
                                  element.height
                              )
                                size = Math.max(7, size - 0.5)
                              patchElement({ fontSize: size })
                            }}
                          >
                            Fit text to box (minimum 7 pt)
                          </button>
                          {elementColor(
                            'Text background',
                            'fill',
                            'fillOpacity',
                            true,
                          )}
                        </>
                      )}
                      <Control label="Group ID (same ID moves together)">
                        <input
                          disabled={element.locked}
                          value={element.groupId || ''}
                          onChange={(e) =>
                            patchElement({
                              groupId: e.target.value || undefined,
                            })
                          }
                        />
                      </Control>
                      <Control label="Show element">
                        <select
                          disabled={element.locked}
                          value={element.condition || 'always'}
                          onChange={(e) =>
                            patchElement({
                              condition: e.target
                                .value as LabelElement['condition'],
                            })
                          }
                        >
                          <option value="always">Always</option>
                          <option value="nonempty">
                            When field has a value
                          </option>
                          <option value="allergens">
                            When allergens are declared
                          </option>
                          <option value="batch">
                            When a batch is selected
                          </option>
                        </select>
                      </Control>
                      <details>
                        <summary>Editor help</summary>
                        <p className="studio-small-note">
                          Drag to move; use edge handles to resize and the round
                          handle to rotate. Images and icons keep their
                          proportions. Hold Shift to resize freely or toggle
                          angle snapping. Elements with the same Group ID move
                          together. Use separate Label main name and Label
                          product type fields for font pairings.
                        </p>
                      </details>
                    </div>
                  </details>
                  <button
                    className="text-button"
                    onClick={() => setSelected('')}
                  >
                    Edit label setup
                  </button>
                </div>
              ) : (
                <div className="studio-inspector-fields">
                  <Control label="Label type">
                    <select
                      value={editorDoc.labelType}
                      onChange={(e) => change({ labelType: e.target.value })}
                    >
                      {labelTypes.map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </Control>
                  <Control label="Label size">
                    <select
                      value=""
                      onChange={(e) => {
                        if (e.target.value === '') return
                        const size = labelSizes[Number(e.target.value)]
                        if (size) {
                          dimensions(size.w, size.h)
                          setDoc((prev) =>
                            prev ? { ...prev, round: !!size.round } : prev,
                          )
                        }
                      }}
                    >
                      <option value="">Custom / choose preset</option>
                      {labelSizes.map((s, i) => (
                        <option key={s.name} value={i}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </Control>
                  <Control label="Dimension display">
                    <select
                      value={displayUnit}
                      onChange={(e) => {
                        setDisplayUnit(e.target.value as typeof displayUnit)
                        change({
                          displayUnit: e.target.value as typeof displayUnit,
                        })
                      }}
                    >
                      <option value="in">Inches</option>
                      <option value="mm">Millimeters</option>
                      <option value="px">Pixels (96 DPI screen)</option>
                    </select>
                  </Control>
                  <div className="studio-two">
                    {number(
                      'Width (' + displayUnit + ')',
                      Number(
                        (
                          editorDoc.width /
                          (displayUnit === 'in'
                            ? 72
                            : displayUnit === 'mm'
                              ? 72 / 25.4
                              : 0.75)
                        ).toFixed(2),
                      ),
                      (v) =>
                        dimensions(
                          v *
                            (displayUnit === 'in'
                              ? 72
                              : displayUnit === 'mm'
                                ? 72 / 25.4
                                : 0.75),
                          editorDoc.height,
                        ),
                      0.5,
                    )}
                    {number(
                      'Height (' + displayUnit + ')',
                      Number(
                        (
                          editorDoc.height /
                          (displayUnit === 'in'
                            ? 72
                            : displayUnit === 'mm'
                              ? 72 / 25.4
                              : 0.75)
                        ).toFixed(2),
                      ),
                      (v) =>
                        dimensions(
                          editorDoc.width,
                          v *
                            (displayUnit === 'in'
                              ? 72
                              : displayUnit === 'mm'
                                ? 72 / 25.4
                                : 0.75),
                        ),
                      0.5,
                    )}
                  </div>
                  <button
                    className="btn secondary"
                    onClick={() =>
                      dimensions(editorDoc.height, editorDoc.width)
                    }
                  >
                    Rotate orientation
                  </button>
                  {color(
                    'Label background',
                    editorDoc.background,
                    editorDoc.backgroundOpacity ?? 1,
                    (d, c) => ({
                      ...d,
                      background: c.hex,
                      backgroundOpacity: c.opacity,
                    }),
                    true,
                  )}
                  {sourceControls}
                  <Control label="Brand kit">
                    <select
                      value={brandId}
                      onChange={(e) => {
                        setBrandId(e.target.value)
                        if (doc?.workflowVersion === 1)
                          change({ brandId: e.target.value })
                      }}
                    >
                      <option value="">Business defaults</option>
                      {(w.brand_kits || []).map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </Control>
                  {brand?.primaryLogoAssetId && (
                    <button
                      className="btn secondary"
                      onClick={() =>
                        add({
                          ...newElement('image'),
                          binding: 'business.logo',
                          condition: 'nonempty',
                          width: 70,
                          height: 70,
                        })
                      }
                    >
                      Add brand logo
                    </button>
                  )}
                  {brand && (
                    <button
                      className="btn secondary"
                      onClick={() =>
                        change({
                          background: brand.colors[1] || '#ffffff',
                          elements: applyFontPairing(editorDoc.elements, {
                            name: 'Brand Kit',
                            heading: brand.headingFont || 'Oswald',
                            body: brand.bodyFont || 'DM Sans',
                            compliance: brand.complianceFont || 'DM Sans',
                            accent: brand.accentFont,
                          }).map((e) =>
                            e.locked
                              ? e
                              : { ...e, color: brand.colors[0] || '#292630' },
                          ),
                        })
                      }
                    >
                      <Palette size={17} />
                      Apply brand style
                    </button>
                  )}
                  {labelCheck}
                  <details>
                    <summary>Saved versions</summary>
                    {(w.label_versions || [])
                      .filter((v) => v.templateId === doc.id)
                      .slice()
                      .reverse()
                      .map((v) => (
                        <button
                          className="text-button"
                          key={v.id}
                          onClick={() =>
                            commit({
                              ...v.document,
                              revision: revision.current,
                            })
                          }
                        >
                          Restore v{v.revision} ·{' '}
                          {new Date(v.savedAt).toLocaleString()}
                        </button>
                      ))}
                  </details>
                </div>
              )}
            </aside>
          </div>
        </>
      )}
      {section === 'Graphics Library' && (
        <>
          <div className="studio-gallery-heading">
            <div>
              <h2>Your artwork, close at hand.</h2>
              <p>
                Original files stay private to your business. PNG, JPEG, WebP ·
                up to 5 MB.
              </p>
            </div>
            <label className="btn">
              <Upload size={18} />
              Upload graphic
              <input
                className="sr-only"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={busy || !canEdit}
                onChange={(e) => {
                  if (e.target.files?.[0]) void upload(e.target.files[0])
                }}
              />
            </label>
          </div>
          <div className="panel panel-body" style={{ marginBottom: 24 }}>
            <h3>Link artwork to label data</h3>
            <p>
              Choose a role before uploading, or link an existing graphic below.
            </p>
            <div className="studio-two">
              <Control label="Use artwork for">
                <select
                  value={imageTarget}
                  onChange={(e) => setImageTarget(e.target.value)}
                >
                  <option value="library">Library only · fixed graphic</option>
                  <option value="businessLogo">Business logo</option>
                  <option value="productPhoto">Product photo</option>
                  <option value="productGraphic">
                    Product graphic / illustration
                  </option>
                </select>
              </Control>
              {imageTarget.startsWith('product') && (
                <Control label="Artwork product">
                  <select
                    value={imageProductId}
                    onChange={(e) => setImageProductId(e.target.value)}
                  >
                    <option value="">Choose product…</option>
                    {w.products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </Control>
              )}
            </div>
          </div>
          <div
            className="studio-upload-drop"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              if (e.dataTransfer.files[0]) void upload(e.dataTransfer.files[0])
            }}
          >
            <Upload size={26} />
            <strong>Drop your logo or artwork here</strong>
            <p>
              For sharp printing, aim for 300 pixels per inch. SVG/PDF uploads
              and background removal are not available.
            </p>
            <div className="studio-two">
              <Control label="Asset category">
                <select
                  value={uploadCategory}
                  onChange={(e) => setUploadCategory(e.target.value)}
                >
                  {[
                    'logo',
                    'product photo',
                    'illustration',
                    'seasonal',
                    'divider',
                    'icon',
                    'background',
                  ].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </Control>
              <Control label="Collection">
                <input
                  value={collection}
                  onChange={(e) => setCollection(e.target.value)}
                />
              </Control>
            </div>
          </div>
          <Control label="Search graphics / collections">
            <input
              value={assetQuery}
              onChange={(e) => setAssetQuery(e.target.value)}
              placeholder="Logo, seasonal, bread…"
            />
          </Control>
          <div className="studio-assets-grid">
            {assets
              .filter((a) =>
                [a.name, a.category, a.collection, a.tags]
                  .join(' ')
                  .toLowerCase()
                  .includes(assetQuery.toLowerCase()),
              )
              .map((a) => (
                <article className="panel" key={a.id}>
                  <img src={a.fileUrl} alt={a.name} />
                  <h3>{a.name}</h3>
                  <p>
                    {a.widthPx} × {a.heightPx} px · {a.collection}
                  </p>
                  <p>
                    300 DPI: {(a.widthPx / 300).toFixed(1)} ×{' '}
                    {(a.heightPx / 300).toFixed(1)} in
                  </p>
                  {imageTarget !== 'library' && (
                    <button
                      className="btn secondary"
                      disabled={!canEdit || busy}
                      onClick={() => {
                        setBusy(true)
                        linkArtwork(a.id)
                          .catch((e) => setError(e.message))
                          .finally(() => setBusy(false))
                      }}
                    >
                      Link as{' '}
                      {imageTarget === 'businessLogo'
                        ? 'business logo'
                        : imageTarget === 'productPhoto'
                          ? 'product photo'
                          : 'product graphic'}
                    </button>
                  )}
                  {doc && (
                    <button
                      className="text-button"
                      onClick={() => {
                        add({
                          ...newElement('image'),
                          assetId: a.id,
                          width: 90,
                          height: (90 * a.heightPx) / a.widthPx,
                        })
                        setSection('Editor')
                      }}
                    >
                      Add to current label <Plus size={16} />
                    </button>
                  )}
                </article>
              ))}
          </div>
          <h3 className="spaced-title">Original bakery collection</h3>
          <div className="studio-graphic-grid library">
            {Object.keys(bakeryGraphics).map((g) => (
              <button
                key={g}
                disabled={!doc}
                onClick={() => {
                  add({
                    ...newElement('illustration'),
                    graphic: g,
                    width: 60,
                    height: 60,
                  })
                  setSection('Editor')
                }}
              >
                <svg viewBox="0 0 100 100">
                  <path d={bakeryGraphics[g]} />
                </svg>
                <span>{g}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {['Brand Kit', 'Label Settings'].includes(section) && (
        <FontUploadPanel
          workspace={w}
          onWorkspace={onWorkspace}
          canEdit={canEdit}
        />
      )}
      {section === 'Brand Kit' && (
        <div className="studio-brand-layout">
          <section className="panel studio-brand-form">
            <h2>Make it unmistakably yours.</h2>
            <p>Save multiple palettes for different product lines.</p>
            <Control label="Saved brand kits">
              <select
                value={brandDraft.id}
                onChange={(e) =>
                  setBrandDraft(
                    (w.brand_kits || []).find(
                      (b) => b.id === e.target.value,
                    ) || {
                      id: '',
                      name: 'New brand',
                      colors: ['#742b60', '#fffdf6'],
                      contact: {},
                    },
                  )
                }
              >
                <option value="">New brand kit</option>
                {(w.brand_kits || []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </Control>
            <Control label="Kit name">
              <input
                value={brandDraft.name}
                onChange={(e) =>
                  setBrandDraft({ ...brandDraft, name: e.target.value })
                }
              />
            </Control>
            <div className="studio-brand-colors">
              {brandDraft.colors.map((c: string, i: number) => (
                <label key={i}>
                  <span>Color {i + 1}</span>
                  <input
                    type="color"
                    value={c}
                    onChange={(e) =>
                      setBrandDraft({
                        ...brandDraft,
                        colors: brandDraft.colors.map((v: string, j: number) =>
                          i === j ? e.target.value : v,
                        ),
                      })
                    }
                  />
                </label>
              ))}
              <button
                className="icon-button"
                aria-label="Add brand color"
                disabled={brandDraft.colors.length >= 12}
                onClick={() =>
                  setBrandDraft({
                    ...brandDraft,
                    colors: [...brandDraft.colors, '#ffffff'],
                  })
                }
              >
                <Plus size={18} />
              </button>
            </div>
            <Control label="Default font pairing">
              <select
                value={brandDraft.defaultFontPairing || ''}
                onChange={(e) => {
                  const p = fontPairings.find((p) => p.name === e.target.value)
                  if (p)
                    setBrandDraft({
                      ...brandDraft,
                      defaultFontPairing: p.name,
                      headingFont: p.heading,
                      bodyFont: p.body,
                      complianceFont: p.compliance,
                      accentFont: p.accent || p.heading,
                    })
                }}
              >
                <option value="">Custom typography</option>
                {fontPairings.map((p) => (
                  <option key={p.name}>{p.name}</option>
                ))}
              </select>
            </Control>
            {[
              'headingFont',
              'secondaryHeadingFont',
              'bodyFont',
              'complianceFont',
              'accentFont',
            ].map((key) => (
              <Control key={key} label={key.replace('Font', ' font')}>
                <FontPicker
                  onUploadRequest={() => setSection('Brand Kit')}
                  customFonts={customFonts}
                  value={brandDraft[key] || 'DM Sans'}
                  onChange={(font) =>
                    setBrandDraft({ ...brandDraft, [key]: font })
                  }
                  preferences={w.settings[0].currentFontPreferences}
                  onPreferences={canEdit ? saveFontPreferences : undefined}
                />
              </Control>
            ))}
            <label className="btn secondary">
              <Upload size={17} />
              Upload business logo
              <input
                type="file"
                className="sr-only"
                accept="image/png,image/jpeg,image/webp"
                disabled={busy || !canEdit}
                onChange={(e) => {
                  if (e.target.files?.[0])
                    void upload(
                      e.target.files[0],
                      'businessLogo',
                      brandDraft.id || undefined,
                    )
                }}
              />
            </label>
            {['primaryLogoAssetId', 'secondaryLogoAssetId', 'markAssetId'].map(
              (key) => (
                <Control
                  key={key}
                  label={key.replace('AssetId', '').replace(/([A-Z])/g, ' $1')}
                >
                  <select
                    value={brandDraft[key] || ''}
                    onChange={(e) =>
                      setBrandDraft({ ...brandDraft, [key]: e.target.value })
                    }
                  >
                    <option value="">No logo</option>
                    {assets.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </Control>
              ),
            )}
            <details>
              <summary>Business information & default label text</summary>
              {[
                'name',
                'address',
                'website',
                'phone',
                'email',
                'jurisdiction',
                'socialHandle',
              ].map((k) => (
                <Control label={'Business ' + k} key={k}>
                  <input
                    value={brandDraft.contact?.[k] || ''}
                    placeholder={w.settings[0]?.[k] || ''}
                    onChange={(e) =>
                      setBrandDraft({
                        ...brandDraft,
                        contact: { ...brandDraft.contact, [k]: e.target.value },
                      })
                    }
                  />
                </Control>
              ))}
              {['defaultDisclaimer', 'defaultStorage', 'defaultFooter'].map(
                (k) => (
                  <Control label={k.replace('default', 'Default ')} key={k}>
                    <textarea
                      value={brandDraft[k] || ''}
                      onChange={(e) =>
                        setBrandDraft({ ...brandDraft, [k]: e.target.value })
                      }
                    />
                  </Control>
                ),
              )}
            </details>
            <button
              className="btn"
              disabled={busy || !canEdit}
              onClick={async () => {
                setBusy(true)
                try {
                  const result = await request('labelBrand', brandDraft)
                  setBrandDraft(
                    result.brand_kits.find((b) => b.id === brandDraft.id) ||
                      result.brand_kits.at(-1)!,
                  )
                  setStatus('Brand kit saved')
                } catch (e) {
                  setError((e as Error).message)
                } finally {
                  setBusy(false)
                }
              }}
            >
              <Save size={17} />
              Save brand kit
            </button>
            <p role="status">{status}</p>
          </section>
          <aside
            className="studio-brand-preview"
            style={{
              background: brandDraft.colors[1] || '#fffdf6',
              color: brandDraft.colors[0],
            }}
          >
            <Wheat size={55} />
            <span>YOUR BRAND, BEAUTIFULLY CONSISTENT</span>
            <h2 style={{ fontFamily: brandDraft.headingFont || 'Oswald' }}>
              {brandDraft.contact?.name || w.settings[0].name}
            </h2>
            <p style={{ fontFamily: brandDraft.bodyFont || 'DM Sans' }}>
              Made by hand. Labeled with care.
            </p>
          </aside>
        </div>
      )}
      {section === 'Print & Export' &&
        (doc ? (
          <div className="studio-print-layout">
            <section className="panel studio-print-controls">
              <h2>Preview and print</h2>
              {doc.workflowVersion === 1 && (
                <div className="button-row">
                  <button
                    className="btn secondary"
                    disabled={saveBusy || !canEdit}
                    onClick={() => void saveDocument()}
                  >
                    Save label
                  </button>
                  <button
                    className="btn secondary"
                    onClick={() => setSection('Editor')}
                  >
                    Edit label
                  </button>
                  <button
                    className="btn secondary"
                    disabled={saveBusy}
                    onClick={cancelEditor}
                  >
                    Cancel
                  </button>
                  {dirty && (
                    <p role="status">
                      Save your changes before printing. Review manually entered
                      product text in the editor when changing products.
                    </p>
                  )}
                </div>
              )}
              {sourceControls}
              <LabelSetControls
                document={doc}
                products={copies}
                parts={parts}
                setParts={(v) => {
                  setParts(v)
                  updatePrint({ parts: v })
                  setRunIndex(0)
                }}
                order={order}
                setOrder={(v) => {
                  setOrder(v)
                  updatePrint({ order: v })
                }}
                runIndex={runIndex}
                setRunIndex={setRunIndex}
              />
              <LabelPrintOptions
                doc={doc}
                printerProfiles={printerProfiles}
                selectedPrinter={selectedPrinter}
                printingMethod={printingMethod}
                setPrintingMethod={(value) => {
                  setPrintingMethod(value)
                  updatePrint({ printingMethod: value })
                }}
                connected={connected}
                copies={copies}
                setCopies={(v) => {
                  setCopies(v)
                  updatePrint({ copies: v })
                }}
                layout={layout}
                setLayout={(v) => {
                  setLayout(v)
                  updatePrint({ layout: v })
                }}
                onManagePrinters={() => setSection('Label Settings')}
              />
              <div className="studio-print-buttons">
                <button
                  className="btn"
                  disabled={busy || !canEdit || colorEditing}
                  onClick={() => void output('print')}
                >
                  <Printer size={18} />
                  {busy
                    ? 'Preparing…'
                    : selectedPrinter?.method === 'qz'
                      ? `Print to ${selectedPrinter.name}`
                      : 'Print labels'}
                </button>
                <button
                  className="btn secondary"
                  disabled={busy || !canEdit}
                  onClick={() => void output('pdf')}
                >
                  <Download size={18} />
                  Download PDF
                </button>
                <button
                  className="btn secondary"
                  disabled={busy || !canEdit}
                  onClick={() => void output('png')}
                >
                  <Download size={18} />
                  Single PNG · 300 DPI
                </button>
              </div>
              <p className="studio-small-note">
                Match your printer paper size and use actual size / 100%
                scaling. Set driver copies to 1: the document already contains
                the requested labels. Browser code cannot force every driver
                option. Fonts and graphics finish loading before the print
                dialog opens. Screen RGB colors are not guaranteed CMYK or exact
                printed matches.
              </p>
              {labelCheck}
            </section>
            <div className="studio-print-preview">
              {doc.format === 'front-back' && (
                <PairedLabelPreview
                  document={doc}
                  data={data}
                  assets={assets}
                />
              )}
              <span className="eyebrow">
                ACTUAL LABEL: {(editorDoc.width / 72).toFixed(2)} ×{' '}
                {(editorDoc.height / 72).toFixed(2)} IN
              </span>
              {layout.mode === 'sheet' ? (
                <div
                  className="studio-sheet-preview"
                  style={{
                    aspectRatio: `${layout.pageWidth}/${layout.pageHeight}`,
                    padding: `${(layout.margin / layout.pageWidth) * 100}%`,
                    gap: `${(layout.gutter / layout.pageWidth) * 100}%`,
                    gridTemplateColumns: `repeat(${Math.max(1, Math.min(20, layout.columns))},1fr)`,
                  }}
                >
                  {Array.from(
                    {
                      length: Math.min(
                        200,
                        Math.max(1, layout.columns * layout.rows),
                      ),
                    },
                    (_, i) => (
                      <LabelCanvas
                        key={i}
                        document={editorDoc}
                        data={data}
                        assets={assets}
                        svgRef={i === 0 ? svgRef : undefined}
                      />
                    ),
                  )}
                </div>
              ) : (
                <div
                  style={{
                    maxWidth: Math.min(520, editorDoc.width * 1.6),
                    margin: 'auto',
                  }}
                >
                  <LabelCanvas
                    document={editorDoc}
                    data={data}
                    assets={assets}
                    svgRef={svgRef}
                  />
                </div>
              )}
              <p>
                {copies} copies ·{' '}
                {layout.mode === 'sheet'
                  ? Math.ceil(copies / (layout.columns * layout.rows))
                  : copies}{' '}
                pages
              </p>
            </div>
          </div>
        ) : (
          <div className="calm-empty">
            <Printer size={35} />
            <h2>Choose a label first.</h2>
            <button className="btn" onClick={() => navigateStudio('Labels')}>
              Browse labels
            </button>
          </div>
        ))}
      {section === 'Label Settings' && (
        <>
          <LabelPrinterSettings
            profiles={printerProfiles}
            canEdit={canEdit}
            width={editorDoc?.width}
            height={editorDoc?.height}
            save={async (data) => {
              await request('labelPrinterProfile', data)
            }}
            onTest={testPrinter}
            onConnection={setConnected}
          />
          <section className="panel studio-label-settings">
            <h2>Thoughtful defaults for real print jobs.</h2>
            <p>
              All document coordinates are stored in points (72 pt = 1 inch).
              Bundled fonts include their open licenses. Google Fonts load on
              demand. Supported fonts are embedded into PDF exports; unavailable
              or unsupported fonts produce an error instead of a substitute.
            </p>
            <div className="studio-two">
              <div>
                <h3>Label sizes</h3>
                <p>
                  Use presets, round labels, or custom dimensions in the editor.
                  Size changes scale the design; review text and safe areas
                  after resizing.
                </p>
              </div>
              <div>
                <h3>Food information</h3>
                <p>
                  Ingredient declarations use saved supplier details and
                  verified conversions. Confirm finished-product ordering,
                  missing subingredients, allergens, dates, and local labeling
                  requirements.
                </p>
              </div>
            </div>
            <button
              className="btn secondary"
              onClick={() => setSection('Brand Kit')}
            >
              Edit brand defaults <ArrowRight size={16} />
            </button>
            <details>
              <summary>Print history</summary>
              {(w.label_print_jobs || [])
                .slice()
                .reverse()
                .map((j) => (
                  <div className="studio-history-row" key={j.id}>
                    <strong>{j.name}</strong>
                    <span>
                      {j.outputType.toUpperCase()} · {j.copies} copies ·{' '}
                      {new Date(j.createdAt).toLocaleString()}
                    </span>
                    <span className="status neutral">
                      {j.status === 'exported'
                        ? 'PDF exported'
                        : 'Export prepared'}
                    </span>
                  </div>
                ))}
              {!w.label_print_jobs?.length && <p>No exports recorded yet.</p>}
            </details>
            <details>
              <summary>Beyond this release</summary>
              <p>
                QR/barcode generation, curved text, variable-data runs, advanced
                image crops, collaboration, and jurisdiction-specific rules are
                not available. Barcode label types can hold a reviewed uploaded
                barcode graphic.
              </p>
            </details>
          </section>
        </>
      )}
    </div>
  )
}
