import { effectiveAccess, latestManualGrant } from '../lib/manual-access'
import {
  assertSavedLabelOutput,
  validateSavedLabelContext,
} from '../../src/lib/saved-labels'
import { exportSvgLabelPdf } from '../lib/label-svg-output'
import {
  labelSide,
  labelSides,
  labelSetPlan,
  validateLabelRunContent,
} from '../../src/lib/label-sets'
import { ProductImportFailure } from '../../src/lib/product-import-diagnostics'
import { photoPilotGrant, PHOTO_RATE } from '../lib/photo-pilot'
import { libraryArtwork } from '../../src/lib/artwork-library'
import { validateRecipeComponents } from '../../src/lib/recipe-components'
import {
  purchaseSetupView,
  validateConversions,
} from '../../src/lib/purchase-setup'
import {
  handleCatalog,
  saveCatalogAcceptance,
  LookupError,
} from '../lib/catalog-handler'
import { handlePackagePhotos } from '../lib/package-photo-handler'
import { packagePhotoPilotApproved } from '../lib/feature-flags'
import { normalizeProductNetWeight } from '../../src/lib/net-weight'
import { handleAddItem } from '../lib/add-item-handler'
import {
  applyReceivedDateCorrections,
  receiveDateCorrection,
} from '../../src/lib/received-dates'
import { purchasableInventory } from '../../src/lib/purchased-inventory'
import { ovenToday } from '../../src/lib/oven-dates'
import { reviewedProductMetadata } from '../../src/lib/inventory-product'
import {
  handleProductWorkflow,
  consumeFinishedSale,
  returnFinishedSale,
} from '../lib/product-workflow-handler'
import { handleProductCategories } from '../lib/product-category-handler'
import { tracksFinishedStock } from '../../src/lib/product-workflows'
import { categoryTaxState } from '../../src/lib/product-categories'
import { labelContent } from '../../src/lib/label-persistence'
import { saleTaxProduct } from '../../src/lib/domain'
import {
  isPackaging,
  selectPantryCategory,
} from '../../src/lib/pantry-category'
import { ingredientCreateErrors } from '../../src/lib/ingredient-create'
import { ZodError } from 'zod'
import {
  ingredientVendor,
  matchProductVendors,
} from '../../src/lib/product-vendors'
import {
  verifiedSession,
  selectedWorkspace,
  SessionError,
} from '../lib/verified-session'
import {
  assertRegistrationQuota,
  assertTestWorkspaceAction,
  assertFullFreeStockCoverage,
} from '../lib/registration-usage'
import {
  barcodeText,
  barcodeFormats as scanFormats,
} from '../../src/lib/barcodes'
import { labelRecordKind, templateNameKey } from '../../src/lib/label-library'
import { applyProductTemplateDraft } from '../../src/lib/label-preview'
import { validateShelfMedia } from '../../src/lib/shelf-labels'
import {
  countQuantity,
  assertCountUnchanged,
} from '../../src/lib/inventory-count'
import { inventoryAdjustmentPlan } from '../../src/lib/inventory-adjustment'
import { updateProductRecipe } from '../../src/lib/product-recipe-links'
import { handleCottageAssistant } from '../lib/cottage-assistant-handler'
import { fetchRecipeUrl } from '../lib/recipe-import'
import { fetchProductDetails } from '../lib/product-import'
import { ProductHumanVerificationError } from '../../src/lib/product-import-response'
import {
  handleRecipeImport,
  RecipeImportError,
} from '../lib/recipe-import-handler'
import {
  aiEnabled,
  receiptReadingEnabled,
  shoppingSearchEnabled,
} from '../lib/feature-flags'
import { receiptLimits } from '../lib/receipt-pdf'
import {
  findPrices,
  priceSearchConfigured,
  PriceSearchError,
} from '../lib/price-search'
import { searchInput, webComparison } from '../../src/lib/price-search'
import { validateLabelColor, recentColorList } from '../../src/lib/label-colors'
import {
  validatePrinterProfile,
  checkPrinterSize,
  qzPrintOptions,
  printerSize,
  points,
} from '../../src/lib/label-printers'
import { qzConfigured, qzCertificate, signQzCall } from '../lib/qz-print'
import {
  updateIngredient,
  validateOffer,
  packageCost,
  validPantrySort,
} from '../../src/lib/ingredients'
import {
  financeTables,
  defaultAccounts,
  planFinance,
} from '../../src/lib/finance'
import {
  receiptObjectKey,
  receiptMime,
  receiptReviewValues,
} from '../../src/lib/receipt-document'
import {
  ReceiptExtractionError,
  extractionFailure,
  receiptModel,
  receiptFile,
  extractReceipt,
} from '../lib/receipt-extraction'
import fontkit from '@pdf-lib/fontkit'
import { validateUploadedFont } from '../lib/uploaded-label-font'
import { workspaceFonts } from '../../src/lib/label-font-catalog'
import { loadGoogleFontFace } from '../lib/google-label-font'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import sharp from 'sharp'
import {
  exportLabelPdf,
  validateSheet,
  defaultSheet,
} from '../../src/lib/label-export'
import { getStore } from '@netlify/blobs'
import { imageSize } from 'image-size'
import {
  blankLabel,
  systemLabelTemplates,
  newElement,
  validateLabelDocument,
  resolveLabelData,
  labelFonts,
  imageBindings,
  labelArtworkAssignment,
  type LabelDocument,
} from '../../src/lib/label-studio'
import { validateAppearance } from '../../src/lib/appearance'
import { getDatabase } from '@netlify/database'
import type { Context } from '@netlify/functions'
import { randomBytes, createHash, randomUUID } from 'node:crypto'
import { rollup } from '../../src/lib/demo'
import { openingStockEntry } from '../../src/lib/ingredient-opening-stock'
import { ingredientHasStockHistory } from '../../src/lib/ingredient-stock-unit'
import {
  effectiveRecipeLines,
  recipeProductionLines,
} from '../../src/lib/domain'
import {
  convert,
  number,
  parseQuantity,
  recipeCost,
  allergens,
  baseUnit,
  costBreakdown,
  productCosting,
  packagingLines,
  applicableTaxes,
  calculateTax,
  validateTaxRates,
  roundMoney,
  units,
  ingredientUnits,
  validateDate,
} from '../../src/lib/domain'
import type { Item, Workspace } from '../../src/lib/domain'
const tables = [
  ...financeTables,
  'lots',
  'inventory_counts',
  'ingredients',
  'recipes',
  'products',
  'batches',
  'sales',
  'expenses',
  'vendors',
  'orders',
  'ledger',
  'activity',
  'settings',
  'accounts',
  'journals',
  'integrations',
  'units',
  'label_templates',
  'label_elements',
  'label_versions',
  'brand_kits',
  'graphic_assets',
  'font_assets',
  'label_print_jobs',
]
export default async (req: Request, context: Context) => {
  if (!['GET', 'POST'].includes(req.method))
    return Response.json(
      { error: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED' },
      { status: 405 },
    )
  if (req.method === 'POST') {
    const origin = req.headers.get('origin')
    if (origin && new URL(origin).host !== new URL(req.url).host)
      return Response.json(
        {
          error: 'This request must come from Cottage Pantry.',
          code: 'ORIGIN_FORBIDDEN',
        },
        { status: 403 },
      )
  }
  const suppliedSaveTrace = req.headers.get('X-Ingredient-Save-Trace') || ''
  const saveTrace = /^[a-f0-9-]{36}$/i.test(suppliedSaveTrace)
    ? suppliedSaveTrace
    : undefined
  let ingredientSaveStage = 'request'
  const labelTrace = req.headers
    .get('X-Label-Save-Trace')
    ?.match(/^[a-f0-9-]{36}$/i)?.[0]
  let labelStage = 'authorization'
  if (labelTrace)
    console.info(
      JSON.stringify({
        area: 'label_save',
        traceId: labelTrace,
        result: 'received',
        stage: 'request',
      }),
    )
  const requestUrl = new URL(req.url)
  if (
    requestUrl.searchParams.has('packagePhotos') &&
    !packagePhotoPilotApproved()
  )
    return Response.json(
      { error: 'This operation is unavailable.', code: 'FEATURE_UNAVAILABLE' },
      { status: 404, headers: { 'Cache-Control': 'private, no-store' } },
    )
  const importTrace = requestUrl.searchParams.has('recipeImports')
    ? randomUUID()
    : undefined
  let importStage = 'session_verification'
  if (
    (requestUrl.searchParams.has('priceSearch') ||
      requestUrl.searchParams.has('priceSearchStatus')) &&
    !shoppingSearchEnabled()
  )
    return Response.json(
      { error: 'This operation is unavailable.', code: 'FEATURE_UNAVAILABLE' },
      { status: 404, headers: { 'Cache-Control': 'private, no-store' } },
    )
  if (requestUrl.searchParams.has('assistant') && !aiEnabled())
    return Response.json(
      { error: 'This operation is unavailable.', code: 'FEATURE_UNAVAILABLE' },
      { status: 404, headers: { 'Cache-Control': 'private, no-store' } },
    )
  if (
    !receiptReadingEnabled() &&
    req.method === 'POST' &&
    !req.headers.get('content-type')?.includes('multipart/form-data')
  ) {
    const operation = await req
      .clone()
      .json()
      .catch(() => null)
    if (operation?.action === 'receiptExtract')
      return Response.json(
        {
          error:
            'Document reading is unavailable. Enter receipt details manually.',
          code: 'FEATURE_UNAVAILABLE',
        },
        { status: 404, headers: { 'Cache-Control': 'private, no-store' } },
      )
  }
  let client: any
  try {
    client = await getDatabase().pool.connect()
    await client.query('BEGIN')
    if (saveTrace) ingredientSaveStage = 'session_verification'
    const user = await verifiedSession(req)
    if (!user) {
      await client.query('ROLLBACK')
      return Response.json(
        {
          code: 'SIGN_IN_REQUIRED',
          error: 'Log in on this site to open your existing oven.',
        },
        { status: 401, headers: { 'Cache-Control': 'private, no-store' } },
      )
    }
    if (
      user &&
      (!user.confirmedAt || !Number.isFinite(Date.parse(user.confirmedAt)))
    ) {
      await client.query('ROLLBACK')
      return Response.json(
        {
          code: 'EMAIL_UNVERIFIED',
          error: 'Verify your account email before opening an oven.',
        },
        { status: 403, headers: { 'Cache-Control': 'private, no-store' } },
      )
    }
    if (saveTrace) ingredientSaveStage = 'workspace_resolution'
    if (importTrace) importStage = 'workspace_resolution'
    let business: any,
      role = 'Owner'
    if (user)
      await client.query("SELECT set_config('app.identity_id',$1,true)", [
        user.id,
      ])
    if (user) {
      const r = await client.query(
        'SELECT b.*, u.role FROM businesses b JOIN users u ON u.business_id=b.id WHERE u.identity_id=$1 AND u.active=true',
        [user.id],
      )
      const selection = selectedWorkspace(req)
      business =
        r.rows.find((row: any) => row.id === selection) ||
        (r.rows.length === 1 ? r.rows[0] : undefined)
      if (r.rows.length > 1 && !business) {
        await client.query('ROLLBACK')
        return Response.json(
          {
            code: 'WORKSPACE_SELECTION_REQUIRED',
            error: 'Choose an oven at /oven before continuing.',
          },
          { status: 409, headers: { 'Cache-Control': 'private, no-store' } },
        )
      }
      if (business) role = business.role
    }
    if (!business && user) {
      await client.query('ROLLBACK')
      return Response.json(
        {
          code: 'ONBOARDING_REQUIRED',
          error:
            'Complete verified business setup before opening an oven. No oven was created.',
        },
        { status: 409, headers: { 'Cache-Control': 'private, no-store' } },
      )
    }
    if (
      ![
        'Owner',
        'Manager',
        'Production Staff',
        'Read-only Accountant',
      ].includes(role)
    )
      throw new Error('Your oven role is not authorized.')
    const org = business.id
    if (importTrace) importStage = 'workspace_authorization'
    await client.query("SELECT set_config('app.business_id',$1,true)", [org])
    // Billing screens remain Owner-only. The application must nevertheless read
    // this minimal server-only policy for every verified member of a new-policy
    // business, otherwise a second login could bypass module restrictions.
    const previousBillingWorker =
      (
        await client.query(
          "SELECT current_setting('app.billing_worker',true) AS value",
        )
      ).rows[0]?.value || ''
    let managedBilling:
      import('../lib/billing-entitlements').BillingPolicyRow | undefined
    try {
      await client.query("SELECT set_config('app.billing_worker','true',true)")
      managedBilling = (
        await client.query(
          'SELECT plan_id,status,source,paid_through,environment,entitlement_policy FROM workspace_billing WHERE business_id=$1 ',
          [org],
        )
      ).rows[0]
    } finally {
      await client.query("SELECT set_config('app.billing_worker',$1,true)", [
        previousBillingWorker,
      ])
    }
    const manualGrant = await latestManualGrant(client, org)
    const resolvedAccess = effectiveAccess(
      managedBilling,
      manualGrant,
      business.identity_owner,
    )
    let moduleAccess: import('../lib/billing-state').AccessResult | undefined
    let moduleContinuation = false
    // Ovens without a billing row (legacy/owner ovens, including complimentary
    // access) and app-managed Free/complimentary rows keep unrestricted access.
    if (resolvedAccess.suspended || resolvedAccess.manualValid) {
      if (resolvedAccess.suspended && req.method !== 'GET')
        throw new Error(
          'Account access is suspended; a manual grant cannot bypass suspension.',
        )
      const { enforceSquareBilledWrite } =
        await import('../lib/billing-entitlements')
      moduleAccess = await enforceSquareBilledWrite({
        client,
        org,
        row: managedBilling || {
          plan_id: null,
          source: 'unassigned',
          status: 'unassigned',
        },
        access: resolvedAccess.access!,
        method: req.method,
        url: requestUrl,
        body:
          req.method === 'POST'
            ? await req
                .clone()
                .json()
                .catch(() => null)
            : null,
      })
      // Only the request-local quota basis changes. Provider billing is never written here.
      managedBilling = {
        ...(managedBilling || { source: 'unassigned', status: 'unassigned' }),
        plan_id: moduleAccess.plan,
        entitlement_policy: 'kitchen-two-v1',
      }
    } else if (
      managedBilling &&
      ['free_sandbox', 'unassigned'].includes(managedBilling.source)
    ) {
      if (
        req.method === 'POST' &&
        !['free_active', 'paid_active', 'complimentary'].includes(
          managedBilling.status,
        )
      )
        throw new Error('Oven activation or verified payment is required.')
      const body =
        req.method === 'POST'
          ? await req
              .clone()
              .json()
              .catch(() => null)
          : null
      if (managedBilling.plan_id)
        assertTestWorkspaceAction(
          managedBilling.plan_id,
          req.method,
          requestUrl,
          body && {
            ...body,
            action:
              (
                {
                  fabricUpdate: 'ingredientUpdate',
                  fabricRemnant: 'adjust',
                } as Record<string, string>
              )[body.action] || body.action,
          },
        )
    } else if (
      managedBilling &&
      ['square_sandbox', 'square_production'].includes(managedBilling.source)
    ) {
      // Server-side subscription entitlements: verified paid period only.
      const { enforceSquareBilledWrite } =
        await import('../lib/billing-entitlements')
      const access = await enforceSquareBilledWrite({
        client,
        org,
        row: managedBilling,
        method: req.method,
        url: requestUrl,
        body:
          req.method === 'POST'
            ? await req
                .clone()
                .json()
                .catch(() => null)
            : null,
      })
      moduleAccess = access
      // Record quotas follow the plan that currently applies (Free after a lapse).
      managedBilling.plan_id = access.plan
    } else if (managedBilling) {
      // free_app / complimentary rows: no plan restrictions while unapproved.
      managedBilling.plan_id = null
    }
    if (moduleAccess && req.method === 'POST') {
      const operation = await req
        .clone()
        .json()
        .catch(() => null)
      moduleContinuation = [
        'refund',
        'returnFinishedSale',
        'consignmentRefund',
        'consignmentPayout',
        'receiptCancel',
        'receiptDismissExtraction',
        'financeReverse',
        'inventoryCountCancel',
      ].includes(operation?.action)
    }
    let deviceCookie = context.cookies.get('cp_print_device')
    if (!deviceCookie || !/^[a-f0-9]{64}$/.test(deviceCookie)) {
      deviceCookie = randomBytes(32).toString('hex')
      context.cookies.set?.({
        name: 'cp_print_device',
        value: deviceCookie,
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
        path: '/',
        maxAge: 31536000,
      })
    }
    const deviceKey = createHash('sha256')
      .update((user?.id || 'demo') + ':' + deviceCookie)
      .digest('hex')
    function inventoryRevision(item: Item, ledger: Item[]) {
      return createHash('sha256')
        .update(
          JSON.stringify([
            item.quantity,
            item.unit,
            item.trackInventory,
            item.conversions,
            ledger
              .filter((l) => l.ingredientId === item.id)
              .map((l) => [l.id, l.quantity, l.unit])
              .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
          ]),
        )
        .digest('hex')
    }
    function workspaceForDevice(workspace: Workspace): Workspace {
      return {
        ...workspace,
        ledger: applyReceivedDateCorrections(
          workspace.ledger,
          workspace.settings[0],
        ),
        ingredients: workspace.ingredients.map((item) => ({
          ...item,
          inventoryRevision: inventoryRevision(item, workspace.ledger),
        })),
        settings: workspace.settings.map((s) => {
          const view: Item = {
            ...s,
            effectiveAccess: resolvedAccess,
            labelEditorScope: createHash('sha256')
              .update(org + ':' + user!.id)
              .digest('hex'),
            currentPrinterProfiles:
              s.printerProfilesByDevice?.[deviceKey] || [],
            receiptReading: {
              enabled: receiptReadingEnabled(),
              maxBytes: receiptLimits.bytes,
              maxPages: receiptLimits.pages,
              dailyAttempts: receiptLimits.attemptsPerDay,
              attemptsPerReceipt: receiptLimits.attemptsPerReceiptPerDay,
            },
            currentLabelColors:
              s.labelColorPreferences?.[user?.id || 'demo'] || [],
          }
          view.currentShelfMediaProfiles =
            s.shelfMediaProfilesByDevice?.[deviceKey] || []
          delete view.shelfMediaProfilesByDevice
          delete view.printerProfilesByDevice
          delete view.labelColorPreferences
          delete view.directSignedJobs
          view.currentPantryView =
            s.pantryViewPreferences?.[user?.id || 'demo'] === 'table'
              ? 'table'
              : 'cards'
          delete view.pantryViewPreferences
          view.currentPantryNavigationExpanded =
            s.pantryNavigationPreferences?.[user?.id || 'demo'] !== false
          delete view.pantryNavigationPreferences
          delete view.priceSearchCaches
          if (role !== 'Owner') delete view.priceSearchConnection
          delete view.priceSearchRequests
          delete view.assistantRequests
          delete view.assistantConnections
          delete view.printerTestJobs
          return view
        }),
      }
    }

    await client.query("SELECT set_config('app.business_id',$1,true)", [org])
    const state: Workspace = {}
    async function save(
      table: string,
      item: Item,
      stockMutation = false,
      dateApproval = false,
    ) {
      if (!tables.includes(table)) throw new Error('Invalid record type.')
      const { assertPlanRecordWrite } =
        await import('../lib/plan-feature-gates')
      assertPlanRecordWrite(
        moduleAccess,
        table,
        item,
        state,
        moduleContinuation,
      )
      if (managedBilling) {
        await assertRegistrationQuota(
          client,
          org,
          managedBilling.plan_id,
          table,
          item,
        )
        if (table === 'settings' && item.currency && item.currency !== 'USD')
          throw new Error(
            'Only USD oven reporting is supported. Historical amounts cannot be relabeled.',
          )
      }
      if (
        table === 'ingredients' &&
        item.needsCostSetup &&
        typeof item.currentCost === 'number' &&
        Number.isFinite(item.currentCost) &&
        item.currentCost >= 0
      )
        item.needsCostSetup = false
      if (table === 'products') {
        const stored = state.products.find((p) => p.id === item.id)
        if (item.labelAssignmentEdited === true)
          throw new Error(
            'Manage labels in Labels; existing design links are preserved.',
          )
        if (stored?.labelDesignId) item.labelDesignId = stored.labelDesignId
        else delete item.labelDesignId

        if (
          item.workflow &&
          !['food', 'handmade', 'resale', 'kit'].includes(item.workflow)
        )
          throw new Error('Choose a supported product workflow.')
        const previous = state.products.find((p) => p.id === item.id)
        if (!stockMutation) {
          normalizeProductNetWeight(item, previous)
          if (!previous && tracksFinishedStock(item))
            throw new Error(
              'Create tracked products through the product workflow editor.',
            )
          if (previous && item.workflow !== previous.workflow)
            throw new Error('Existing workflow cannot be reclassified.')
          item.quantity = previous?.quantity || 0
          item.cost = previous?.cost || 0
          item.stockCostKnown = previous?.stockCostKnown
        }
        if (previous && item.productCategoryId === undefined)
          item.productCategoryId = previous.productCategoryId
        const category = (state.settings[0]?.productCategories || []).find(
          (c: any) => c.id === item.productCategoryId,
        )
        if (
          item.productCategoryId &&
          (!category || category.active === false) &&
          item.productCategoryId !== previous?.productCategoryId
        )
          throw new Error('Select an active product category from this oven.')
        if (previous)
          for (const key of [
            'taxSource',
            'taxStatus',
            'taxRateIds',
            'taxAssignments',
          ])
            item[key] = previous[key]
      }
      if (table === 'recipes' && item.workflow !== 'handmade')
        validateRecipeComponents(item, state)
      if (table === 'recipes') delete item.baseRecipe
      if (table === 'recipes' && item.workflow === 'handmade' && !stockMutation)
        throw new Error('Save handmade designs through the design editor.')
      if (table === 'settings' && !dateApproval && state.settings?.[0])
        item.receivedDateCorrections =
          state.settings[0]?.receivedDateCorrections || []
      if (['ledger', 'receipt_extractions'].includes(table))
        item.addedAt =
          state[table]?.find((r) => r.id === item.id)?.addedAt ||
          new Date().toISOString()
      item.createdBy = item.createdBy || user?.id || 'demo-owner'
      item.updatedBy = user?.id || 'demo-owner'
      item.updatedAt = new Date().toISOString()
      const financeLinks: Record<string, Record<string, string>> = {
        label_templates: { product_id: 'productId' },
        consignment_items: { consignor_id: 'consignorId' },
        consignment_sales: { consignor_id: 'consignorId', item_id: 'itemId' },
        consignment_movements: {
          consignor_id: 'consignorId',
          item_id: 'itemId',
        },
        consignment_payouts: { consignor_id: 'consignorId' },
        finance_transactions: { receipt_id: 'receiptId', bill_id: 'billId' },
        finance_reviews: { transaction_id: 'transactionId' },
        vendor_matches: { item_id: 'itemId' },
      }
      if (financeLinks[table]) {
        const links = Object.entries(financeLinks[table]),
          columns = links.map(([column]) => column)
        await client.query(
          `INSERT INTO ${table}(id,business_id,data,${columns.join(',')}) VALUES($1,$2,$3,${columns.map((_, index) => '$' + (index + 4)).join(',')}) ON CONFLICT(business_id,id) DO UPDATE SET data=$3,${columns.map((column, index) => column + '=$' + (index + 4)).join(',')},updated_at=NOW()`,
          [
            item.id,
            org,
            JSON.stringify(item),
            ...links.map(([, key]) =>
              table === 'vendor_matches' &&
              item.itemTable === 'products' &&
              key === 'itemId'
                ? null
                : item[key] || null,
            ),
          ],
        )
      } else if (table === 'ingredients') {
        await client.query(
          `INSERT INTO ingredients(id,business_id,data,quantity,cost) VALUES($1,$2,$3,$4,$5) ON CONFLICT(business_id,id) DO UPDATE SET data=$3,quantity=$4,cost=$5,updated_at=NOW()`,
          [item.id, org, JSON.stringify(item), item.quantity, item.cost],
        )
        await saveCatalogAcceptance(client, org, item)
      } else if (
        ['label_elements', 'label_versions', 'label_print_jobs'].includes(table)
      ) {
        if (table === 'label_print_jobs')
          await client.query(
            `INSERT INTO label_print_jobs(id,business_id,data,template_id,product_id,batch_id) VALUES($1,$2,$3,$4,$5,$6)`,
            [
              item.id,
              org,
              JSON.stringify(item),
              item.templateId,
              item.productId || null,
              item.batchId || null,
            ],
          )
        else
          await client.query(
            `INSERT INTO ${table}(id,business_id,data,template_id) VALUES($1,$2,$3,$4) ON CONFLICT(business_id,id) DO UPDATE SET data=$3,updated_at=NOW()`,
            [item.id, org, JSON.stringify(item), item.templateId],
          )
      } else if (table === 'products') {
        await client.query(
          'INSERT INTO products(id,business_id,data,recipe_id,quantity,cost) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(business_id,id) DO UPDATE SET data=$3,recipe_id=$4,quantity=$5,cost=$6,updated_at=NOW()',
          [
            item.id,
            org,
            JSON.stringify(item),
            item.recipeId || null,
            item.quantity || 0,
            item.cost || 0,
          ],
        )
      } else if (table === 'ledger') {
        await client.query(
          'INSERT INTO ledger(id,business_id,data,ingredient_id,product_id) VALUES($1,$2,$3,$4,$5)',
          [
            item.id,
            org,
            JSON.stringify({
              ...item,
              actor: user?.id || 'demo-owner',
              occurredAt: item.occurredAt || new Date().toISOString(),
              sourceId: item.sourceId || item.batchId || item.id,
            }),
            item.ingredientId || null,
            item.productId || null,
          ],
        )
      } else if (['batches', 'sales'].includes(table)) {
        const column =
          table === 'ledger'
            ? 'ingredient_id'
            : table === 'sales'
              ? 'product_id'
              : 'recipe_id'
        const value =
          table === 'ledger'
            ? item.ingredientId
            : table === 'sales'
              ? item.productId
              : item.recipeId
        await client.query(
          `INSERT INTO ${table}(id,business_id,data,${column}) VALUES($1,$2,$3,$4) ON CONFLICT(business_id,id) DO UPDATE SET data=$3,${column}=$4,updated_at=NOW()`,
          [item.id, org, JSON.stringify(item), value || null],
        )
      } else
        await client.query(
          `INSERT INTO ${table}(id,business_id,data) VALUES($1,$2,$3) ON CONFLICT(business_id,id) DO UPDATE SET data=$3,updated_at=NOW()`,
          [item.id, org, JSON.stringify(item)],
        )
      if (table === 'recipes') {
        await client.query(
          'DELETE FROM recipe_base_links WHERE business_id=$1 AND recipe_id=$2',
          [org, item.id],
        )
        if (item.baseRecipeId)
          await client.query(
            'INSERT INTO recipe_base_links(id,business_id,data,recipe_id,base_recipe_id,multiplier) VALUES($1,$2,$3,$4,$5,$6)',
            [
              item.id,
              org,
              '{}',
              item.id,
              item.baseRecipeId,
              item.baseMultiplier,
            ],
          )
        await client.query(
          'DELETE FROM recipe_lines WHERE business_id=$1 AND recipe_id=$2',
          [org, item.id],
        )
        for (const [index, line] of (item.lines || []).entries())
          await client.query(
            'INSERT INTO recipe_lines(id,business_id,data,recipe_id,ingredient_id,quantity,unit) VALUES($1,$2,$3,$4,$5,$6,$7)',
            [
              `${item.id}-${index}`,
              org,
              JSON.stringify(line),
              item.id,
              line.ingredientId,
              line.quantity,
              line.unit,
            ],
          )
      }
      if (table === 'settings') {
        for (const rate of item.taxRates || [])
          await client.query(
            'INSERT INTO tax_rates(id,business_id,data) VALUES($1,$2,$3) ON CONFLICT(business_id,id) DO UPDATE SET data=$3,updated_at=NOW()',
            [rate.id, org, JSON.stringify(rate)],
          )
      }
      if (table === 'ingredients') {
        await client.query(
          "DELETE FROM ingredient_conversions WHERE business_id=$1 AND data->>'ingredientId'=$2",
          [org, item.id],
        )
        for (const [index, conversion] of (item.conversions || []).entries())
          await client.query(
            'INSERT INTO ingredient_conversions(id,business_id,data) VALUES($1,$2,$3)',
            [
              `${item.id}-${index}`,
              org,
              JSON.stringify({
                ...conversion,
                ingredientId: item.id,
                factor: conversion.amountTo / conversion.amountFrom,
              }),
            ],
          )
      }
      if (table === 'products') {
        await client.query(
          'DELETE FROM product_tax_assignments WHERE business_id=$1 AND product_id=$2',
          [org, item.id],
        )
        for (const id of item.taxRateIds || []) {
          const assignment =
            (item.taxAssignments || []).find((a: any) => a.taxRateId === id) ||
            {}
          await client.query(
            'INSERT INTO product_tax_assignments(id,business_id,data,product_id,tax_rate_id) VALUES($1,$2,$3,$4,$5)',
            [
              `${item.id}-${id}`,
              org,
              JSON.stringify({
                ...assignment,
                active: assignment.active !== false,
                productId: item.id,
                taxRateId: id,
              }),
              item.id,
              id,
            ],
          )
        }
      }
      if (table === 'products') {
        await client.query(
          'DELETE FROM product_packaging_lines WHERE business_id=$1 AND product_id=$2',
          [org, item.id],
        )
        for (const [index, line] of packagingLines(item).entries())
          await client.query(
            'INSERT INTO product_packaging_lines(id,business_id,data,product_id,ingredient_id,quantity) VALUES($1,$2,$3,$4,$5,$6)',
            [
              `${item.id}-packaging-${index}`,
              org,
              JSON.stringify(line),
              item.id,
              line.ingredientId,
              line.quantity,
            ],
          )
      }
    }
    // Serialize workspace mutations to prevent lost updates across concurrent requests.
    await client.query('SELECT id FROM businesses WHERE id=$1 FOR UPDATE', [
      org,
    ])
    let metadataOnly = false
    // A personal navigation preference never enters stock, costing or finance workflows.
    if (
      req.method === 'POST' &&
      /^(application\/json|text\/plain|$)/i.test(
        req.headers.get('content-type') || '',
      )
    ) {
      const body = await req.clone().json()
      metadataOnly =
        requestUrl.searchParams.has('labelPdf') ||
        requestUrl.searchParams.has('productImport') ||
        [
          'receivedDateCorrection',
          'shelfMedia',
          'inventoryCountStart',
          'inventoryCountLine',
          'ingredientBarcode',
          'labelSave',
          'labelDelete',
          'labelDraft',
          'templateAssignments',
          'productLabelAssignment',
          'labelPrint',
        ].includes(body?.action)
      if (body?.action === 'pantryNavigation') {
        if (
          body.table !== 'settings' ||
          typeof body.data?.expanded !== 'boolean' ||
          Object.keys(body.data).some((key) => key !== 'expanded')
        )
          throw new Error('Choose whether Pantry navigation is expanded.')
        const rows = await client.query(
          'SELECT data FROM settings WHERE business_id=$1 ORDER BY created_at,id',
          [org],
        )
        const settings = rows.rows[0]?.data
        if (!settings) throw new Error('Business settings are unavailable.')
        settings.pantryNavigationPreferences = {
          ...(settings.pantryNavigationPreferences || {}),
          [user?.id || 'demo']: body.data.expanded,
        }
        await save('settings', settings)
        await client.query('COMMIT')
        return Response.json(
          { expanded: body.data.expanded },
          { headers: { 'Cache-Control': 'private, no-store' } },
        )
      }
    }
    if (importTrace) importStage = 'workspace_load'
    for (const table of tables) {
      const r = await client.query(
        ['ledger', 'receipt_extractions'].includes(table)
          ? `SELECT data, to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS added_at FROM ${table} WHERE business_id=$1 ORDER BY created_at,id`
          : `SELECT data FROM ${table} WHERE business_id=$1 ORDER BY created_at,id`,
        [org],
      )
      state[table] = r.rows.map((r: any) =>
        r.added_at ? { ...r.data, addedAt: r.added_at } : r.data,
      )
    }
    if (requestUrl.searchParams.has('catalog'))
      return await handleCatalog(req, {
        client,
        org,
        role,
        state,
        actor: user.id,
      })
    if (requestUrl.searchParams.has('packagePhotos'))
      return await handlePackagePhotos(req, {
        client,
        org,
        role,
        actor: user?.id,
      })
    if (requestUrl.searchParams.has('productCategories')) {
      return await handleProductCategories(req, { state, role, save, client })
    }
    if (requestUrl.searchParams.has('productVendors')) {
      if (!['Owner', 'Manager'].includes(role))
        throw new Error('Only an Owner or Manager can select product vendors.')
      let vendor: Item | undefined
      if (req.method === 'POST') {
        const body = await req.json()
        const name = String(body.name || '').trim()
        const website = String(body.website || '').trim()
        if (!name || name.length > 200 || website.length > 8192)
          throw new Error('Enter a vendor name of at most 200 characters.')
        if (website && !/^https?:\/\//i.test(website))
          throw new Error('Use an http or https vendor website.')
        const matches = matchProductVendors(state.vendors, name, website)
        if (matches.length > 1)
          throw new Error(
            'Multiple vendors match. Reload the vendor list and choose an existing vendor.',
          )
        vendor = matches[0]
        if (!vendor) {
          vendor = { id: randomUUID(), name, website }
          await save('vendors', vendor)
          state.vendors.push(vendor)
        }
      } else if (req.method !== 'GET') {
        throw new Error(
          'Use GET to load vendors or POST to explicitly add one.',
        )
      }
      await client.query('COMMIT')
      return Response.json(
        { vendors: state.vendors, vendor },
        {
          headers: { 'Cache-Control': 'private, no-store' },
        },
      )
    }
    if (
      requestUrl.searchParams.has('recipeImports') ||
      requestUrl.searchParams.has('recipeImportFile')
    ) {
      importStage = 'import_request'
      const response = await handleRecipeImport(req, {
        client,
        org,
        role,
        actor: user?.id || 'demo-owner',
        state,
        save,
        stage: (stage) => {
          importStage = stage
        },
      })
      return response
    }
    if (!metadataOnly) rollup(state)
    const configuredRates =
      state.settings[0]?.taxRates ??
      applicableTaxes({ id: 'defaults', name: 'Defaults' }, state.settings[0])
    if (!metadataOnly)
      for (const rate of configuredRates)
        await client.query(
          'INSERT INTO tax_rates(id,business_id,data) VALUES($1,$2,$3) ON CONFLICT(business_id,id) DO NOTHING',
          [rate.id, org, JSON.stringify(rate)],
        )
    if (!metadataOnly)
      for (const account of defaultAccounts)
        await client.query(
          'INSERT INTO accounts(id,business_id,data) VALUES($1,$2,$3) ON CONFLICT(business_id,id) DO NOTHING',
          [
            'auto-' + account.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
            org,
            JSON.stringify({
              id:
                'auto-' +
                account.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
              ...account,
            }),
          ],
        )
    if (requestUrl.searchParams.has('assistant'))
      return await handleCottageAssistant(req, {
        client,
        org,
        role,
        userId: user?.id,
        settings: state.settings[0],
        deploymentId: context.deploy?.id || 'local',
        save,
      })
    if (requestUrl.searchParams.has('productImport')) {
      if (req.method !== 'POST' || !['Owner', 'Manager'].includes(role))
        throw new Error('Only an Owner or Manager can import product details.')
      if (Number(req.headers.get('content-length') || 0) > 10000)
        throw new Error('Product request is too large.')
      const input = await req.json().catch(() => {
        throw new Error('Send valid JSON containing a complete product URL.')
      })
      if (typeof input?.url !== 'string' || input.url.length > 8192)
        throw new Error('Enter a public HTTPS product URL.')
      const products = await fetchProductDetails(input.url)
      await client.query('COMMIT')
      return Response.json(
        { products },
        { headers: { 'Cache-Control': 'private, no-store' } },
      )
    }
    if (requestUrl.searchParams.has('priceSearchStatus')) {
      if (role !== 'Owner') {
        await client.query('ROLLBACK')
        return Response.json(
          { error: 'Only an Owner can manage price comparison setup.' },
          { status: 403 },
        )
      }
      const settings = state.settings[0]
      const configured = priceSearchConfigured()
      const deploymentId = context.deploy?.id || 'local'
      const connection =
        settings.priceSearchConnection?.deploymentId === deploymentId
          ? settings.priceSearchConnection
          : null
      if (req.method === 'GET') {
        await client.query('COMMIT')
        return Response.json(
          {
            configured,
            status: !configured
              ? 'Missing configuration'
              : connection?.status || 'Configured, not tested',
            outcome: !configured
              ? 'missing_configuration'
              : connection?.outcome || null,
            lastTest: configured ? connection?.checkedAt || null : null,
            message: configured ? connection?.message || null : null,
          },
          { headers: { 'Cache-Control': 'private, no-store' } },
        )
      }
      if (!configured) {
        await client.query('COMMIT')
        return Response.json(
          {
            error: 'Set SERPAPI_API_KEY for Netlify Functions, then redeploy.',
            configured: false,
            code: 'missing_configuration',
          },
          { status: 503, headers: { 'Cache-Control': 'private, no-store' } },
        )
      }
      const raw = await req.json().catch(() => null)
      if (!raw || typeof raw !== 'object')
        throw new Error('Send a valid shopping test request.')
      if (raw.confirmAllowance !== true)
        throw new Error('Confirm that the test uses SerpApi API allowance.')
      const ingredient = state.ingredients.find(
        (i) => i.id === raw.ingredientId,
      )
      if (!ingredient)
        throw new Error('Choose an ingredient in this oven for the test.')
      const request = searchInput(raw, ingredient)
      const now = Date.now(),
        requests = (settings.priceSearchRequests || []).filter(
          (t: number) => now - t < 3600000,
        )
      if (
        requests.length >= 10 ||
        requests.some((t: number) => now - t < 15000)
      )
        throw new Error(
          'Please wait before another lookup. Up to 10 searches per oven per hour are available.',
        )
      settings.priceSearchRequests = [...requests, now]
      let status = 'Connection successful',
        outcome = 'search_successful',
        message = 'Search successful. Product matches still require review.'
      try {
        const offers = await findPrices(ingredient, request)
        if (!offers.length) {
          outcome = 'no_matching_products'
          message =
            'No matching products. SerpApi accepted the search, but no usable product matches were returned. Review the ingredient name, brand and package before another explicit search.'
        }
      } catch (e) {
        outcome =
          e instanceof PriceSearchError ? e.code : 'provider_unavailable'
        status =
          outcome === 'authentication_failed'
            ? 'Authentication failed'
            : outcome === 'allowance_exhausted'
              ? 'Allowance exhausted'
              : 'Provider unavailable'
        message =
          e instanceof PriceSearchError
            ? e.message
            : 'Price provider returned an invalid result. Check configuration and try later.'
      }
      settings.priceSearchConnection = {
        status,
        outcome,
        message,
        checkedAt: new Date().toISOString(),
        deploymentId,
      }
      await save('settings', settings)
      await client.query('COMMIT')
      return Response.json(
        {
          configured: true,
          status,
          outcome,
          message,
          lastTest: settings.priceSearchConnection.checkedAt,
        },
        { headers: { 'Cache-Control': 'private, no-store' } },
      )
    }
    if (requestUrl.searchParams.has('priceSearch')) {
      const ingredient = state.ingredients.find(
        (i) => i.id === requestUrl.searchParams.get('priceSearch'),
      )
      if (!ingredient) throw new Error('Choose an ingredient in this oven.')
      const settings = state.settings[0]
      const previous = settings.priceSearchCaches?.[ingredient.id]
      const canSearch = ['Owner', 'Manager'].includes(role)
      if (req.method === 'GET') {
        await client.query('COMMIT')
        return Response.json(
          {
            configured: priceSearchConfigured(),
            canSearch,
            cache: previous || null,
          },
          { headers: { 'Cache-Control': 'private, no-store' } },
        )
      }
      if (!canSearch)
        throw new Error('An Owner or Manager must search or save store prices.')
      const input = await req.json()
      if (input.operation === 'save') {
        if (!previous || Date.now() - Date.parse(previous.checkedAt) > 3600000)
          throw new Error('Refresh expired results before saving an offer.')
        const offer = previous.offers.find((o: any) => o.id === input.offerId)
        if (!offer)
          throw new Error(
            'Choose an offer returned by this oven’s price search.',
          )
        if (
          !offer.packageQuantity ||
          !offer.purchaseUnit ||
          !offer.direct ||
          offer.currency !== (ingredient.currency || 'USD') ||
          offer.conditional
        )
          throw new Error(
            'Check package size, currency, direct store link and price conditions before saving this quote. Conditional or incomplete quotes cannot become a reference.',
          )
        const comparison = webComparison(ingredient, offer)
        if (comparison.unitCost == null)
          throw new Error(
            'A verified storage-unit conversion is required before saving this quote.',
          )
        let vendor = state.vendors.find(
          (v) => v.name.toLowerCase() === offer.retailer.toLowerCase(),
        )
        if (!vendor) {
          vendor = {
            id: randomUUID(),
            name: offer.retailer,
            source: 'price_search',
          }
          await save('vendors', vendor)
        }
        const stored = validateOffer(
          ingredient,
          {
            id: 'web-' + offer.id,
            vendorId: vendor.id,
            brand: offer.brand || offer.title,
            purchaseQuantity: offer.packageQuantity,
            purchaseUnit: offer.purchaseUnit,
            packagePrice: offer.price,
            currency: offer.currency,
            barcode: offer.barcode || '',
            productUrl: offer.url,
            priceCheckedAt: offer.checkedAt.slice(0, 10),
            includesTax: false,
            includesShipping: false,
            notes:
              'Web quote only. Verify package, price, ingredients and allergens before purchase.',
            allergens: [],
            subingredients: '',
          },
          [...state.vendors.filter((v) => v.id !== vendor!.id), vendor],
        )
        Object.assign(stored, {
          source: 'connected_provider',
          provider: 'SerpApi',
          providerOfferId: offer.id,
          match: offer.match,
          checkedAt: offer.checkedAt,
          labelReviewRequired: offer.rank === 4,
        })
        const purchaseOffers = [
          ...(ingredient.purchaseOffers || []).filter(
            (o: any) => o.id !== stored.id,
          ),
          stored,
        ]
        if (purchaseOffers.length > 100)
          throw new Error('Use at most 100 saved offers per ingredient.')
        await save('ingredients', { ...ingredient, purchaseOffers })
        await save('activity', {
          id: randomUUID(),
          name: 'Store price quote saved',
          detail: `${ingredient.name} · ${offer.retailer} · Quote only; reference cost unchanged`,
          date: ovenToday(state.settings[0]),
          type: 'priceSearchOffer',
          actor: user?.id || 'Demo owner',
        })
        await client.query('COMMIT')
        return Response.json(
          { saved: true },
          { headers: { 'Cache-Control': 'private, no-store' } },
        )
      }
      if (input.operation !== 'search')
        throw new Error('Choose Find prices or Save offer.')
      const request = searchInput(input, ingredient)
      const fingerprint = createHash('sha256')
        .update(
          JSON.stringify({
            request,
            name: ingredient.name,
            brand: ingredient.brand,
            barcode: ingredient.barcode,
            quantity: ingredient.purchaseQuantity,
            unit: ingredient.purchaseUnit,
          }),
        )
        .digest('hex')
      if (
        previous?.fingerprint === fingerprint &&
        Date.now() - Date.parse(previous.checkedAt) < 3600000 &&
        input.refresh !== true
      ) {
        await client.query('COMMIT')
        return Response.json(
          {
            configured: priceSearchConfigured(),
            cache: previous,
            cached: true,
          },
          { headers: { 'Cache-Control': 'private, no-store' } },
        )
      }
      if (!priceSearchConfigured()) {
        await client.query('COMMIT')
        return Response.json(
          {
            configured: false,
            code: 'missing_configuration',
            error: 'Missing configuration. Price comparison isn’t configured.',
          },
          { status: 503, headers: { 'Cache-Control': 'private, no-store' } },
        )
      }
      const now = Date.now(),
        requests = (settings.priceSearchRequests || []).filter(
          (t: number) => now - t < 3600000,
        )
      if (
        requests.length >= 10 ||
        requests.some((t: number) => now - t < 15000)
      )
        throw new Error(
          'Please wait before another price lookup. Up to 10 searches per oven per hour are available.',
        )
      settings.priceSearchRequests = [...requests, now]
      // Persist quota even on provider failure; the workspace lock serializes concurrent lookups.
      await save('settings', settings)
      let cache
      try {
        const offers = await findPrices(ingredient, request)
        cache = {
          request,
          fingerprint,
          offers,
          checkedAt: new Date().toISOString(),
          provider: 'SerpApi',
        }
        const caches = {
          ...(settings.priceSearchCaches || {}),
          [ingredient.id]: cache,
        }
        settings.priceSearchCaches = Object.fromEntries(
          Object.entries(caches)
            .sort(
              ([, a]: any, [, b]: any) =>
                Date.parse(b.checkedAt) - Date.parse(a.checkedAt),
            )
            .slice(0, 40),
        )
        await save('settings', settings)
      } catch (error) {
        await client.query('COMMIT')
        return Response.json(
          {
            code:
              error instanceof PriceSearchError
                ? error.code
                : 'provider_unavailable',
            error:
              error instanceof PriceSearchError
                ? error.message
                : 'Price provider is unavailable or rejected this lookup. Check provider setup/quota or try later. Previous results remain available.',
          },
          { status: 502, headers: { 'Cache-Control': 'private, no-store' } },
        )
      }
      await client.query('COMMIT')
      return Response.json(
        {
          configured: true,
          cache,
          cached: false,
          outcome: cache.offers.length
            ? 'search_successful'
            : 'no_matching_products',
        },
        { headers: { 'Cache-Control': 'private, no-store' } },
      )
    }
    if (req.method === 'GET' && requestUrl.searchParams.has('receiptFile')) {
      const receipt = state.receipt_extractions.find(
        (r) => r.id === requestUrl.searchParams.get('receiptFile'),
      )
      if (!receipt || !receipt.fileHash)
        throw new Error('Receipt file not found in this oven.')
      const original = requestUrl.searchParams.get('original') === '1'
      const bytes = await getStore('receipts-private').get(
        receiptObjectKey(org, receipt, original),
        { type: 'arrayBuffer' },
      )
      if (!bytes) throw new Error('Receipt file is unavailable.')
      if (
        original &&
        createHash('sha256').update(Buffer.from(bytes)).digest('hex') !==
          receipt.fileHash
      )
        throw new Error('Receipt original integrity check failed.')
      await client.query('COMMIT')
      return new Response(bytes, {
        headers: {
          'Content-Type': receiptMime(new Uint8Array(bytes)),
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
          'Content-Disposition': original
            ? 'attachment; filename="receipt' +
              (receipt.originalMime === 'application/pdf'
                ? '.pdf'
                : receipt.originalMime === 'image/heic'
                  ? '.heic'
                  : receipt.originalMime === 'image/png'
                    ? '.png'
                    : '.jpg') +
              '"'
            : 'inline',
        },
      })
    }
    if (req.method === 'POST' && requestUrl.searchParams.has('receiptUpload')) {
      if (!['Owner', 'Manager'].includes(role))
        throw new Error('An Owner or Manager can upload receipts.')
      let form: FormData
      if (requestUrl.searchParams.has('productImage')) {
        const input = await req.json()
        const image = await fetchRecipeUrl(String(input.url || ''), true)
        form = new FormData()
        form.set(
          'file',
          new File([new Uint8Array(image.bytes)], 'Imported product photo', {
            type: image.mime,
          }),
        )
        form.set('category', 'product photo')
        form.set('tags', 'Imported with user approval; source: ' + image.url)
      } else form = await req.formData()
      const file = form.get('file')
      if (!(file instanceof File)) throw new Error('Choose a receipt file.')
      const parsed = await receiptFile(file)
      const duplicate = state.receipt_extractions.find(
        (r) => r.fileHash === parsed.fileHash && r.status !== 'cancelled',
      )
      if (duplicate)
        throw new Error(
          'This receipt file is already in your inbox. Review the existing draft or posted receipt.',
        )
      const id = randomUUID(),
        store = getStore('receipts-private')
      await store.set(
        `${org}/${id}/original`,
        new Uint8Array(parsed.bytes).buffer,
      )
      await store.set(
        `${org}/${id}/preview`,
        new Uint8Array(parsed.preview).buffer,
      )
      const receipt: Item = {
        id,
        name: file.name.slice(0, 200),
        filename: file.name.slice(0, 200),
        status: 'draft',
        vendor: '',
        date: '',
        receivedDate: ovenToday(state.settings[0]),
        total: null,
        subtotal: null,
        tax: null,
        originalObjectKey: `${org}/${id}/original`,
        previewObjectKey: `${org}/${id}/preview`,
        method: '',
        lines: [],
        fileHash: parsed.fileHash,
        originalMime: parsed.originalMime,
        previewMime: parsed.mime,
        extractionStatus: receiptReadingEnabled() ? 'queued' : 'manual',
        ...(!receiptReadingEnabled()
          ? {
              extractionMessage:
                'Original saved. Enter the receipt details manually before review.',
            }
          : {}),
        history: [
          {
            action: 'uploaded',
            at: new Date().toISOString(),
            by: user?.id || 'demo-owner',
          },
        ],
      }
      await save('receipt_extractions', receipt)
      await save('activity', {
        id: randomUUID(),
        name: 'Receipt uploaded',
        detail: receipt.name,
        receiptId: id,
        date: ovenToday(state.settings[0]),
        actor: user?.id || 'demo-owner',
      })
      await client.query('COMMIT')
      return Response.json(
        { receipt },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    }
    const customFonts = workspaceFonts(state.font_assets)
    async function loadCustomFont(key: string) {
      const asset = state.font_assets.find((a) => a.font?.file === key)
      if (!asset)
        throw new Error(
          'This font is not available in your oven. Choose another font.',
        )
      const bytes = await getStore('label-fonts-private').get(
        `${org}/${asset.id}`,
        { type: 'arrayBuffer' },
      )
      if (!bytes)
        throw new Error(
          'The uploaded font is unavailable. No substitute is exported.',
        )
      return new Uint8Array(bytes)
    }
    if (req.method === 'GET' && requestUrl.searchParams.has('font')) {
      const id = requestUrl.searchParams.get('font') || ''
      const asset = state.font_assets.find((a) => a.id === id)
      if (!asset) throw new Error('Font not found in this oven.')
      const bytes = await loadCustomFont(asset.font.file)
      await client.query('COMMIT')
      const headers = {
        'Cache-Control': 'private, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
      }
      if (requestUrl.searchParams.get('metrics') === '1') {
        const face = fontkit.create(bytes)
        return Response.json(
          Object.fromEntries(
            face.characterSet.map((code) => [
              code,
              face.glyphForCodePoint(code).advanceWidth / face.unitsPerEm,
            ]),
          ),
          { headers },
        )
      }
      return new Response(bytes as BodyInit, {
        headers: { ...headers, 'Content-Type': 'font/' + asset.format },
      })
    }
    if (req.method === 'POST' && requestUrl.searchParams.has('fontUpload')) {
      if (!['Owner', 'Manager'].includes(role))
        throw new Error('Only an Owner or Manager can upload fonts.')
      if (state.font_assets.length >= 100)
        throw new Error('This oven already has 100 uploaded font files.')
      let form: FormData
      if (requestUrl.searchParams.has('productImage')) {
        const input = await req.json()
        const image = await fetchRecipeUrl(String(input.url || ''), true)
        form = new FormData()
        form.set(
          'file',
          new File([new Uint8Array(image.bytes)], 'Imported product photo', {
            type: image.mime,
          }),
        )
        form.set('category', 'product photo')
        form.set('tags', 'Imported with user approval; source: ' + image.url)
      } else form = await req.formData()
      const file = form.get('file')
      if (!(file instanceof File)) throw new Error('Choose a font file.')
      const bytes = new Uint8Array(await file.arrayBuffer())
      const metadata = await validateUploadedFont(
        bytes,
        file.name,
        form.get('licenseConsent') === 'true',
      )
      const id = randomUUID(),
        name = `${metadata.family} ${metadata.style} · ${id.slice(0, 6)}`
      const asset = {
        id,
        name,
        originalFilename: file.name.slice(0, 200),
        ...metadata,
        sizeBytes: bytes.length,
        licenseConsent: true,
        consentedAt: new Date().toISOString(),
        consentedBy: user?.id || 'demo-owner',
        status: 'ready',
        font: {
          name,
          category: 'Uploaded',
          file: 'custom-' + id,
          source: 'custom',
          browserFormat: metadata.browserFormat,
          weights: [400],
          smallPrint: false,
          minimumPt: 12,
          license: 'User-confirmed use and embedding rights',
          embedding: true,
          styles: ['normal'],
          suitable_for: ['headings'],
          tags: ['Uploaded fonts'],
          readability: 'Review for small print',
          style: metadata.style,
          licensedStatus: 'Rights confirmed by uploader',
          fallbackFamily: 'DM Sans',
        },
      }
      await getStore('label-fonts-private').set(
        `${org}/${id}`,
        bytes.buffer as ArrayBuffer,
      )
      await save('font_assets', asset)
      state.font_assets.push(asset)
      if (state.settings[0]) {
        state.settings[0].currentFontPreferences = state.settings[0]
          .labelFontPreferences?.[user?.id || 'demo'] || {
          favorites: [],
          recent: [],
        }
        delete state.settings[0].labelFontPreferences
      }
      await client.query('COMMIT')
      return Response.json(
        { workspace: workspaceForDevice(state), asset, role, demo: !user },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    }

    if (req.method === 'GET' && requestUrl.searchParams.has('asset')) {
      const asset = state.graphic_assets.find(
        (a) => a.id === requestUrl.searchParams.get('asset'),
      )
      if (!asset) throw new Error('Graphic is unavailable.')
      const bytes = await getStore('label-graphics').get(`${org}/${asset.id}`, {
        type: 'arrayBuffer',
      })
      if (!bytes) throw new Error('Graphic file is unavailable.')
      await client.query('COMMIT')
      return new Response(bytes, {
        headers: {
          'Content-Type': asset.fileType,
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'",
        },
      })
    }
    if (
      req.method === 'POST' &&
      (requestUrl.searchParams.has('upload') ||
        requestUrl.searchParams.has('productImage'))
    ) {
      if (!['Owner', 'Manager'].includes(role))
        throw new Error('Only an Owner or Manager can upload graphics.')
      if (Number(req.headers.get('content-length') || 0) > 6000000)
        throw new Error('Use an image smaller than 5 MB.')
      let form: FormData
      if (requestUrl.searchParams.has('productImage')) {
        const input = await req.json()
        const image = await fetchRecipeUrl(String(input.url || ''), true)
        form = new FormData()
        form.set(
          'file',
          new File([new Uint8Array(image.bytes)], 'Imported product photo', {
            type: image.mime,
          }),
        )
        form.set('category', 'product photo')
        form.set('tags', 'Imported with user approval; source: ' + image.url)
      } else form = await req.formData()
      const file = form.get('file')
      if (!(file instanceof File) || file.size > 5000000 || !file.size)
        throw new Error('Choose a PNG, JPEG, or WebP image smaller than 5 MB.')
      const bytes = new Uint8Array(await file.arrayBuffer()),
        size = imageSize(bytes)
      const mime: Record<string, string> = {
        png: 'image/png',
        jpg: 'image/jpeg',
        webp: 'image/webp',
      }
      if (
        !size.type ||
        !mime[size.type] ||
        !size.width ||
        !size.height ||
        size.width * size.height > 40000000
      )
        throw new Error(
          'Use a valid PNG, JPEG, or WebP image up to 40 megapixels. SVG and PDF uploads are not supported.',
        )
      const metadata = await sharp(bytes).metadata()
      const rotated = [5, 6, 7, 8].includes(metadata.orientation || 0)
      const id = randomUUID(),
        asset = {
          id,
          name: file.name.slice(0, 100),
          fileType: mime[size.type],
          widthPx: rotated ? size.height : size.width,
          heightPx: rotated ? size.width : size.height,
          transparentBackground: !!metadata.hasAlpha,
          category: String(form.get('category') || 'illustration').slice(0, 50),
          collection: String(form.get('collection') || 'My graphics').slice(
            0,
            60,
          ),
          tags: String(form.get('tags') || '').slice(0, 200),
          fileUrl: '/api/workspace?asset=' + id,
        }
      await getStore('label-graphics').set(`${org}/${id}`, bytes.buffer)
      await save('graphic_assets', asset)
      state.graphic_assets.push(asset)
      await client.query('COMMIT')
      return Response.json(
        { workspace: workspaceForDevice(state), asset, role, demo: !user },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    }
    if (
      req.method === 'GET' &&
      requestUrl.searchParams.has('printerCertificate')
    ) {
      if (!['Owner', 'Manager'].includes(role))
        throw new Error('An Owner or Manager must set up direct printing.')
      await client.query('COMMIT')
      return Response.json(
        {
          configured: qzConfigured(),
          certificate: qzConfigured() ? qzCertificate() : null,
        },
        { headers: { 'Cache-Control': 'private, no-store' } },
      )
    }
    if (req.method === 'POST' && requestUrl.searchParams.has('printerSign')) {
      if (!['Owner', 'Manager'].includes(role))
        throw new Error('An Owner or Manager must authorize direct printing.')
      const input = await req.json(),
        settings = state.settings[0]
      if (!qzConfigured())
        throw new Error(
          'Direct printing signing is not configured. Use browser printing.',
        )
      let signed
      if (input.operation === 'discover')
        signed = signQzCall('printers.find', { query: null })
      else if (input.operation === 'print') {
        const job =
          state.label_print_jobs.find((j) => j.id === input.jobId) ||
          settings.printerTestJobs?.[input.jobId]
        if (
          !job ||
          job.deviceKey !== deviceKey ||
          !job.printerProfile ||
          Date.now() - Date.parse(job.createdAt) > 600000
        )
          throw new Error(
            'This print authorization is unavailable or expired. Prepare a new job explicitly.',
          )
        if (settings.directSignedJobs?.[job.id])
          throw new Error(
            'This job was already authorized. Check the print queue before creating another job.',
          )
        const profile = (
          settings.printerProfilesByDevice?.[deviceKey] || []
        ).find((p: any) => p.id === job.printerProfile.id)
        if (
          !profile ||
          JSON.stringify(profile) !== JSON.stringify(job.printerProfile)
        )
          throw new Error('The printer profile changed. Prepare a new job.')
        const bytes = await getStore('label-print-pdfs').get(
          `${org}/${job.id}`,
          { type: 'arrayBuffer' },
        )
        if (!bytes)
          throw new Error('Prepared PDF is unavailable. No job was submitted.')
        const params = {
          printer: { name: profile.name },
          options: qzPrintOptions(profile),
          data: [
            {
              type: 'pixel',
              format: 'pdf',
              flavor: 'base64',
              data: Buffer.from(bytes).toString('base64'),
            },
          ],
        }
        signed = signQzCall('print', params)
        settings.directSignedJobs = Object.fromEntries(
          Object.entries(settings.directSignedJobs || {}).filter(
            ([, time]) => Date.now() - Number(time) < 600000,
          ),
        )
        settings.directSignedJobs[job.id] = Date.now()
        await save('settings', settings)
        await save('activity', {
          id: randomUUID(),
          name: 'Direct print job authorized',
          detail:
            'Authorization issued once; submission is not proof of physical printing.',
          date: ovenToday(state.settings[0]),
          sourceId: job.id,
        })
      } else
        throw new Error(
          'Choose discovery or an approved print job. Arbitrary requests cannot be signed.',
        )
      await client.query('COMMIT')
      return Response.json(signed, {
        headers: { 'Cache-Control': 'private, no-store' },
      })
    }
    if (req.method === 'POST' && requestUrl.searchParams.has('printerTest')) {
      if (!['Owner', 'Manager'].includes(role))
        throw new Error('An Owner or Manager must prepare a test label.')
      if (!qzConfigured())
        throw new Error(
          'Direct printing signing is not configured. Use browser printing.',
        )
      const input = await req.json(),
        settings = state.settings[0]
      const profile = (
        settings.printerProfilesByDevice?.[deviceKey] || []
      ).find((p: any) => p.id === input.profileId && p.method === 'qz')
      if (!profile)
        throw new Error('Save a direct printer profile for this device first.')
      const size = printerSize(profile),
        document = {
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
              ...newElement('text', 'Cottage Pantry\nTest label · actual size'),
              font: 'DM Sans',
              fontSize: Math.min(12, size.width / 16),
              x: 8,
              y: 8,
              width: size.width - 16,
              height: size.height - 16,
            },
          ],
        }
      const snapshot = {
        values: {},
        warnings: [],
        allergens: [],
        weightsVerified: true,
        ingredientParts: [],
      }
      const bytes = await exportLabelPdf(
        document,
        snapshot,
        [],
        1,
        {
          ...defaultSheet,
          mode: 'roll',
          offsetX: points(profile.offsetX, profile.unit),
          offsetY: points(profile.offsetY, profile.unit),
        },
        {
          font: async (key) =>
            new Uint8Array(
              await readFile(resolve('public/label-fonts', key + '.ttf')),
            ),
          image: async () => {
            throw new Error('Test labels do not contain images.')
          },
        },
      )
      const job = {
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        deviceKey,
        printerProfile: profile,
      }
      await getStore('label-print-pdfs').set(
        `${org}/${job.id}`,
        new Uint8Array(bytes).buffer,
      )
      settings.printerTestJobs = Object.fromEntries(
        Object.entries(settings.printerTestJobs || {}).filter(
          ([, j]: any) => Date.now() - Date.parse(j.createdAt) < 600000,
        ),
      )
      settings.printerTestJobs[job.id] = job
      await save('settings', settings)
      await client.query('COMMIT')
      return Response.json(
        { jobId: job.id },
        { headers: { 'Cache-Control': 'private, no-store' } },
      )
    }
    if (req.method === 'POST' && requestUrl.searchParams.has('labelPdf')) {
      if (!['Owner', 'Manager'].includes(role))
        throw new Error('Only an Owner or Manager can prepare print exports.')
      const data = await req.json(),
        template = state.label_templates.find((t) => t.id === data.templateId)
      if (!template || template.deletedAt)
        throw new Error('Save an available label before exporting.')
      const masterDocument = validateLabelDocument(template, customFonts),
        source = data.source
      if (!source || !['product', 'batch', 'ingredient'].includes(source.kind))
        throw new Error('Choose a label source.')
      const collection =
        source.kind === 'product'
          ? state.products
          : source.kind === 'batch'
            ? state.batches
            : state.ingredients
      if (!collection.some((r) => r.id === source.id))
        throw new Error('Source is unavailable.')
      if (
        source.productId &&
        !state.products.some((p) => p.id === source.productId)
      )
        throw new Error('Product is unavailable.')
      assertSavedLabelOutput(masterDocument, source, data.brandId)
      const snapshot = resolveLabelData(
          state,
          source,
          state.brand_kits.find((b) => b.id === data.brandId),
        ),
        copies = number(data.copies, 'Label copies', 1),
        layout = { ...(data.layout || defaultSheet) }
      const setPlan =
        masterDocument.format === 'front-back'
          ? labelSetPlan(masterDocument, copies, data.parts, data.order)
          : null
      const selectedRun = setPlan?.runs[data.runIndex || 0]
      if (setPlan && !selectedRun) throw new Error('Choose a valid print run.')
      const document = selectedRun?.document || masterDocument
      const sequence =
        selectedRun?.sequence ||
        Array.from({ length: copies }, () => 'front' as const)
      validateLabelRunContent(masterDocument, snapshot, sequence)
      const printerProfile = data.printerProfileId
        ? (state.settings[0].printerProfilesByDevice?.[deviceKey] || []).find(
            (p: any) => p.id === data.printerProfileId && p.method === 'qz',
          )
        : undefined
      if (data.printerProfileId && !printerProfile)
        throw new Error('Select a direct printer profile saved on this device.')
      if (printerProfile) {
        if (layout.mode === 'sheet')
          throw new Error(
            'Use one label per page for this thermal printer profile.',
          )
        checkPrinterSize(document, printerProfile)
        layout.offsetX = points(printerProfile.offsetX, printerProfile.unit)
        layout.offsetY = points(printerProfile.offsetY, printerProfile.unit)
      }
      if (!Number.isInteger(copies) || copies > 200)
        throw new Error('Print between 1 and 200 copies.')
      validateSheet(document, layout)
      const pdfLoaders = {
        fonts: customFonts,
        font: async (key: string) =>
          key.startsWith('custom-')
            ? loadCustomFont(key)
            : key.startsWith('google-')
              ? loadGoogleFontFace(key)
              : new Uint8Array(
                  await readFile(resolve('public/label-fonts', key + '.ttf')),
                ),
        image: async (asset: Item) => {
          const raw = await getStore('label-graphics').get(
            `${org}/${asset.id}`,
            { type: 'arrayBuffer' },
          )
          if (!raw) throw new Error('Image is unavailable.')
          return new Uint8Array(
            await sharp(Buffer.from(raw)).rotate().png().toBuffer(),
          )
        },
      }
      const bytes =
        masterDocument.renderVersion === 2 ||
        masterDocument.format === 'front-back'
          ? await exportSvgLabelPdf(
              sequence.map((side) => labelSide(masterDocument, side)),
              snapshot,
              state.graphic_assets,
              layout,
              pdfLoaders,
            )
          : await exportLabelPdf(
              document,
              snapshot,
              state.graphic_assets,
              copies,
              layout,
              pdfLoaders,
            )
      const printJobId = randomUUID()
      if (printerProfile)
        await getStore('label-print-pdfs').set(
          `${org}/${printJobId}`,
          new Uint8Array(bytes).buffer,
        )
      await save('label_print_jobs', {
        id: printJobId,
        deviceKey: printerProfile ? deviceKey : undefined,
        printerProfile,
        name: template.name,
        templateId: template.id,
        productId: source.kind === 'product' ? source.id : source.productId,
        batchId: source.kind === 'batch' ? source.id : undefined,
        outputType: 'pdf',
        copies,
        renderedDataSnapshot: snapshot,
        documentSnapshot: structuredClone(masterDocument),
        sequence,
        runIndex: data.runIndex || 0,
        parts: data.parts || 'both',
        order: data.order || 'grouped',
        layout,
        createdAt: new Date().toISOString(),
        status: 'exported',
      })
      await client.query('COMMIT')
      return new Response(bytes as BodyInit, {
        headers: {
          'X-Label-Job': printJobId,
          'Content-Type': 'application/pdf',
          'Content-Disposition':
            'attachment; filename="cottage-pantry-labels.pdf"',
          'Cache-Control': 'private, no-store',
        },
      })
    }
    const stockContext = () => ({
      state,
      save: (table: string, item: Item) => save(table, item, true),
      actor: user?.id || 'demo-owner',
      today: ovenToday(state.settings[0]),
      audit: async (_name: string, _detail: string) => {},
    })
    async function recordSale(item: Item) {
      delete item.stockDeducted
      if (state.sales.some((s) => s.id === item.id))
        throw new Error('Recorded sales are immutable. Use a refund.')
      const p = state.products.find((p) => p.id === item.productId)
      if (!p) throw new Error('Choose a product.')
      if (p.workflow === 'kit')
        throw new Error(
          'Kit fulfillment is unavailable: finished-package consumption is not supported for every component. No stock or sale was posted.',
        )
      if (item.refundOf)
        throw new Error('Use the refund action to reverse a recorded sale.')
      item.quantity = number(item.quantity, 'Packages sold', 0.000001)
      item.discounts = number(item.discounts || 0, 'Discounts')
      const entered =
        number(item.amount ?? item.quantity * p.price, 'Entered sales amount') -
        item.discounts
      if (entered < 0) throw new Error('Discount exceeds sales.')
      item.date = validateDate(item.date || ovenToday(state.settings[0]))
      if (
        item.taxRateIds &&
        (!Array.isArray(item.taxRateIds) ||
          item.taxRateIds.some(
            (id: string) => !configuredRates.some((r: any) => r.id === id),
          ))
      )
        throw new Error('Choose tax rates from this business.')
      const taxProduct = saleTaxProduct(p, item.taxRateIds)
      const tax = calculateTax(
        entered,
        applicableTaxes(taxProduct, state.settings[0], item.date),
      )
      item.enteredAmount = entered
      item.amount = tax.revenue
      item.tax = tax.tax
      item.customerTotal = tax.customerTotal
      item.taxSnapshot = tax.snapshot
      item.taxStatus = p.taxStatus || 'taxable'
      if (p.taxSource === 'category') {
        const inherited = categoryTaxState(p, state.settings[0])
        item.categoryTaxSnapshot = {
          categoryId: inherited.category?.id,
          categoryName: inherited.category?.name,
          classification: inherited.category?.classification,
          configuredTaxRateIds: inherited.ids,
          taxRateIds: tax.snapshot.map((rate) => rate.id),
          manualOverride: Array.isArray(item.taxRateIds),
        }
      }
      item.priceTaxMode = p.priceTaxMode || 'configured'
      item.fees = number(item.fees || 0, 'Fees')
      // An explicit completed run preserves its actual production costs.
      const batch = item.batchId
        ? state.batches.find(
            (b) =>
              b.id === item.batchId &&
              b.status === 'completed' &&
              b.productId === p.id,
          )
        : undefined
      if (item.batchId && (!batch || !batch.costSnapshot))
        throw new Error('Choose a completed batch for this product.')
      if (
        batch &&
        batch.costSnapshot.unitsPerPackage !== Number(p.unitsPerPackage)
      )
        throw new Error(
          'This product package size differs from the completed batch. Choose a batch made with the same package size.',
        )
      const finishedSale = await consumeFinishedSale(stockContext(), item, p)
      const costing = finishedSale
        ? item.costSnapshot
        : batch?.costSnapshot || productCosting(p, state)
      if (!finishedSale) {
        item.costSnapshot = batch?.costSnapshot || costing
        item.historicalCogs = roundMoney(
          (batch ? batch.costSnapshot.perPackage : costing.perPackage) *
            item.quantity,
        )
        item.costSource = batch ? 'completed_batch' : 'current_estimate'
      }
      await save('sales', item)
      state.sales.push(item)
      for (const [id, name, type] of [
        ['sales-tax-payable', 'Sales Tax Payable', 'liability'],
        ['sales-revenue', 'Sales revenue', 'income'],
      ])
        await save('accounts', { id, name, type })
      if (tax.customerTotal > 0)
        await save('journals', {
          id: randomUUID(),
          name: `Sale: ${item.name}`,
          sourceId: item.id,
          date: item.date,
          status: 'posted',
          lines: [
            { account: 'Cash', debit: tax.customerTotal, credit: 0 },
            { account: 'Sales revenue', debit: 0, credit: tax.revenue },
            ...tax.snapshot
              .filter((r) => r.amount > 0)
              .map((r) => ({
                account: 'Sales Tax Payable',
                jurisdiction: r.jurisdiction,
                taxRateId: r.id,
                debit: 0,
                credit: r.amount,
              })),
          ],
        })
      if (item.fees > 0)
        await save('journals', {
          id: randomUUID(),
          name: 'Sale processing fee: ' + item.name,
          date: item.date,
          sourceId: item.id,
          status: 'posted',
          lines: [
            {
              account: 'Payment processing fees',
              debit: roundMoney(item.fees),
              credit: 0,
            },
            { account: 'Cash', debit: 0, credit: roundMoney(item.fees) },
          ],
        })
    }
    if (req.method === 'POST') {
      const { action, table, data } = await req.json()
      if (
        table === 'inventory_counts' &&
        ![
          'inventoryCountStart',
          'inventoryCountLine',
          'inventoryCountComplete',
        ].includes(action)
      )
        throw new Error('Use the reviewed inventory count workflow.')
      if (
        role === 'Read-only Accountant' &&
        !['pantrySort', 'pantryView', 'shelfMedia'].includes(action)
      )
        throw new Error('Your role has read-only access.')
      if (
        role === 'Production Staff' &&
        ![
          'complete',
          'receive',
          'adjust',
          'pantrySort',
          'pantryView',
          'shelfMedia',
          'inventoryCountStart',
          'inventoryCountLine',
          'inventoryCountComplete',
        ].includes(action)
      )
        throw new Error('This action requires an Owner or Manager.')
      const today = ovenToday(state.settings[0])
      const audit = async (name: string, detail: string) =>
        save('activity', {
          id: randomUUID(),
          name,
          detail,
          date: today,
          type: action,
          actor: user?.id || 'Demo owner',
        })
      if (
        table === 'users' &&
        ['save', 'import'].includes(action) &&
        moduleAccess?.plan
      ) {
        const { launchPricing } = await import('../../src/lib/launch-plans')
        const limit = launchPricing.plans.find(
          (p) => p.id === moduleAccess!.plan,
        )?.users
        const existing = state.users?.find((u) => u.id === data.id)
        if (
          typeof limit === 'number' &&
          data.active !== false &&
          !existing?.active
        ) {
          const active = (
            await client.query(
              'SELECT count(DISTINCT identity_id)::int AS count FROM users WHERE business_id=$1 AND active=true',
              [org],
            )
          ).rows[0].count
          if (active >= limit)
            throw new Error(
              'This business is at its configured user limit. Existing members are preserved.',
            )
        }
      }
      const kitTarget = state.products.find(
        (p) => p.id === (data.id || data.productId),
      )
      if (
        kitTarget?.workflow === 'kit' &&
        !['save', 'archive'].includes(action)
      )
        throw new Error(
          'Kit stock, production and fulfillment actions are unavailable. Definitions do not move stock.',
        )
      if (
        table === 'batches' &&
        state.products.some(
          (p) => p.id === data.productId && p.workflow === 'kit',
        )
      )
        throw new Error(
          'Produce component products separately; kit production is unavailable.',
        )
      if (action === 'receivedDateCorrection') {
        const settings = state.settings[0]
        const record = applyReceivedDateCorrections(
          state.ledger,
          settings,
        ).find((r) => r.id === data.id)
        if (!record)
          throw new Error('Choose a purchase receipt from this oven.')
        if (!/^[a-f0-9-]{36}$/i.test(data.operationId || ''))
          throw new Error('Reopen the date correction form.')
        const corrections = settings.receivedDateCorrections || []
        const previous = corrections.find((c: any) => c.id === data.operationId)
        if (
          previous &&
          (previous.ledgerId !== data.id ||
            previous.receivedDate !== data.receivedDate ||
            previous.reason !== String(data.reason).slice(0, 1000))
        )
          throw new Error(
            'This date correction ID was already used. Reopen the record.',
          )
        if (!previous) {
          const correction = receiveDateCorrection(
            record,
            data,
            user?.id || 'demo-owner',
          )
          await save(
            'settings',
            {
              ...settings,
              receivedDateCorrections: [...corrections, correction],
            },
            false,
            true,
          )
          await audit(
            'Received date corrected',
            `${record.id}: ${correction.previousDate} → ${correction.receivedDate}. ${correction.reason}`,
          )
        }
      } else if (
        await handleAddItem(action, table, data, {
          ...stockContext(),
          audit,
          today,
        })
      ) {
        // Item and optional opening receipt are posted atomically.
      } else if (
        await handleProductWorkflow(action, table, data, {
          ...stockContext(),
          audit,
        })
      ) {
        // Shared stock/product/design workflows completed within this workspace transaction.
      } else if (action === 'ingredientBarcode') {
        const item = state.ingredients.find((i) => i.id === data.id)
        if (!item || data.expectedUpdatedAt !== item.updatedAt)
          throw new Error(
            'Item unavailable or changed. Refresh before linking.',
          )
        const code = barcodeText(data.barcode)
        if (item.barcode && item.barcode !== code)
          throw new Error(
            'An existing code must be reviewed in the item editor; it cannot be replaced by scanning.',
          )
        item.barcode = code
        item.barcodeFormat = scanFormats.includes(data.barcodeFormat)
          ? data.barcodeFormat
          : undefined
        await save('ingredients', item)
        await audit('Item barcode linked', item.name)
      } else if (action === 'shelfMedia') {
        const profile = validateShelfMedia({
          ...data.profile,
          id: data.profile?.id || randomUUID(),
        })
        const settings = state.settings[0],
          profiles = settings.shelfMediaProfilesByDevice?.[deviceKey] || []
        if (
          profiles.length >= 24 &&
          !profiles.some((p: Item) => p.id === profile.id)
        )
          throw new Error('Use up to 24 shelf media profiles.')
        const nextProfiles = [
          ...profiles.filter((p: Item) => p.id !== profile.id),
          profile,
        ]
        settings.shelfMediaProfilesByDevice = {
          ...settings.shelfMediaProfilesByDevice,
          [deviceKey]: nextProfiles,
        }
        await save('settings', settings)
      } else if (action === 'inventoryCountStart') {
        if (!/^[a-zA-Z0-9_-]{1,100}$/.test(data.id || ''))
          throw new Error('A unique count ID is required.')
        if (!state.inventory_counts.some((c) => c.id === data.id)) {
          await save('inventory_counts', {
            id: data.id,
            name: 'Inventory count',
            status: 'draft',
            revision: 0,
            lines: [],
            date: today,
          })
          await audit(
            'Inventory count started',
            'No stock or financial changes.',
          )
        }
      } else if (
        action === 'inventoryCountLine' ||
        action === 'inventoryCountComplete'
      ) {
        const session = state.inventory_counts.find((c) => c.id === data.id)
        if (!session) throw new Error('Count session unavailable.')
        if (session.status === 'completed') {
          if (action !== 'inventoryCountComplete')
            throw new Error('Completed counts cannot be edited.')
        } else {
          if (data.revision !== session.revision)
            throw new Error(
              'This count changed. Refresh it before saving; no adjustments were applied.',
            )
          if (action === 'inventoryCountLine') {
            const item = state.ingredients.find(
              (i) => i.id === data.ingredientId,
            )
            if (!item) throw new Error('Item unavailable in this oven.')
            const revision = inventoryRevision(item, state.ledger)
            if (revision !== data.inventoryRevision)
              throw new Error(
                'Stock changed. Refresh and recount this item; no adjustment was applied.',
              )
            const quantity = countQuantity(data.quantity, data.unit, item)
            session.lines = [
              ...session.lines.filter((l: Item) => l.ingredientId !== item.id),
              {
                ingredientId: item.id,
                name: item.name,
                countedQuantity: quantity,
                unit: item.unit,
                enteredQuantity: number(data.quantity, 'Count quantity'),
                enteredUnit: data.unit,
                systemQuantity: item.quantity,
                inventoryRevision: revision,
              },
            ]
          } else {
            if (!session.lines.length || data.confirm !== true)
              throw new Error(
                'Review at least one counted item and confirm the adjustments.',
              )
            assertCountUnchanged(session.lines, state.ingredients, (item) =>
              inventoryRevision(item, state.ledger),
            )
            for (const line of session.lines) {
              const item = state.ingredients.find(
                  (i) => i.id === line.ingredientId,
                )!,
                change = line.countedQuantity - item.quantity,
                amount = change * item.cost
              if (change !== 0) {
                item.quantity = line.countedQuantity
                await save('ingredients', item)
                const movementId = 'count-' + session.id + '-' + item.id
                await save('ledger', {
                  id: movementId,
                  name: item.name,
                  ingredientId: item.id,
                  quantity: change,
                  unit: item.unit,
                  amount,
                  date: today,
                  type: 'adjustment',
                  reason: 'Reviewed inventory count ' + session.id,
                  countId: session.id,
                })
                if (roundMoney(Math.abs(amount)) > 0)
                  await save('journals', {
                    id: 'journal-' + movementId,
                    name: 'Inventory count: ' + item.name,
                    sourceId: session.id,
                    date: today,
                    status: 'posted',
                    lines:
                      amount > 0
                        ? [
                            {
                              account: 'Inventory asset',
                              debit: roundMoney(amount),
                              credit: 0,
                            },
                            {
                              account: 'Other income',
                              debit: 0,
                              credit: roundMoney(amount),
                            },
                          ]
                        : [
                            {
                              account: 'Inventory shrink/waste COGS',
                              debit: roundMoney(-amount),
                              credit: 0,
                            },
                            {
                              account: 'Inventory asset',
                              debit: 0,
                              credit: roundMoney(-amount),
                            },
                          ],
                  })
              }
            }
            session.status = 'completed'
            await audit(
              'Inventory count completed',
              'Reviewed adjustments posted once. ' + session.id,
            )
          }
          session.revision += 1
          await save('inventory_counts', session)
        }
      } else if (action === 'productRecipeLink') {
        if (!['Owner', 'Manager'].includes(role))
          throw new Error(
            'An Owner or Manager must manage product recipe links.',
          )
        const linked = updateProductRecipe(state, data)
        const original = state.products.find((p) => p.id === linked.id)
        if (
          original?.workflow === 'resale' ||
          original?.workflow === 'handmade'
        )
          throw new Error(
            'Use the product workflow editor to manage this product design.',
          )
        if (linked !== original) await save('products', linked)
      } else if (action === 'simpleSale') {
        if (
          !Array.isArray(data.saleLines) ||
          !data.saleLines.length ||
          data.saleLines.length > 50
        )
          throw new Error('Add between 1 and 50 product lines.')
        if (
          data.saleLines.some((line: Item) =>
            state.products.some(
              (p) => p.id === line.productId && tracksFinishedStock(p),
            ),
          ) &&
          !data.requestId
        )
          throw new Error(
            'A stable sale request ID is required for tracked finished goods.',
          )
        const groupId = String(data.requestId || randomUUID())
        if (state.finance_transactions.some((t) => t.id === groupId))
          throw new Error('This sale has already been recorded.')
        const when = validateDate(data.date),
          fees = roundMoney(number(data.fees || 0, 'Processing fees'))
        const receiptId = data.receiptId
          ? state.receipt_extractions.find((r) => r.id === data.receiptId)?.id
          : undefined
        if (data.receiptId && !receiptId)
          throw new Error('Choose a receipt from this oven.')
        const gross = data.saleLines.reduce(
          (sum: number, l: any) =>
            sum +
            number(l.amount, 'Gross amount') -
            number(l.discounts || 0, 'Discounts'),
          0,
        )
        if (fees > gross)
          throw new Error('Fees exceed the entered sales amount.')
        let allocated = 0,
          totalRevenue = 0,
          totalTax = 0,
          totalCustomer = 0
        const saleIds: string[] = []
        for (const [index, l] of data.saleLines.entries()) {
          const product = state.products.find((p) => p.id === l.productId)
          if (!product) throw new Error('Choose a product from this oven.')
          const fee =
            index === data.saleLines.length - 1
              ? roundMoney(fees - allocated)
              : roundMoney(
                  gross
                    ? (fees * (Number(l.amount) - Number(l.discounts || 0))) /
                        gross
                    : 0,
                )
          allocated = roundMoney(allocated + fee)
          const sale: Item = {
            id: randomUUID(),
            name: product.name,
            date: when,
            productId: product.id,
            quantity: l.quantity,
            amount: l.amount,
            discounts: l.discounts,
            fees: fee,
            batchId: l.batchId || undefined,
            channel: String(data.channel || 'Other').slice(0, 200),
            paymentMethod: String(data.method || '').slice(0, 100),
            customer: String(data.customer || '').slice(0, 200),
            receiptId,
            transactionId: groupId,
          }
          await recordSale(sale)
          totalRevenue += sale.amount
          totalTax += sale.tax
          totalCustomer += sale.customerTotal
          saleIds.push(sale.id)
        }
        await save('finance_transactions', {
          id: groupId,
          name: 'Product sale · ' + String(data.channel || 'Other'),
          kind: 'productSale',
          date: when,
          amount: roundMoney(totalCustomer),
          revenue: roundMoney(totalRevenue),
          tax: roundMoney(totalTax),
          fees,
          receiptId,
          saleIds,
          status: 'posted',
        })
        await audit(
          'Product sale confirmed',
          `${data.saleLines.length} product lines · tax held separately`,
        )
      } else if (action === 'receiptExtract') {
        if (!receiptReadingEnabled()) {
          await client.query('ROLLBACK')
          return Response.json(
            {
              error:
                'Document reading is unavailable. Enter receipt details manually.',
              code: 'FEATURE_UNAVAILABLE',
            },
            { status: 404, headers: { 'Cache-Control': 'private, no-store' } },
          )
        }
        let receipt = state.receipt_extractions.find((r) => r.id === data.id)
        if (!receipt || receipt.status !== 'draft')
          throw new Error('Choose an open receipt draft.')
        if (
          receipt.extractionStatus === 'processing' &&
          Date.now() - Date.parse(receipt.extractionStartedAt) < 120000
        )
          throw new Error(
            'Extraction is already processing. Wait before retrying.',
          )
        const dayStart = new Date().toISOString().slice(0, 10)
        const todayAttempts = state.receipt_extractions.flatMap((r) =>
          (r.extractionAttempts || []).filter(
            (a: Item) => String(a.startedAt).slice(0, 10) === dayStart,
          ),
        )
        const ownAttempts = (receipt.extractionAttempts || []).filter(
          (a: Item) => String(a.startedAt).slice(0, 10) === dayStart,
        )
        if (
          todayAttempts.length >= receiptLimits.attemptsPerDay ||
          ownAttempts.length >= receiptLimits.attemptsPerReceiptPerDay
        )
          throw new Error(
            'Receipt reading limit reached for today. Your file and entries are preserved; use manual entry or try tomorrow.',
          )
        const attempt: Item = {
          name: 'Receipt extraction',
          id: randomUUID(),
          startedAt: new Date().toISOString(),
          provider: 'Google Gemini',
          model: receiptModel,
          sourceHash: receipt.fileHash,
          before: receiptReviewValues(receipt),
          status: 'processing',
        }
        receipt.extractionStatus = 'processing'
        receipt.extractionStartedAt = attempt.startedAt
        receipt.activeExtractionId = attempt.id
        receipt.extractionAttempts = [
          ...(receipt.extractionAttempts || []),
          attempt,
        ]
        await save('receipt_extractions', receipt)
        // Provider latency must not hold the workspace's stock/accounting lock.
        await client.query('COMMIT')
        let extracted: Awaited<ReturnType<typeof extractReceipt>> | undefined
        let failure: ReturnType<typeof extractionFailure> | undefined
        try {
          const bytes = await getStore('receipts-private').get(
            receiptObjectKey(org, receipt, true),
            { type: 'arrayBuffer' },
          )
          if (!bytes)
            throw new ReceiptExtractionError(
              'source_missing',
              'The original receipt file is unavailable. Retry or enter details manually.',
            )
          const buffer = Buffer.from(bytes)
          if (
            createHash('sha256').update(buffer).digest('hex') !==
            receipt.fileHash
          )
            throw new ReceiptExtractionError(
              'source_integrity_failed',
              'The saved original failed its integrity check. Upload the original again; existing draft values are preserved.',
            )
          extracted = await extractReceipt(buffer, receipt.originalMime)
        } catch (error) {
          failure = extractionFailure(error)
        }
        const currentUser = await verifiedSession(req)
        if (!currentUser || currentUser.id !== user?.id)
          throw new Error(
            'Your session expired while reading. The original and saved entries are preserved; sign in and retry.',
          )
        await client.query('BEGIN')
        await client.query("SELECT set_config('app.identity_id',$1,true)", [
          currentUser.id,
        ])
        await client.query("SELECT set_config('app.business_id',$1,true)", [
          org,
        ])
        const currentMembership = await client.query(
          'SELECT role FROM users WHERE business_id=$1 AND identity_id=$2 AND active=true',
          [org, currentUser.id],
        )
        if (
          !currentMembership.rows.some((member: { role: string }) =>
            ['Owner', 'Manager'].includes(member.role),
          )
        )
          throw new Error(
            'Oven access changed while reading. Your original and saved entries are preserved.',
          )
        await client.query('SELECT id FROM businesses WHERE id=$1 FOR UPDATE', [
          org,
        ])
        const latest = await client.query(
          'SELECT data FROM receipt_extractions WHERE business_id=$1 ORDER BY created_at,id',
          [org],
        )
        receipt = latest.rows
          .map((r: any) => r.data)
          .find((r: Item) => r.id === data.id)
        if (
          !receipt ||
          receipt.status !== 'draft' ||
          receipt.activeExtractionId !== attempt.id
        )
          throw new Error(
            'This extraction attempt was superseded or the receipt was closed.',
          )
        const savedAttempt = receipt.extractionAttempts.find(
          (r: Item) => r.id === attempt.id,
        )
        if (extracted) {
          for (const line of extracted.lines) {
            const match = [...state.vendor_matches]
              .reverse()
              .find(
                (m) =>
                  m.vendor === (extracted!.vendor || '').toLowerCase() &&
                  m.description === (line.description || '').toLowerCase(),
              )
            if (!match && line.description) {
              const words = String(line.description)
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, ' ')
              const candidates = purchasableInventory(state).filter(
                (i) =>
                  !i.compoundRecipeId &&
                  String(i.name).trim().length >= 4 &&
                  (' ' + words + ' ').includes(
                    ' ' +
                      String(i.name)
                        .toLowerCase()
                        .replace(/[^a-z0-9]+/g, ' ')
                        .trim() +
                      ' ',
                  ),
              )
              if (candidates.length === 1)
                Object.assign(line, {
                  suggestedDecision: 'inventory',
                  suggestedItemId: candidates[0].id,
                  suggestedItemTable: candidates[0].itemTable,
                  suggestionSource: 'name',
                })
            }
            if (match)
              Object.assign(line, {
                suggestedDecision: match.decision,
                suggestedItemId: match.itemId,
                suggestedItemTable: match.itemTable || 'ingredients',
                suggestedCategory: match.category,
              })
          }
          savedAttempt.result = structuredClone(extracted)
          savedAttempt.status = extracted.partial ? 'partial' : 'needs_review'
          savedAttempt.usage = extracted.usage
          const edited =
            data.preserveEdits ||
            receipt.extractionSnapshot ||
            (receipt.history || []).some((h: Item) => h.action === 'edited') ||
            JSON.stringify(receiptReviewValues(receipt)) !==
              JSON.stringify(attempt.before)
          if (edited) receipt.pendingExtraction = extracted
          else Object.assign(receipt, extracted)
          receipt.extractionSnapshot = structuredClone(extracted)
          receipt.extractionStatus = extracted.partial
            ? 'partial'
            : 'needs_review'
          receipt.lastReadSummary = {
            processingMethod: extracted.processingMethod,
            pageCount: extracted.pageCount,
            unverifiedPages: extracted.unverifiedPages,
            warnings: extracted.warnings,
          }
          receipt.extractionMessage = edited
            ? 'New extraction is ready. Review replacement values before applying; your edits are preserved.'
            : extracted.partial
              ? 'Partially extracted — review needed. Missing or ambiguous values remain blank.'
              : 'Ready for review. Check every value before confirmation.'
          delete receipt.extractionError
          receipt.history.push({
            action: 'extracted',
            at: new Date().toISOString(),
            attemptId: attempt.id,
          })
        } else if (failure) {
          Object.assign(savedAttempt, failure)
          receipt.extractionStatus = failure.status
          receipt.extractionMessage = failure.message
          receipt.extractionError = {
            code: failure.code,
            httpStatus: failure.httpStatus,
          }
          receipt.history.push({
            action: 'extraction ' + failure.status,
            at: new Date().toISOString(),
            attemptId: attempt.id,
          })
        }
        savedAttempt.finishedAt = new Date().toISOString()
        await save('receipt_extractions', receipt)
        await audit('Receipt extraction reviewed', receipt.name)
      } else if (action === 'receiptMatch') {
        const receipt = state.receipt_extractions.find((r) => r.id === data.id)
        const transaction = state.finance_transactions.find(
          (t) =>
            t.id === data.transactionId &&
            !t.reversedBy &&
            ['expense', 'bill'].includes(t.kind),
        )
        if (!receipt || receipt.status !== 'draft' || !transaction)
          throw new Error('Choose an open receipt and an existing purchase.')
        if (
          receipt.total == null ||
          Number(receipt.total) !== Number(transaction.amount)
        )
          throw new Error(
            'Receipt total must match the existing purchase amount.',
          )
        if (
          transaction.receiptId ||
          state.receipt_extractions.some(
            (r) => r.matchedTransactionId === transaction.id,
          )
        )
          throw new Error(
            'This purchase already has a receipt. Review the linked record.',
          )
        receipt.matchedTransactionId = transaction.id
        receipt.status = 'attached'
        receipt.history.push({
          action: 'attached to existing purchase; no new posting',
          transactionId: transaction.id,
          at: new Date().toISOString(),
        })
        await save('receipt_extractions', receipt)
        await audit('Receipt matched to existing purchase', receipt.name)
      } else if (
        action === 'receiptApplyExtraction' ||
        action === 'receiptDismissExtraction'
      ) {
        const receipt = state.receipt_extractions.find((r) => r.id === data.id)
        if (
          !receipt ||
          receipt.status !== 'draft' ||
          !receipt.pendingExtraction
        )
          throw new Error('No replacement extraction is available.')
        if (data.updatedAt && data.updatedAt !== receipt.updatedAt)
          throw new Error(
            'The draft changed. Reopen it before applying replacement values.',
          )
        const previousReview = receiptReviewValues(receipt)
        if (action === 'receiptApplyExtraction')
          Object.assign(receipt, receipt.pendingExtraction)
        receipt.history.push({
          action:
            action === 'receiptApplyExtraction'
              ? 'replacement explicitly applied'
              : 'replacement dismissed; edits kept',
          at: new Date().toISOString(),
          previousReview,
        })
        delete receipt.pendingExtraction
        await save('receipt_extractions', receipt)
      } else if (action === 'receiptManual') {
        await save('receipt_extractions', {
          id: randomUUID(),
          name: 'Manual receipt',
          vendor: '',
          date: '',
          receivedDate: today,
          status: 'draft',
          subtotal: null,
          tax: null,
          total: null,
          lines: [],
          extractionStatus: 'manual',
          history: [
            { action: 'created manually', at: new Date().toISOString() },
          ],
        })
        await audit('Manual receipt draft created', 'Review before posting')
      } else if (
        [
          'consignorSave',
          'consignmentReceive',
          'consignmentSale',
          'consignmentRefund',
          'consignmentPayout',
          'financeEntry',
          'financeReconcile',
          'financeReverse',
          'receiptDraft',
          'receiptCreateItem',
          'receiptPost',
          'receiptCancel',
        ].includes(action)
      ) {
        const plan = planFinance(state, action, data, randomUUID)
        // New pantry items must exist before their non-deferrable ledger foreign key.
        for (const write of plan.writes.filter((w) =>
          ['ingredients', 'products'].includes(w.table),
        )) {
          if (
            write.record.imageAssetId &&
            !state.graphic_assets.some(
              (a) => a.id === write.record.imageAssetId,
            )
          )
            throw new Error('Choose a photo from this oven.')
          await save(write.table, write.record, true)
        }
        for (const write of plan.writes.filter(
          (w) => !['ingredients', 'products'].includes(w.table),
        ))
          await save(write.table, write.record, true)
        if (plan.journal) await save('journals', plan.journal)
        if (plan.writes.length || plan.journal)
          await audit(plan.description, plan.writes[0]?.record.name || '')
      } else if (action === 'labelImageAssignment') {
        for (const assignment of labelArtworkAssignment(state, data))
          await save(assignment.table, assignment.record)
        await audit('Label artwork linked', String(data.target))
      } else if (
        ['templateAssignments', 'productLabelAssignment'].includes(action)
      ) {
        throw new Error(
          'Create or duplicate a label in Labels. Existing product links are preserved pending conversion review.',
        )
      } else if (action === 'labelColorRecent') {
        const color = validateLabelColor(data.color),
          settings = state.settings[0],
          key = user?.id || 'demo'
        settings.labelColorPreferences = {
          ...(settings.labelColorPreferences || {}),
          [key]: recentColorList(
            settings.labelColorPreferences?.[key] || [],
            color,
          ),
        }
        await save('settings', settings)
      } else if (action === 'labelBrandColor') {
        const kit = state.brand_kits.find((b) => b.id === data.brandId),
          color = validateLabelColor(data.color)
        if (!kit) throw new Error('Choose a saved Brand Kit in this oven.')
        if (
          typeof data.name !== 'string' ||
          !data.name.trim() ||
          data.name.length > 60 ||
          color.hex === 'transparent'
        )
          throw new Error('Name a valid brand color.')
        const swatches =
          (kit.colorSwatches?.length ? kit.colorSwatches : null) ||
          (kit.colors || []).map((hex: string) => ({
            hex,
            opacity: 1,
            name: hex,
          }))
        if (swatches.length >= 32)
          throw new Error('Use up to 32 named brand colors.')
        kit.colorSwatches = [...swatches, { ...color, name: data.name.trim() }]
        await save('brand_kits', kit)
      } else if (action === 'labelPrinterProfile') {
        const settings = state.settings[0],
          profiles = settings.printerProfilesByDevice?.[deviceKey] || []
        let next
        if (data.operation === 'forget')
          next = profiles.filter((p: any) => p.id !== data.profileId)
        else {
          const profile = validatePrinterProfile({
            ...data.profile,
            id: data.profile?.id || randomUUID(),
          })
          if (
            profiles.length >= 16 &&
            !profiles.some((p: any) => p.id === profile.id)
          )
            throw new Error('Use up to 16 profiles per device.')
          next = [
            ...profiles
              .filter((p: any) => p.id !== profile.id)
              .map((p: any) =>
                profile.preferred ? { ...p, preferred: false } : p,
              ),
            profile,
          ]
        }
        settings.printerProfilesByDevice = {
          ...(settings.printerProfilesByDevice || {}),
          [deviceKey]: next,
        }
        await save('settings', settings)
      } else if (action === 'labelFontPreferences') {
        const valid = (list: unknown, max: number) => {
          if (
            !Array.isArray(list) ||
            list.length > max ||
            list.some(
              (n) =>
                typeof n !== 'string' ||
                ![...labelFonts, ...customFonts].some((f) => f.name === n),
            )
          )
            throw new Error('Choose supported fonts.')
          return [...new Set(list)]
        }
        const settings = state.settings[0]
        settings.labelFontPreferences = {
          ...settings.labelFontPreferences,
          [user?.id || 'demo']: {
            favorites: valid(data.favorites, 2000),
            recent: valid(data.recent, 16),
          },
        }
        await save('settings', settings)
      } else if (action === 'labelDraft') {
        const expectedScope = createHash('sha256')
          .update(org + ':' + user.id)
          .digest('hex')
        if (data.expectedScope !== expectedScope)
          throw new Error(
            'The oven or account changed. Export your label before reopening the correct oven.',
          )
        if (
          !/^[a-f0-9-]{36}$/i.test(data.id || '') ||
          !/^[a-f0-9-]{36}$/i.test(data.sessionId || '') ||
          !Number.isSafeInteger(data.sequence) ||
          data.sequence < 0 ||
          !data.document ||
          typeof data.document.id !== 'string' ||
          !data.document.id ||
          data.document.id.length > 100 ||
          !Array.isArray(data.document.elements) ||
          data.document.elements.length > 100 ||
          JSON.stringify(data).length > 1_000_000
        )
          throw new Error(
            'The recovery checkpoint is invalid or too large. Export the editable recovery file.',
          )
        // Drafts intentionally accept unfinished text/font settings. Never delete history.
        const saved = state.label_templates.find(
          (t) => t.id === data.document.id,
        )
        if (!saved || saved.workflowVersion !== 1)
          throw new Error(
            'Save this label before preserving recovery checkpoints.',
          )
        if (saved?.deletedAt)
          throw new Error(
            'This design was deleted. Recover edits as a new copy.',
          )
        const draft = {
          id: data.id,
          name: String(data.document.name || 'Untitled label').slice(0, 100),
          document: data.document,
          sessionId: data.sessionId,
          sequence: data.sequence,
          baseRevision: Number(data.baseRevision) || 0,
          source: data.source,
          displayUnit: data.displayUnit,
          savedAt: new Date().toISOString(),
          ...(saved?.lastSaveSessionId === data.sessionId &&
          saved?.lastSaveSequence >= data.sequence
            ? { resolvedAt: new Date().toISOString() }
            : {}),
        }
        await client.query(
          'INSERT INTO label_recovery_drafts(id,business_id,identity_id,label_id,data) VALUES($1,$2,$3,$4,$5) ON CONFLICT(business_id,id) DO NOTHING',
          [draft.id, org, user.id, data.document.id, JSON.stringify(draft)],
        )
      } else if (action === 'labelSave') {
        labelStage = 'validation'
        if (
          data.expectedScope &&
          data.expectedScope !==
            createHash('sha256')
              .update(org + ':' + user.id)
              .digest('hex')
        )
          throw new Error(
            'The oven or account changed. Export your label before reopening the correct oven.',
          )
        const document = validateLabelDocument(data.document, customFonts)
        if (
          !document.id ||
          document.id.startsWith('system-') ||
          document.id.length > 100
        )
          throw new Error('Duplicate the system template before editing.')
        for (const element of labelSides(document).flatMap(
          (side) => labelSide(document, side).elements,
        ))
          if (
            element.type === 'image' &&
            !imageBindings.includes(element.binding || '') &&
            !libraryArtwork(element.assetId || '') &&
            !state.graphic_assets.some((a) => a.id === element.assetId)
          )
            throw new Error('An image does not belong to this business.')
        const previous = state.label_templates.find((t) => t.id === document.id)
        if (previous && previous.workflowVersion !== 1)
          throw new Error(
            'This existing design is preserved pending conversion review. Duplicate it to edit independently.',
          )
        validateSavedLabelContext(state, document)
        if (previous?.deletedAt || document.deletedAt)
          throw new Error(
            'This design was deleted. Save your edits as a new copy.',
          )
        if (
          document.recordKind !== undefined &&
          !['label', 'template'].includes(document.recordKind)
        )
          throw new Error('Choose a valid design type.')
        if (
          previous &&
          labelRecordKind(previous as LabelDocument) !==
            labelRecordKind(document)
        )
          throw new Error(
            'Save a separate copy to change between labels and templates.',
          )
        if (
          labelRecordKind(document) === 'template' &&
          state.label_templates.some(
            (t) =>
              !t.deletedAt &&
              t.id !== document.id &&
              labelRecordKind(t as LabelDocument) === 'template' &&
              templateNameKey(t.name) === templateNameKey(document.name),
          )
        )
          throw new Error(
            'A template with this name already exists. Rename it or explicitly update the existing template.',
          )
        if (
          document.sourceTemplateId &&
          !systemLabelTemplates.some(
            (t) => t.id === document.sourceTemplateId,
          ) &&
          !state.label_templates.some(
            (t) =>
              t.id === document.sourceTemplateId &&
              labelRecordKind(t as LabelDocument) === 'template',
          )
        )
          throw new Error('The source template does not belong to this oven.')
        const operationId = data.operationId || randomUUID()
        if (!/^[a-f0-9-]{36}$/i.test(operationId))
          throw new Error('Invalid label save reference.')
        const requestHash = createHash('sha256')
          .update(labelContent(document))
          .digest('hex')
        const replay = previous?.lastSaveOperationId === operationId
        if (replay && previous?.lastSaveHash !== requestHash)
          throw new Error(
            'This save reference belongs to different edits. Export your recovery file before retrying.',
          )
        if (
          !replay &&
          Number(data.expectedRevision || 0) !== Number(previous?.revision || 0)
        )
          throw new Error(
            'This label changed elsewhere. Your edits remain open. Export a recovery file or save a copy; reopen the newer label before updating it.',
          )
        if (!replay) {
          document.revision = Number(previous?.revision || 0) + 1
          Object.assign(document, {
            lastSaveOperationId: operationId,
            lastSaveHash: requestHash,
            lastSaveSessionId: data.sessionId,
            lastSaveSequence: data.sequence,
            savedAt: new Date().toISOString(),
          })
          labelStage = 'write'
          await save('label_templates', document)
          await client.query(
            'DELETE FROM label_elements WHERE business_id=$1 AND template_id=$2',
            [org, document.id],
          )
          for (const side of labelSides(document))
            for (const [zIndex, e] of labelSide(
              document,
              side,
            ).elements.entries())
              await save('label_elements', {
                ...e,
                id: document.id + (side === 'back' ? '-back-' : '-') + e.id,
                side,
                name: e.binding || e.type,
                templateId: document.id,
                zIndex,
              })
          await save('label_versions', {
            id: randomUUID(),
            name: document.name,
            templateId: document.id,
            revision: document.revision,
            document: structuredClone(document),
            savedAt: new Date().toISOString(),
          })
        }
        if (
          /^[a-f0-9-]{36}$/i.test(data.sessionId || '') &&
          Number.isSafeInteger(data.sequence)
        )
          await client.query(
            "UPDATE label_recovery_drafts SET data=jsonb_set(data,'{resolvedAt}',to_jsonb(NOW()::text)) WHERE business_id=$1 AND identity_id=$2 AND label_id=$3 AND data->>'sessionId'=$4 AND (data->>'sequence')::bigint <= $5",
            [org, user.id, document.id, data.sessionId, data.sequence],
          )
      } else if (action === 'labelDelete') {
        if (
          data.expectedScope &&
          data.expectedScope !==
            createHash('sha256')
              .update(org + ':' + user.id)
              .digest('hex')
        )
          throw new Error(
            'The oven or account changed. Reopen the correct oven.',
          )
        if (
          !['label', 'template'].includes(data.recordKind) ||
          !Array.isArray(data.ids) ||
          !data.ids.length ||
          data.ids.length >
            state.label_templates.length + systemLabelTemplates.length ||
          data.ids.some(
            (id: unknown) => typeof id !== 'string' || !id || id.length > 100,
          ) ||
          new Set(data.ids).size !== data.ids.length
        )
          throw new Error('Select the saved labels or templates to delete.')
        // Keep tombstones and history so stale saves cannot recreate deleted records.
        // No graphics, fonts, print history, or source templates are removed.
        const targets = data.ids.map(
          (id: string) =>
            state.label_templates.find((t) => t.id === id) ||
            systemLabelTemplates.find((t) => t.id === id),
        )
        if (
          targets.some(
            (t: Item | undefined) =>
              !t || labelRecordKind(t as LabelDocument) !== data.recordKind,
          )
        )
          throw new Error(
            'A selected design is unavailable or has a different type. Refresh and select again.',
          )
        if (targets.some((t: Item) => t.workflowVersion !== 1))
          throw new Error(
            'Existing designs are preserved pending conversion review. No original was deleted.',
          )
        const affected = state.products.filter((p) =>
          targets.some((t: Item) => t.id === p.labelDesignId),
        )
        if (affected.length)
          throw new Error(
            `Resolve label assignments before deletion: ${affected
              .map((p) => p.name)
              .join(', ')
              .slice(0, 1000)}`,
          )
        for (const target of targets) {
          if (!target.deletedAt)
            await save('label_templates', {
              ...target,
              // Built-in designs are immutable code assets. Only this tenant's
              // removal marker is saved; no shared template or child is deleted.
              recordKind: data.recordKind,
              deletedAt: new Date().toISOString(),
              revision: Number(target.revision || 0) + 1,
            })
          await client.query(
            "UPDATE label_recovery_drafts SET data=jsonb_set(data,'{resolvedAt}',to_jsonb(NOW()::text)) WHERE business_id=$1 AND label_id=$2 AND data->>'resolvedAt' IS NULL",
            [org, target.id],
          )
        }
        await audit(
          `${targets.length} ${data.recordKind === 'template' ? 'templates' : 'labels'} deleted`,
          targets
            .map((t: Item) => t.name)
            .join(', ')
            .slice(0, 2000),
        )
      } else if (action === 'labelBrand') {
        if (
          typeof data.name !== 'string' ||
          !data.name.trim() ||
          data.name.length > 100
        )
          throw new Error('Give the brand kit a name.')
        if (
          !Array.isArray(data.colors) ||
          data.colors.length > 12 ||
          data.colors.some((c: any) => !/^#[0-9a-f]{6}$/i.test(c))
        )
          throw new Error('Choose valid brand colors.')
        for (const key of [
          'primaryLogoAssetId',
          'secondaryLogoAssetId',
          'markAssetId',
        ])
          if (
            data[key] &&
            !state.graphic_assets.some((a) => a.id === data[key])
          )
            throw new Error('Choose a logo from this business.')
        for (const key of [
          'headingFont',
          'secondaryHeadingFont',
          'bodyFont',
          'complianceFont',
          'accentFont',
        ])
          if (
            data[key] &&
            ![...labelFonts, ...customFonts].some((f) => f.name === data[key])
          )
            throw new Error('Choose a supported brand font.')
        if (
          data.contact &&
          (typeof data.contact !== 'object' ||
            Array.isArray(data.contact) ||
            Object.values(data.contact).some(
              (v) => typeof v !== 'string' || v.length > 2000,
            ))
        )
          throw new Error('Use plain text for business contact information.')
        const existingKit = state.brand_kits.find((kit) => kit.id === data.id)
        // Named swatches are edited through the validated color action.
        await save('brand_kits', {
          ...data,
          colorSwatches: existingKit?.colorSwatches || [],
          id: data.id || randomUUID(),
          name: data.name.slice(0, 100),
        })
        await audit('Brand kit saved', data.name)
      } else if (action === 'labelPrint') {
        const template = state.label_templates.find(
          (t) => t.id === data.templateId,
        )
        if (!template || template.deletedAt)
          throw new Error('Save an available label before printing.')
        assertSavedLabelOutput(
          template as LabelDocument,
          data.source,
          data.brandId,
        )
        const source = data.source
        if (
          !source ||
          !['product', 'ingredient', 'batch'].includes(source.kind)
        )
          throw new Error('Choose a valid data source.')
        const collection =
          source.kind === 'product'
            ? state.products
            : source.kind === 'batch'
              ? state.batches
              : state.ingredients
        if (!collection.some((r) => r.id === source.id))
          throw new Error('Choose a source in this business.')
        if (
          source.productId &&
          !state.products.some((p) => p.id === source.productId)
        )
          throw new Error('Product is unavailable.')
        const copies = number(data.copies, 'Label copies', 1)
        if (!Number.isInteger(copies) || copies > 200)
          throw new Error('Print between 1 and 200 copies.')
        const document = validateLabelDocument(template, customFonts)
        const plan =
          document.format === 'front-back'
            ? labelSetPlan(document, copies, data.parts, data.order)
            : null
        const selectedRun = plan?.runs[data.runIndex || 0]
        if (plan && !selectedRun) throw new Error('Choose a valid print run.')
        validateSheet(
          selectedRun?.document || document,
          data.layout || defaultSheet,
        )
        const brand = state.brand_kits.find((b) => b.id === data.brandId),
          snapshot = resolveLabelData(state, source, brand)
        validateLabelRunContent(
          document,
          snapshot,
          selectedRun?.sequence || ['front'],
        )
        await save('label_print_jobs', {
          id: randomUUID(),
          name: template.name,
          templateId: template.id,
          productId: source.kind === 'product' ? source.id : source.productId,
          batchId: source.kind === 'batch' ? source.id : undefined,
          outputType: ['pdf', 'png', 'print'].includes(data.outputType)
            ? data.outputType
            : 'pdf',
          copies,
          renderedDataSnapshot: snapshot,
          documentSnapshot: structuredClone(document),
          sequence: selectedRun?.sequence,
          parts: data.parts || 'both',
          order: data.order || 'grouped',
          runIndex: data.runIndex || 0,
          layout: data.layout,
          createdAt: new Date().toISOString(),
          status: 'prepared',
        })
      } else if (action === 'save') {
        if (
          ![
            'ingredients',
            'recipes',
            'products',
            'batches',
            'sales',
            'expenses',
            'vendors',
            'orders',
            'settings',
          ].includes(table)
        )
          throw new Error('This record cannot be edited directly.')
        const item: Item = {
          ...data,
          id: data.id || randomUUID(),
          name: String(data.name || '').trim(),
        }
        if (!item.name) throw new Error('A name is required.')
        if (table === 'settings' && item.timezone) {
          try {
            new Intl.DateTimeFormat('en', { timeZone: item.timezone })
          } catch {
            throw new Error(
              'Choose a valid IANA timezone, such as America/Chicago.',
            )
          }
        }
        if (table === 'products') {
          for (const key of ['labelMainName', 'labelProductType'])
            if (
              item[key] !== undefined &&
              (typeof item[key] !== 'string' || item[key].length > 200)
            )
              throw new Error(
                'Label name parts must be text of up to 200 characters.',
              )
        }
        if (table === 'ingredients') {
          const existing = state.ingredients.find((i) => i.id === item.id)
          const fingerprint = createHash('sha256')
            .update(JSON.stringify(data))
            .digest('hex')
          if (
            existing &&
            data.creationRequestId &&
            existing.creationRequestId === data.creationRequestId &&
            existing.creationFingerprint === fingerprint
          ) {
            await client.query('COMMIT')
            return Response.json(
              { workspace: workspaceForDevice(state), role, demo: !user },
              { headers: { 'Cache-Control': 'no-store' } },
            )
          }
          if (existing)
            throw new Error(
              `This ${isPackaging(item) ? 'packaging' : 'ingredient'} already exists. Reopen it before changing values; no duplicate was created.`,
            )
          ingredientSaveStage = 'validation'
          if (item.receivedDate) validateDate(item.receivedDate)
          if (item.purchaseDate) validateDate(item.purchaseDate)
          if (item.categoryId)
            Object.assign(
              item,
              selectPantryCategory(item, String(item.categoryId), true),
            )
          const errors = ingredientCreateErrors(item)
          if (Object.keys(errors).length)
            throw new Error(Object.values(errors).join(' '))
          Object.assign(item, ingredientVendor(item, state.vendors))
          if (
            item.imageAssetId &&
            !state.graphic_assets.some((a) => a.id === item.imageAssetId)
          )
            throw new Error(
              'Choose a photo from this oven, or remove the photo and save without it.',
            )
          if (data.creationRequestId) item.creationFingerprint = fingerprint
          item.purchaseQuantity = number(
            item.purchaseQuantity,
            'Purchase quantity',
            0.000001,
          )
          item.packagePrice = number(item.packagePrice, 'Package price')
          item.barcode = item.barcode ? barcodeText(item.barcode) : ''
          if (item.barcodeFormat && !scanFormats.includes(item.barcodeFormat))
            throw new Error('Unsupported barcode format.')
          item.currency = String(item.currency || 'USD').toUpperCase()
          if (item.currency !== (state.settings[0]?.currency || 'USD'))
            throw new Error(
              'Use the oven costing currency; currency conversion is not configured.',
            )
          for (const key of ['includesTax', 'includesShipping'])
            item[key] = typeof item[key] === 'boolean' ? item[key] : null
          item.storageUnit = item.unit
          item.unit = baseUnit(item.storageUnit, item.conversions)
          item.quantity = convert(
            item.purchaseQuantity,
            item.purchaseUnit,
            item.unit,
            item.conversions,
          )
          const receiptPrice = item.packagePrice
          if (item.productCheckedAt) {
            const packages = number(
              item.receivedPackages,
              'Packages actually received',
              0.000001,
            )
            item.quantity *= packages
            item.packagePrice = receiptPrice / packages
          }
          item.receivedPurchaseCost = receiptPrice
          item.cost = receiptPrice / item.quantity
          item.currentCost = item.cost
          item.threshold = convert(
            number(item.threshold || 0, 'Reorder level'),
            item.storageUnit,
            item.unit,
            item.conversions,
          )
          item.threshold = number(item.threshold || 0, 'Reorder level')
          item.allergens = (
            Array.isArray(item.allergens) ? item.allergens : []
          ).filter((a: string) => allergens.includes(a))
          item.reviewed = item.reviewed === true
          ingredientSaveStage = 'database_write'
          await save('ingredients', item)
          await save('ledger', {
            id: randomUUID(),
            name: `${item.name} received`,
            ingredientId: item.id,
            quantity: item.quantity,
            unit: item.unit,
            amount: item.receivedPurchaseCost,
            receivedPackages: item.receivedPackages,
            date: item.receivedDate || today,
            receivedDate: item.receivedDate || today,
            purchaseDate: item.purchaseDate || '',
            type: 'purchase_receipt',
            reason: 'Initial purchase',
            purchaseQuantity: item.purchaseQuantity,
            purchaseUnit: item.purchaseUnit,
            packagePrice: item.packagePrice,
            normalizedQuantity: item.quantity,
            normalizedUnit: item.unit,
            vendor: item.vendor,
          })
        }
        if (table === 'ingredients' && item.receivedPurchaseCost > 0)
          await save('journals', {
            id: randomUUID(),
            name: 'Inventory purchase: ' + item.name,
            date: item.purchaseDate || item.receivedDate || today,
            sourceId: item.id,
            status: 'posted',
            lines: [
              {
                account: 'Inventory asset',
                debit: roundMoney(item.receivedPurchaseCost),
                credit: 0,
              },
              {
                account: 'Cash',
                debit: 0,
                credit: roundMoney(item.receivedPurchaseCost),
              },
            ],
          })
        if (table === 'recipes') {
          const existingPrep = state.ingredients.find(
            (i) => i.compoundRecipeId === item.id,
          )
          if (existingPrep && existingPrep.unit !== item.yieldUnit)
            throw new Error(
              'A recipe supplying prepared stock must retain its yield unit. An explicit stock migration is required.',
            )
          if (existingPrep && item.compound === false)
            throw new Error(
              'This recipe supplies prepared stock. Keep compound prep enabled to preserve its production link.',
            )
          if (existingPrep) item.compound = true
          if (
            (item.lines || []).some(
              (l: Item) =>
                state.ingredients.find((i) => i.id === l.ingredientId)
                  ?.usedAs === 'material',
            )
          )
            throw new Error(
              'Craft materials belong in a handmade design, not a food recipe.',
            )
          if (
            item.compound &&
            (!Object.hasOwn(units, item.yieldUnit) ||
              units[item.yieldUnit].factor <= 0)
          )
            throw new Error(
              'Compound prep yields must use a normalized pantry unit.',
            )
          item.yield = number(item.yield, 'Yield', 0.000001)
          item.laborMinutes = number(item.laborMinutes || 0, 'Labor')
          item.laborRate = number(item.laborRate ?? 18, 'Labor rate')
          item.overhead = number(item.overhead || 0, 'Overhead')
          if (!item.lines?.length && !item.baseRecipeId)
            throw new Error('Add at least one ingredient.')
          if (
            new Set(item.lines.map((l: any) => l.ingredientId)).size !==
            item.lines.length
          )
            throw new Error('Combine duplicate ingredient lines before saving.')
          for (const l of item.lines)
            l.quantity = number(l.quantity, 'Ingredient quantity', 0.000001)
          const componentStocks = validateRecipeComponents(item, state)
          for (const stock of componentStocks) {
            const source = state.recipes.find(
              (r) => r.id === stock.compoundRecipeId,
            )!
            if (!source.compound) {
              source.compound = true
              await save('recipes', source)
            }
            await save('ingredients', stock)
            const at = state.ingredients.findIndex((i) => i.id === stock.id)
            if (at < 0) state.ingredients.push(stock)
            else state.ingredients[at] = stock
          }
          costBreakdown(item, state.ingredients, {
            recipes: [...state.recipes.filter((r) => r.id !== item.id), item],
          })
        }
        if (table === 'products') {
          const previous = state.products.find((p) => p.id === item.id)
          item.quantity = previous?.quantity || 0
          item.cost = previous?.cost || 0
          delete item.stockCostKnown
          const category = (state.settings[0].productCategories || []).find(
            (c: any) => c.id === item.productCategoryId,
          )
          if (
            item.productCategoryId &&
            (!category || category.active === false) &&
            item.productCategoryId !== previous?.productCategoryId
          )
            throw new Error('Select an active product category from this oven.')
          // Existing products retain every saved assignment until a separately reviewed migration.
          if (previous) {
            for (const key of [
              'taxSource',
              'taxStatus',
              'taxRateIds',
              'taxAssignments',
            ])
              item[key] = previous[key]
          } else if (item.taxSource === 'category' || item.productCategoryId) {
            item.taxSource = 'category'
            delete item.taxStatus
            delete item.taxRateIds
            delete item.taxAssignments
          }
        }
        if (table === 'products') {
          applyProductTemplateDraft(
            state,
            item,
            state.products.find((p) => p.id === item.id),
          )
          if (item.labelArtworkVersion !== 2)
            item.graphicAssetId = item.graphicAssetId || item.iconAssetId || ''
          item.labelArtworkVersion = 2
          for (const key of ['imageAssetId', 'graphicAssetId', 'iconAssetId'])
            if (
              item[key] &&
              !state.graphic_assets.some((a) => a.id === item[key]) &&
              !(key === 'graphicAssetId' && libraryArtwork(item[key]))
            )
              throw new Error('Choose product artwork from this oven.')
          productCosting(item, state)
          if (!packagingLines(item).length && item.unpacked !== true)
            throw new Error(
              'Add product packaging or confirm it is sold unpackaged.',
            )
          if (
            item.taxRateIds &&
            (!Array.isArray(item.taxRateIds) ||
              item.taxRateIds.some(
                (id: string) => !configuredRates.some((r: any) => r.id === id),
              ))
          )
            throw new Error('Choose tax rates from this business.')
          if (
            item.priceTaxMode &&
            !['before', 'includes', 'configured'].includes(item.priceTaxMode)
          )
            throw new Error('Choose a valid price tax behavior.')
          if (
            item.taxStatus &&
            !['taxable', 'exempt', 'zero_rated'].includes(item.taxStatus)
          )
            throw new Error('Choose a valid tax status.')
          if (
            item.targetFoodCost !== undefined &&
            number(item.targetFoodCost, 'Target food cost') > 100
          )
            throw new Error('Target food cost must not exceed 100%.')
          if (!state.recipes.find((r) => r.id === item.recipeId))
            throw new Error('Choose a recipe.')
          item.price = number(item.price, 'Retail price')
          if (
            item.taxSource !== 'category' ||
            !categoryTaxState(item, state.settings[0]).issue
          )
            calculateTax(item.price, applicableTaxes(item, state.settings[0]))
          item.wholesale = number(item.wholesale || 0, 'Wholesale price')
          item.targetMargin = number(item.targetMargin ?? 65, 'Target margin')
          if (item.targetMargin >= 100)
            throw new Error('Target margin must be below 100%.')
          item.packagingQuantity = number(
            item.packagingQuantity || 1,
            'Packaging quantity',
            0.000001,
          )
          item.unitsPerPackage = number(
            item.unitsPerPackage,
            'Units per package',
            0.000001,
          )
        }
        if (table === 'batches') {
          if (
            state.batches.some(
              (b) => b.id === item.id && b.status === 'completed',
            )
          )
            throw new Error('Completed batches are immutable. Use Make again.')
          if (data.status === 'completed')
            throw new Error('Use Complete batch to consume stock.')
          if (!state.recipes.find((r) => r.id === item.recipeId))
            throw new Error('Choose a recipe.')
          item.count = number(item.count, 'Batch count', 0.000001)
          item.status = 'scheduled'
        }
        if (table === 'sales') {
          if (
            state.products.some(
              (p) => p.id === item.productId && tracksFinishedStock(p),
            ) &&
            !data.id
          )
            throw new Error(
              'A stable sale ID is required for tracked finished goods.',
            )
          await recordSale(item)
        }
        if (table === 'expenses' || table === 'orders')
          item.amount = number(item.amount, 'Amount', 0.01)
        if (table === 'expenses') {
          if (state.expenses.some((e) => e.id === item.id))
            throw new Error(
              'Posted expenses cannot be edited. Use a correction with an audit trail.',
            )
          item.inventory = item.inventory === true
          item.status = 'posted'
          item.transactionId = item.id
          await save('finance_transactions', {
            ...item,
            kind: 'expense',
            paid: 0,
          })
          await save('journals', {
            id: randomUUID(),
            name: 'Expense: ' + item.name,
            date: item.date || today,
            sourceId: item.id,
            status: 'posted',
            lines: [
              {
                account: item.inventory
                  ? 'Inventory asset'
                  : item.category || 'Miscellaneous expense',
                debit: roundMoney(item.amount),
                credit: 0,
              },
              { account: 'Cash', debit: 0, credit: roundMoney(item.amount) },
            ],
          })
        }
        if (table === 'settings') {
          if (
            item.logoAssetId &&
            !state.graphic_assets.some((a) => a.id === item.logoAssetId)
          )
            throw new Error('Choose a business logo from this oven.')
          item.labelFontPreferences =
            state.settings[0]?.labelFontPreferences || {}
          for (const key of [
            'pantryViewPreferences',
            'pantryNavigationPreferences',
            'priceSearchCaches',
            'priceSearchRequests',
            'priceSearchConnection',
            'assistantRequests',
            'assistantConnections',
            'printerProfilesByDevice',
            'shelfMediaProfilesByDevice',
            'labelColorPreferences',
            'directSignedJobs',
            'printerTestJobs',
          ])
            item[key] = state.settings[0]?.[key]
          delete item.currentPrinterProfiles
          delete item.currentLabelColors
          delete item.currentFontPreferences
          item.pantrySortPreferences =
            state.settings[0]?.pantrySortPreferences || {}
          delete item.currentShelfMediaProfiles
          delete item.currentPantryView
          delete item.currentPantryNavigationExpanded
          delete item.currentPantrySort
          for (const key of [
            'productCategories',
            'categoryTaxMappings',
            'categoryConfigRevision',
          ])
            item[key] = state.settings[0]?.[key]
          if (item.taxRates) validateTaxRates(item.taxRates)
          if (item.defaultOverhead !== undefined)
            item.defaultOverhead = number(
              item.defaultOverhead,
              'Default overhead',
            )
          item.taxRate = number(item.taxRate || 0, 'Tax rate')
          item.laborRate = number(item.laborRate ?? 18, 'Labor rate')
          item.targetMargin = number(item.targetMargin ?? 65, 'Target margin')
          if (item.taxRate > 100 || item.targetMargin >= 100)
            throw new Error('Check tax and margin percentages.')
        }
        if (table === 'settings' && item.id !== 'business')
          throw new Error('Invalid business settings.')
        if (table !== 'sales') await save(table, item)
        if (table === 'recipes' && item.compound) {
          const prep = state.ingredients.find(
            (i) => i.compoundRecipeId === item.id,
          )
          if (prep && prep.unit !== item.yieldUnit)
            throw new Error(
              'A stocked compound prep must retain its yield unit. Create a new prep to change units.',
            )
          await save('ingredients', {
            ...prep,
            id: prep?.id || `prep-${item.id}`,
            name: item.name,
            quantity: prep?.quantity || 0,
            unit: item.yieldUnit,
            cost:
              prep?.cost ??
              recipeCost(item, state.ingredients, state.recipes) / item.yield,
            currentCost:
              recipeCost(item, state.ingredients, state.recipes) / item.yield,
            compoundRecipeId: item.id,
            usedAs: 'ingredient',
            category: prep?.category || 'Preps & fillings',
            threshold: prep?.threshold || 0,
            allergens: prep?.allergens || [],
            reviewed: prep?.reviewed || false,
          })
        }
        await audit(`${item.name} saved`, table)
      } else if (
        action === 'ingredientUpdate' ||
        action === 'ingredientOffer'
      ) {
        const existing = state.ingredients.find((i) => i.id === data.id)
        if (!existing)
          throw new Error(
            `${isPackaging(data) ? 'Packaging' : 'Ingredient'} is unavailable in this oven.`,
          )
        const opening =
          action === 'ingredientUpdate'
            ? openingStockEntry(existing, data.openingStock, state.ledger)
            : null
        const openingSaveFingerprint = opening
          ? createHash('sha256').update(JSON.stringify(data)).digest('hex')
          : undefined
        if (
          opening?.replay &&
          opening.previous.ingredientSaveFingerprint !== openingSaveFingerprint
        )
          throw new Error(
            'Opening stock was already recorded. Your changed details remain in this draft; reopen the ingredient to review the saved version before saving them.',
          )
        if (!opening?.replay) {
          if (data.expectedUpdatedAt !== existing.updatedAt)
            throw new Error(
              `This ${isPackaging(existing) ? 'packaging' : 'ingredient'} changed elsewhere. Reopen it before saving.`,
            )
          let updated: Item
          if (action === 'ingredientUpdate') {
            const input = { ...data }
            delete input.purchaseOffers
            delete input.openingStock
            updated = updateIngredient(existing, input, {
              hasStockHistory: ingredientHasStockHistory(existing, state),
            })
            if (opening && updated.unit !== existing.unit)
              throw new Error(
                'Save the new stock basis first, then reopen the ingredient to enter opening stock in its saved unit.',
              )
            if (
              (updated.usedAs || 'ingredient') !==
              (existing.usedAs || 'ingredient')
            )
              throw new Error(
                'Item Type is fixed for an existing item. Create a separate item instead of converting stock or history.',
              )
            Object.assign(
              updated,
              ingredientVendor(input, state.vendors, existing),
            )
            if (updated.currency !== (existing.currency || 'USD'))
              throw new Error(
                'Reference prices must use the existing costing currency; currency conversion is not configured.',
              )
            if (
              updated.imageAssetId &&
              !state.graphic_assets.some((a) => a.id === updated.imageAssetId)
            )
              throw new Error('Choose a photo from this oven.')
          } else {
            updated = {
              ...existing,
              purchaseOffers: [...(existing.purchaseOffers || [])],
            }
            const offers = updated.purchaseOffers as any[]
            const offer = offers.find((o) => o.id === data.offerId)
            if (data.operation === 'save') {
              const saved = validateOffer(
                existing,
                { ...data.offer, id: data.offer?.id || randomUUID() },
                state.vendors,
              )
              const index = offers.findIndex((o) => o.id === saved.id)
              if (index < 0 && offers.length >= 100)
                throw new Error('Use at most 100 offers per ingredient.')
              if (index < 0) offers.push(saved)
              else offers[index] = { ...offers[index], ...saved }
            } else {
              if (!offer) throw new Error('This store offer is unavailable.')
              if (data.operation === 'remove')
                updated.purchaseOffers = offers.filter((o) => o.id !== offer.id)
              else if (data.operation === 'preferred') {
                updated.purchaseOffers = offers.map((o) => ({
                  ...o,
                  preferred: o.id === offer.id,
                }))
                updated.referenceVendor =
                  existing.referenceVendor || existing.vendor || ''
                updated.vendor = offer.vendor
                updated.vendorId = offer.vendorId
              } else if (data.operation === 'reference') {
                if (
                  offer.source === 'connected_provider' &&
                  Date.now() -
                    Date.parse(offer.checkedAt || offer.priceCheckedAt) >
                    3600000
                )
                  throw new Error(
                    'Refresh and save a current web quote before using it as a reference.',
                  )
                if (data.confirmed !== true)
                  throw new Error('Review and confirm the new reference price.')
                if (offer.currency !== (existing.currency || 'USD'))
                  throw new Error(
                    'Reference prices must use the existing costing currency.',
                  )
                if (offer.offerExpiresAt && offer.offerExpiresAt < today)
                  throw new Error(
                    'This offer has expired. Check its price first.',
                  )
                packageCost(existing, offer)
                updated = updateIngredient(existing, {
                  ...offer,
                  id: existing.id,
                  name: existing.name,
                  vendor: existing.vendor,
                  notes: existing.notes,
                  threshold: convert(
                    existing.threshold || 0,
                    existing.unit,
                    existing.storageUnit || existing.unit,
                    existing.conversions,
                  ),
                  reorderQuantity: convert(
                    existing.reorderQuantity || 0,
                    existing.unit,
                    existing.storageUnit || existing.unit,
                    existing.conversions,
                  ),
                  reviewed: existing.reviewed,
                  allergens: existing.allergens,
                  brand: existing.brand,
                  subingredients: existing.subingredients,
                  barcode: existing.barcode,
                })
                updated.purchaseOffers = offers
                updated.referenceOfferId = offer.id
                updated.referenceVendor = offer.vendor
                if (
                  (offer.brand && offer.brand !== existing.brand) ||
                  offer.subingredients !==
                    String(existing.subingredients || '') ||
                  JSON.stringify(offer.allergens) !==
                    JSON.stringify(existing.allergens || [])
                ) {
                  updated.reviewed = false
                  updated.labelReviewReason =
                    'Reference package changed. Review supplier ingredients and allergens before using labels.'
                }
              } else throw new Error('Choose a supported offer action.')
            }
          }
          if (opening && !opening.replay) {
            validateDate(data.openingStock.date)
            // The owned business row is already locked for this transaction.
            // Keep quantity and value in the saved canonical inventory unit.
            updated.quantity = opening.item.quantity
            updated.cost = opening.item.cost
            updated.openingStockRecorded = true
            await save('ledger', {
              ...opening.ledger,
              ingredientSaveFingerprint: openingSaveFingerprint,
            })
            if (opening.journal) await save('journals', opening.journal)
          }
          await save('ingredients', updated)
          await audit(
            `${existing.name} updated`,
            action === 'ingredientUpdate'
              ? opening
                ? 'Opening stock already owned recorded once, with a matching ledger entry.'
                : 'Ingredient details/reference updated; stock and historical valuation preserved.'
              : `Store offer ${data.operation}; no purchase posted.`,
          )
        }
      } else if (action === 'pantryView') {
        if (!['cards', 'table'].includes(data.view))
          throw new Error('Choose Cards or Table.')
        const settings = state.settings[0]
        settings.pantryViewPreferences = {
          ...(settings.pantryViewPreferences || {}),
          [user?.id || 'demo']: data.view,
        }
        await save('settings', settings)
      } else if (action === 'pantrySort') {
        const settings = state.settings[0]
        settings.pantrySortPreferences = {
          ...(settings.pantrySortPreferences || {}),
          [user?.id || 'demo']: validPantrySort(data),
        }
        await save('settings', settings)
      } else if (action === 'appearance') {
        const businessSettings = state.settings[0]
        if (!businessSettings)
          throw new Error('Business settings are unavailable.')
        businessSettings.appearance = validateAppearance(data.appearance)
        await save('settings', businessSettings)
        await audit(
          'Oven appearance updated',
          `${businessSettings.appearance.theme} · ${businessSettings.appearance.mode}`,
        )
      } else if (action === 'unit') {
        const i = state.ingredients.find((i) => i.id === data.ingredientId)
        if (!i) throw new Error('Ingredient is unavailable.')
        const abbreviation = String(data.abbreviation || '').trim()
        if (
          !/^[a-zA-Z][a-zA-Z0-9_-]{0,19}$/.test(abbreviation) ||
          units[abbreviation]
        )
          throw new Error(
            'Use a unique custom unit abbreviation (up to 20 letters, digits, underscores or hyphens).',
          )
        const definition = {
          id: abbreviation,
          name: String(data.name || abbreviation),
          abbreviation,
          category: 'count',
          factor: number(data.factor, 'Each per custom unit', 0.000001),
          active: true,
          custom: true,
        }
        const existingUnit = state.units.find((u) => u.id === abbreviation)
        if (existingUnit && existingUnit.factor !== definition.factor)
          throw new Error(
            'This business unit already has a different count. Choose a new abbreviation.',
          )
        if (
          (i.conversions || []).some(
            (c: Item) => c.from === abbreviation || c.to === abbreviation,
          )
        )
          throw new Error(
            'This ingredient already has that custom unit. Review Unit Conversions.',
          )
        await save('units', definition)
        i.conversions = [
          ...(i.conversions || []),
          {
            from: abbreviation,
            to: 'each',
            amountFrom: 1,
            amountTo: definition.factor,
            verified: true,
            source: 'user_entered',
            unitDefinition: definition,
            createdAt: new Date().toISOString(),
          },
        ]
        await save('ingredients', i)
        await audit(
          `${i.name} custom unit saved`,
          `1 ${abbreviation} = ${definition.factor} each`,
        )
      } else if (action === 'conversion') {
        const i = state.ingredients.find((i) => i.id === data.ingredientId)
        if (!i) throw new Error('Ingredient is unavailable.')
        const c = {
          from: String(data.from),
          to: String(data.to),
          amountFrom: number(data.amountFrom, 'From amount', 0.000001),
          amountTo: number(data.amountTo, 'To amount', 0.000001),
          source: [
            'user_entered',
            'package_label',
            'verified_reference',
          ].includes(data.source)
            ? data.source
            : 'user_entered',
          verified: data.verified === true,
          notes: String(data.notes || ''),
          createdAt: new Date().toISOString(),
        }
        if (
          !ingredientUnits(i.conversions)[c.from] ||
          !ingredientUnits(i.conversions)[c.to] ||
          !c.verified
        )
          throw new Error('Review and verify the conversion before saving.')
        const primary = purchaseSetupView(i).setup.packageUnit
        const shelf = i.storageUnit || i.unit
        if (
          primary &&
          ((c.from === primary && c.to === shelf) ||
            (c.to === primary && c.from === shelf))
        )
          throw new Error(
            'Edit the primary package relationship in Details & Costing.',
          )
        // A retried identical request is a no-op; it never adds or rewrites an edge.
        const identical = (i.conversions || []).some(
          (saved: Item) =>
            saved.verified &&
            saved.from === c.from &&
            saved.to === c.to &&
            parseQuantity(saved.amountFrom) === c.amountFrom &&
            parseQuantity(saved.amountTo) === c.amountTo,
        )
        if (!identical) {
          const next = [...(i.conversions || []), c]
          validateConversions(next)
          i.conversions = next
        }
        await save('ingredients', i)
        await audit(
          `${i.name} conversion saved`,
          `${c.amountFrom} ${c.from} = ${c.amountTo} ${c.to}`,
        )
      } else if (action === 'refund') {
        const original = state.sales.find(
          (s) => s.id === data.id && !s.refundOf,
        )
        if (!original || state.sales.some((s) => s.refundOf === original.id))
          throw new Error('Sale is unavailable or already refunded.')
        const refund = {
          ...original,
          id: randomUUID(),
          name: `Refund: ${original.name}`,
          refundOf: original.id,
          date: today,
          amount: -original.amount,
          tax: -original.tax,
          quantity: -original.quantity,
          customerTotal: -roundMoney(original.amount + original.tax),
          historicalCogs: -(original.historicalCogs || 0),
          enteredAmount: -(original.enteredAmount ?? original.amount),
          fees: 0,
          taxSnapshot: (original.taxSnapshot || []).map((r: any) => ({
            ...r,
            taxableBase: -r.taxableBase,
            amount: -r.amount,
            exactAmount: -r.exactAmount,
          })),
        }
        await returnFinishedSale(stockContext(), original, refund, data.restock)
        await save('sales', refund)
        if (-refund.customerTotal > 0)
          await save('journals', {
            id: randomUUID(),
            name: refund.name,
            date: today,
            status: 'posted',
            sourceId: refund.id,
            lines: [
              { account: 'Sales revenue', debit: original.amount, credit: 0 },
              {
                account: 'Sales Tax Payable',
                debit: original.tax || 0,
                credit: 0,
              },
              { account: 'Cash', debit: 0, credit: -refund.customerTotal },
            ],
          })
        await audit(
          refund.name,
          'Full refund reversed sales revenue and related tax liability.',
        )
      } else if (action === 'receive' || action === 'adjust') {
        const operationId = data.operationId
        if (operationId && !/^[a-zA-Z0-9_-]{1,100}$/.test(operationId))
          throw new Error('Invalid stock operation ID.')
        const requestHash = createHash('sha256')
          .update(
            JSON.stringify([
              action,
              data.id,
              data.quantity,
              data.unit,
              data.price,
              data.type,
              data.reason,
              data.vendor,
              data.lot,
              data.expires,
              data.receivedDate,
              data.purchaseDate,
              data.productDetails,
              ...(action === 'adjust' &&
              (data.adjustmentMode !== undefined ||
                data.expectedInventoryRevision !== undefined)
                ? [data.adjustmentMode, data.expectedInventoryRevision]
                : []),
            ]),
          )
          .digest('hex')
        const previous =
          operationId &&
          state.ledger.find((l) => l.id === 'stock-' + operationId)
        if (previous) {
          if (previous.requestHash !== requestHash)
            throw new Error(
              'This operation ID was used for different values. Start a new stock entry.',
            )
        } else {
          const i = state.ingredients.find((i) => i.id === data.id)
          if (!i) throw new Error('Ingredient not found.')
          if (data.receivedDate) validateDate(data.receivedDate)
          if (data.purchaseDate) validateDate(data.purchaseDate)
          if (action === 'receive' && data.productDetails)
            Object.assign(
              i,
              reviewedProductMetadata(i, data.productDetails, state.vendors),
            )
          if (
            i.imageAssetId &&
            !state.graphic_assets.some((a) => a.id === i.imageAssetId)
          )
            throw new Error('Choose a photo from this oven.')
          let change: number
          let costChange: number
          let adjustment: ReturnType<typeof inventoryAdjustmentPlan> | undefined
          if (action === 'receive') {
            if (data.price === '' || data.price == null)
              throw new Error(
                'Confirm the price paid, including an explicit zero for a free receipt.',
              )
            const q = number(data.quantity, 'Purchase quantity', 0.000001)
            const price = number(data.price, 'Price')
            change = convert(q, data.unit, i.unit, i.conversions)
            costChange = price
            i.cost = (i.quantity * i.cost + price) / (i.quantity + change)
            i.currentCost = price / change
            i.needsCostSetup = false
            i.purchaseQuantity = q
            i.purchaseUnit = data.unit
            i.packagePrice = price
            i.lastPurchaseDate = data.purchaseDate || data.receivedDate || today
            i.referenceVendor = String(data.vendor || i.vendor || '')
            i.referenceOfferId = null
            if (data.expires) i.expires = data.expires
          } else {
            if (
              data.type &&
              !['adjustment', 'waste', 'spoilage'].includes(data.type)
            )
              throw new Error('Unsupported adjustment type.')
            if (!String(data.reason || '').trim())
              throw new Error('A reason is required.')
            if (
              (data.adjustmentMode === 'total' &&
                !data.expectedInventoryRevision) ||
              (data.adjustmentMode !== undefined &&
                data.unit !== (i.storageUnit || i.unit)) ||
              (data.expectedInventoryRevision &&
                data.expectedInventoryRevision !==
                  inventoryRevision(i, state.ledger))
            )
              throw new Error(
                'Stock or inventory units changed. Reopen the adjustment and review the balance before saving.',
              )
            if (
              data.adjustmentMode === 'total' &&
              data.type &&
              data.type !== 'adjustment'
            )
              throw new Error('Opening counts use the adjustment type.')
            adjustment = inventoryAdjustmentPlan(i, data)
            change = adjustment.change
            costChange = change * i.cost
          }
          if (i.quantity + change < 0)
            throw new Error(
              'Insufficient stock. Reduce the adjustment or receive stock first.',
            )
          i.quantity = adjustment
            ? adjustment.resultingQuantity
            : i.quantity + change
          await save('ingredients', i)
          await save('ledger', {
            id: operationId ? 'stock-' + operationId : randomUUID(),
            requestHash,
            name: i.name,
            ingredientId: i.id,
            quantity: change,
            unit: i.unit,
            amount: costChange,
            enteredQuantity: data.quantity,
            enteredUnit: data.unit || i.unit,
            ...(adjustment
              ? {
                  adjustmentMode: adjustment.mode,
                  inventoryQuantity: adjustment.inventoryQuantity,
                  inventoryUnit: adjustment.inventoryUnit,
                  previousInventoryQuantity:
                    adjustment.previousInventoryQuantity,
                  resultingInventoryQuantity:
                    adjustment.resultingInventoryQuantity,
                  previousQuantity: adjustment.previousQuantity,
                  resultingQuantity: adjustment.resultingQuantity,
                  normalizedQuantity: change,
                  normalizedUnit: i.unit,
                }
              : {}),
            purchasePrice: action === 'receive' ? data.price : undefined,
            date: data.receivedDate || today,
            receivedDate: data.receivedDate || today,
            purchaseDate: data.purchaseDate || '',
            type:
              action === 'receive'
                ? 'purchase_receipt'
                : data.type || 'adjustment',
            reason: data.reason || 'Stock received',
            vendor: data.vendor,
            lot: data.lot,
            expires: data.expires,
          })
          if (roundMoney(Math.abs(costChange)) > 0)
            await save('journals', {
              id: randomUUID(),
              name:
                (action === 'receive'
                  ? 'Inventory purchase: '
                  : 'Inventory adjustment: ') + i.name,
              sourceId: i.id,
              date: data.purchaseDate || data.receivedDate || today,
              status: 'posted',
              lines:
                costChange > 0
                  ? [
                      {
                        account: 'Inventory asset',
                        debit: roundMoney(costChange),
                        credit: 0,
                      },
                      {
                        account: action === 'receive' ? 'Cash' : 'Other income',
                        debit: 0,
                        credit: roundMoney(costChange),
                      },
                    ]
                  : [
                      {
                        account: 'Inventory shrink/waste COGS',
                        debit: roundMoney(-costChange),
                        credit: 0,
                      },
                      {
                        account: 'Inventory asset',
                        debit: 0,
                        credit: roundMoney(-costChange),
                      },
                    ],
            })
          await audit(
            `${i.name} ${action === 'receive' ? 'received' : 'adjusted'}`,
            `${change.toFixed(2)} ${i.unit} · ${data.reason || 'Purchase receipt'}`,
          )
        }
      } else if (action === 'complete') {
        if (managedBilling?.plan_id === 'free')
          assertFullFreeStockCoverage(state, data.id)
        const b = state.batches.find((b) => b.id === data.id)
        if (!b || b.status === 'completed')
          throw new Error('Batch is already completed or unavailable.')
        const r = state.recipes.find((r) => r.id === b.recipeId)!
        const count = number(b.count, 'Batch count', 0.000001)
        const yieldActual = number(data.actualYield, 'Actual yield', 0.000001)
        const usage = new Map<string, number>()
        const productionLines = recipeProductionLines(
          r,
          state.ingredients,
          state.recipes,
        )
        for (const line of productionLines) {
          const i = state.ingredients.find((i) => i.id === line.ingredientId)!
          const actual = data.usage?.[i.id] ?? line.quantity * count
          const q = convert(
            number(actual, 'Actual ingredient use'),
            line.unit,
            i.unit,
            i.conversions,
          )
          usage.set(i.id, (usage.get(i.id) || 0) + q)
        }
        const candidates = state.products.filter((p) => p.recipeId === r.id)
        const product =
          state.products.find(
            (p) => p.id === (data.productId || b.productId),
          ) || (candidates.length === 1 ? candidates[0] : undefined)
        if (candidates.length && !product)
          throw new Error('Choose the sellable product for this run.')
        if (product && product.recipeId !== r.id)
          throw new Error('Product must use this recipe.')
        b.productId = product?.id
        for (const line of product ? packagingLines(product) : []) {
          const i = state.ingredients.find(
            (i) => i.id === line.ingredientId && i.usedAs === 'packaging',
          )
          if (!i) throw new Error('Packaging item is unavailable.')
          if (i.trackInventory === false) continue
          const q =
            (convert(
              number(line.quantity, 'Packaging quantity'),
              line.unit || 'each',
              i.unit,
              i.conversions,
            ) *
              yieldActual) /
            product!.unitsPerPackage
          usage.set(i.id, (usage.get(i.id) || 0) + q)
        }
        const lockedUsage = []
        for (const [id, q] of usage) {
          const i = state.ingredients.find((i) => i.id === id)!
          if (i.quantity < q)
            throw new Error(
              `${i.name} is short by ${(q - i.quantity).toFixed(2)} ${i.unit}. Receive stock before completing.`,
            )
          const cost = q * i.cost
          lockedUsage.push({
            ingredientId: id,
            quantity: q,
            unit: i.unit,
            cost,
          })
          i.quantity -= q
          await save('ingredients', i)
          await save('ledger', {
            id: randomUUID(),
            name: i.name,
            ingredientId: id,
            quantity: -q,
            unit: i.unit,
            amount: -cost,
            date: today,
            type: 'batch_consumption',
            batchId: b.id,
            reason: `Completed ${b.name}`,
          })
        }
        b.wasteReason = String(data.wasteReason || '')
        if (Number(data.waste) > 0 && !b.wasteReason.trim())
          throw new Error('A waste reason is required.')
        b.status = 'completed'
        b.actualYield = yieldActual
        b.waste = number(data.waste || 0, 'Waste')
        b.laborMinutes = number(
          data.laborMinutes ?? r.laborMinutes * count,
          'Labor',
        )
        const actualRecipe = {
          ...r,
          // Snapshot the actual aggregated raw use, so overlapping inputs are
          // charged and deducted once and later base edits cannot rewrite it.
          baseRecipeId: undefined,
          baseRecipe: undefined,
          lines: productionLines.map((l: any) => ({
            ...l,
            quantity:
              number(
                data.usage?.[l.ingredientId] ?? l.quantity * count,
                'Actual usage',
              ) / count,
          })),
        }
        b.costSnapshot = costBreakdown(actualRecipe, state.ingredients, {
          multiplier: count,
          actualYield: yieldActual,
          product,
          laborMinutes: b.laborMinutes,
          wasteCost: data.wasteCost,
          historical: true,
          baseCostOverride: r.baseRecipeId
            ? costBreakdown(
                state.recipes.find((source) => source.id === r.baseRecipeId)!,
                state.ingredients,
                {
                  recipes: state.recipes,
                  reusableBase: true,
                  multiplier: count * r.baseMultiplier,
                  historical: true,
                },
              )
            : undefined,
        })
        b.recipeSnapshot = {
          recipeId: r.id,
          baseRecipeId: r.baseRecipeId,
          baseMultiplier: r.baseMultiplier,
          lines: effectiveRecipeLines(r, state.recipes),
        }
        b.historicalCost = b.costSnapshot.total
        b.usage = lockedUsage
        b.completedAt = new Date().toISOString()
        await save('batches', b)
        const prep = state.ingredients.find((i) => i.compoundRecipeId === r.id)
        if (prep) {
          const q = convert(
            yieldActual,
            r.yieldUnit,
            prep.unit,
            prep.conversions,
          )
          prep.cost =
            (prep.quantity * prep.cost + b.historicalCost) / (prep.quantity + q)
          prep.quantity += q
          await save('ingredients', prep)
          await save('ledger', {
            id: randomUUID(),
            name: prep.name,
            ingredientId: prep.id,
            quantity: q,
            unit: prep.unit,
            amount: b.historicalCost,
            date: today,
            type: 'production_receipt',
            batchId: b.id,
            reason: 'Completed compound prep',
          })
        }
        if (!prep) {
          const ingredientsUsed = roundMoney(
            lockedUsage
              .filter(
                (l) =>
                  state.ingredients.find((i) => i.id === l.ingredientId)
                    ?.usedAs !== 'packaging',
              )
              .reduce((a, l) => a + l.cost, 0),
          )
          const packagingUsed = roundMoney(
            lockedUsage
              .filter(
                (l) =>
                  state.ingredients.find((i) => i.id === l.ingredientId)
                    ?.usedAs === 'packaging',
              )
              .reduce((a, l) => a + l.cost, 0),
          )
          if (ingredientsUsed + packagingUsed > 0)
            await save('journals', {
              id: randomUUID(),
              name: 'Production costs: ' + b.name,
              sourceId: b.id,
              date: today,
              status: 'posted',
              lines: [
                {
                  account: 'Ingredient COGS',
                  debit: ingredientsUsed,
                  credit: 0,
                },
                { account: 'Packaging COGS', debit: packagingUsed, credit: 0 },
                {
                  account: 'Inventory asset',
                  debit: 0,
                  credit: roundMoney(ingredientsUsed + packagingUsed),
                },
              ],
            })
        }
        await audit(
          `${b.name} batch completed`,
          `${yieldActual} ${r.yieldUnit} · $${b.historicalCost.toFixed(2)} locked cost`,
        )
      } else if (action === 'import') {
        if (
          !['ingredients', 'recipes', 'products', 'sales', 'expenses'].includes(
            table,
          )
        )
          throw new Error('Unsupported import type.')
        if (
          !Array.isArray(data.rows) ||
          !data.rows.length ||
          data.rows.length > 500
        )
          throw new Error('Import between 1 and 500 rows.')
        if (!String(data.reason || '').trim())
          throw new Error('An import reason is required.')
        const importedIds = data.rows.map((row: any) => row.id).filter(Boolean)
        if (new Set(importedIds).size !== importedIds.length)
          throw new Error(
            'Duplicate record IDs in the import. Each row must be unique.',
          )
        for (const row of data.rows) {
          const item: Item = {
            ...row,
            id: row.id || randomUUID(),
            name: String(row.name || '').trim(),
          }
          if (!item.name) throw new Error('Every imported row needs a name.')
          if (table === 'ingredients') {
            if (!Object.hasOwn(units, item.unit))
              throw new Error('Unsupported inventory unit.')
            const existing = state.ingredients.find((i) => i.id === item.id)
            if (existing && existing.unit !== item.unit)
              throw new Error(
                'Change inventory units with a verified conversion, not a CSV import.',
              )
            item.quantity = number(item.quantity, 'Stock quantity')
            item.cost = number(item.cost, 'Unit cost')
            item.threshold = number(item.threshold || 0, 'Threshold')
            item.allergens = Array.isArray(item.allergens) ? item.allergens : []
            item.reviewed = item.reviewed === true
            item.usedAs = item.usedAs || 'ingredient'
            await save('ingredients', item)
            const delta = item.quantity - (existing?.quantity || 0)
            if (delta !== 0)
              await save('ledger', {
                id: randomUUID(),
                name: item.name,
                ingredientId: item.id,
                quantity: delta,
                unit: item.unit,
                amount: delta * item.cost,
                date: today,
                type: existing ? 'adjustment' : 'opening_balance',
                reason: data.reason,
              })
          } else if (table === 'recipes') {
            item.yield = number(item.yield, 'Yield', 0.000001)
            item.laborMinutes = number(item.laborMinutes || 0, 'Labor')
            item.laborRate = number(item.laborRate ?? 18, 'Labor rate')
            item.laborRate = number(item.laborRate ?? 18, 'Labor rate')
            item.overhead = number(item.overhead || 0, 'Overhead')
            if (!Array.isArray(item.lines) || !item.lines.length)
              throw new Error('Recipes need ingredient lines.')
            for (const l of item.lines)
              l.quantity = number(l.quantity, 'Ingredient quantity', 0.000001)
            recipeCost(item, state.ingredients, state.recipes)
            await save(table, item)
          } else if (table === 'products') {
            if (!state.recipes.find((r) => r.id === item.recipeId))
              throw new Error(
                'Imported product references an unavailable recipe.',
              )
            item.price = number(item.price, 'Retail price')
            item.wholesale = number(item.wholesale || 0, 'Wholesale price')
            item.targetMargin = number(item.targetMargin ?? 65, 'Target margin')
            if (item.targetMargin >= 100)
              throw new Error('Target margin must be below 100%.')
            item.packagingQuantity = number(
              item.packagingQuantity || 1,
              'Packaging quantity',
              0.000001,
            )
            item.wholesale = number(item.wholesale || 0, 'Wholesale price')
            item.unitsPerPackage = number(
              item.unitsPerPackage,
              'Units per package',
              0.000001,
            )
            productCosting(item, state)
            await save(table, item)
          } else if (table === 'sales') {
            const p = state.products.find((p) => p.id === item.productId)
            if (!p)
              throw new Error(
                'Imported sale references an unavailable product.',
              )
            await recordSale(item)
          } else {
            item.amount = number(item.amount, 'Expense amount', 0.01)
            item.inventory = item.inventory === true
            await save(table, item)
          }
        }
        await audit(`${data.rows.length} ${table} imported`, data.reason)
      } else if (action === 'postJournal') {
        const lines = data.lines || []
        if (lines.length < 2)
          throw new Error('At least two journal lines are required.')
        let debits = 0,
          credits = 0
        for (const l of lines) {
          const d = number(l.debit || 0, 'Debit'),
            c = number(l.credit || 0, 'Credit')
          if (d > 0 && c > 0)
            throw new Error('A line must be a debit or credit.')
          debits += Math.round(d * 100)
          credits += Math.round(c * 100)
        }
        if (debits !== credits || debits === 0)
          throw new Error('Debits and credits must balance.')
        await save('journals', {
          id: randomUUID(),
          name: data.name || 'Journal entry',
          date: today,
          status: 'posted',
          lines,
        })
        await audit(
          'Journal entry posted',
          data.name || 'Balanced journal entry',
        )
      } else throw new Error('Unknown action.')
    }
    if (saveTrace) ingredientSaveStage = 'workspace_reload'
    const result: Workspace = {}
    for (const table of tables) {
      const r = await client.query(
        ['ledger', 'receipt_extractions'].includes(table)
          ? `SELECT data, to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS added_at FROM ${table} WHERE business_id=$1 ORDER BY created_at,id`
          : `SELECT data FROM ${table} WHERE business_id=$1 ORDER BY created_at,id`,
        [org],
      )
      result[table] = r.rows.map((r: any) =>
        r.added_at ? { ...r.data, addedAt: r.added_at } : r.data,
      )
    }
    if (!metadataOnly) rollup(result)
    if (!metadataOnly)
      for (const i of result.ingredients.filter((i) => i.compoundRecipeId))
        await save('ingredients', i)
    if (result.settings[0]) {
      const photoGrant = await photoPilotGrant(client, org, user?.id)
      result.settings[0].packagePhotoExtractionAllowed =
        photoGrant?.enabled === true
      result.settings[0].packagePhotoProcessingReady =
        photoGrant?.processingEnabled === true &&
        photoGrant?.boundsVerified === true &&
        Date.now() < Date.parse(PHOTO_RATE.validUntil)
      result.settings[0].currentFontPreferences = result.settings[0]
        .labelFontPreferences?.[user?.id || 'demo'] || {
        favorites: [],
        recent: [],
      }
      delete result.settings[0].labelFontPreferences
      result.settings[0].currentPantrySort = validPantrySort(
        result.settings[0].pantrySortPreferences?.[user?.id || 'demo'],
      )
      delete result.settings[0].pantrySortPreferences
    }
    if (saveTrace) ingredientSaveStage = 'commit'
    const drafts = await client.query(
      "SELECT DISTINCT ON (label_id,data->>'sessionId') data FROM label_recovery_drafts WHERE business_id=$1 AND identity_id=$2 AND data->>'resolvedAt' IS NULL ORDER BY label_id,data->>'sessionId',(data->>'sequence')::bigint DESC,created_at DESC",
      [org, user.id],
    )
    result.label_recovery_drafts = drafts.rows.map(
      (r: { data: Item }) => r.data,
    )
    if (labelTrace) labelStage = 'commit'
    await client.query('COMMIT')
    if (labelTrace)
      console.info(
        JSON.stringify({
          area: 'label_save',
          traceId: labelTrace,
          result: 'committed',
          stage: 'commit',
        }),
      )
    if (saveTrace)
      console.info(
        JSON.stringify({
          area: 'ingredient_save',
          traceId: saveTrace,
          result: 'saved',
          stage: 'commit',
        }),
      )
    return Response.json(
      { workspace: workspaceForDevice(result), role, demo: !user },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    if (labelTrace)
      console.info(
        JSON.stringify({
          area: 'label_save',
          traceId: labelTrace,
          result: 'failed',
          stage: labelStage,
        }),
      )
    const databaseUnavailable =
      !client ||
      (error instanceof Error &&
        /relation .* does not exist|ECONNREFUSED|database .* does not exist/i.test(
          error.message,
        ))
    if (client) await client.query('ROLLBACK').catch(() => {})
    const importValidation =
      importTrace && error instanceof ZodError
        ? error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          }))
        : undefined
    const importDatabaseError =
      importTrace &&
      typeof (error as any)?.code === 'string' &&
      /^[0-9A-Z]{5}$/.test((error as any).code)
    if (importTrace)
      console.info(
        JSON.stringify({
          area: 'recipe_import',
          traceId: importTrace,
          result: 'failed',
          stage: databaseUnavailable ? 'database' : importStage,
          category: importValidation
            ? 'validation'
            : importDatabaseError
              ? 'database'
              : error instanceof SessionError
                ? 'session'
                : 'request',
        }),
      )
    if (saveTrace)
      console.info(
        JSON.stringify({
          area: 'ingredient_save',
          traceId: saveTrace,
          result: 'failed',
          stage: databaseUnavailable ? 'database' : ingredientSaveStage,
        }),
      )
    if (error instanceof ProductImportFailure) {
      error.diagnostics.requestId = context.requestId || randomUUID()
      console.info(
        JSON.stringify({
          area: 'product_import',
          requestId: error.diagnostics.requestId,
          at: error.diagnostics.requestedAt,
          source: error.diagnostics.source,
          status: error.diagnostics.hops.at(-1)?.status,
        }),
      )
    }
    return Response.json(
      {
        ...(error instanceof ProductImportFailure
          ? { diagnostics: error.diagnostics }
          : {}),
        ...(saveTrace ? { traceId: saveTrace } : {}),
        ...(importTrace ? { traceId: importTrace, stage: importStage } : {}),
        ...(importValidation ? { fields: importValidation } : {}),
        code:
          error instanceof LookupError
            ? error.code
            : error instanceof SessionError
              ? error.code
              : error instanceof RecipeImportError
                ? error.code
                : error instanceof ProductHumanVerificationError
                  ? error.code
                  : importValidation
                    ? 'IMPORT_DRAFT_INVALID'
                    : databaseUnavailable
                      ? 'WORKSPACE_SETUP_REQUIRED'
                      : new URL(req.url).searchParams.has('productImport')
                        ? 'PRODUCT_IMPORT_FAILED'
                        : 'WORKSPACE_REQUEST_FAILED',
        error: importValidation
          ? 'Some draft fields are invalid. Correct the listed fields and retry; your edits remain open.'
          : importDatabaseError
            ? 'The database could not save this import. Your edits remain open. Retry with the same draft and use the reference if the problem continues.'
            : databaseUnavailable
              ? 'The oven database is not ready. Complete database provisioning and migrations for this environment, then retry. No item changes were saved.'
              : error instanceof Error
                ? error.message
                : 'Unable to update oven.',
      },
      {
        status:
          error instanceof LookupError
            ? error.status
            : error instanceof SessionError
              ? error.status
              : error instanceof RecipeImportError
                ? error.status
                : databaseUnavailable
                  ? 503
                  : 400,
        headers: {
          'Cache-Control': 'no-store',
          ...(error instanceof ProductImportFailure && error.retryAfter
            ? { 'Retry-After': error.retryAfter }
            : {}),
        },
      },
    )
  } finally {
    client?.release()
  }
}
export const config = { path: '/api/workspace' }
