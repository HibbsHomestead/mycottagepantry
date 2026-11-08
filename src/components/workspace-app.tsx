import { ProductLabelsInfo } from './product-labels'
import { labelsForProduct } from '@/lib/saved-labels'
import { RecipeComponentPicker } from './recipe-component-picker'
import { componentStock } from '@/lib/recipe-components'
import { RecipeBaseFields } from './recipe-base-fields'
import { effectiveRecipeLines, recipeProductionLines } from '@/lib/domain'
import { ItemDetailHeader, ItemDetailLayout } from './item-detail-layout'
import { NetWeightField } from './net-weight-field'
import { RecipeLineCost } from './recipe-line-cost'
import { ProductCostCards } from './product-cost-cards'
import { AddItemDialog } from './add-item-dialog'
import { InventoryPreview } from './inventory-preview'
import { stockReceiptPreview } from '@/lib/inventory-browse'
import { IngredientStockAdjustment } from './ingredient-stock-adjustment'
import {
  inventoryAdjustmentPlan,
  inventoryMovementView,
} from '@/lib/inventory-adjustment'
import { defaultItemType } from '@/lib/add-item'
import { ovenToday } from '@/lib/oven-dates'
import { InventoryProductFields } from './inventory-product-fields'
import { foodProduct } from '@/lib/inventory-product'
import { ProductWorkflowDialog } from './product-workflow-dialog'
import { FabricDialog } from './fabric-dialog'
import { isFabric } from '@/lib/fabric'
import {
  FinishedInventory,
  HandmadeProduction,
  PurchaseStockReceipts,
} from './finished-inventory'
import { ProductCategoryManager } from './product-categories'
import { workflowOf, tracksFinishedStock } from '@/lib/product-workflows'
import {
  destination,
  destinationHash,
  parseWorkspaceHash,
  sectionTabs,
} from '@/lib/workspace-navigation'
import { ProductCategorySelector } from './product-categories'
import { AppUpdateNotice } from './app-update-notice'
import {
  isPackaging,
  pantryCategories,
  pantryCategoryId,
  selectPantryCategory,
} from '@/lib/pantry-category'
import { ingredientCreateErrors } from '@/lib/ingredient-create'
import { InventoryTools } from './inventory-tools'
import { ShelfLabels } from './shelf-labels'
import { BarcodeScanner } from './barcode-scanner'
import { RecipeDetail } from '@/components/recipe-detail'
import { ProductLinkImport } from '@/components/product-link-import'
import { Upload } from 'lucide-react'
import { RecipeImport } from '@/components/recipe-import'
import { duplicateBarcodes } from '@/lib/ingredients'
import { FinanceWorkspace } from '@/components/finance-workspace'
import { ItemImagesPanel } from '@/components/item-images-panel'
import * as Tabs from '@radix-ui/react-tabs'
import '@/components/product-editor.css'
import { ProductCards } from '@/components/product-cards'
import { LabelStudio } from '@/components/label-studio'
import { LabelPreviewDialog } from './label-preview-dialog'
import {
  useState,
  useEffect,
  useEffectEvent,
  useRef,
  type ReactNode,
  type FormEvent,
} from 'react'
import {
  LayoutDashboard,
  BookOpen,
  Package,
  Tag,
  CookingPot,
  StickyNote,
  Wallet,
  ChartNoAxesCombined,
  Settings,
  ChevronDown,
  ChevronRight,
  Plus,
  ArrowUpRight,
  ArrowRight,
  Search,
  Bell,
  Wheat,
  CircleHelp,
  Menu,
  X,
  Download,
  CalendarDays,
  Clock3,
  CircleCheck,
  TriangleAlert,
  Receipt,
  TrendingUp,
  Leaf,
  Check,
  RefreshCw,
  ShieldCheck,
  Building2,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  IngredientFormBody,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import { BakeryArt } from '@/components/bakery-art'
import { demoData } from '@/lib/demo'
import { reportRows, parseCsv } from '@/lib/reports'
import {
  money,
  recipeCost,
  costBreakdown,
  productCosting,
  profitability,
  applicableTaxes,
  saleTaxProduct,
  ingredientUnits,
  unitLabel,
  parseQuantity,
  baseUnit,
  convert,
  units,
  csv,
  allergens,
  type Item,
  type Workspace,
} from '@/lib/domain'

import {
  ConversionEditor,
  BatchCostPreview,
  PackagingEditor,
  TaxRateEditor,
  TaxPreview,
  LineCalculation,
} from '@/components/financial-editors'

import { IngredientDetail } from '@/components/ingredient-detail'
import { PantryPhoto } from '@/components/pantry-photo'
import { PantryInventory } from '@/components/pantry-inventory'
import { WorkspaceDashboard } from '@/components/workspace-dashboard'
import { TaxCenter } from '@/components/tax-center'
import { SettingsWorkspace } from '@/components/settings-workspace'
import {
  defaultAppearance,
  applyAppearance,
  cacheAppearance,
  readAppearanceCache,
  resolveAppearance,
  type Appearance,
} from '@/lib/appearance'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'

const quickActions = [
  ['Add Item', 'add-item-generic'],
  ['Receive stock', 'receive-picker'],
  ['Create recipe', 'recipe'],
  ['Import recipe', 'recipe-import'],
  ['Create product', 'product'],
  ['Start batch run', 'batch'],
  ['Record a sale', 'sale'],
  ['Record an expense', 'expense'],
  ['Create purchase order', 'order'],
]
const navigation = [
  { name: 'Dashboard', icon: LayoutDashboard },
  { name: 'Inventory', icon: Package },
  { name: 'Recipes', icon: BookOpen },
  { name: 'Products', icon: Tag },
  { name: 'Production', icon: CookingPot },
  { name: 'Sales', icon: TrendingUp },
  { name: 'Purchasing', icon: Receipt },
  { name: 'Labels', icon: StickyNote },
  { name: 'Finance', icon: Wallet },
  { name: 'Settings', icon: Settings },
]
const dateLabel = (date: string) =>
  new Date(date + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
function Badge({
  children,
  tone = 'green',
}: {
  children: ReactNode
  tone?: string
}) {
  return <span className={`status ${tone}`}>{children}</span>
}
function Btn({
  children,
  onClick,
  secondary = false,
  small = false,
  disabled = false,
  type = 'button',
}: {
  children: ReactNode
  onClick?: () => void
  secondary?: boolean
  small?: boolean
  disabled?: boolean
  type?: 'button' | 'submit'
}) {
  return (
    <button
      type={type}
      className={`btn ${secondary ? 'secondary' : ''} ${small ? 'small' : ''}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  )
}
function Field({
  label,
  children,
  hint,
}: {
  label: string
  children: ReactNode
  hint?: string
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  )
}
function Empty({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="empty">
      <Wheat size={32} />
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  )
}
export function WorkspaceApp() {
  const [page, setPage] = useState('Dashboard'),
    [sub, setSub] = useState('All items'),
    [mobile, setMobile] = useState(false),
    [state, setState] = useState<Workspace>(demoData),
    [ready, setReady] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [search, setSearch] = useState(''),
    [modal, setModal] = useState<string | null>(null),
    [productTab, setProductTab] = useState('details'),
    [selected, setSelected] = useState<Item | null>(null),
    [filter, setFilter] = useState('All items'),
    [role, setRole] = useState('Owner'),
    [demo, setDemo] = useState(true),
    [labelProduct, setLabelProduct] = useState(''),
    [labelDesign, setLabelDesign] = useState(''),
    [labelCreateRequest, setLabelCreateRequest] = useState(0),
    [previewProduct, setPreviewProduct] = useState<Item | null>(null),
    [previewLabelId, setPreviewLabelId] = useState(''),
    [financeEntry, setFinanceEntry] = useState(''),
    [formError, setFormError] = useState('')
  const [componentPicker, setComponentPicker] = useState(false)
  const [draft, setDraft] = useState<Record<string, any>>({}),
    [lines, setLines] = useState<any[]>([])
  const [appearancePreview, setAppearancePreview] = useState<Appearance | null>(
    null,
  )
  const deliberateUnits = useRef(new Set<string>())
  const labelUnsaved = useRef(false)
  const workflowDirty = useRef(false)
  const [route, setRoute] = useState(() => destination('Dashboard'))
  const routeRef = useRef(route)
  const lastHash = useRef('')
  const sectionTabsRef = useRef<HTMLElement>(null)
  const [formDirty, setFormDirty] = useState(false)
  const packagingDraft = isPackaging(draft)
  useEffect(() => {
    if (!modal || (!formDirty && !busy)) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [modal, formDirty, busy])
  const ingredientSaving = useRef(false)
  const [ingredientErrors, setIngredientErrors] = useState<
    Record<string, string>
  >({})
  const [ingredientImportBusy, setIngredientImportBusy] = useState(false)
  const [shelfItem, setShelfItem] = useState<Item | null>(null)
  const [barcodeEntryOpen, setBarcodeEntryOpen] = useState(false)
  const [inventoryPreview, setInventoryPreview] = useState<{
    key: string | null
  } | null>(null)
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return
    const update = () => {
      document.documentElement.style.setProperty(
        '--app-visual-height',
        `${viewport.height}px`,
      )
      document.documentElement.style.setProperty(
        '--app-visual-top',
        `${viewport.offsetTop}px`,
      )
    }
    update()
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
      document.documentElement.style.removeProperty('--app-visual-height')
      document.documentElement.style.removeProperty('--app-visual-top')
    }
  }, [])
  const appearanceQueue = useRef<Promise<boolean>>(Promise.resolve(true))
  const [startupAppearance, setStartupAppearance] = useState(defaultAppearance)
  function persistAppearance(next: Appearance) {
    appearanceQueue.current = appearanceQueue.current.then(async () => {
      try {
        await mutate('appearance', 'settings', { appearance: next })
        return true
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'Appearance could not sync. Retry Save appearance.'
        setFormError(message)
        toast.error(message)
        return false
      }
    })
    return appearanceQueue.current
  }
  const accountAppearance = ready
    ? resolveAppearance(state.settings[0]?.appearance, defaultAppearance)
    : startupAppearance
  const appearance = appearancePreview || accountAppearance
  useEffect(() => {
    setStartupAppearance(readAppearanceCache())
  }, [])
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const resolved =
      appearancePreview ||
      (ready
        ? resolveAppearance(state.settings[0]?.appearance, defaultAppearance)
        : readAppearanceCache())
    const apply = () => applyAppearance(resolved, media.matches)
    apply()
    if (ready || appearancePreview) cacheAppearance(resolved)
    if (resolved.mode === 'system') media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [
    ready,
    appearancePreview,
    accountAppearance.theme,
    accountAppearance.mode,
  ])
  useEffect(() => {
    if (!mobile) return
    const previous = document.activeElement as HTMLElement
    const sidebar = document.querySelector<HTMLElement>('.sidebar')
    sidebar?.querySelector<HTMLElement>('button')?.focus()
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobile(false)
      if (event.key === 'Tab' && sidebar) {
        const items = [
          ...sidebar.querySelectorAll<HTMLElement>('button, a, summary'),
        ].filter((el) => el.getClientRects().length)
        const first = items[0],
          last = items.at(-1)
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last?.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first?.focus()
        }
      }
    }
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('keydown', key)
      previous?.focus()
    }
  }, [mobile])
  const ingredients = state.ingredients,
    recipes = state.recipes,
    products = state.products,
    batches = state.batches,
    business = state.settings[0]
  const recipeIngredients = [...ingredients]
  for (const line of lines) {
    if (
      !line.componentRecipeId ||
      recipeIngredients.some((i) => i.id === line.ingredientId)
    )
      continue
    const source = recipes.find((r) => r.id === line.componentRecipeId)
    if (source) {
      try {
        recipeIngredients.push(componentStock(source, ingredients))
      } catch {
        /* shown by line costing */
      }
    }
  }
  const openedRecipeLink = useRef(false)
  const openLinkedRecipe = useEffectEvent((source: Item) => {
    setPage('Recipes')
    open('recipe', source)
  })
  useEffect(() => {
    if (!ready || openedRecipeLink.current) return
    const id = new URL(window.location.href).searchParams.get('recipe')
    if (!id) return
    openedRecipeLink.current = true
    const source = recipes.find((r) => r.id === id)
    if (source) openLinkedRecipe(source)
  }, [ready, recipes])
  const low = ingredients.filter((i) => i.quantity <= i.threshold),
    expiring = ingredients.filter((i) => i.expires && i.expires <= '2026-11-04')
  const commissionIncome = (state.consignment_sales || []).reduce(
      (s, i) => s + i.commission + i.deductions,
      0,
    ),
    consignmentFees = (state.consignment_sales || []).reduce(
      (s, i) => s + i.businessFee,
      0,
    )
  const totalSales = state.sales.reduce((s, i) => s + i.amount, 0),
    totalExpense = state.expenses.reduce((s, i) => s + i.amount, 0)
  function productCost(p: Item) {
    try {
      return productCosting(p, state).perPackage
    } catch {
      return NaN
    }
  }

  const cogs = state.sales.reduce(
      (s, i) =>
        s +
        (i.historicalCogs ??
          productCost(
            products.find((p) => p.id === i.productId) || products[0],
          ) * i.quantity),
      0,
    ),
    grossProfit = totalSales - cogs,
    operating = state.expenses
      .filter((i) => !i.inventory)
      .reduce((s, i) => s + i.amount, 0),
    fees = state.sales.reduce((s, i) => s + (i.fees || 0), 0),
    netProfit =
      grossProfit + commissionIncome - operating - fees - consignmentFees
  function applyRoute(
    next: ReturnType<typeof destination>,
    query = new URLSearchParams(),
  ) {
    routeRef.current = next
    setRoute(next)
    setPage(next.page)
    setSub(next.sub)
    setFilter(query.get('filter') || next.filter)
    setSearch(query.get('search') || '')
    setMobile(false)
  }
  function go(name: string, section?: string) {
    const next = destination(name, section)
    if (
      ((labelUnsaved.current && next.section !== 'Labels') ||
        workflowDirty.current ||
        (modal && formDirty)) &&
      destinationHash(next) !== destinationHash(routeRef.current) &&
      !window.confirm(
        'This page has unsaved changes. Save before leaving, or discard changes and continue?',
      )
    )
      return
    if (workflowDirty.current || formDirty) {
      setModal(null)
      workflowDirty.current = false
      setFormDirty(false)
    }
    const hash = destinationHash(next)
    if (window.location.hash !== hash) window.history.pushState(null, '', hash)
    lastHash.current = hash
    applyRoute(next)
  }
  const navigationGuard = useRef<() => boolean>(() => false)
  useEffect(() => {
    document.title = `${route.tab || route.section} | My Oven | Cottage Pantry`
  }, [route.section, route.tab])
  navigationGuard.current = () =>
    labelUnsaved.current || workflowDirty.current || !!(modal && formDirty)
  useEffect(() => {
    const navigate = () => {
      const next = parseWorkspaceHash(window.location.hash)
      if (
        navigationGuard.current() &&
        !window.confirm(
          'This page has unsaved changes. Discard changes and continue?',
        )
      ) {
        window.history.pushState(
          null,
          '',
          lastHash.current || destinationHash(routeRef.current),
        )
        return
      }
      setModal(null)
      setFormDirty(false)
      workflowDirty.current = false
      applyRoute(next, next.query)
      const canonical =
        destinationHash(next) +
        (next.query.size ? '?' + next.query.toString() : '')
      if (canonical !== window.location.hash)
        window.history.replaceState(null, '', canonical)
      lastHash.current = canonical
    }
    navigate()
    window.addEventListener('popstate', navigate)
    window.addEventListener('hashchange', navigate)
    return () => {
      window.removeEventListener('popstate', navigate)
      window.removeEventListener('hashchange', navigate)
    }
  }, [])
  useEffect(() => {
    if (!ready) return
    const query = new URLSearchParams()
    if (search) query.set('search', search)
    if (filter !== route.filter) query.set('filter', filter)
    const hash =
      destinationHash(route) + (query.size ? '?' + query.toString() : '')
    window.history.replaceState(null, '', hash)
    lastHash.current = hash
  }, [search, filter, route, ready])
  useEffect(() => {
    const tabs = sectionTabsRef.current
    const active = tabs?.querySelector<HTMLElement>('[aria-current="page"]')
    if (!tabs || !active) return
    const bounds = tabs.getBoundingClientRect()
    const selected = active.getBoundingClientRect()
    if (selected.left < bounds.left || selected.right > bounds.right)
      tabs.scrollLeft +=
        selected.left - bounds.left - (bounds.width - selected.width) / 2
  }, [route.section, route.tab, ready])

  async function load() {
    setError('')
    try {
      const res = await fetch('/api/workspace')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setState(json.workspace)
      setRole(json.role)
      setDemo(json.demo)
      setReady(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Oven could not connect.')
      setReady(false)
    }
  }
  useEffect(() => {
    void load()
    let unsubscribe = () => {}
    import('@netlify/identity').then((identity) => {
      unsubscribe = identity.onAuthChange((event) => {
        if (event === 'logout') window.location.replace('/login')
      })
    })
    return () => unsubscribe()
  }, [])
  async function mutate(
    action: string,
    table: string,
    data: Record<string, any>,
  ) {
    if (!ready) {
      throw new Error(
        'Your private oven is still connecting. Try again in a moment.',
      )
    }
    setBusy(true)
    setFormError('')
    try {
      const ingredientTrace =
        action === 'save' && table === 'ingredients' ? crypto.randomUUID() : ''
      const res = await fetch('/api/workspace', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(action === 'save' && table === 'ingredients'
            ? { 'X-Ingredient-Save-Trace': ingredientTrace }
            : {}),
        },
        body: JSON.stringify({ action, table, data }),
      }).catch((error) => {
        if (ingredientTrace)
          throw new Error(
            `${isPackaging(data) ? 'Packaging' : 'Ingredient'} save request could not complete. Your draft is preserved. Retry with the same form to avoid duplicates; reference ${ingredientTrace}.`,
          )
        throw error
      })
      let result
      try {
        result = await res.json()
      } catch {
        throw new Error(
          `The oven returned an unreadable response (HTTP ${res.status}${ingredientTrace ? '; reference ' + ingredientTrace : ''}). Your draft is still here. Check the connection and retry.`,
        )
      }
      if (!res.ok)
        throw new Error(
          action === 'save' && table === 'ingredients'
            ? `${result.error || `${isPackaging(data) ? 'Packaging' : 'Ingredient'} save failed.`} (HTTP ${res.status}; ${result.code || 'SAVE_FAILED'}${result.traceId || ingredientTrace ? '; reference ' + (result.traceId || ingredientTrace) : ''}). Your draft is preserved.`
            : result.error,
        )
      if (
        action === 'save' &&
        table === 'ingredients' &&
        (!Array.isArray(result.workspace?.ingredients) ||
          !result.workspace.ingredients.some(
            (item: Item) => item.id === data.id,
          ))
      ) {
        throw new Error(
          `The save response did not confirm this ${isPackaging(data) ? 'packaging' : 'ingredient'}. Your draft is preserved; retry this same form rather than creating another. Reference ${ingredientTrace}.`,
        )
      }
      if (action === 'save' && table === 'products' && data.id) {
        const saved = Array.isArray(result.workspace?.products)
          ? result.workspace.products.find((p: Item) => p.id === data.id)
          : undefined
        // Only report success when the response contains the saved product.
        if (!saved)
          throw new Error(
            'The save response did not confirm this product. Your changes are still here; select Save again. No duplicate is created by retrying.',
          )
      }
      setState(result.workspace)
      setFormDirty(false)
      if (
        ![
          'ingredientBarcode',
          'shelfMedia',
          'inventoryCountStart',
          'inventoryCountLine',
          'inventoryCountComplete',
          'conversion',
          'unit',
          'appearance',
          'pantrySort',
          'pantryView',
          'ingredientUpdate',
          'ingredientOffer',
          'productRecipeLink',
        ].includes(action)
      )
        setModal(null)
      toast.success(
        action === 'complete'
          ? 'Batch completed. Inventory and historical costs updated.'
          : table === 'ingredients' &&
              ['save', 'ingredientUpdate'].includes(action)
            ? `${isPackaging(data) ? 'Packaging' : 'Ingredient'} saved.`
            : action === 'save' &&
                table === 'products' &&
                products.some((p) => p.id === data.id)
              ? `${data.name || 'Product'} changes saved.`
              : 'Saved to your oven.',
      )
    } finally {
      setBusy(false)
    }
  }
  function open(kind: string, item?: Item) {
    if (['label-preview', 'label-print'].includes(kind) && item) {
      setPreviewLabelId('')
      setPreviewProduct(item)
      return
    }
    if (kind === 'inventory-preview' || kind === 'inventory-preview-item') {
      setInventoryPreview({
        key: item ? `${item.inventoryTable || 'ingredients'}:${item.id}` : null,
      })
      return
    }
    if (
      [
        'ingredient',
        'packaging',
        'trade-material',
        'trade-product-resale',
        'add-item',
        'add-item-generic',
      ].includes(kind) &&
      (!item || !ingredients.some((i) => i.id === item.id))
    ) {
      setSelected({
        id: '',
        name: '',
        initialDraft: item,
        initialType:
          kind === 'packaging'
            ? 'packaging'
            : kind === 'trade-material'
              ? 'material'
              : kind === 'trade-product-resale'
                ? 'resale'
                : kind === 'add-item-generic'
                  ? ''
                  : route.section === 'Inventory'
                    ? defaultItemType(route.tab)
                    : '',
      })
      setModal('add-item')
      return
    }
    if (kind === 'receive' && item?.workflow === 'resale') {
      open('trade-receive', item)
      return
    }
    if (
      isFabric(item) &&
      [
        'ingredient-detail',
        'ingredient-edit',
        'receive',
        'adjust',
        'fabric-remnant',
      ].includes(kind)
    ) {
      setSelected(
        state.ingredients.find((i) => i.id === item?.id) || item || null,
      )
      setModal(
        (
          {
            'ingredient-detail': 'fabric-detail',
            'ingredient-edit': 'fabric-edit',
            receive: 'fabric-receive',
            adjust: 'fabric-adjust',
            'fabric-remnant': 'fabric-remnant',
          } as Record<string, string>
        )[kind],
      )
      return
    }
    if (kind === 'ingredient' && !item && route.tab === 'Craft Materials')
      kind = 'trade-material'
    if (kind.startsWith('trade-')) {
      setSelected(item || null)
      setModal(kind)
      return
    }
    if (kind === 'product' && item && tracksFinishedStock(item)) {
      setSelected(item)
      setModal('trade-product')
      return
    }
    if (
      ['recipe', 'recipe-detail'].includes(kind) &&
      item?.workflow === 'handmade'
    ) {
      setSelected(item)
      setModal('trade-design')
      return
    }
    if (
      kind === 'complete' &&
      state.recipes.find((r) => r.id === item?.recipeId)?.workflow ===
        'handmade'
    ) {
      setSelected(item || null)
      setModal('trade-complete')
      return
    }

    if (kind === 'shelf-label') {
      setShelfItem(item!)
      return
    }
    if (kind === 'packaging') {
      open('ingredient', {
        name: '',
        id: crypto.randomUUID(),
        creationRequestId: crypto.randomUUID(),
        categoryId: 'packaging',
        category: 'Packaging',
        usedAs: 'packaging',
        purchaseUnit: 'each',
        unit: 'each',
        recipeUnit: 'each',
        purchaseQuantity: '',
        packagePrice: '',
        threshold: 0,
      })
      return
    }
    if (kind === 'ingredient-edit') {
      open('ingredient-detail', { ...item!, startEditing: true })
      return
    }
    if (['expense', 'sale', 'transaction'].includes(kind) && !item) {
      setFinanceEntry(kind)
      go('Finances', 'Money activity')
      return
    }

    const original = item && ingredients.find((i) => i.id === item.id)
    setSelected(
      original && ['receive', 'adjust'].includes(kind)
        ? original
        : item || null,
    )
    setFormError('')
    setIngredientErrors({})
    setFormDirty(false)
    setProductTab('details')
    deliberateUnits.current = new Set(item ? ['purchaseUnit', 'unit'] : [])
    setDraft(
      item
        ? {
            ...item,
            ...(kind === 'ingredient'
              ? { receivedDate: item.receivedDate || ovenToday(business) }
              : {}),
            ...(['receive', 'adjust'].includes(kind)
              ? {
                  operationId: item.operationId || crypto.randomUUID(),
                  receivedDate: ovenToday(business),
                  purchaseDate: '',
                }
              : {}),
            ...(kind === 'adjust' && original
              ? {
                  unit: original.storageUnit || original.unit,
                  adjustmentMode: 'change',
                  type: 'adjustment',
                  reason: '',
                  quantity: '',
                  expectedInventoryRevision: original.inventoryRevision,
                }
              : {}),
          }
        : {
            ...(kind === 'ingredient'
              ? {
                  id: crypto.randomUUID(),
                  creationRequestId: crypto.randomUUID(),
                  categoryId: 'flour-grains',
                }
              : {}),
            purchaseQuantity: kind === 'ingredient' ? '' : 25,
            purchaseUnit: business.measurements === 'metric' ? 'g' : 'lb',
            unit: business.measurements === 'metric' ? 'g' : 'lb',
            packagePrice: kind === 'ingredient' ? '' : 10.95,
            threshold: 5,
            category: kind === 'product' ? '' : 'Flour & grains',
            ...(kind === 'product'
              ? {
                  workflow: 'food',
                  taxSource: 'category',
                  productCategoryId: '',
                }
              : {}),
            usedAs: 'ingredient',
            vendor: kind === 'ingredient' || !demo ? '' : 'Sam’s Club',
            quantity: 1,
            price: demo ? 8 : '',
            wholesale: demo ? 6 : '',
            unitsPerPackage: 1,
            targetMargin: business.targetMargin ?? (demo ? 65 : 0),
            recipeId: recipes[0]?.id,
            productId: products[0]?.id,
            yield: demo ? 4 : 1,
            yieldUnit: demo ? 'loaves' : 'each',
            laborMinutes: demo ? 25 : 0,
            overhead: business.defaultOverhead ?? 0,
            overheadMode: business.overheadMode || 'batch',
            laborRate: business.laborRate ?? (demo ? 18 : 0),
            count: 1,
            date: ovenToday(business),
            receivedDate: ovenToday(business),
            channel: demo ? 'Farmers market' : '',
            paymentMethod: 'Card',
            amount: 0,
            tax: 0,
            fees: 0,
            allergens: [],
            reviewed: false,
          },
    )
    setLines(
      item?.lines?.map((l: any) => ({ ...l })) || [
        demo
          ? { ingredientId: 'flour', quantity: 1200, unit: 'g' }
          : {
              ingredientId: ingredients[0]?.id || '',
              quantity: 0,
              unit: business.measurements === 'metric' ? 'g' : 'oz',
            },
      ],
    )
    setModal(kind)
  }
  const change = (key: string, value: any) => {
    setFormDirty(true)
    if (modal === 'ingredient') {
      if (['purchaseUnit', 'unit'].includes(key))
        deliberateUnits.current.add(key)
      if (key === 'categoryId' || key === 'usedAs') setIngredientErrors({})
    }
    setDraft((d) => {
      if (modal === 'ingredient' && key === 'categoryId')
        return selectPantryCategory(d, value, false, deliberateUnits.current)
      if (
        modal === 'ingredient' &&
        key === 'usedAs' &&
        value === 'ingredient' &&
        !['packaging', 'supplies'].includes(pantryCategoryId(d))
      )
        return { ...d, usedAs: value }
      if (modal === 'ingredient' && key === 'usedAs')
        return selectPantryCategory(
          d,
          value === 'packaging'
            ? 'packaging'
            : value === 'supply'
              ? 'supplies'
              : 'flour-grains',
          false,
          deliberateUnits.current,
        )
      return {
        ...d,
        [key]: value,
        ...(key === 'packagePrice' && d.listedOnlinePrice != null
          ? { purchasePriceConfirmed: false }
          : {}),
      }
    })
  }
  const input = (key: string, type = 'text', placeholder = '') => (
    <input
      type={type === 'number' && /quantity/i.test(key) ? 'text' : type}
      value={draft[key] ?? ''}
      onChange={(e) => change(key, e.target.value)}
      placeholder={placeholder}
      min={type === 'number' ? 0 : undefined}
      step={type === 'number' ? 'any' : undefined}
      required={
        ['name', 'date'].includes(key) ||
        (modal === 'ingredient' &&
          ['purchaseQuantity', 'packagePrice'].includes(key))
      }
      aria-invalid={modal === 'ingredient' && !!ingredientErrors[key]}
      aria-describedby={
        modal === 'ingredient' && ingredientErrors[key]
          ? `ingredient-error-${key}`
          : undefined
      }
    />
  )
  const select = (
    key: string,
    options: (string | { value: string; label: string })[],
  ) => (
    <select
      aria-label={
        key === 'purchaseUnit'
          ? 'Purchase unit'
          : key === 'categoryId'
            ? 'Category'
            : undefined
      }
      value={
        key === 'categoryId' ? pantryCategoryId(draft) : (draft[key] ?? '')
      }
      onChange={(e) => change(key, e.target.value)}
      aria-invalid={modal === 'ingredient' && !!ingredientErrors[key]}
      aria-describedby={
        modal === 'ingredient' && ingredientErrors[key]
          ? `ingredient-error-${key}`
          : undefined
      }
    >
      {options.map((o) => (
        <option
          key={typeof o === 'string' ? o : o.value}
          value={typeof o === 'string' ? o : o.value}
        >
          {typeof o === 'string'
            ? /unit/i.test(key)
              ? unitLabel(o)
              : o
            : o.label}
        </option>
      ))}
    </select>
  )
  function exportData(table: string, rows?: Item[]) {
    const data = csv(rows || state[table] || [])
    const url = URL.createObjectURL(
      new Blob([data], { type: 'text/csv;charset=utf-8;' }),
    )
    const a = document.createElement('a')
    a.href = url
    a.download = `cottage-pantry-${table}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('CSV exported.')
  }
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (
      modal === 'ingredient' &&
      (ingredientSaving.current || ingredientImportBusy || busy)
    )
      return
    if (modal === 'ingredient') {
      const errors = ingredientCreateErrors(draft)
      setIngredientErrors(errors)
      if (Object.keys(errors).length) {
        setFormError(
          `Check the highlighted ${packagingDraft ? 'packaging' : 'ingredient'} fields. Nothing was saved.`,
        )
        return
      }
      ingredientSaving.current = true
    }
    try {
      if (modal === 'import') {
        await mutate('import', draft.importTable || 'ingredients', {
          rows: draft.importRows || [],
          reason: draft.importReason,
        })
        return
      }
      if (modal === 'signin') {
        window.location.assign('/login')
        return
      }
      if (modal === 'receive' || modal === 'adjust') {
        if (
          modal === 'receive' &&
          (draft.quantity === '' || draft.price === '' || draft.price == null)
        )
          throw new Error(
            'Confirm purchase quantity and price paid; enter zero explicitly only for a free receipt.',
          )
        if (modal === 'adjust') {
          if (!selected)
            throw new Error(
              'Ingredient unavailable. Reopen it before adjusting.',
            )
          inventoryAdjustmentPlan(selected, draft)
        }
        await mutate(modal, 'ingredients', {
          ...draft,
          id: selected?.id,
          quantity: parseQuantity(draft.quantity),
          price: Number(draft.price),
        })
        return
      }
      if (modal === 'complete') {
        await mutate('complete', 'batches', {
          ...draft,
          id: selected?.id,
          actualYield: draft.actualYield ?? selected?.yield,
        })
        return
      }
      if (modal === 'journal') {
        await mutate('postJournal', 'journals', {
          name: draft.name,
          lines: [
            { account: 'Cash', debit: Number(draft.amount), credit: 0 },
            { account: 'Owner equity', debit: 0, credit: Number(draft.amount) },
          ],
        })
        return
      }
      const table = (
        {
          ingredient: 'ingredients',
          recipe: 'recipes',
          product: 'products',
          batch: 'batches',
          sale: 'sales',
          expense: 'expenses',
          vendor: 'vendors',
          order: 'orders',
          settings: 'settings',
        } as Record<string, string>
      )[modal || '']
      const data = { ...draft }
      for (const k of [
        'yield',
        'laborMinutes',
        'laborRate',
        'overhead',
        'unitsPerPackage',
        'price',
        'wholesale',
        'targetMargin',
        'count',
        'quantity',
        'amount',
        'tax',
        'fees',
      ])
        if (data[k] !== undefined)
          data[k] = /quantity|yield|count|unitsPerPackage/i.test(k)
            ? parseQuantity(data[k])
            : Number(data[k])
      if (modal === 'recipe')
        data.lines = lines.map((l) => ({
          ...l,
          quantity: parseQuantity(l.quantity),
        }))
      if (modal === 'batch') {
        data.name = recipes.find((r) => r.id === data.recipeId)?.name
        data.yield =
          recipes.find((r) => r.id === data.recipeId)!.yield * data.count
      }
      if (modal === 'sale')
        data.name =
          data.name || products.find((p) => p.id === data.productId)?.name
      await mutate('save', table, data)
    } catch (e) {
      setFormError(
        e instanceof Error
          ? e.message
          : 'Unable to save. Your draft is preserved.',
      )
    } finally {
      ingredientSaving.current = false
    }
  }
  const filtered = (rows: Item[]) =>
    rows.filter((i) => i.name.toLowerCase().includes(search.toLowerCase()))
  const pageAction = (
    {
      Pantry: ['Receive stock', 'receive-picker'],
      Recipes: ['Create recipe', 'recipe'],
      'Products & Pricing': [
        'Create product',
        route.tab === 'Handmade'
          ? 'trade-product'
          : route.tab === 'Resale'
            ? 'trade-product-resale'
            : 'product',
      ],
      Production: ['Plan a batch', 'batch'],
      Finances: ['Record a transaction', 'transaction'],
      Labels: ['Print label', 'print'],
      Reports: ['Export report', 'export'],
      Settings: ['Edit business', 'settings'],
    } as Record<string, string[]>
  )[page]
  const activeNavigation = page === 'Recipes' ? 'Recipes' : route.section
  if (!ready)
    return (
      <main className="public-auth">
        <h1>{error ? 'Oven unavailable' : 'Opening your oven…'}</h1>
        <p role={error ? 'alert' : 'status'}>
          {error || 'Loading your private business records.'}
        </p>
        <button type="button" onClick={() => window.location.reload()}>
          Retry oven access
        </button>{' '}
        · <a href="/login">Log in again</a> · <a href="/help">Need help?</a>
      </main>
    )
  return (
    <div className="app-shell stage-one-shell">
      <aside
        className={`sidebar ${mobile ? 'is-open' : ''}`}
        aria-label="Oven navigation"
      >
        <button
          className="sidebar-close icon-button"
          aria-label="Close navigation"
          onClick={() => setMobile(false)}
        >
          <X size={22} />
        </button>
        <a
          href="#Dashboard"
          onClick={(e) => {
            e.preventDefault()
            go('Dashboard')
          }}
          className="brand"
        >
          <img
            className="brand-logo"
            src="/brand/cottage-pantry-logo.webp"
            alt="Cottage Pantry — Inventory & Cost Analysis"
            width={600}
            height={503}
          />
        </a>
        <button className="workspace-switch" onClick={() => open('workspace')}>
          <span className="workspace-avatar">HH</span>
          <span>
            <strong>{business.name}</strong>
            <small>Business oven</small>
          </span>
          <ChevronDown size={15} />
        </button>
        <span className="nav-label">YOUR OVEN</span>
        <nav aria-label="Primary navigation">
          {navigation.map(({ name, icon: Icon }) => (
            <a
              key={name}
              href={destinationHash(destination(name))}
              className={`nav-item ${activeNavigation === name ? 'active' : ''}`}
              aria-current={activeNavigation === name ? 'page' : undefined}
              onClick={(event) => {
                if (!event.metaKey && !event.ctrlKey && !event.shiftKey) {
                  event.preventDefault()
                  go(name)
                }
              }}
            >
              <Icon size={21} />
              <span>{name}</span>
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button className="nav-item" onClick={() => open('help')}>
            <CircleHelp size={19} />
            Help & support
            <ArrowUpRight size={14} />
          </button>
          <button className="profile" onClick={() => open('signin')}>
            <span className="profile-avatar">SH</span>
            <span>
              <strong>{business.owner || 'Business owner'}</strong>
              <small>
                {role} · {demo ? 'Demo oven' : 'Private oven'}
              </small>
            </span>
            <ChevronDown size={15} />
          </button>
        </div>
      </aside>
      {mobile && (
        <button
          className="mobile-scrim"
          aria-label="Close menu"
          onClick={() => setMobile(false)}
        />
      )}
      <div className="main-shell" data-page={page} inert={mobile || undefined}>
        <AppUpdateNotice />
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="mobile-toggle icon-button"
              aria-label="Open navigation"
              onClick={() => setMobile(true)}
            >
              <Menu size={22} />
            </button>
            <span>My Oven</span>
            <ChevronRight size={13} />
            <strong>{route.section}</strong>
          </div>
          <div className="topbar-right">
            <button
              className="global-search"
              aria-label="Search oven"
              onClick={() => open('search')}
            >
              <Search size={19} />
              <span>Search anything…</span>
              <kbd>Search</kbd>
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="btn quick-add" aria-label="Quick Add">
                  <Plus size={19} />
                  <span>Quick Add</span>
                  <ChevronDown size={15} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="workspace-menu quick-add-menu"
              >
                {quickActions.map(([name, kind]) => (
                  <DropdownMenuItem key={kind} onSelect={() => open(kind)}>
                    <Plus size={17} />
                    {name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <button
              className="icon-button notification"
              aria-label="View notifications"
              onClick={() => open('notifications')}
            >
              <Bell size={19} />
              <i />
            </button>
            <button
              className="icon-button top-help"
              aria-label="Help and guides"
              onClick={() => open('help')}
            >
              <CircleHelp size={20} />
            </button>
            <span className="topbar-divider" />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="top-avatar" aria-label="Profile menu">
                  {(business.owner || 'Owner')
                    .split(' ')
                    .map((n: string) => n[0])
                    .slice(0, 2)
                    .join('')}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="workspace-menu">
                <DropdownMenuItem onSelect={() => open('workspace')}>
                  Business oven
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => go('Settings', 'Appearance')}>
                  Appearance
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => open('signin')}>
                  Account & sign in
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main>
          {error && (
            <div className="connection-note">
              <TriangleAlert size={16} />
              <span>
                Preview data is visible. Your private database is connecting.
              </span>
              <button onClick={load}>Retry connection</button>
            </div>
          )}
          <div className="page-heading">
            <div>
              <span className="eyebrow">
                {page === 'Dashboard' ? business.name : 'COTTAGE PANTRY'}
              </span>
              <h1>
                {page === 'Dashboard'
                  ? `Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}.`
                  : page === 'Finances' && sub === 'Tax center'
                    ? 'Tax Center'
                    : page === 'Products & Pricing' && sub === 'Categories'
                      ? 'Product Categories'
                      : route.section}
              </h1>
              <p>
                {page === 'Dashboard'
                  ? 'Here’s what needs your attention today.'
                  : page === 'Pantry'
                    ? 'Track what you have, what it costs, and what needs restocking.'
                    : page === 'Recipes'
                      ? 'Cost food recipes and handmade designs with the inputs and labor they use.'
                      : page === 'Products & Pricing'
                        ? sub === 'Categories'
                          ? 'Organize products and review their inherited tax treatment.'
                          : 'Build prices that cover your costs and support your profit goals.'
                        : page === 'Production'
                          ? 'Plan production and keep every completed run traceable.'
                          : page === 'Finances' && sub === 'Tax center'
                            ? 'Track tax collected, review what is due, and export records for filing.'
                            : page === 'Finances'
                              ? 'Keep sales, costs, and business profit in clear view.'
                              : page === 'Settings'
                                ? 'Make this oven work for your business.'
                                : page === 'Reports'
                                  ? 'Turn your business records into useful answers.'
                                  : 'Create labels with your branding and the product details you can verify.'}
              </p>
            </div>
            <div className="heading-actions">
              {route.section === 'Inventory' && (
                <Btn secondary onClick={() => open('inventory-preview')}>
                  Preview photo inventory
                </Btn>
              )}
              {route.section === 'Inventory' &&
                ['Owner', 'Manager'].includes(role) && (
                  <Btn secondary onClick={() => open('add-item')}>
                    <Plus size={17} />
                    Add Item
                  </Btn>
                )}
              {page === 'Finances' && (
                <Btn secondary onClick={() => go('Finances', 'Receipt inbox')}>
                  <Receipt size={17} />
                  Upload receipt
                </Btn>
              )}
              {page !== 'Dashboard' &&
                page !== 'Settings' &&
                page !== 'Labels' &&
                !(page === 'Products & Pricing' && sub === 'Categories') &&
                sub !== 'Finished Goods' &&
                pageAction && (
                  <Btn
                    onClick={() =>
                      pageAction[1] === 'print'
                        ? window.print()
                        : pageAction[1] === 'export'
                          ? exportData('sales')
                          : open(pageAction[1])
                    }
                  >
                    <Plus size={18} />
                    {pageAction[0]}
                  </Btn>
                )}
            </div>
          </div>
          {!!sectionTabs[route.section]?.length &&
            route.section !== 'Labels' &&
            route.section !== 'Settings' && (
              <nav
                ref={sectionTabsRef}
                className="page-tabs section-tabs"
                aria-label={`${route.section} tabs`}
              >
                {sectionTabs[route.section].map((tab) => (
                  <a
                    key={tab}
                    href={destinationHash(destination(route.section, tab))}
                    className={route.tab === tab ? 'active' : ''}
                    aria-current={route.tab === tab ? 'page' : undefined}
                    onClick={(event) => {
                      if (!event.metaKey && !event.ctrlKey && !event.shiftKey) {
                        event.preventDefault()
                        go(route.section, tab)
                      }
                    }}
                  >
                    {tab}
                  </a>
                ))}
              </nav>
            )}
          {page === 'Dashboard' && (
            <WorkspaceDashboard
              workspace={state}
              financialReady={ready}
              canWrite={['Owner', 'Manager'].includes(role)}
              go={go}
              open={open}
            />
          )}
          {page === 'Pantry' && (
            <>
              {sub === 'Finished Goods' ? (
                <FinishedInventory
                  workspace={state}
                  open={open}
                  role={role}
                  search={search}
                />
              ) : sub === 'Inventory ledger' ? (
                <DataTable
                  rows={state.ledger.map(inventoryMovementView)}
                  columns={[
                    ['name', 'Item'],
                    ['quantity', 'Change'],
                    ['unit', 'Unit'],
                    ['type', 'Movement'],
                    ['reason', 'Reason'],
                    ['actor', 'Who'],
                    ['occurredAt', 'When'],
                    ['sourceId', 'Source'],
                  ]}
                />
              ) : sub === 'All items' || sub === 'Receiving' ? (
                <>
                  <InventoryTools
                    workspace={state}
                    role={role}
                    open={open}
                    mutate={mutate}
                    refresh={load}
                  />
                  <PantryInventory
                    ingredients={
                      route.tab === 'Craft Materials'
                        ? ingredients.filter((i) => i.usedAs === 'material')
                        : route.tab === 'Ingredients'
                          ? ingredients.filter(
                              (i) =>
                                !['material', 'packaging', 'supply'].includes(
                                  i.usedAs,
                                ),
                            )
                          : route.tab === 'Packaging'
                            ? ingredients.filter(
                                (i) => i.usedAs === 'packaging',
                              )
                            : route.tab === 'Supplies'
                              ? ingredients.filter((i) => i.usedAs === 'supply')
                              : ingredients
                    }
                    typeFilter={route.filter}
                    assets={state.graphic_assets}
                    savedView={business.currentPantryView}
                    onView={(view) => {
                      if (ready)
                        void mutate('pantryView', 'settings', { view }).catch(
                          (e) => toast.error(e.message),
                        )
                    }}
                    savedSort={business.currentPantrySort}
                    onSort={(sort) => {
                      if (ready)
                        void mutate('pantrySort', 'settings', sort).catch((e) =>
                          toast.error(e.message),
                        )
                    }}
                    filter={filter}
                    setFilter={setFilter}
                    search={search}
                    setSearch={setSearch}
                    open={open}
                  />
                </>
              ) : sub === 'Vendors' ? (
                <>
                  <div className="toolbar">
                    <h2>Your trusted suppliers</h2>
                    <Btn onClick={() => open('vendor')}>
                      <Plus size={15} />
                      Add vendor
                    </Btn>
                  </div>
                  <div className="card-grid">
                    {state.vendors.map((v) => (
                      <section className="panel vendor-card" key={v.id}>
                        <Building2 size={25} />
                        <h2>{v.name}</h2>
                        <p>{v.email || 'No contact email added'}</p>
                        <Badge>{v.terms}</Badge>
                        <Btn secondary small onClick={() => open('vendor', v)}>
                          Edit details
                        </Btn>
                      </section>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <div className="toolbar">
                    <p>Plan restocks and track incoming purchases.</p>
                    <Btn onClick={() => open('order')}>
                      <Plus size={16} />
                      Create purchase order
                    </Btn>
                  </div>
                  <DataTable
                    rows={state.orders}
                    columns={[
                      ['name', 'Order'],
                      ['vendor', 'Vendor'],
                      ['date', 'Expected'],
                      ['amount', 'Total'],
                      ['status', 'Status'],
                    ]}
                    onRow={(o) => open('order', o)}
                  />
                </>
              )}
            </>
          )}
          {page === 'Recipes' && (
            <>
              {['Owner', 'Manager'].includes(role) && (
                <div className="toolbar">
                  <button
                    className="btn secondary"
                    onClick={() => open('trade-design')}
                  >
                    Create handmade design
                  </button>
                  <button
                    className="btn secondary"
                    onClick={() => open('trade-material')}
                  >
                    Add Item
                  </button>
                </div>
              )}
              <div className="toolbar">
                <div className="search-field">
                  <Search size={17} />
                  <input
                    aria-label="Search recipes"
                    placeholder="Find a recipe or prep…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <Btn secondary onClick={() => open('recipe-import')}>
                  <Upload size={16} /> Import recipe
                </Btn>
                <Badge>{recipes.length} recipes & preps</Badge>
                <Btn secondary onClick={() => exportData('recipes')}>
                  <Download size={16} />
                  Export
                </Btn>
              </div>
              <div className="recipe-grid">
                {filtered(recipes).map((r) => {
                  let cost = 0,
                    warning = ''
                  try {
                    cost = recipeCost(r, ingredients)
                  } catch (e) {
                    warning = (e as Error).message
                  }
                  return (
                    <button
                      className="panel recipe-card"
                      key={r.id}
                      onClick={() => open('recipe-detail', r)}
                    >
                      <div className="recipe-cover">
                        <PantryPhoto
                          item={r}
                          assets={state.graphic_assets}
                          kind="recipe"
                        />
                        <span className="recipe-category">{r.category}</span>
                      </div>
                      <div className="recipe-card-body">
                        <div className="recipe-card-title">
                          <h2>{r.name}</h2>
                          <ArrowUpRight size={17} />
                        </div>
                        <p>
                          {r.description ||
                            'A hardworking prep for your kitchen.'}
                        </p>
                        <div className="recipe-meta">
                          <span>
                            <CookingPot size={14} />
                            {r.yield} {r.yieldUnit}
                          </span>
                          <span>
                            <Clock3 size={14} />
                            {r.laborMinutes} min
                          </span>
                        </div>
                        <div className="recipe-cost">
                          <span>
                            <small>TOTAL BATCH COST</small>
                            <strong>
                              {warning
                                ? warning.startsWith('Cost incomplete')
                                  ? warning
                                  : 'Review units'
                                : money(cost)}
                            </strong>
                          </span>
                          <span>
                            <small>
                              PER{' '}
                              {r.yieldUnit === 'loaves'
                                ? 'LOAF'
                                : r.yieldUnit.toUpperCase()}
                            </small>
                            <strong>
                              {warning ? '—' : money(cost / r.yield)}
                            </strong>
                          </span>
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </>
          )}
          {page === 'Products & Pricing' && (
            <>
              {sub === 'Categories' ? (
                <ProductCategoryManager
                  canManage={ready && ['Owner', 'Manager'].includes(role)}
                  onConfig={(patch) =>
                    setState((w) => ({
                      ...w,
                      settings: w.settings.map((s, i) =>
                        i === 0 ? { ...s, ...patch } : s,
                      ),
                    }))
                  }
                />
              ) : (
                <>
                  <div className="info-banner">
                    <Tag size={20} />
                    <div>
                      <strong>A price that works as hard as you do.</strong>
                      <p>
                        Recipe + packaging + labor + overhead = your real cost.
                        Sales tax stays separate.
                      </p>
                    </div>
                  </div>
                  <div className="toolbar">
                    <div className="search-field">
                      <Search size={17} />
                      <input
                        aria-label="Search products"
                        placeholder="Find a product…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </div>
                    <Btn secondary onClick={() => exportData('products')}>
                      <Download size={16} />
                      Export products
                    </Btn>
                  </div>
                  {['Owner', 'Manager'].includes(role) && (
                    <div className="toolbar">
                      <button
                        className="btn secondary"
                        onClick={() => open('product')}
                      >
                        Create food product
                      </button>
                      <button
                        className="btn secondary"
                        onClick={() => open('trade-product')}
                      >
                        Create handmade product
                      </button>
                      <button
                        className="btn secondary"
                        onClick={() => open('trade-product-resale')}
                      >
                        Create resale product
                      </button>
                    </div>
                  )}
                  <ProductCards
                    products={filtered(products).filter(
                      (p) =>
                        !['Food', 'Handmade', 'Resale'].includes(sub) ||
                        workflowOf(p) === sub.toLowerCase(),
                    )}
                    workspace={state}
                    open={open}
                  />
                </>
              )}
            </>
          )}
          {page === 'Production' && (
            <>
              <HandmadeProduction workspace={state} role={role} open={open} />
              {sub === 'Waste / adjustments' ? (
                <>
                  <div className="info-banner">
                    <Leaf size={20} />
                    <div>
                      <strong>Small changes, clearly recorded.</strong>
                      <p>
                        Record spoilage, waste, and corrections with a reason
                        for your ledger.
                      </p>
                    </div>
                    <Btn secondary onClick={() => open('adjust-picker')}>
                      Record adjustment
                    </Btn>
                  </div>
                  <DataTable
                    rows={state.ledger
                      .filter((l) =>
                        ['waste', 'spoilage', 'adjustment'].includes(l.type),
                      )
                      .map(inventoryMovementView)}
                    columns={[
                      ['name', 'Item'],
                      ['quantity', 'Change'],
                      ['unit', 'Unit'],
                      ['reason', 'Reason'],
                      ['date', 'Date'],
                    ]}
                  />
                </>
              ) : (
                <>
                  <div className="production-layout">
                    <section className="panel">
                      <div className="panel-heading">
                        <div>
                          <h2>
                            {sub === 'Batch runs'
                              ? 'Your batch history'
                              : 'On the kitchen calendar'}
                          </h2>
                          <p>Plan thoughtfully. Bake confidently.</p>
                        </div>
                        <CalendarDays size={19} />
                      </div>
                      {batches
                        .filter(
                          (b) =>
                            state.recipes.find((r) => r.id === b.recipeId)
                              ?.workflow !== 'handmade',
                        )
                        .filter((b) =>
                          sub === 'Batch runs'
                            ? true
                            : b.status !== 'completed',
                        )
                        .map((b) => (
                          <div className="batch-row" key={b.id}>
                            <div className="batch-date">
                              <small>
                                {new Date(
                                  b.date + 'T12:00:00',
                                ).toLocaleDateString('en-US', {
                                  month: 'short',
                                })}
                              </small>
                              <strong>{b.date.slice(-2)}</strong>
                            </div>
                            <div className="batch-info">
                              <h3>{b.name}</h3>
                              <p>
                                {b.count} batches · {b.actualYield || b.yield}{' '}
                                {
                                  recipes.find((r) => r.id === b.recipeId)
                                    ?.yieldUnit
                                }
                              </p>
                              <small>
                                {b.note ||
                                  (b.historicalCost &&
                                    `Historical cost locked: ${money(b.historicalCost)}`)}
                              </small>
                            </div>
                            <Badge
                              tone={
                                b.status === 'in_progress' ? 'amber' : 'green'
                              }
                            >
                              {b.status.replaceAll('_', ' ')}
                            </Badge>
                            <Btn
                              secondary
                              small
                              onClick={() =>
                                open(
                                  b.status === 'completed'
                                    ? 'batch-detail'
                                    : 'complete',
                                  b,
                                )
                              }
                            >
                              {b.status === 'completed'
                                ? 'View run'
                                : 'Complete batch'}
                              <ChevronRight size={14} />
                            </Btn>
                          </div>
                        ))}
                    </section>
                    <section className="panel shortage-panel">
                      <div className="panel-heading">
                        <div>
                          <h2>Before you start</h2>
                          <p>Stock check for upcoming batches</p>
                        </div>
                        <Package size={19} />
                      </div>
                      {(() => {
                        const requirements = new Map<string, number>()
                        for (const b of batches.filter(
                          (b) => b.status !== 'completed',
                        )) {
                          const r = recipes.find((r) => r.id === b.recipeId)
                          for (const l of r?.lines || []) {
                            const i = ingredients.find(
                              (i) => i.id === l.ingredientId,
                            )!
                            try {
                              requirements.set(
                                i.id,
                                (requirements.get(i.id) || 0) +
                                  convert(
                                    l.quantity * b.count,
                                    l.unit,
                                    i.unit,
                                    i.conversions,
                                  ),
                              )
                            } catch {}
                          }
                        }
                        return [...requirements].map(([id, q]) => {
                          const i = ingredients.find((i) => i.id === id)!
                          const short = q > i.quantity
                          return (
                            <div className="shortage-row" key={id}>
                              <span>
                                <strong>{i.name}</strong>
                                <small>
                                  Need {q.toFixed(2)} {i.unit} · Have{' '}
                                  {i.quantity.toFixed(2)}
                                </small>
                              </span>
                              {short ? (
                                <Badge tone="amber">
                                  Short {(q - i.quantity).toFixed(2)}
                                </Badge>
                              ) : (
                                <CircleCheck size={18} className="positive" />
                              )}
                            </div>
                          )
                        })
                      })()}
                      <Btn
                        secondary
                        onClick={() => {
                          go('Pantry')
                          setFilter('Low stock')
                        }}
                      >
                        View pantry <ArrowRight size={15} />
                      </Btn>
                    </section>
                  </div>
                </>
              )}
            </>
          )}
          {page === 'Labels' && (
            <LabelStudio
              initialProductId={labelProduct}
              initialLabelId={labelDesign}
              initialCreateRequest={labelCreateRequest}
              onCreateRequestHandled={() => setLabelCreateRequest(0)}
              initialSection={sub}
              onSectionChange={(section) => go('Labels', section)}
              onDirtyChange={(dirty) => {
                labelUnsaved.current = dirty
              }}
              workspace={state}
              onWorkspace={setState}
              ready={ready}
              role={role}
            />
          )}
          {page === 'Finances' && (
            <>
              {sub === 'Receipt inbox' && (
                <PurchaseStockReceipts
                  correctDate={(data) =>
                    mutate('receivedDateCorrection', 'ledger', data)
                  }
                  workspace={state}
                  role={role}
                  open={open}
                />
              )}
              {['Receipt inbox', 'Money activity', 'Consignment'].includes(
                sub,
              ) ? (
                <FinanceWorkspace
                  workspace={state}
                  onWorkspace={setState}
                  section={sub}
                  ready={ready}
                  role={role}
                  initialEntry={financeEntry}
                  onEntryOpened={() => setFinanceEntry('')}
                  onCreatePantryItem={(kind) => open(kind)}
                />
              ) : sub === 'Sales' || sub === 'Expenses' ? (
                <>
                  <div className="toolbar">
                    <h2>
                      {sub === 'Sales'
                        ? 'Every sale, accounted for.'
                        : 'The cost of doing good business.'}
                    </h2>
                    <div className="button-row">
                      <Btn
                        secondary
                        onClick={() => exportData(sub.toLowerCase())}
                      >
                        <Download size={16} />
                        Export
                      </Btn>
                      <Btn
                        onClick={() =>
                          open(sub === 'Sales' ? 'sale' : 'expense')
                        }
                      >
                        <Plus size={16} />
                        Record {sub === 'Sales' ? 'sale' : 'expense'}
                      </Btn>
                    </div>
                  </div>
                  <DataTable
                    rows={state[sub.toLowerCase()]}
                    columns={
                      sub === 'Sales'
                        ? [
                            ['name', 'Description'],
                            ['date', 'Date'],
                            ['channel', 'Channel'],
                            ['amount', 'Net sales'],
                            ['tax', 'Tax collected'],
                            ['fees', 'Fees'],
                          ]
                        : [
                            ['name', 'Expense'],
                            ['date', 'Date'],
                            ['category', 'Category'],
                            ['amount', 'Amount'],
                            ['inventory', 'Inventory purchase'],
                          ]
                    }
                    onRow={(i) =>
                      open(sub === 'Sales' ? 'sale-detail' : 'expense', i)
                    }
                  />
                </>
              ) : sub === 'Tax center' ? (
                <TaxCenter
                  workspace={state}
                  configure={() => go('Settings', 'Taxes')}
                  exportData={exportData}
                />
              ) : sub === 'Integrations' ? (
                <section className="panel settings-panel">
                  <h2>Square</h2>
                  <Badge tone="amber">Planned · not yet available</Badge>
                  <p>
                    Square authorization, product matching and transaction
                    imports are not implemented.
                  </p>
                  <p>
                    Manual sales are available now. Square authorization and
                    imports are planned.
                  </p>
                  <Btn secondary onClick={() => exportData('sales')}>
                    <Download size={16} />
                    Export manual sales
                  </Btn>
                  <Btn secondary onClick={() => go('Settings', 'Integrations')}>
                    View proposed sync scope
                  </Btn>
                </section>
              ) : sub === 'Chart of accounts' ? (
                <>
                  <div className="toolbar">
                    <h2>Your accounting foundation</h2>
                    <Btn onClick={() => open('journal')}>
                      <Plus size={16} />
                      Post balanced entry
                    </Btn>
                  </div>
                  <DataTable
                    rows={[
                      { id: '1000', name: 'Cash', type: 'Asset' },
                      { id: '1200', name: 'Inventory', type: 'Asset' },
                      {
                        id: '2100',
                        name: 'Sales tax payable',
                        type: 'Liability',
                      },
                      { id: '3000', name: 'Owner equity', type: 'Equity' },
                      { id: '4000', name: 'Product sales', type: 'Income' },
                      {
                        id: '5000',
                        name: 'Cost of goods sold',
                        type: 'Cost of goods sold',
                      },
                      {
                        id: '6000',
                        name: 'Operating expenses',
                        type: 'Expense',
                      },
                    ]}
                    columns={[
                      ['id', 'Account'],
                      ['name', 'Name'],
                      ['type', 'Type'],
                    ]}
                  />
                  <h2 className="spaced-title">Posted journal entries</h2>
                  <DataTable
                    rows={state.journals || []}
                    columns={[
                      ['name', 'Memo'],
                      ['date', 'Date'],
                      ['status', 'Status'],
                    ]}
                  />
                </>
              ) : (
                <>
                  <section className="stat-grid">
                    <Stat
                      title="Sales · excluding tax"
                      value={money(totalSales)}
                      icon={<Wallet size={18} />}
                      foot="All recorded October sales"
                      trend="Revenue"
                    />
                    <Stat
                      title="Estimated COGS"
                      value={money(cogs)}
                      icon={<CookingPot size={18} />}
                      foot="Historical when available"
                      trend="Cost of sales"
                    />
                    <Stat
                      title="Operating expenses"
                      value={money(operating + fees + consignmentFees)}
                      icon={<Receipt size={18} />}
                      foot="Excludes inventory purchases"
                      trend="Expenses"
                    />
                    <Stat
                      title="Estimated net profit"
                      value={money(netProfit)}
                      icon={<TrendingUp size={18} />}
                      foot={`${(totalSales + commissionIncome > 0 ? (netProfit / (totalSales + commissionIncome)) * 100 : 0).toFixed(1)}% net margin`}
                      trend="After expenses"
                    />
                  </section>
                  <div className="finance-grid">
                    <section className="panel">
                      <div className="panel-heading">
                        <div>
                          <h2>
                            {sub === 'Cash flow'
                              ? 'Cash-flow summary'
                              : 'Profit & loss'}
                          </h2>
                          <p>October 1–31, 2026 · USD · estimated</p>
                        </div>
                        <Btn
                          secondary
                          small
                          onClick={() =>
                            exportData(
                              sub === 'Cash flow'
                                ? 'cash-flow'
                                : 'profit-and-loss',
                              reportRows(
                                sub === 'Cash flow'
                                  ? 'Cash-flow summary'
                                  : 'Profit & loss',
                                state,
                              ),
                            )
                          }
                        >
                          <Download size={14} />
                          Export
                        </Btn>
                      </div>
                      {(sub === 'Cash flow'
                        ? [
                            ['Sales receipts', totalSales],
                            [
                              'Sales tax held',
                              state.sales.reduce((s, i) => s + (i.tax || 0), 0),
                            ],
                            [
                              'Cash paid for purchases & expenses',
                              -totalExpense,
                            ],
                            ['Payment processing fees', -fees],
                            [
                              'Net cash movement',
                              totalSales +
                                state.sales.reduce(
                                  (s, i) => s + (i.tax || 0),
                                  0,
                                ) -
                                totalExpense -
                                fees,
                            ],
                          ]
                        : [
                            ['Net product sales', totalSales],
                            ['Consignment commission income', commissionIncome],
                            ['Cost of goods sold', -cogs],
                            ['Gross profit', grossProfit + commissionIncome],
                            ['Operating expenses', -operating],
                            [
                              'Payment processing fees',
                              -fees - consignmentFees,
                            ],
                            ['Estimated net profit', netProfit],
                          ]
                      ).map(([label, value], index) => (
                        <div
                          className={`financial-line ${index === 2 || index === 5 ? 'total' : ''}`}
                          key={String(label)}
                        >
                          <span>{label}</span>
                          <strong>{money(Number(value))}</strong>
                        </div>
                      ))}
                      <p className="panel-note">
                        Estimates combine saved sales costs and current costs
                        where historical sales snapshots are unavailable.
                        Inventory purchases are tracked separately from
                        operating expenses.
                      </p>
                    </section>
                    <section className="panel">
                      <div className="panel-heading">
                        <div>
                          <h2>Where your sales happen</h2>
                          <p>Revenue by sales channel</p>
                        </div>
                      </div>
                      {[
                        'Farmers market',
                        'Pre-order',
                        'Wholesale',
                        'Custom order',
                      ].map((channel, index) => {
                        const amount = state.sales
                          .filter((s) => s.channel === channel)
                          .reduce((s, i) => s + i.amount, 0)
                        return (
                          <div className="channel-row" key={channel}>
                            <div>
                              <span>{channel}</span>
                              <strong>{money(amount)}</strong>
                            </div>
                            <span className={`channel-bar bar-${index}`}>
                              <i
                                style={{
                                  width: `${(amount / totalSales) * 100}%`,
                                }}
                              />
                            </span>
                          </div>
                        )
                      })}
                      <div className="panel-note">
                        Sales tax collected{' '}
                        <strong>
                          {money(
                            state.sales.reduce((s, i) => s + (i.tax || 0), 0),
                          )}
                        </strong>
                        <p>Tracked as a liability, separate from revenue.</p>
                      </div>
                    </section>
                  </div>
                  <p className="table-note">
                    Cottage Pantry supports recordkeeping. It does not replace a
                    licensed CPA or tax professional.
                  </p>
                </>
              )}
            </>
          )}
          {page === 'Reports' && (
            <>
              <div className="info-banner">
                <ChartNoAxesCombined size={22} />
                <div>
                  <strong>A clear view of what’s working.</strong>
                  <p>
                    Explore your operational and financial records. Export CSV
                    files for a closer look.
                  </p>
                </div>
              </div>
              <div className="report-grid">
                {[
                  {
                    name: 'Profit & loss',
                    desc: 'Revenue, costs, and estimated bottom line.',
                    table: 'sales',
                    section: 'Profit & loss',
                  },
                  {
                    name: 'Cash-flow summary',
                    desc: 'Cash coming in and going out.',
                    table: 'expenses',
                    section: 'Cash flow',
                  },
                  {
                    name: 'Sales by product',
                    desc: 'See which products earn their shelf space.',
                    table: 'sales',
                  },
                  {
                    name: 'Sales by channel',
                    desc: 'Markets, pre-orders, and wholesale.',
                    table: 'sales',
                  },
                  {
                    name: 'Sales tax collected',
                    desc: 'Tax held separately from revenue.',
                    table: 'sales',
                    section: 'Tax center',
                  },
                  {
                    name: 'Expense categories',
                    desc: 'Where your business dollars go.',
                    table: 'expenses',
                  },
                  {
                    name: 'Inventory valuation',
                    desc: 'On-hand quantities at current unit costs.',
                    table: 'ingredients',
                  },
                  {
                    name: 'Product profitability',
                    desc: 'Recipe cost, retail price, and margin.',
                    table: 'products',
                  },
                  {
                    name: 'Batch cost variance',
                    desc: 'Planned production and locked actual costs.',
                    table: 'batches',
                  },
                  {
                    name: 'Low stock & reorders',
                    desc: 'Your pantry’s next shopping list.',
                    table: 'ingredients',
                  },
                  {
                    name: 'Waste & spoilage',
                    desc: 'Track waste and stock adjustments.',
                    table: 'ledger',
                  },
                  {
                    name: 'Ingredient purchase history',
                    desc: 'Purchase receipts and historical costs.',
                    table: 'ledger',
                  },
                ].map((r) => (
                  <section key={r.name} className="panel report-card">
                    <ChartNoAxesCombined size={23} />
                    <h2>{r.name}</h2>
                    <p>{r.desc}</p>
                    <div>
                      <button
                        className="text-button"
                        onClick={() =>
                          r.section
                            ? go('Finances', r.section)
                            : open('report', { id: r.table, name: r.name })
                        }
                      >
                        View report <ArrowRight size={14} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label={'Export ' + r.name}
                        onClick={() =>
                          exportData(r.name, reportRows(r.name, state))
                        }
                      >
                        <Download size={17} />
                      </button>
                    </div>
                  </section>
                ))}
              </div>
            </>
          )}
          {page === 'Settings' && (
            <SettingsWorkspace
              openTaxReports={() => go('Finances', 'Tax center')}
              isOwner={ready && role === 'Owner'}
              workspace={state}
              section={sub}
              go={(section) => go('Settings', section)}
              open={open}
              appearance={appearance}
              preview={(next) => {
                setAppearancePreview(next)
                cacheAppearance(next)
                setStartupAppearance(next)
                if (ready && ['Owner', 'Manager'].includes(role))
                  void persistAppearance(next)
              }}
              busy={busy}
              canSave={ready && ['Owner', 'Manager'].includes(role)}
              saveAppearance={async () => {
                if (await persistAppearance(appearance))
                  setAppearancePreview(null)
              }}
              saveBusiness={(item) => mutate('save', 'settings', item)}
              onCategoryConfig={(patch) =>
                setState((w) => ({
                  ...w,
                  settings: w.settings.map((s, i) =>
                    i === 0 ? { ...s, ...patch } : s,
                  ),
                }))
              }
              exportData={(type, template) => {
                if (template) {
                  const fields: Record<string, string[]> = {
                    ingredients: [
                      'name',
                      'usedAs',
                      'category',
                      'purchaseQuantity',
                      'purchaseUnit',
                      'packagePrice',
                      'unit',
                      'threshold',
                      'vendor',
                    ],
                    recipes: [
                      'name',
                      'category',
                      'yield',
                      'yieldUnit',
                      'laborMinutes',
                      'laborRate',
                      'overhead',
                      'lines',
                    ],
                    products: [
                      'name',
                      'recipeId',
                      'unitsPerPackage',
                      'price',
                      'wholesale',
                      'targetMargin',
                      'packagingLines',
                    ],
                    sales: [
                      'name',
                      'date',
                      'productId',
                      'quantity',
                      'unitPrice',
                      'fees',
                    ],
                    expenses: ['name', 'date', 'category', 'amount', 'vendor'],
                  }
                  exportData(type + '-template', [
                    Object.fromEntries(
                      (fields[type] || ['name']).map((key) => [key, '']),
                    ) as Item,
                  ])
                } else exportData(type)
              }}
              backup={() => {
                const url = URL.createObjectURL(
                  new Blob([JSON.stringify(state, null, 2)], {
                    type: 'application/json',
                  }),
                )
                const a = document.createElement('a')
                a.href = url
                a.download =
                  'cottage-pantry-backup-' + ovenToday(business) + '.json'
                a.click()
                URL.revokeObjectURL(url)
              }}
            />
          )}
        </main>
      </div>
      <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
        {navigation.slice(0, 4).map(({ name, icon: Icon }) => (
          <button
            key={name}
            className={activeNavigation === name ? 'active' : ''}
            aria-current={activeNavigation === name ? 'page' : undefined}
            onClick={() => go(name)}
          >
            <Icon size={22} />
            <span>{name}</span>
          </button>
        ))}
        <button onClick={() => setMobile(true)} aria-label="More navigation">
          <Menu size={22} />
          <span>More</span>
        </button>
      </nav>
      {modal === 'add-item' && (
        <AddItemDialog
          workspace={state}
          initialType={selected?.initialType || ''}
          initialValues={selected?.initialDraft}
          onWorkspace={setState}
          close={() => setModal(null)}
          onDirty={(dirty) => {
            workflowDirty.current = dirty
          }}
          onExisting={(item) => open('receive', item)}
          onReceive={(item) => {
            setModal(null)
            open('receive', item)
          }}
          onView={(item, table) => {
            setModal(null)
            open('inventory-preview-item', { ...item, inventoryTable: table })
          }}
          save={(table, data) => mutate('save', table, data)}
        />
      )}
      {modal?.startsWith('fabric-') && selected && (
        <FabricDialog
          key={`${modal}-${selected.id}`}
          kind={modal}
          item={selected}
          workspace={state}
          role={role}
          mutate={mutate}
          onWorkspace={setState}
          close={() => setModal(null)}
          onDirty={(dirty) => {
            workflowDirty.current = dirty
          }}
        />
      )}
      {modal?.startsWith('trade-') && (
        <ProductWorkflowDialog
          key={`${modal}-${selected?.id || 'new'}`}
          kind={modal}
          item={selected}
          workspace={state}
          role={role}
          mutate={mutate}
          onWorkspace={setState}
          onStockAction={(kind, product) => open(kind, product)}
          close={() => setModal(null)}
          onDirty={(dirty) => {
            workflowDirty.current = dirty
          }}
        />
      )}
      {modal === 'recipe-import' && (
        <RecipeImport
          workspace={state}
          canEdit={ready && ['Owner', 'Manager'].includes(role)}
          close={() => setModal(null)}
          onWorkspace={setState}
          openRecipe={(recipe) => open('recipe-detail', recipe)}
          onConversion={async (data) => {
            await mutate('conversion', 'ingredients', data)
          }}
        />
      )}
      {shelfItem && (
        <ShelfLabels
          items={[ingredients.find((i) => i.id === shelfItem.id) || shelfItem]}
          profiles={business.currentShelfMediaProfiles || []}
          onSave={(profile) => mutate('shelfMedia', 'settings', { profile })}
          onClose={() => setShelfItem(null)}
        />
      )}
      {barcodeEntryOpen && (
        <BarcodeScanner
          onCode={(raw, format) => {
            change('barcode', raw)
            if (format) change('barcodeFormat', format)
            setBarcodeEntryOpen(false)
          }}
          onClose={() => setBarcodeEntryOpen(false)}
        />
      )}
      {inventoryPreview && (
        <InventoryPreview
          workspace={state}
          role={role}
          initialKey={inventoryPreview.key}
          close={() => setInventoryPreview(null)}
          open={open}
        />
      )}
      {modal === 'ingredient-detail' && selected && (
        <IngredientDetail
          key={selected.id}
          initialEditing={selected.startEditing === true}
          isOwner={role === 'Owner'}
          ingredient={ingredients.find((i) => i.id === selected.id) || selected}
          workspace={state}
          canEdit={ready && ['Owner', 'Manager'].includes(role)}
          close={() => setModal(null)}
          open={open}
          save={(action, data) => mutate(action, 'ingredients', data)}
          onWorkspace={setState}
        />
      )}
      <Dialog
        open={
          !!modal &&
          !modal.startsWith('trade-') &&
          !modal.startsWith('fabric-') &&
          !['ingredient-detail', 'recipe-import', 'add-item'].includes(modal)
        }
        onOpenChange={(v) => {
          if (!v) setModal(null)
        }}
      >
        <DialogContent
          ingredient={modal === 'ingredient'}
          presentation={modal === 'ingredient' ? 'detail' : 'modal'}
          className={`app-dialog ${['recipe', 'recipe-detail', 'product', 'product-detail', 'report'].includes(modal || '') ? 'wide-dialog' : ''} ${modal === 'recipe-detail' ? 'recipe-detail-shell' : modal === 'product-detail' ? 'item-detail-dialog' : ''}`}
        >
          {modal === 'product-detail' && selected ? (
            <ItemDetailHeader name={selected.name}>
              Everything you need to keep your business in good order.
            </ItemDetailHeader>
          ) : (
            <DialogHeader>
              <div className="eyebrow">COTTAGE PANTRY · YOUR OVEN</div>
              <DialogTitle>
                {(
                  {
                    ingredient: packagingDraft
                      ? 'Add packaging'
                      : 'Add ingredient',
                    receive: 'Receive inventory',
                    adjust: 'Record a stock adjustment',
                    recipe: recipes.some((r) => r.id === draft.id)
                      ? 'Edit Recipe'
                      : 'Create a recipe',
                    product: products.some((p) => p.id === draft.id)
                      ? 'Edit Product'
                      : 'Create Product',
                    batch: 'Plan your next batch',
                    complete: 'Finish this batch',
                    sale: 'Record a sale',
                    expense: 'Record an expense',
                    vendor: 'Vendor details',
                    order: 'Purchase order',
                    settings: 'Your business details',
                    signin: 'Your account',
                    quick: 'Quick Add',
                    help: 'Help & support',
                    notifications: 'Needs attention',
                    workspace: 'Your oven',
                    journal: 'Post a balanced entry',
                    import: 'Bring your records along',
                    search: 'Find your way around',
                    activity: 'The latest in your kitchen',
                    'receive-picker': 'What’s arriving?',
                    'adjust-picker': 'Choose an item to adjust',
                  } as Record<string, string>
                )[modal || ''] ||
                  selected?.name ||
                  'Oven'}
              </DialogTitle>
              <DialogDescription>
                {modal === 'recipe-detail'
                  ? selected?.description ||
                    'Recipe details, costing and linked products.'
                  : ['receive', 'ingredient'].includes(modal || '')
                    ? `${modal === 'ingredient' && packagingDraft ? 'Packaging details. ' : ''}Tell us how you bought it. We’ll take care of the unit math.`
                    : modal === 'signin'
                      ? 'Manage your existing oven session.'
                      : 'Everything you need to keep your business in good order.'}
              </DialogDescription>
            </DialogHeader>
          )}
          {[
            'ingredient',
            'receive',
            'adjust',
            'recipe',
            'product',
            'batch',
            'complete',
            'sale',
            'expense',
            'vendor',
            'order',
            'settings',
            'signin',
            'journal',
            'import',
          ].includes(modal || '') ? (
            <form
              onSubmit={submit}
              onChangeCapture={() => setFormDirty(true)}
              onInvalidCapture={(e) => {
                // Fields on inactive product tabs are still validated: open
                // the tab that holds the first invalid field and show it.
                if (modal !== 'product') return
                const target = e.target as HTMLInputElement
                const first = Array.from(e.currentTarget.elements).find(
                  (el) =>
                    'validity' in el &&
                    !(el as HTMLInputElement).validity.valid,
                )
                if (first !== target) return
                const tab = target
                  .closest('[data-product-tab]')
                  ?.getAttribute('data-product-tab')
                if (!tab || tab === productTab) return
                e.preventDefault()
                setProductTab(tab)
                requestAnimationFrame(() => target.focus())
              }}
              noValidate={modal === 'ingredient'}
              className={`editor-form editor-${modal}`}
            >
              {modal === 'import' && (
                <>
                  <Field label="Record type">
                    {select('importTable', [
                      'ingredients',
                      'recipes',
                      'products',
                      'sales',
                      'expenses',
                    ])}
                  </Field>
                  <Field
                    label="CSV file"
                    hint="Use an exported CSV as your template. Up to 500 rows; the entire import is transactional."
                  >
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      required
                      onChange={async (e) => {
                        try {
                          const file = e.target.files?.[0]
                          if (file) {
                            if (file.size > 2000000)
                              throw new Error('Choose a CSV smaller than 2 MB.')
                            const rows = parseCsv(await file.text())
                            change('importRows', rows)
                            setFormError('')
                          }
                        } catch (error) {
                          setFormError((error as Error).message)
                        }
                      }}
                    />
                  </Field>
                  <Field label="Import / adjustment reason">
                    <input
                      required
                      value={draft.importReason || ''}
                      onChange={(e) => change('importReason', e.target.value)}
                      placeholder="e.g. Opening balances from October stock count"
                    />
                  </Field>
                  <div className="calculation-box">
                    <strong>
                      {draft.importRows?.length || 0} rows ready to import
                    </strong>
                    <p>
                      Stock differences create ledger entries. Cross-oven
                      references and unsupported units are rejected.
                    </p>
                  </div>
                  <Btn
                    secondary
                    onClick={() =>
                      exportData(draft.importTable || 'ingredients')
                    }
                  >
                    Download current CSV template
                  </Btn>
                </>
              )}
              {modal === 'ingredient' && (
                <IngredientFormBody enabled>
                  <div className="ingredient-flow">
                    <div className="product-link-panel ingredient-import-tools">
                      <ProductLinkImport
                        populateDraft={foodProduct(draft)}
                        vendors={state.vendors}
                        settings={business}
                        draft={draft}
                        apply={(patch) => {
                          for (const key of ['purchaseUnit', 'unit'])
                            if (Object.hasOwn(patch, key))
                              deliberateUnits.current.add(key)
                          setFormDirty(true)
                          setDraft((old: any) => ({ ...old, ...patch }))
                        }}
                        onWorkspace={setState}
                        onVendorsChange={(vendors) =>
                          setState((old) => ({ ...old, vendors }))
                        }
                        onBusyChange={setIngredientImportBusy}
                      />
                    </div>
                    <InventoryProductFields value={draft} change={change} />
                    <div className="form-grid">
                      <Field label="Received date">
                        {input('receivedDate', 'date')}
                      </Field>
                      <Field label="Purchase date (optional)">
                        {input('purchaseDate', 'date')}
                      </Field>
                    </div>
                    {draft.productCheckedAt && (
                      <Field label="Packages actually received">
                        {input('receivedPackages', 'number')}
                      </Field>
                    )}
                    <section className="form-step ingredient-basics">
                      <h3>1 · Basics</h3>
                      <Field
                        label={
                          packagingDraft
                            ? 'Packaging name'
                            : 'Ingredient / item name'
                        }
                      >
                        {input(
                          'name',
                          'text',
                          packagingDraft
                            ? 'e.g. Bread bags'
                            : 'e.g. Bread flour',
                        )}
                        {ingredientErrors.name && (
                          <small id="ingredient-error-name" role="alert">
                            {ingredientErrors.name}
                          </small>
                        )}
                      </Field>
                      <div className="form-grid">
                        <Field label="Brand">{input('brand')}</Field>
                        <Field label="Default barcode">
                          {input('barcode')}
                          <button
                            type="button"
                            className="btn secondary"
                            onClick={() => setBarcodeEntryOpen(true)}
                          >
                            Scan barcode
                          </button>
                        </Field>
                      </div>
                      {!!duplicateBarcodes(
                        ingredients,
                        String(draft.barcode || ''),
                      ).length && (
                        <p role="status" className="warning-text">
                          This barcode is already assigned to{' '}
                          {duplicateBarcodes(
                            ingredients,
                            String(draft.barcode || ''),
                          ).join(', ')}
                          . Confirm the package identity.
                        </p>
                      )}
                      <PantryPhoto
                        className="pantry-edit-photo"
                        item={{
                          ...draft,
                          id: draft.id,
                          name:
                            draft.name ||
                            (packagingDraft
                              ? 'New packaging'
                              : 'New ingredient'),
                        }}
                        assets={state.graphic_assets}
                      />
                      <Field label="Product photo">
                        <select
                          value={draft.imageAssetId || ''}
                          onChange={(e) =>
                            change('imageAssetId', e.target.value)
                          }
                        >
                          <option value="">No photo</option>
                          {(state.graphic_assets || []).map((asset) => (
                            <option key={asset.id} value={asset.id}>
                              {asset.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field
                        label="Upload product photo"
                        hint={`Optional. Choose a PNG, JPEG, or WebP you have permission to use, up to 5 MB. Save ${packagingDraft ? 'packaging' : 'ingredient'} to attach it.`}
                      >
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          disabled={busy || ingredientImportBusy}
                          onChange={async (e) => {
                            const file = e.target.files?.[0]
                            if (!file) return
                            setBusy(true)
                            try {
                              const body = new FormData()
                              body.set('file', file)
                              body.set('category', 'product photo')
                              const response = await fetch(
                                '/api/workspace?upload=1',
                                { method: 'POST', body },
                              )
                              const result = await response.json()
                              if (!response.ok || !result.asset?.id)
                                throw new Error(
                                  'Photo upload failed. Save without a photo or try another file. Your draft is preserved.',
                                )
                              setState(result.workspace)
                              change('imageAssetId', result.asset.id)
                            } catch {
                              setFormError(
                                'Photo upload failed. Save without a photo or try another file. Your draft is preserved.',
                              )
                            } finally {
                              setBusy(false)
                            }
                          }}
                        />
                      </Field>
                      <div className="form-grid">
                        <Field label="Item type">
                          {select('usedAs', [
                            'ingredient',
                            'packaging',
                            'supply',
                          ])}
                        </Field>
                        <Field label="Category">
                          {select('categoryId', [...pantryCategories])}
                        </Field>
                      </div>
                    </section>
                    <section className="form-step ingredient-purchase">
                      <h3>2 · How you buy it</h3>
                      {packagingDraft && (
                        <p className="muted">
                          For 100 bags purchased for $12, enter quantity 100,
                          unit each, and price 12: $0.12 per bag. A case, box,
                          pack, or roll needs verified contents before
                          converting to each; add these under Advanced
                          conversions.
                        </p>
                      )}
                      <div className="form-grid three">
                        <Field
                          label={
                            packagingDraft
                              ? 'Purchase quantity'
                              : 'Package quantity'
                          }
                        >
                          {input('purchaseQuantity', 'number')}
                          {ingredientErrors.purchaseQuantity && (
                            <small
                              id="ingredient-error-purchaseQuantity"
                              role="alert"
                            >
                              {ingredientErrors.purchaseQuantity}
                            </small>
                          )}
                        </Field>
                        <Field label="Purchase unit">
                          {select('purchaseUnit', Object.keys(units))}
                          {packagingDraft && draft.purchaseUnit !== 'each' && (
                            <p className="muted">
                              Your selected unit is preserved.{' '}
                              <button
                                type="button"
                                className="text-button"
                                onClick={() => change('purchaseUnit', 'each')}
                              >
                                Change purchase unit to each
                              </button>
                            </p>
                          )}
                          {ingredientErrors.purchaseUnit && (
                            <small
                              id="ingredient-error-purchaseUnit"
                              role="alert"
                            >
                              {ingredientErrors.purchaseUnit}
                            </small>
                          )}
                        </Field>
                        <Field
                          label={
                            draft.productCheckedAt
                              ? 'Actual total purchase cost'
                              : 'Package price'
                          }
                          hint="Required: total price paid for this package. An imported online listing is only a suggestion; confirm your actual price before saving. Enter zero only for a free purchase."
                        >
                          {input('packagePrice', 'number')}
                          {ingredientErrors.packagePrice && (
                            <small
                              id="ingredient-error-packagePrice"
                              role="alert"
                            >
                              {ingredientErrors.packagePrice}
                            </small>
                          )}
                        </Field>
                      </div>
                      {draft.listedOnlinePrice != null && (
                        <label className="check-label">
                          <input
                            type="checkbox"
                            checked={draft.purchasePriceConfirmed === true}
                            onChange={(e) =>
                              change('purchasePriceConfirmed', e.target.checked)
                            }
                          />
                          I confirm the package price entered above is the
                          actual price paid. Imported listed online price:{' '}
                          {String(draft.listedOnlinePrice)}{' '}
                          {draft.currency || 'USD'}.
                        </label>
                      )}
                      <div className="form-grid">
                        <Field label="Currency">
                          <input
                            value={draft.currency || 'USD'}
                            onChange={(e) => change('currency', e.target.value)}
                          />
                        </Field>
                        {[
                          ['includesTax', 'Purchase tax'],
                          ['includesShipping', 'Shipping'],
                        ].map(([key, label]) => (
                          <Field key={key} label={label}>
                            <select
                              value={
                                draft[key] === true
                                  ? 'yes'
                                  : draft[key] === false
                                    ? 'no'
                                    : 'unknown'
                              }
                              onChange={(e) =>
                                change(
                                  key,
                                  e.target.value === 'unknown'
                                    ? null
                                    : e.target.value === 'yes',
                                )
                              }
                            >
                              <option value="unknown">Not specified</option>
                              <option value="yes">Included</option>
                              <option value="no">Excluded</option>
                            </select>
                          </Field>
                        ))}
                      </div>
                      {draft.purchaseQuantity !== '' &&
                      draft.packagePrice !== '' ? (
                        <CostExplanation
                          quantity={
                            parseQuantity(draft.purchaseQuantity) *
                            (draft.productCheckedAt
                              ? Number(draft.receivedPackages || 0)
                              : 1)
                          }
                          unit={draft.purchaseUnit}
                          price={Number(draft.packagePrice)}
                          storageUnit={draft.unit}
                          conversions={draft.conversions}
                        />
                      ) : (
                        <p className="muted">
                          Enter package quantity and package price to preview
                          the cost.
                        </p>
                      )}
                      <Field label="Vendor">
                        <select
                          value={
                            draft.vendorId ||
                            state.vendors.find((v) => v.name === draft.vendor)
                              ?.id ||
                            ''
                          }
                          onChange={(e) => {
                            change('vendorId', e.target.value || null)
                            change(
                              'vendor',
                              state.vendors.find((v) => v.id === e.target.value)
                                ?.name || '',
                            )
                          }}
                        >
                          <option value="">Not set</option>
                          {state.vendors.map((vendor) => (
                            <option value={vendor.id} key={vendor.id}>
                              {vendor.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                    </section>
                    <section className="form-step ingredient-storage">
                      <h3>3 · Storage & recipe units</h3>{' '}
                      <div className="form-grid">
                        <Field label="Display stock in">
                          {select(
                            'unit',
                            Object.keys(ingredientUnits(selected?.conversions)),
                          )}
                        </Field>
                        <Field label="Low-stock threshold">
                          {input('threshold', 'number')}
                        </Field>
                      </div>
                      <Field label="Preferred recipe unit">
                        {select('recipeUnit', Object.keys(units))}
                      </Field>
                      <label className="check-label">
                        <input
                          type="checkbox"
                          checked={draft.trackInventory !== false}
                          onChange={(e) =>
                            change('trackInventory', e.target.checked)
                          }
                        />
                        Track inventory (packaging can be costed without stock
                        tracking)
                      </label>
                    </section>
                    {!packagingDraft &&
                      !['material', 'supply'].includes(draft.usedAs) && (
                        <details className="form-step">
                          <summary>
                            4 · Labels & food details (optional)
                          </summary>{' '}
                          <Field label="Ingredient statement name">
                            {input(
                              'statement',
                              'text',
                              'Exact name for your label',
                            )}
                          </Field>
                          <Field label="Subingredients (from supplier label)">
                            <textarea
                              value={draft.subingredients || ''}
                              onChange={(e) =>
                                change('subingredients', e.target.value)
                              }
                              placeholder="e.g. cream, salt"
                            />
                          </Field>
                          <Field label="Source Contains statement">
                            <textarea
                              value={draft.sourceContains || ''}
                              onChange={(e) =>
                                change('sourceContains', e.target.value)
                              }
                            />
                          </Field>
                          <Field label="Source May contain / facility statement">
                            <textarea
                              value={draft.sourceMayContain || ''}
                              onChange={(e) =>
                                change('sourceMayContain', e.target.value)
                              }
                            />
                          </Field>
                          <fieldset className="allergen-options">
                            <legend>Supplier-declared allergens</legend>
                            {allergens.map((a) => (
                              <label key={a}>
                                <input
                                  type="checkbox"
                                  checked={(draft.allergens || []).includes(a)}
                                  onChange={(e) =>
                                    change(
                                      'allergens',
                                      e.target.checked
                                        ? [...(draft.allergens || []), a]
                                        : (draft.allergens || []).filter(
                                            (v: string) => v !== a,
                                          ),
                                    )
                                  }
                                />
                                {a}
                              </label>
                            ))}
                          </fieldset>
                          <label className="check-label">
                            <input
                              type="checkbox"
                              checked={!!draft.reviewed}
                              onChange={(e) =>
                                change('reviewed', e.target.checked)
                              }
                            />
                            I reviewed the supplier’s allergen and ingredient
                            information.
                          </label>
                        </details>
                      )}
                    <details className="form-step">
                      <summary>
                        {packagingDraft ? '4' : '5'} · Advanced conversions
                      </summary>{' '}
                      <ConversionEditor
                        key={`${pantryCategoryId(draft)}:${draft.purchaseUnit}:${draft.unit}`}
                        ingredient={{
                          ...draft,
                          id: 'preview',
                          name:
                            draft.name ||
                            (packagingDraft
                              ? 'New packaging'
                              : 'New ingredient'),
                        }}
                        from={draft.purchaseUnit}
                        onSave={async (data) =>
                          change('conversions', [
                            ...(draft.conversions || []),
                            { ...data, createdAt: new Date().toISOString() },
                          ])
                        }
                      />
                    </details>
                  </div>
                  {formError && (
                    <div className="form-error" role="alert">
                      <TriangleAlert size={16} />
                      {formError}
                    </div>
                  )}
                </IngredientFormBody>
              )}
              {modal === 'receive' && (
                <>
                  <ProductLinkImport
                    settings={business}
                    draft={{ ...selected, ...draft }}
                    existing
                    onWorkspace={setState}
                    apply={(patch) => {
                      setFormDirty(true)
                      setDraft((d) => ({
                        ...d,
                        productDetails: { ...d.productDetails, ...patch },
                      }))
                    }}
                  />
                  <div className="form-grid">
                    <Field label="Received date">
                      {input('receivedDate', 'date')}
                    </Field>
                    <Field label="Purchase date (optional)">
                      {input('purchaseDate', 'date')}
                    </Field>
                  </div>
                  <div className="selected-item">
                    <Package size={24} />
                    <span>
                      <strong>{selected?.name}</strong>
                      <small>
                        {selected?.quantity} {selected?.unit} currently on hand
                      </small>
                    </span>
                  </div>
                  <div className="form-grid three">
                    <Field label="Purchase quantity">
                      {input('quantity', 'number')}
                    </Field>
                    <Field label="Purchase unit">
                      {select(
                        'unit',
                        Object.keys(ingredientUnits(selected?.conversions)),
                      )}
                    </Field>
                    <Field label="Price paid ($)">
                      {input('price', 'number')}
                    </Field>
                  </div>
                  <CostExplanation
                    quantity={parseQuantity(draft.quantity)}
                    unit={draft.unit}
                    price={Number(draft.price)}
                    storageUnit={selected?.unit}
                    conversions={selected?.conversions}
                  />
                  {selected && (
                    <p className="calculation-box" aria-live="polite">
                      {stockReceiptPreview(
                        selected,
                        draft.quantity,
                        draft.unit,
                      ) ||
                        'Enter purchase quantity and unit to preview the resulting stock.'}
                    </p>
                  )}
                  <Field label="Vendor">
                    {select(
                      'vendor',
                      state.vendors.map((v) => v.name),
                    )}
                  </Field>
                  <div className="form-grid">
                    <Field label="Lot code (optional)">{input('lot')}</Field>
                    <Field label="Expiration (optional)">
                      {input('expires', 'date')}
                    </Field>
                  </div>
                  <Field label="Note / receipt reference">
                    {input(
                      'reason',
                      'text',
                      'e.g. 25 lb flour bag, receipt #104',
                    )}
                  </Field>
                  <div className="info-banner compact">
                    <ShieldCheck size={17} />
                    <p>
                      This receipt updates stock, calculates weighted average
                      cost, and creates a ledger entry.
                    </p>
                  </div>
                </>
              )}
              {modal === 'adjust' && selected && (
                <IngredientStockAdjustment
                  item={selected}
                  draft={draft}
                  change={change}
                />
              )}
              {modal === 'recipe' && (
                <>
                  {componentPicker && (
                    <RecipeComponentPicker
                      recipes={recipes}
                      parentId={draft.id}
                      close={() => setComponentPicker(false)}
                      select={(source) => {
                        try {
                          const stock = componentStock(source, ingredients)
                          setFormDirty(true)
                          setLines((ls) => [
                            ...ls,
                            {
                              ingredientId: stock.id,
                              componentRecipeId: source.id,
                              productionMode: 'prepared_stock',
                              quantity: 1,
                              unit: source.yieldUnit,
                            },
                          ])
                          setComponentPicker(false)
                        } catch (e) {
                          toast.error((e as Error).message)
                        }
                      }}
                    />
                  )}
                  <Field label="Recipe name">
                    {input('name', 'text', 'e.g. Homestyle White Bread')}
                  </Field>
                  <RecipeBaseFields
                    recipe={{
                      ...draft,
                      id: draft.id || 'preview',
                      name: draft.name || 'Recipe',
                      lines,
                    }}
                    recipes={recipes}
                    ingredients={ingredients}
                    change={change}
                  />
                  <div className="form-grid">
                    <Field label="Category">
                      {select('category', [
                        'Breads',
                        'Cookies',
                        'Pastries',
                        'Cakes',
                        'Preps & fillings',
                      ])}
                    </Field>
                    <Field label="Description">{input('description')}</Field>
                    <Field label="Batch yield">
                      {input('yield', 'number')}
                    </Field>
                    <Field label="Yield unit">
                      {input('yieldUnit', 'text', 'loaves')}
                    </Field>
                  </div>
                  <div className="form-section-title">
                    <h3>
                      1 · {draft.baseRecipeId ? 'Inclusions' : 'Ingredients'}
                    </h3>
                    <div className="recipe-add-actions">
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => {
                          setFormDirty(true)
                          setLines((l) => [
                            ...l,
                            {
                              ingredientId: ingredients[0].id,
                              quantity: 100,
                              unit: 'g',
                            },
                          ])
                        }}
                      >
                        <Plus size={15} />
                        Add ingredient
                      </button>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => setComponentPicker(true)}
                      >
                        <Plus size={15} />
                        Add recipe component
                      </button>
                    </div>
                  </div>
                  {lines.map((line, index) => {
                    const prep = recipeIngredients.find(
                      (i) => i.id === line.ingredientId,
                    )
                    const source = recipes.find(
                      (r) =>
                        r.id ===
                        (line.componentRecipeId || prep?.compoundRecipeId),
                    )
                    return (
                      <div className="recipe-line-editor" key={index}>
                        {source ? (
                          <div className="recipe-component-source">
                            <strong>{source.name}</strong>
                            <small>
                              Finished yield: {source.yield}{' '}
                              {unitLabel(source.yieldUnit)}
                            </small>
                            <small>
                              Use prepared stock · estimate follows source
                              recipe
                            </small>
                            <a
                              className="text-button"
                              href={`/oven?recipe=${encodeURIComponent(source.id)}#Recipes`}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              Open recipe
                            </a>
                          </div>
                        ) : (
                          <select
                            aria-label={`Ingredient ${index + 1}`}
                            value={line.ingredientId}
                            onChange={(e) =>
                              setLines((ls) =>
                                ls.map((l, i) =>
                                  i === index
                                    ? { ...l, ingredientId: e.target.value }
                                    : l,
                                ),
                              )
                            }
                          >
                            {ingredients
                              .filter((i) => i.usedAs === 'ingredient')
                              .map((i) => (
                                <option key={i.id} value={i.id}>
                                  {i.name}
                                </option>
                              ))}
                          </select>
                        )}
                        <input
                          type="text"
                          aria-label="Ingredient quantity"
                          min="0.000001"
                          step="any"
                          value={line.quantity}
                          onChange={(e) =>
                            setLines((ls) =>
                              ls.map((l, i) =>
                                i === index
                                  ? { ...l, quantity: e.target.value }
                                  : l,
                              ),
                            )
                          }
                        />
                        <select
                          aria-label="Recipe unit"
                          value={line.unit}
                          onChange={(e) =>
                            setLines((ls) =>
                              ls.map((l, i) =>
                                i === index
                                  ? { ...l, unit: e.target.value }
                                  : l,
                              ),
                            )
                          }
                        >
                          {Object.keys(
                            ingredientUnits(
                              recipeIngredients.find(
                                (i) => i.id === line.ingredientId,
                              )?.conversions,
                            ),
                          ).map((u) => (
                            <option key={u} value={u}>
                              {unitLabel(u)}
                            </option>
                          ))}
                        </select>
                        <RecipeLineCost
                          line={line}
                          ingredients={recipeIngredients}
                        />
                        <button
                          type="button"
                          className="icon-button"
                          aria-label="Remove ingredient"
                          onClick={() => {
                            setFormDirty(true)
                            setLines((ls) => ls.filter((_, i) => i !== index))
                          }}
                        >
                          <X size={16} />
                        </button>
                      </div>
                    )
                  })}
                  <h3>2 · Yield & labor</h3>
                  <div className="form-grid three">
                    <Field
                      label="Labor (minutes)"
                      hint={
                        draft.baseRecipeId
                          ? 'Total time for this entire recipe batch, including the base.'
                          : undefined
                      }
                    >
                      {input('laborMinutes', 'number')}
                    </Field>
                    <Field label="Labor rate ($ / h)">
                      {input('laborRate', 'number')}
                    </Field>
                    <Field label="Overhead amount ($ or %)">
                      {input('overhead', 'number')}
                    </Field>
                  </div>
                  <details className="form-step">
                    <summary>Overhead & waste settings</summary>
                    <div className="form-grid">
                      <Field label="Overhead calculation">
                        {select('overheadMode', [
                          { value: 'batch', label: 'Flat amount per batch' },
                          {
                            value: 'unit',
                            label: 'Flat amount per finished item',
                          },
                          {
                            value: 'percent',
                            label:
                              'Percent of ingredients, packaging and labor',
                          },
                        ])}
                      </Field>
                      <Field label="Waste method">
                        {select('wasteMode', [
                          { value: 'percent', label: 'Percentage allowance' },
                          {
                            value: 'actual',
                            label: 'Actual additional waste cost',
                          },
                        ])}
                      </Field>
                      <Field label="Waste allowance (%)">
                        {input('wastePercent', 'number')}
                      </Field>
                      <Field
                        label="Additional actual waste cost ($)"
                        hint="Use only for costs outside recorded ingredient usage, to avoid counting waste twice."
                      >
                        {input('wasteCost', 'number')}
                      </Field>
                    </div>
                  </details>
                  <p className="muted recipe-packaging-note">
                    3 · Packaging is assigned to sellable products, so each
                    package uses its own bags, boxes, and labels.
                  </p>
                  <RecipeCalculation
                    recipe={{
                      ...draft,
                      baseRecipe: recipes.find(
                        (r) => r.id === draft.baseRecipeId,
                      ),
                      id: draft.id || 'preview',
                      name: draft.name || 'Recipe',
                      lines,
                    }}
                    ingredients={recipeIngredients}
                    onConversion={(data) =>
                      mutate('conversion', 'ingredients', data)
                    }
                  />
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={!!draft.compound}
                      onChange={(e) => change('compound', e.target.checked)}
                    />
                    This recipe is a compound prep (yield unit must be a pantry
                    unit, e.g. g).
                  </label>
                  <Field label="Instructions">
                    <textarea
                      rows={4}
                      value={draft.instructions || ''}
                      onChange={(e) => change('instructions', e.target.value)}
                      placeholder="Mix, rest, shape, bake…"
                    />
                  </Field>
                </>
              )}
              {modal === 'product' && (
                <Tabs.Root
                  value={productTab}
                  onValueChange={setProductTab}
                  className="product-form-tabs"
                >
                  <Tabs.List
                    className="add-item-tabs product-form-tab-list"
                    aria-label="Product sections"
                  >
                    <Tabs.Trigger value="details">
                      Details & Pricing
                    </Tabs.Trigger>
                    <Tabs.Trigger value="images">Images & Labels</Tabs.Trigger>
                    <Tabs.Trigger value="stock">
                      Stock & Other Details
                    </Tabs.Trigger>
                  </Tabs.List>
                  <Tabs.Content
                    value="details"
                    forceMount
                    hidden={productTab !== 'details'}
                    data-product-tab="details"
                    className="product-form-panel"
                  >
                    <Field label="Product name">
                      {input('name', 'text', 'e.g. Homestyle White Bread Loaf')}
                    </Field>
                    <Field label="Connected recipe">
                      {select(
                        'recipeId',
                        recipes
                          .filter((r) => r.workflow !== 'handmade')
                          .map((r) => ({ value: r.id, label: r.name })),
                      )}
                    </Field>
                    <div className="form-grid">
                      <Field label="Units per package">
                        {input('unitsPerPackage', 'number')}
                      </Field>
                      <Field label="Retail price ($)">
                        {input('price', 'number')}
                      </Field>
                      <Field label="Wholesale price ($)">
                        {input('wholesale', 'number')}
                      </Field>
                      <Field label="Target margin (%)">
                        {input('targetMargin', 'number')}
                      </Field>
                      <Field label="Entered prices">
                        {select('priceTaxMode', [
                          {
                            value: 'configured',
                            label: 'Use rate behaviors (supports mixed taxes)',
                          },
                          {
                            value: 'before',
                            label: 'My entered price is before tax',
                          },
                          {
                            value: 'includes',
                            label: 'My entered price includes tax',
                          },
                        ])}
                      </Field>
                      <Field label="Target food cost (%)">
                        {input('targetFoodCost', 'number')}
                      </Field>
                    </div>
                    <ProductCategorySelector
                      product={{
                        ...draft,
                        id: draft.id || 'preview',
                        name: draft.name || 'Product',
                      }}
                      business={business}
                      canManage={ready && ['Owner', 'Manager'].includes(role)}
                      onChange={change}
                      onBusyChange={setBusy}
                      onConfig={(patch) =>
                        setState((w) => ({
                          ...w,
                          settings: w.settings.map((s, i) =>
                            i === 0 ? { ...s, ...patch } : s,
                          ),
                        }))
                      }
                      openTaxSettings={() =>
                        window.open(
                          '/oven#Settings/Taxes',
                          '_blank',
                          'noopener,noreferrer',
                        )
                      }
                    />
                    <PackagingEditor
                      product={{
                        ...draft,
                        id: draft.id || 'preview',
                        name: draft.name || 'Product',
                      }}
                      ingredients={ingredients}
                      onChange={(lines) => change('packagingLines', lines)}
                    />
                    <label className="check-label">
                      <input
                        type="checkbox"
                        checked={draft.unpacked === true}
                        onChange={(e) => change('unpacked', e.target.checked)}
                      />
                      This product is sold unpackaged (only when no packaging
                      lines are assigned).
                    </label>
                  </Tabs.Content>
                  <Tabs.Content
                    value="images"
                    forceMount
                    hidden={productTab !== 'images'}
                    data-product-tab="images"
                    className="product-form-panel"
                  >
                    <ItemImagesPanel
                      value={{
                        ...draft,
                        id: draft.id || 'preview',
                        name: draft.name || 'Product',
                      }}
                      assets={state.graphic_assets || []}
                      canUpload={ready && ['Owner', 'Manager'].includes(role)}
                      disabled={busy}
                      onChange={change}
                      onWorkspace={setState}
                      onBusy={setBusy}
                    >
                      <ProductLabelsInfo
                        value={{
                          ...draft,
                          id: draft.id || 'preview',
                          name: draft.name || 'Product',
                        }}
                        workspace={state}
                      />
                      <section
                        className="item-images-text"
                        aria-label="Label text"
                      >
                        <h3>Label text</h3>
                        <div className="form-grid">
                          <Field label="Label main name (optional)">
                            {input('labelMainName', 'text', 'Homestyle White')}
                          </Field>
                          <Field label="Label product type (optional)">
                            {input('labelProductType', 'text', 'Bread')}
                          </Field>
                          <NetWeightField value={draft} onChange={change} />
                        </div>
                        <p className="form-hint">
                          Label Studio can bind these name parts to separate
                          text elements with independent fonts. Your full
                          product name stays unchanged.
                        </p>
                      </section>
                    </ItemImagesPanel>
                  </Tabs.Content>
                  <Tabs.Content
                    value="stock"
                    forceMount
                    hidden={productTab !== 'stock'}
                    data-product-tab="stock"
                    className="product-form-panel"
                  >
                    <section
                      className="calculation-box product-form-stock"
                      aria-label="Production and stock"
                    >
                      <h3>Production & stock</h3>
                      <p>
                        {(() => {
                          const runs = batches.filter(
                            (b) =>
                              b.status === 'completed' &&
                              !!draft.id &&
                              b.productId === draft.id,
                          ).length
                          return runs
                            ? `${runs} completed production ${runs === 1 ? 'run' : 'runs'} recorded for this product.`
                            : 'No completed production runs recorded for this product yet.'
                        })()}
                      </p>
                      <p className="form-hint">
                        Food products are made through the batch workflow in
                        Production. Saving this form never adds stock, posts
                        inventory or changes historical batch costs.
                      </p>
                    </section>
                    <Field label="Storage instructions">
                      {input('storage', 'text', 'Store in a cool, dry place.')}
                    </Field>
                  </Tabs.Content>
                </Tabs.Root>
              )}
              {modal === 'product' && (
                <PricingSummary
                  workspace={state}
                  product={{
                    ...draft,
                    id: draft.id || 'preview',
                    name: draft.name || 'Product',
                  }}
                  cost={productCost({
                    ...draft,
                    id: 'preview',
                    name: 'Product',
                  })}
                  onSuggested={(price) => change('price', price)}
                />
              )}
              {modal === 'batch' && (
                <>
                  <Field label="Recipe">
                    {select(
                      'recipeId',
                      recipes
                        .filter((r) => r.workflow !== 'handmade')
                        .map((r) => ({ value: r.id, label: r.name })),
                    )}
                  </Field>
                  <div className="form-grid">
                    <Field label="Production date">
                      {input('date', 'date')}
                    </Field>
                    <Field label="Number of batches">
                      {input('count', 'number')}
                    </Field>
                  </div>
                  <Field label="Product for packaging and historical costs">
                    {select('productId', [
                      {
                        value: '',
                        label: 'Select product (or compound prep)',
                      },
                      ...products
                        .filter((p) => p.recipeId === draft.recipeId)
                        .map((p) => ({ value: p.id, label: p.name })),
                    ])}
                  </Field>
                  <div className="calculation-box">
                    <strong>
                      {Number(draft.count) *
                        (recipes.find((r) => r.id === draft.recipeId)?.yield ||
                          0)}{' '}
                      {recipes.find((r) => r.id === draft.recipeId)?.yieldUnit}{' '}
                      planned
                    </strong>
                    <p>
                      Inventory stays on your shelf until you complete the
                      batch.
                    </p>
                  </div>
                  <BatchCostPreview
                    recipe={recipes.find((r) => r.id === draft.recipeId)}
                    product={products.find(
                      (p) =>
                        p.id === draft.productId &&
                        p.recipeId === draft.recipeId,
                    )}
                    ingredients={ingredients}
                    multiplier={Number(draft.count || 1)}
                  />
                  <Field label="Production notes">
                    <textarea
                      value={draft.note || ''}
                      onChange={(e) => change('note', e.target.value)}
                      placeholder="Market, pre-orders, special instructions…"
                    />
                  </Field>
                </>
              )}
              {modal === 'complete' && (
                <>
                  <Field label="Sellable product">
                    {select('productId', [
                      {
                        value: '',
                        label: 'Select product (or compound prep)',
                      },
                      ...products
                        .filter((p) => p.recipeId === selected?.recipeId)
                        .map((p) => ({ value: p.id, label: p.name })),
                    ])}
                  </Field>
                  <Field
                    label="Additional actual waste cost ($)"
                    hint="Only for costs outside recorded ingredient usage."
                  >
                    {input('wasteCost', 'number')}
                  </Field>

                  <div className="selected-item">
                    <CookingPot size={25} />
                    <span>
                      <strong>{selected?.name}</strong>
                      <small>
                        {selected?.count} batches · planned yield{' '}
                        {selected?.yield}
                      </small>
                    </span>
                  </div>
                  <div className="form-grid">
                    <Field label="Actual finished yield">
                      <input
                        type="number"
                        min="0.000001"
                        step="any"
                        required
                        value={draft.actualYield ?? selected?.yield ?? ''}
                        onChange={(e) => change('actualYield', e.target.value)}
                      />
                    </Field>
                    <Field
                      label="Actual labor (minutes)"
                      hint="Total time for the entire run, including any linked base."
                    >
                      <input
                        type="number"
                        min="0"
                        required
                        value={
                          draft.laborMinutes ??
                          (recipes.find((r) => r.id === selected?.recipeId)
                            ?.laborMinutes || 0) * (selected?.count || 1)
                        }
                        onChange={(e) => change('laborMinutes', e.target.value)}
                      />
                    </Field>
                    <Field label="Waste quantity">
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={draft.waste ?? 0}
                        onChange={(e) => change('waste', e.target.value)}
                      />
                    </Field>
                    <Field label="Waste reason">{input('wasteReason')}</Field>
                  </div>
                  <div className="form-section-title">
                    <h3>Actual ingredient use</h3>
                    <small>Adjust to match what you used.</small>
                  </div>
                  {recipeProductionLines(
                    recipes.find((r) => r.id === selected?.recipeId) || {
                      id: 'missing',
                      name: '',
                      lines: [],
                    },
                    ingredients,
                    recipes,
                  ).map((l: any) => {
                    const i = ingredients.find((i) => i.id === l.ingredientId)!
                    return (
                      <div className="actual-use-row" key={i.id}>
                        <span>{i.name}</span>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          aria-label={'Actual ' + i.name}
                          value={
                            draft.usage?.[i.id] ??
                            l.quantity * (selected?.count || 1)
                          }
                          onChange={(e) =>
                            change('usage', {
                              ...draft.usage,
                              [i.id]: e.target.value,
                            })
                          }
                        />
                        <span>{l.unit}</span>
                      </div>
                    )
                  })}
                  <BatchCostPreview
                    recipe={recipes.find((r) => r.id === selected?.recipeId)}
                    product={
                      products.find(
                        (p) =>
                          p.id === (draft.productId || selected?.productId),
                      ) ||
                      (products.filter((p) => p.recipeId === selected?.recipeId)
                        .length === 1 &&
                        products.find(
                          (p) => p.recipeId === selected?.recipeId,
                        )) ||
                      undefined
                    }
                    ingredients={ingredients}
                    multiplier={Number(selected?.count || 1)}
                    actualYield={Number(draft.actualYield ?? selected?.yield)}
                    laborMinutes={
                      draft.laborMinutes === undefined
                        ? undefined
                        : Number(draft.laborMinutes)
                    }
                    usage={draft.usage}
                    wasteCost={
                      draft.wasteCost === undefined
                        ? undefined
                        : Number(draft.wasteCost)
                    }
                  />
                  <div className="review-note">
                    <ShieldCheck size={20} />
                    <p>
                      Completing deducts actual ingredients and product
                      packaging atomically. Costs are locked to this run.
                      Insufficient stock prevents completion.
                    </p>
                  </div>
                </>
              )}
              {modal === 'sale' && (
                <>
                  <Field label="Product">
                    {select(
                      'productId',
                      products.map((p) => ({ value: p.id, label: p.name })),
                    )}
                  </Field>
                  <div className="form-grid">
                    <Field label="Date">{input('date', 'date')}</Field>
                    <Field label="Packages sold">
                      {input('quantity', 'number')}
                    </Field>
                    <Field
                      label="Sales amount before discounts ($)"
                      hint="Enter the amount using this product’s configured tax behavior; discounts use the same basis."
                    >
                      {input('amount', 'number')}
                    </Field>
                    <Field label="Discounts ($)">
                      {input('discounts', 'number')}
                    </Field>
                    <Field label="Processing fees ($)">
                      {input('fees', 'number')}
                    </Field>
                    <Field label="Sales channel">
                      {select('channel', [
                        'Farmers market',
                        'Pre-order',
                        'Wholesale',
                        'Custom order',
                        'Online',
                        'Walk-in',
                        'Other',
                      ])}
                    </Field>
                    <Field label="Payment method">
                      {select('paymentMethod', [
                        'Card',
                        'Cash',
                        'Check',
                        'Bank transfer',
                        'Other',
                      ])}
                    </Field>
                  </div>
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => {
                      const p = products.find((p) => p.id === draft.productId)
                      if (p)
                        change(
                          'amount',
                          Number(draft.quantity || 0) *
                            Number(
                              draft.channel === 'Wholesale'
                                ? p.wholesale || 0
                                : p.price || 0,
                            ),
                        )
                    }}
                  >
                    Use {draft.channel === 'Wholesale' ? 'wholesale' : 'retail'}{' '}
                    price × packages sold
                  </button>
                  <Field label="Production cost source">
                    {select('batchId', [
                      {
                        value: '',
                        label:
                          'Current cost estimate (no completed batch selected)',
                      },
                      ...batches
                        .filter(
                          (b) =>
                            b.status === 'completed' &&
                            b.productId === draft.productId,
                        )
                        .map((b) => ({
                          value: b.id,
                          label: `${b.name} · ${b.date} · ${money(b.historicalCost)}`,
                        })),
                    ])}
                  </Field>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={Array.isArray(draft.taxRateIds)}
                      onChange={(e) => {
                        try {
                          change(
                            'taxRateIds',
                            e.target.checked
                              ? applicableTaxes(
                                  products.find(
                                    (p) => p.id === draft.productId,
                                  ) || { id: '', name: '' },
                                  business,
                                  draft.date,
                                ).map((r) => r.id)
                              : undefined,
                          )
                        } catch (error) {
                          setError((error as Error).message)
                        }
                      }}
                    />
                    Select rates manually for this sale
                  </label>
                  {Array.isArray(draft.taxRateIds) &&
                    (business.taxRates || []).map((r: any) => (
                      <label key={r.id} className="check-label">
                        <input
                          type="checkbox"
                          checked={draft.taxRateIds.includes(r.id)}
                          onChange={(e) =>
                            change(
                              'taxRateIds',
                              e.target.checked
                                ? [...draft.taxRateIds, r.id]
                                : draft.taxRateIds.filter(
                                    (id: string) => id !== r.id,
                                  ),
                            )
                          }
                        />
                        {r.name} · {r.jurisdiction} · {r.ratePercent}%
                      </label>
                    ))}
                  <TaxPreview
                    product={saleTaxProduct(
                      products.find((p) => p.id === draft.productId) || {
                        id: '',
                        name: '',
                      },
                      draft.taxRateIds,
                    )}
                    business={business}
                    date={draft.date}
                    amount={Math.max(
                      0,
                      Number(draft.amount || 0) - Number(draft.discounts || 0),
                    )}
                  />
                  <div className="info-banner compact">
                    <Receipt size={19} />
                    <p>
                      Sales tax is recorded separately from revenue. Product
                      cost is preserved at the time of recording.
                    </p>
                  </div>
                </>
              )}
              {modal === 'expense' && (
                <>
                  <Field label="Description">
                    {input('name', 'text', 'e.g. Saturday market stall')}
                  </Field>
                  <div className="form-grid">
                    <Field label="Date">{input('date', 'date')}</Field>
                    <Field label="Amount ($)">
                      {input('amount', 'number')}
                    </Field>
                    <Field label="Category">
                      {select('category', [
                        'Ingredients',
                        'Packaging',
                        'Supplies',
                        'Labor',
                        'Market fees',
                        'Delivery',
                        'Mileage',
                        'Equipment',
                        'Software',
                        'Rent / commissary kitchen',
                        'Utilities',
                        'Advertising',
                        'Insurance',
                        'Licenses / permits',
                        'Payment processing fees',
                        'Professional services',
                        'Miscellaneous',
                      ])}
                    </Field>
                    <Field label="Vendor">
                      {select('vendor', [
                        'None',
                        ...state.vendors.map((v) => v.name),
                      ])}
                    </Field>
                    <Field label="Payment method">
                      {select('paymentMethod', [
                        'Card',
                        'Cash',
                        'Bank transfer',
                        'Check',
                      ])}
                    </Field>
                  </div>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={!!draft.inventory}
                      onChange={(e) => change('inventory', e.target.checked)}
                    />
                    Inventory purchase (separate from operating expenses)
                  </label>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={!!draft.taxDeductible}
                      onChange={(e) =>
                        change('taxDeductible', e.target.checked)
                      }
                    />
                    Flag for tax-deductibility review
                  </label>
                </>
              )}
              {modal === 'vendor' && (
                <>
                  <Field label="Vendor name">{input('name')}</Field>
                  <div className="form-grid">
                    <Field label="Contact name">{input('contact')}</Field>
                    <Field label="Email">{input('email', 'email')}</Field>
                    <Field label="Phone">{input('phone', 'tel')}</Field>
                    <Field label="Payment terms">
                      {select('terms', [
                        'Due on receipt',
                        'Net 15',
                        'Net 30',
                        'Net 60',
                      ])}
                    </Field>
                  </div>
                  <Field label="Notes">
                    <textarea
                      value={draft.notes || ''}
                      onChange={(e) => change('notes', e.target.value)}
                    />
                  </Field>
                </>
              )}
              {modal === 'order' && (
                <>
                  <Field label="Order number">
                    {input('name', 'text', 'PO-0026')}
                  </Field>
                  <Field label="Vendor">
                    {select(
                      'vendor',
                      state.vendors.map((v) => v.name),
                    )}
                  </Field>
                  <div className="form-grid">
                    <Field label="Expected date">{input('date', 'date')}</Field>
                    <Field label="Estimated total ($)">
                      {input('amount', 'number')}
                    </Field>
                  </div>
                  <Field label="Status">
                    {select('status', [
                      'draft',
                      'ordered',
                      'partially_received',
                      'received',
                      'cancelled',
                    ])}
                  </Field>
                  <p className="muted">
                    Receive individual items in Pantry to update stock and
                    create receipt transactions.
                  </p>
                </>
              )}
              {modal === 'settings' && (
                <>
                  <Field label="Oven timezone (IANA)">
                    <input
                      value={draft.timezone || 'America/Chicago'}
                      onChange={(e) => change('timezone', e.target.value)}
                      placeholder="America/Chicago"
                    />
                  </Field>
                  <Field label="Business name">{input('name')}</Field>
                  <div className="form-grid">
                    <Field label="Owner name">{input('owner')}</Field>
                    <Field label="Business email">
                      {input('email', 'email')}
                    </Field>
                  </div>
                  <Field label="Business address">{input('address')}</Field>
                  <Field label="State / jurisdiction">
                    {input('jurisdiction')}
                  </Field>
                  <div className="form-grid three">
                    <Field label="Labor rate ($ / h)">
                      {input('laborRate', 'number')}
                    </Field>
                    <Field label="Target margin (%)">
                      {input('targetMargin', 'number')}
                    </Field>
                  </div>
                  <div className="form-grid">
                    <Field label="Business default overhead">
                      {input('defaultOverhead', 'number')}
                    </Field>
                    <Field label="Default overhead method">
                      {select('overheadMode', [
                        { value: 'batch', label: 'Flat per batch' },
                        { value: 'unit', label: 'Flat per finished item' },
                        {
                          value: 'percent',
                          label: 'Percent of direct costs',
                        },
                      ])}
                    </Field>
                  </div>
                  <TaxRateEditor
                    rates={
                      draft.taxRates ??
                      (Number(draft.taxRate) > 0
                        ? [
                            {
                              id: 'legacy-default',
                              name: 'Business default',
                              jurisdiction:
                                draft.jurisdiction || 'Business jurisdiction',
                              ratePercent: Number(draft.taxRate),
                              behavior: 'exclusive',
                            },
                          ]
                        : [])
                    }
                    onChange={(rates) => change('taxRates', rates)}
                  />
                  <Field
                    label="Cottage-food disclaimer"
                    hint="Customize and review with your local authority."
                  >
                    <textarea
                      rows={4}
                      value={draft.disclaimer || ''}
                      onChange={(e) => change('disclaimer', e.target.value)}
                    />
                  </Field>
                </>
              )}
              {modal === 'signin' && (
                <>
                  <p>
                    Your oven uses your verified account and active membership.
                  </p>
                  <a href="/login">Review account access</a>
                  <Btn
                    secondary
                    onClick={async () => {
                      try {
                        const identity = await import('@netlify/identity')
                        await identity.logout()
                        setModal(null)
                      } catch {
                        toast.error(
                          'Sign out could not complete. Please retry.',
                        )
                      }
                    }}
                  >
                    Sign out of your account
                  </Btn>
                </>
              )}
              {modal === 'journal' && (
                <>
                  <Field label="Entry memo">
                    {input('name', 'text', 'Owner capital contribution')}
                  </Field>
                  <Field label="Amount ($)">{input('amount', 'number')}</Field>
                  <div className="calculation-box">
                    <div>
                      Debit · Cash{' '}
                      <strong>{money(Number(draft.amount))}</strong>
                    </div>
                    <div>
                      Credit · Owner equity{' '}
                      <strong>{money(Number(draft.amount))}</strong>
                    </div>
                  </div>
                  <p className="muted">
                    This balanced capital-contribution entry is immutable once
                    posted. Corrections require a new reversing entry.
                  </p>
                </>
              )}
              {formError && modal !== 'ingredient' && (
                <div className="form-error" role="alert">
                  <TriangleAlert size={16} />
                  {formError}
                </div>
              )}
              <div className="form-footer">
                {modal === 'ingredient' && formError && (
                  <p role="alert" className="ingredient-save-error">
                    {formError}
                  </p>
                )}
                <Btn secondary onClick={() => setModal(null)}>
                  Cancel
                </Btn>
                <Btn
                  type="submit"
                  disabled={
                    busy || (modal === 'ingredient' && ingredientImportBusy)
                  }
                >
                  {busy ? (
                    <RefreshCw size={16} className="spinning" />
                  ) : (
                    <Check size={16} />
                  )}{' '}
                  {busy
                    ? 'Saving…'
                    : modal === 'complete'
                      ? 'Complete & deduct inventory'
                      : modal === 'signin'
                        ? 'Review account access'
                        : modal === 'journal'
                          ? 'Post balanced entry'
                          : modal === 'product'
                            ? products.some((p) => p.id === draft.id)
                              ? 'Save Changes'
                              : 'Create Product'
                            : 'Save ' +
                              (
                                {
                                  import: 'CSV import',
                                  ingredient: packagingDraft
                                    ? 'packaging'
                                    : 'ingredient',
                                  receive: 'receipt',
                                  adjust: 'adjustment',
                                  recipe: 'recipe',
                                  product: 'product',
                                  batch: 'batch',
                                  sale: 'sale',
                                  expense: 'expense',
                                  vendor: 'vendor',
                                  order: 'order',
                                  settings: 'settings',
                                } as Record<string, string>
                              )[modal || '']}
                </Btn>
              </div>
            </form>
          ) : null}
          {modal === 'sale-detail' && selected && (
            <>
              <h3>{selected.name}</h3>
              <Btn secondary onClick={() => window.print()}>
                Print receipt / save PDF
              </Btn>
              <p>
                {selected.date} · {selected.quantity} packages ·{' '}
                {selected.refundOf ? 'Refund' : 'Recorded sale'}
              </p>
              <div className="calculation-box">
                <p>Revenue excluding tax: {money(selected.amount)}</p>
                <p>Tax liability: {money(selected.tax || 0)}</p>
                <p>
                  Customer total:{' '}
                  {money(
                    selected.customerTotal ??
                      selected.amount + (selected.tax || 0),
                  )}
                </p>
                <p>
                  Historical cost: {money(selected.historicalCogs)} ·{' '}
                  {selected.costSource || 'legacy snapshot'}
                </p>
              </div>
              <details className="calculation-box">
                <summary>View calculation · saved tax snapshot</summary>
                {(selected.taxSnapshot || []).map((r: any) => (
                  <p key={r.id}>
                    {r.name} · {r.jurisdiction} · {r.behavior}:{' '}
                    {Number(r.taxableBase).toFixed(6)} × {r.ratePercent}% ={' '}
                    {money(r.amount)}
                  </p>
                ))}
                {!selected.taxSnapshot && (
                  <p>This legacy record has no per-rate snapshot.</p>
                )}
              </details>
              {selected.stockDeducted && !selected.refundOf && (
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={draft.restock === true}
                    onChange={(event) =>
                      change('restock', event.target.checked)
                    }
                  />
                  Physically returned goods are sellable: return all items to
                  stock at the original sale cost. Leave unchecked for refund
                  without restocking.
                </label>
              )}
              {!selected.refundOf &&
                !state.sales.some((s) => s.refundOf === selected.id) && (
                  <Btn
                    secondary
                    onClick={async () => {
                      try {
                        await mutate('refund', 'sales', {
                          id: selected.id,
                          restock: draft.restock === true,
                        })
                      } catch (e) {
                        setFormError((e as Error).message)
                      }
                    }}
                  >
                    Record full refund and reverse tax
                  </Btn>
                )}
            </>
          )}
          {modal === 'recipe-detail' && selected && (
            <RecipeDetail
              key={selected.id}
              recipe={selected}
              workspace={state}
              ready={ready}
              canEdit={ready && ['Owner', 'Manager'].includes(role)}
              open={open}
              close={() => setModal(null)}
              save={(data) => mutate('productRecipeLink', 'products', data)}
            />
          )}
          {modal === 'product-detail' && selected && (
            <ItemDetailLayout
              item={selected}
              assets={state.graphic_assets || []}
              kind="product"
              photoDetails={
                <>
                  <section
                    aria-label="Product labels"
                    className="product-linked-labels"
                  >
                    <h3>Labels</h3>
                    {labelsForProduct(state, selected).length ? (
                      labelsForProduct(state, selected).map((label) => (
                        <div className="product-linked-label" key={label.id}>
                          <span>
                            <strong>{label.name}</strong>
                            {label.format === 'front-back'
                              ? ' · Front + Back'
                              : ''}
                          </span>
                          <Btn
                            secondary
                            small
                            onClick={() => {
                              setPreviewLabelId(label.id)
                              setPreviewProduct(selected)
                            }}
                          >
                            Preview/Print
                          </Btn>
                          <Btn
                            secondary
                            small
                            onClick={() => {
                              setLabelProduct(selected.id)
                              setLabelDesign(label.id)
                              setModal(null)
                              go('Labels', 'Editor')
                            }}
                          >
                            Edit
                          </Btn>
                        </div>
                      ))
                    ) : (
                      <p className="table-note">
                        No linked labels. Create one in Labels when needed.
                      </p>
                    )}
                  </section>
                  <div className="button-row product-detail-actions">
                    <Btn onClick={() => open('product', selected)}>
                      Edit Product
                    </Btn>
                    <Btn
                      secondary
                      onClick={() => {
                        setLabelProduct(selected.id)
                        setLabelDesign('')
                        setLabelCreateRequest((n) => n + 1)
                        setModal(null)
                        go('Labels', 'Labels')
                      }}
                    >
                      Create label
                    </Btn>
                  </div>
                  <p className="table-note product-detail-recipe">
                    Connected recipe:{' '}
                    {recipes.find((r) => r.id === selected.recipeId)?.name ||
                      'Not linked — current recipe cost unavailable'}
                    {recipes.find((r) => r.id === selected.recipeId) && (
                      <button
                        className="text-button"
                        onClick={() =>
                          open(
                            'recipe-detail',
                            recipes.find((r) => r.id === selected.recipeId)!,
                          )
                        }
                      >
                        Open recipe
                      </button>
                    )}
                  </p>
                </>
              }
            >
              <ProductCostCards
                product={selected}
                cost={productCost(selected)}
                workspace={state}
              />
            </ItemDetailLayout>
          )}
          {modal === 'batch-detail' && selected && (
            <>
              {selected.costSnapshot && (
                <details className="calculation-box">
                  <summary>View calculation · historical batch cost</summary>
                  {[
                    'ingredient',
                    'packagingCost',
                    'labor',
                    'overhead',
                    'waste',
                    'total',
                  ].map((key) => (
                    <p key={key}>
                      {key}: {money(selected.costSnapshot[key])}
                    </p>
                  ))}
                  <p>
                    Actual yield {selected.costSnapshot.actualYield} · cost per
                    item {money(selected.costSnapshot.perItem)} · cost per
                    package {money(selected.costSnapshot.perPackage)}
                  </p>
                  {selected.costSnapshot.lines.map((l: any, index: number) => (
                    <p key={index}>
                      {l.name}: {l.quantity} {l.unit} ={' '}
                      {l.normalized.toFixed(6)} {l.storageUnit} × $
                      {l.unitCost.toFixed(8)} = ${l.cost.toFixed(6)}
                    </p>
                  ))}
                </details>
              )}

              <div className="detail-stats">
                <span>
                  <small>STATUS</small>
                  <strong>{selected.status.replaceAll('_', ' ')}</strong>
                </span>
                <span>
                  <small>ACTUAL YIELD</small>
                  <strong>{selected.actualYield || selected.yield}</strong>
                </span>
                <span>
                  <small>LOCKED COST</small>
                  <strong>
                    {selected.historicalCost
                      ? money(selected.historicalCost)
                      : 'Not completed'}
                  </strong>
                </span>
              </div>
              <p>{selected.note}</p>
              {selected.usage && (
                <DataTable
                  rows={selected.usage.map((u: any) => ({
                    ...u,
                    id: u.ingredientId,
                    name: ingredients.find((i) => i.id === u.ingredientId)
                      ?.name,
                  }))}
                  columns={[
                    ['name', 'Ingredient'],
                    ['quantity', 'Used'],
                    ['unit', 'Unit'],
                    ['cost', 'Locked cost'],
                  ]}
                />
              )}
              <div className="button-row">
                <Btn
                  onClick={() =>
                    open('batch', {
                      ...selected,
                      id: '',
                      date: ovenToday(business),
                      status: 'scheduled',
                      historicalCost: undefined,
                    })
                  }
                >
                  <RefreshCw size={16} />
                  Make again
                </Btn>
                {selected.status !== 'completed' && (
                  <Btn secondary onClick={() => open('complete', selected)}>
                    Complete batch
                  </Btn>
                )}
              </div>
            </>
          )}
          {['receive-picker', 'adjust-picker'].includes(modal || '') && (
            <div className="picker-list">
              {[
                ...ingredients,
                ...products.filter((p) => p.workflow === 'resale'),
              ].map((i) => (
                <button
                  key={i.id}
                  onClick={() =>
                    open(modal === 'receive-picker' ? 'receive' : 'adjust', {
                      ...i,
                      quantity: modal === 'receive-picker' ? 25 : -1,
                      price: 10.95,
                    })
                  }
                >
                  <Package size={19} />
                  <span>
                    <strong>{i.name}</strong>
                    <small>
                      {i.quantity.toFixed(2)} {i.unit} on hand
                    </small>
                  </span>
                  <ChevronRight size={16} />
                </button>
              ))}
            </div>
          )}
          {modal === 'quick' && (
            <div className="quick-modal-grid">
              {quickActions.map(([name, kind]) => (
                <button key={kind} onClick={() => open(kind)}>
                  <Plus size={18} />
                  {name}
                  <ChevronRight size={16} />
                </button>
              ))}
            </div>
          )}
          {modal === 'notifications' && (
            <div className="picker-list">
              {[
                ...low.map((i) => ({
                  name: i.name,
                  detail: `Low stock · ${i.quantity} ${i.unit} left`,
                  id: i.id,
                })),
                ...expiring.map((i) => ({
                  name: i.name,
                  detail: `Expires ${dateLabel(i.expires)}`,
                  id: i.id + 'exp',
                })),
              ].map((n) => (
                <button
                  key={n.id}
                  onClick={() => {
                    setModal(null)
                    go('Pantry')
                  }}
                >
                  <TriangleAlert size={18} />
                  <span>
                    <strong>{n.name}</strong>
                    <small>{n.detail}</small>
                  </span>
                  <ChevronRight size={16} />
                </button>
              ))}
            </div>
          )}
          {modal === 'search' && (
            <>
              <div className="search-field">
                <Search size={18} />
                <input
                  autoFocus
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search ingredients, recipes, products…"
                />
              </div>
              <div className="picker-list">
                {[
                  ...ingredients.map((i) => ({
                    ...i,
                    kind: 'ingredient-detail',
                  })),
                  ...recipes.map((i) => ({ ...i, kind: 'recipe-detail' })),
                  ...products.map((i) => ({ ...i, kind: 'product-detail' })),
                ]
                  .filter((i) =>
                    i.name.toLowerCase().includes(search.toLowerCase()),
                  )
                  .map((i) => (
                    <button key={i.id} onClick={() => open(i.kind, i)}>
                      {i.kind === 'ingredient-detail' ? (
                        <PantryPhoto item={i} assets={state.graphic_assets} />
                      ) : (
                        <Search size={16} />
                      )}
                      <span>{i.name}</span>
                      <ChevronRight size={16} />
                    </button>
                  ))}
              </div>
            </>
          )}
          {modal === 'workspace' && (
            <>
              <div className="selected-item">
                <Building2 size={28} />
                <span>
                  <strong>{business.name}</strong>
                  <small>
                    {demo
                      ? 'Private browser demo · expires after 30 days'
                      : 'Authenticated business oven'}
                  </small>
                </span>
                <CircleCheck size={20} />
              </div>
              <p className="muted">
                All pantry, recipe, production, and financial records belong to
                this business. Your demo oven is separate from other visitors’
                data.
              </p>
              <Btn onClick={() => open('signin')}>
                Manage account <ArrowRight size={16} />
              </Btn>
            </>
          )}
          {modal === 'activity' && (
            <div className="activity-list">
              {[...state.activity].reverse().map((a) => (
                <div key={a.id}>
                  <CircleCheck size={19} />
                  <span>
                    <strong>{a.name}</strong>
                    <p>{a.detail}</p>
                    <small>{dateLabel(a.date)}</small>
                  </span>
                </div>
              ))}
            </div>
          )}
          {modal === 'report' && selected && (
            <>
              <div className="button-row">
                <Btn
                  secondary
                  onClick={() =>
                    exportData(selected.name, reportRows(selected.name, state))
                  }
                >
                  <Download size={16} />
                  Export CSV
                </Btn>
              </div>
              <DataTable
                rows={reportRows(selected.name, state)}
                columns={Object.keys(
                  reportRows(selected.name, state)[0] || {
                    name: '',
                    amount: 0,
                  },
                )
                  .filter((k) => k !== 'id')
                  .map((k) => [
                    k,
                    k
                      .replace(/([A-Z])/g, ' $1')
                      .replace(/^./, (c) => c.toUpperCase()),
                  ])}
              />
            </>
          )}
          {modal === 'help' && (
            <>
              <div className="help-art">
                <BakeryArt />
              </div>
              <a
                className="btn primary"
                href={'/support#context=' + encodeURIComponent('/oven#' + page)}
              >
                Get help <ArrowRight size={16} />
              </a>
              <p>
                Private tickets and replies with platform support. Do not send
                passwords, API keys or payment-card details.
              </p>
              <h3>From a 25-lb bag to a profitable batch.</h3>
              <ol className="help-steps">
                <li>
                  <strong>Stock your pantry.</strong> Enter package quantities
                  and prices. Unit math is shown at every step.
                </li>
                <li>
                  <strong>Cost your recipes.</strong> Add ingredients, labor,
                  and overhead to see what each batch really costs.
                </li>
                <li>
                  <strong>Price with confidence.</strong> Connect products, add
                  packaging, and check your margins.
                </li>
                <li>
                  <strong>Make something good.</strong> Plan production,
                  complete a batch, and let the ledger track stock.
                </li>
                <li>
                  <strong>Finish thoughtfully.</strong> Review label information
                  and keep sales and expenses in order.
                </li>
              </ol>
              <Btn
                onClick={() => {
                  setModal(null)
                  go('Pantry')
                }}
              >
                Explore your pantry <ArrowRight size={16} />
              </Btn>
            </>
          )}
        </DialogContent>
      </Dialog>
      {previewProduct && (
        <LabelPreviewDialog
          key={`${previewProduct.id}:${previewLabelId}`}
          labelId={previewLabelId || undefined}
          open
          product={
            state.products.find((p) => p.id === previewProduct.id) ||
            previewProduct
          }
          workspace={state}
          ready={ready}
          role={role}
          onWorkspace={setState}
          onOpenChange={(next) => {
            if (!next) setPreviewProduct(null)
          }}
          onEditLabel={(id) => {
            setLabelProduct(previewProduct.id)
            setLabelDesign(id)
            setPreviewProduct(null)
            setModal(null)
            go('Labels', 'Editor')
          }}
          onCreateLabel={() => {
            setLabelProduct(previewProduct.id)
            setLabelDesign('')
            setLabelCreateRequest((n) => n + 1)
            setPreviewProduct(null)
            setModal(null)
            go('Labels', 'Labels')
          }}
        />
      )}
      {modal === 'sale-detail' && selected && (
        <article className="sale-receipt">
          <h1>{business.name}</h1>
          <h2>{selected.refundOf ? 'Refund receipt' : 'Sales receipt'}</h2>
          <p>
            {selected.date} · {selected.id}
          </p>
          <p>
            {selected.name} · {selected.quantity} packages
          </p>
          <p>
            Entered amount {money(selected.enteredAmount ?? selected.amount)} ·{' '}
            {selected.priceTaxMode === 'includes'
              ? 'includes tax'
              : selected.priceTaxMode === 'before'
                ? 'before tax'
                : 'per-rate tax behaviors below'}
          </p>
          <p>Revenue excluding tax: {money(selected.amount)}</p>
          {(selected.taxSnapshot || []).map((r: any) => (
            <p key={r.id}>
              {r.name} · {r.jurisdiction} · {r.ratePercent}% · {r.behavior}:{' '}
              {money(r.amount)}
            </p>
          ))}
          <p>Total tax: {money(selected.tax || 0)}</p>
          <h3>
            Customer total:{' '}
            {money(
              selected.customerTotal ?? selected.amount + (selected.tax || 0),
            )}
          </h3>
        </article>
      )}
    </div>
  )
}
function Stat({
  title,
  value,
  icon,
  foot,
  trend,
}: {
  title: string
  value: string
  icon: ReactNode
  foot: string
  trend: string
}) {
  return (
    <div className="stat-card">
      <div className="stat-title">
        {title}
        <span>{icon}</span>
      </div>
      <strong className="stat-value">{value}</strong>
      <div className="stat-foot">
        <span className="stat-trend">
          {trend === 'Revenue' || trend === 'After COGS' ? (
            <ArrowUpRight size={12} />
          ) : (
            <span className="tiny-dot" />
          )}
          {trend}
        </span>
        <span>{foot}</span>
      </div>
    </div>
  )
}
function DataTable({
  rows,
  columns,
  action,
  onRow,
}: {
  rows: Item[]
  columns: string[][]
  action?: ReactNode
  onRow?: (item: Item) => void
}) {
  return (
    <section className="panel data-panel">
      {action && <div className="table-actions">{action}</div>}
      {rows.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {columns.map(([key, label]) => (
                  <th key={key}>{label}</th>
                ))}
                {onRow && <th />}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, index) => (
                <tr key={r.id || index}>
                  {columns.map(([key]) => (
                    <td
                      key={key}
                      data-label={columns.find((c) => c[0] === key)?.[1]}
                    >
                      {[
                        'amount',
                        'price',
                        'cost',
                        'historicalCost',
                        'tax',
                        'fees',
                      ].includes(key)
                        ? money(r[key] ?? 0)
                        : typeof r[key] === 'boolean'
                          ? r[key]
                            ? 'Yes'
                            : 'No'
                          : typeof r[key] === 'number'
                            ? Number(r[key].toFixed(3))
                            : String(r[key] ?? '—').replaceAll('_', ' ')}
                    </td>
                  ))}
                  {onRow && (
                    <td>
                      <button
                        className="icon-button"
                        aria-label={'View ' + r.name}
                        onClick={() => onRow(r)}
                      >
                        <ChevronRight size={15} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty
          title="A fresh page"
          description="New records appear here as you work. Start by adding your first one."
        />
      )}
    </section>
  )
}
function CostExplanation({
  quantity,
  unit,
  price,
  storageUnit,
  conversions = [],
}: {
  quantity: number
  unit: string
  price: number
  storageUnit: string
  conversions?: any[]
}) {
  let value = 0,
    normalized = 0,
    normalizedUnit = '',
    warning = ''
  try {
    if (!(quantity > 0) || !Number.isFinite(quantity))
      throw new Error('Enter a positive package quantity.')
    value = convert(quantity, unit, storageUnit, conversions)
    normalizedUnit = baseUnit(storageUnit, conversions)
    normalized = convert(quantity, unit, normalizedUnit, conversions)
  } catch (e) {
    warning = (e as Error).message
  }
  return (
    <div className="calculation-box">
      <span className="eyebrow">NO HIDDEN MATH</span>
      {warning ? (
        <p className="warning-text">{warning}</p>
      ) : (
        <>
          <strong>
            {quantity} {unit} for {money(price)} →{' '}
            {value.toLocaleString(undefined, { maximumFractionDigits: 6 })}{' '}
            {storageUnit} → ${(price / value).toFixed(6)} per {storageUnit}
          </strong>
          {units[unit]?.category === 'weight' && (
            <p>
              {convert(quantity || 0, unit, 'oz').toLocaleString(undefined, {
                maximumFractionDigits: 4,
              })}{' '}
              oz total · $
              {((price || 0) / convert(quantity || 1, unit, 'oz')).toFixed(6)} /
              oz
            </p>
          )}
          <details>
            <summary>How was this calculated?</summary>
            <p>
              Normalized quantity:{' '}
              {normalized.toLocaleString(undefined, {
                maximumFractionDigits: 6,
              })}{' '}
              {normalizedUnit}. Base-unit cost = {price} ÷{' '}
              {normalized.toFixed(6)} = $
              {(normalized > 0 ? price / normalized : 0).toFixed(8)} /{' '}
              {normalizedUnit}.
            </p>
          </details>
        </>
      )}
    </div>
  )
}
function RecipeCalculation({
  recipe,
  ingredients,
  onConversion,
}: {
  recipe: Item
  ingredients: Item[]
  onConversion?: (data: any) => Promise<void>
}) {
  let c: ReturnType<typeof costBreakdown> | undefined,
    warning = ''
  let calculationLines = recipe.lines || []
  try {
    calculationLines = effectiveRecipeLines(recipe)
    c = costBreakdown(recipe, ingredients)
  } catch (e) {
    warning = (e as Error).message
  }
  return (
    <div className="recipe-calculation">
      <details className="calculation-box">
        <summary>How was this calculated? · ingredients</summary>
        {calculationLines.map((l: any, index: number) => {
          const i = ingredients.find((i) => i.id === l.ingredientId)
          let needsConversion = false
          if (i) {
            try {
              convert(parseQuantity(l.quantity), l.unit, i.unit, i.conversions)
            } catch {
              needsConversion = true
            }
          }
          return (
            <section key={index}>
              <LineCalculation line={l} ingredient={i} />
              {needsConversion && i && onConversion && (
                <ConversionEditor
                  ingredient={i}
                  from={l.unit}
                  onSave={onConversion}
                />
              )}
            </section>
          )
        })}
      </details>
      {warning && (
        <p role="alert" className="warning-text">
          Cost unavailable: {warning}. Open “How was this calculated?” above to
          add the missing conversion.
        </p>
      )}
      {c && (
        <>
          <div>
            <span>Ingredients</span>
            <strong>{money(c.ingredient)}</strong>
          </div>
          <div>
            <span>Packaging</span>
            <strong>{money(c.packagingCost)}</strong>
          </div>
          <div>
            <span>Labor</span>
            <strong>{money(c.labor)}</strong>
          </div>
          <div>
            <span>Overhead</span>
            <strong>{money(c.overhead)}</strong>
          </div>
          <div>
            <span>Waste allowance</span>
            <strong>{money(c.waste)}</strong>
          </div>
          <div className="total">
            <span>Total batch cost</span>
            <strong>{money(c.total)}</strong>
          </div>
          <div>
            <span>Cost per {recipe.yieldUnit || 'item'}</span>
            <strong>{money(c.perItem)}</strong>
          </div>
          <details className="calculation-box">
            <summary>View calculation · batch cost</summary>
            <p>
              Labor = {c.laborMinutes} ÷ 60 × {c.laborRate} ={' '}
              {c.labor.toFixed(6)}
            </p>
            <p>
              Overhead method: {recipe.overheadMode || 'batch'} · configured
              amount {recipe.overhead || 0} = {c.overhead.toFixed(6)}
            </p>
            <p>
              Waste ={' '}
              {recipe.wasteMode === 'actual'
                ? 'additional recorded waste cost'
                : `(ingredients + packaging + labor + overhead) × ${recipe.wastePercent || 0}%`}{' '}
              = {c.waste.toFixed(6)}
            </p>
            <p>
              Total = {c.ingredient.toFixed(6)} + {c.packagingCost.toFixed(6)} +{' '}
              {c.labor.toFixed(6)} + {c.overhead.toFixed(6)} +{' '}
              {c.waste.toFixed(6)} = {c.total.toFixed(6)}
            </p>
            <p>
              Cost per finished item = {c.total.toFixed(6)} ÷ {c.actualYield} ={' '}
              {c.perItem.toFixed(6)}
            </p>
          </details>
        </>
      )}
    </div>
  )
}
function PricingSummary({
  product,
  cost,
  workspace,
  onSuggested,
}: {
  product: Item
  cost: number
  workspace: Workspace
  onSuggested?: (n: number) => void
}) {
  try {
    const c = productCosting(product, workspace),
      business = workspace.settings[0]
    const p = profitability(product, cost, business)
    const wholesale = profitability(
      product,
      cost,
      business,
      Number(product.wholesale || 0),
    )
    const target = Number(product.targetMargin ?? 65)
    const share = (value: number) =>
      p.revenueExact > 0
        ? ((value / c.packages / p.revenueExact) * 100).toFixed(2) + '%'
        : '—'
    return (
      <div className="pricing-summary">
        <div className="detail-stats">
          <span>
            <small>PACKAGE COST</small>
            <strong>{money(cost)}</strong>
          </span>
          <span>
            <small>PROFIT EXCLUDING TAX</small>
            <strong>{money(p.profit)}</strong>
          </span>
          <span>
            <small>GROSS MARGIN</small>
            <strong className={p.margin < target ? 'warning-text' : 'positive'}>
              {p.margin.toFixed(2)}%
            </strong>
          </span>
        </div>
        <div className="pricing-price-row">
          <span>
            Retail price <strong>{money(Number(product.price || 0))}</strong>
          </span>
          <span className="status blue">
            {applicableTaxes(product, business).some(
              (r) => r.behavior === 'inclusive',
            )
              ? applicableTaxes(product, business).some(
                  (r) => r.behavior === 'exclusive',
                )
                ? 'Includes some taxes · others added'
                : 'Price includes tax'
              : 'Price before tax'}
          </span>
        </div>
        <div
          className="cost-bar"
          role="img"
          aria-label="Cost and profit per package"
        >
          {(
            [
              ['Ingredients', c.ingredient / c.packages, 'var(--primary)'],
              ['Packaging', c.packagingCost / c.packages, 'var(--info)'],
              ['Labor', c.labor / c.packages, 'var(--warning)'],
              ['Overhead', c.overhead / c.packages, 'var(--muted)'],
              ['Waste', c.waste / c.packages, 'var(--danger)'],
              ['Profit', Math.max(0, p.profit), 'var(--success)'],
            ] as [string, number, string][]
          ).map(([name, value, color]) => (
            <span
              key={name}
              title={`${name}: ${money(value)}`}
              style={{
                width: `${(value / Math.max(cost, p.revenueExact, 0.000001)) * 100}%`,
                background: color,
              }}
            />
          ))}
        </div>
        <div className="cost-bar-legend">
          {[
            ['Ingredients', 'var(--primary)'],
            ['Packaging', 'var(--info)'],
            ['Labor', 'var(--warning)'],
            ['Overhead', 'var(--muted)'],
            ['Waste', 'var(--danger)'],
            ['Profit', 'var(--success)'],
          ].map(([name, color]) => (
            <span key={name}>
              <i style={{ background: color }} />
              {name}
            </span>
          ))}
        </div>
        {p.margin < target && (
          <p className="margin-callout">
            <TriangleAlert size={17} /> Margin is {p.margin.toFixed(1)}%. Your
            target is {target}%.
          </p>
        )}
        <details className="calculation-box">
          <summary>View calculation · cost per sellable package</summary>
          {(
            [
              ['Ingredients', c.ingredient],
              ['Packaging', c.packagingCost],
              ['Labor', c.labor],
              ['Overhead', c.overhead],
              ['Waste allowance', c.waste],
            ] as [string, number][]
          ).map(([name, value]) => (
            <p key={name}>
              {name}: batch {money(value)} ÷ {c.packages} packages ={' '}
              <strong>{money(value / c.packages)}</strong> · {share(value)} of
              pre-tax revenue
            </p>
          ))}
          {c.packaging.map((l: any, index: number) => (
            <p key={index}>
              {l.name}: {l.inventoryQuantity} {l.storageUnit} × $
              {l.unitCost.toFixed(8)} = ${l.cost.toFixed(6)} per batch
            </p>
          ))}
          <p>
            Batch {money(c.total)} ÷ yield {c.actualYield} = {money(c.perItem)}{' '}
            per finished item × {c.unitsPerPackage} items ={' '}
            <strong>{money(c.perPackage)} per package</strong>.
          </p>
          <p>
            Gross profit = {p.revenueExact.toFixed(6)} pre-tax revenue −{' '}
            {cost.toFixed(6)} cost = {p.profit.toFixed(6)}. Margin = profit ÷
            pre-tax revenue × 100.
          </p>
          <p>
            Wholesale: entered {money(Number(product.wholesale || 0))} · pre-tax
            revenue {money(wholesale.revenue)} · profit{' '}
            {money(wholesale.profit)} · margin {wholesale.margin.toFixed(2)}%.
          </p>
          <p>
            Net profit also depends on period operating expenses and processing
            fees; review Finances for net profit.
          </p>
        </details>
        <div className="calculation-box">
          <strong>
            {target}% target margin → {money(p.suggested)} suggested entered
            price
          </strong>
          <p>
            Pre-tax target price = {cost.toFixed(6)} ÷ (1 − {target / 100}).
            Inclusive tax multiplier = {p.divisor.toFixed(8)}.
          </p>
          {Number(product.targetFoodCost) > 0 && (
            <p>
              Target food-cost price = ingredient cost per package{' '}
              {(c.ingredient / c.packages).toFixed(6)} ÷{' '}
              {Number(product.targetFoodCost) / 100} × inclusive multiplier ={' '}
              {money(
                (c.ingredient /
                  c.packages /
                  (Number(product.targetFoodCost) / 100)) *
                  p.divisor,
              )}
            </p>
          )}
          {onSuggested && (
            <button
              type="button"
              className="text-button"
              onClick={() => onSuggested(Math.ceil(p.suggested * 100) / 100)}
            >
              Use suggested price
            </button>
          )}
        </div>
        <TaxPreview
          product={product}
          business={business}
          amount={Number(product.price || 0)}
        />
      </div>
    )
  } catch (e) {
    return (
      <div className="pricing-summary">
        <p role="alert" className="warning-text">
          Pricing unavailable: {(e as Error).message}
        </p>
      </div>
    )
  }
}
