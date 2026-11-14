/** Ephemeral, allowlisted diagnostics. Never persist errors or inspect response bodies. */
declare const __APP_VERSION__: string
const appVersion =
  typeof __APP_VERSION__ === 'string' && /^[a-f0-9]{64}$/.test(__APP_VERSION__)
    ? __APP_VERSION__
    : 'unavailable'

const components = new Set([
  'WorkspaceApp',
  'WorkspacePage',
  'PantryInventory',
  'InventoryTools',
  'InventoryCounts',
  'FinishedInventory',
  'PantryPhoto',
  'ShelfLabels',
  'BarcodeScanner',
  'Dialog',
  'DialogContent',
  'RootDocument',
  'MatchInner',
  'CatchBoundary',
  'RouterProvider',
  'AddItemDialog',
  'IngredientDetail',
])
const sourceFiles = new Set([
  'workspace-app',
  'pantry-inventory',
  'inventory-tools',
  'inventory-counts',
  'finished-inventory',
  'pantry-photo',
  'shelf-labels',
  'barcode-scanner',
  'add-item-dialog',
  'ingredient-detail',
  'error-pages',
])
const assetPrefixes = new Set([
  'index',
  'oven',
  'workspace',
  '__root',
  ...sourceFiles,
])
const properties = new Set([
  'map',
  'filter',
  'find',
  'some',
  'reduce',
  'includes',
  'sort',
  'length',
  'toLowerCase',
  'localeCompare',
  'quantity',
  'unit',
  'storageUnit',
  'cost',
  'currentCost',
  'threshold',
  'conversions',
  'ingredients',
  'settings',
  'graphic_assets',
  'inventory_counts',
  'purchaseOffers',
  'name',
  'id',
])
const unitNames = new Set([
  'mg',
  'g',
  'kg',
  'oz',
  'lb',
  'ml',
  'l',
  'fl oz',
  'cup',
  'tbsp',
  'tsp',
  'pint',
  'quart',
  'gallon',
  'mm',
  'cm',
  'm',
  'in',
  'ft',
  'yd',
  'each',
  'dozen',
  'package',
  'case',
  'bag',
  'bottle',
  'jar',
  'can',
  'box',
  'pack',
  'bundle',
  'roll',
])
const staticMessages = new Set([
  'Choose a supported unit or define a custom count unit.',
  'Choose a supported unit.',
  'Conflicting verified conversions require review.',
  'Quantity must be at least 0.',
  'Conversion from quantity must be at least 0.000001.',
  'Conversion to quantity must be at least 0.000001.',
  'Maximum call stack size exceeded',
  'Failed to fetch',
])

export type InventoryErrorDetails = {
  appVersion: string
  timestamp: string
  pathname: string
  error: {
    type: string
    message: string
    stack: string
    componentStack: string
  }
  request?: {
    path: '/api/workspace'
    status: number | null
    message: string
    correlationId?: string
  }
}

export function inventoryErrorLocation(
  location: Pick<Location, 'pathname' | 'hash'> | undefined = typeof window ===
  'undefined'
    ? undefined
    : window.location,
) {
  if (
    !location ||
    !['/oven', '/workspace', '/studio'].includes(location.pathname)
  )
    return null
  const section = location.hash.split(/[/?]/)[0]
  return ['#Inventory', '#Pantry'].includes(section) ? location.pathname : null
}

function field(value: unknown, key: 'name' | 'message' | 'stack') {
  try {
    const entry =
      value && typeof value === 'object' ? (value as Error)[key] : ''
    return typeof entry === 'string' ? entry.slice(0, 20000) : ''
  } catch {
    return ''
  }
}

/** Unknown text is omitted, not regex-scrubbed: messages can contain item names or secrets. */
export function inventoryErrorMessage(message: string) {
  if (staticMessages.has(message)) return message
  const property =
    /^Cannot read properties of (undefined|null) \(reading ['"]([^'"]+)['"]\)$/.exec(
      message,
    )
  if (property)
    return `Cannot read properties of ${property[1]} (reading '${properties.has(property[2]) ? property[2] : '[redacted]'}')`
  const method = /\.([A-Za-z]+) is not a function$/.exec(message)
  if (method && properties.has(method[1]))
    return `${method[1]} is not a function (receiver redacted).`
  if (/ is not a function$/.test(message))
    return 'A value is not a function (name redacted).'
  if (/ is not (?:defined|an object|iterable)/.test(message))
    return 'A required value is missing or has an unexpected type (name redacted).'
  const conversion =
    /^A verified unit conversion from (.+) to (.+) is required\.$/.exec(message)
  if (conversion)
    return `A verified unit conversion from ${unitNames.has(conversion[1]) ? conversion[1] : '[unit redacted]'} to ${unitNames.has(conversion[2]) ? conversion[2] : '[unit redacted]'} is required.`
  const react = /^Minified React error #(\d{1,4});/.exec(message)
  if (react) return `Minified React error #${react[1]}.`
  if (/^Maximum update depth exceeded/.test(message))
    return 'Maximum update depth exceeded.'
  if (/^Rendered (?:fewer|more) hooks/.test(message))
    return 'Rendered an inconsistent number of hooks.'
  if (
    /^(?:Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module)/i.test(
      message,
    )
  )
    return 'Dynamic module loading failed (URL redacted).'
  if (/JSON|Unexpected token|Unexpected end of/.test(message))
    return 'A response or value could not be parsed (content redacted).'
  return 'Message redacted; application stack frames are included when available.'
}

/** Keep only known component names and same-origin application file/line locations. */
export function inventoryErrorStack(stack: string, origin: string) {
  return (
    stack
      .slice(0, 20000)
      .split('\n')
      .slice(0, 60)
      .flatMap((line) => {
        if (!/^\s*(?:at\s|[A-Za-z_$][\w.$]*@)/.test(line)) return []
        const name = /^\s*(?:at\s+)?([A-Za-z_$][\w.$]*)/.exec(line)?.[1]
        const component = name && components.has(name) ? name : '[frame]'
        const location =
          /((?:https?:\/\/|\/(?:assets|src)\/)[^\s)]+?):(\d{1,7}):(\d{1,7})(?:\)|\s|$)/.exec(
            line,
          )
        if (location) {
          try {
            const url = new URL(location[1], origin)
            if (url.origin !== origin)
              return components.has(component) ? [`at ${component}`] : []
            const asset = [...assetPrefixes].some((prefix) => {
              const start = `/assets/${prefix}-`
              return (
                url.pathname.startsWith(start) &&
                /^[A-Za-z0-9_-]{6,32}\.m?js$/.test(
                  url.pathname.slice(start.length),
                )
              )
            })
            const source = /^\/src\/components\/([a-z-]+)\.tsx$/.exec(
              url.pathname,
            )
            const core = [
              '/src/lib/domain.ts',
              '/src/lib/ingredients.ts',
              '/src/lib/fabric.ts',
              '/src/routes/oven.tsx',
              '/src/router.tsx',
            ].includes(url.pathname)
            if (asset || (source && sourceFiles.has(source[1])) || core)
              return [
                `at ${component} (${url.pathname}:${location[2]}:${location[3]})`,
              ]
          } catch {
            /* Malformed URLs never reach the report. */
          }
        }
        return components.has(component) ? [`at ${component}`] : []
      })
      .join('\n') || 'No allowlisted application frames available.'
  )
}

let failedRequest: {
  at: number
  pathname: string
  request: NonNullable<InventoryErrorDetails['request']>
} | null = null
let latestCaptured: InventoryErrorDetails | null = null
export const latestInventoryErrorDetails = () => latestCaptured
const captured = new WeakMap<object, InventoryErrorDetails>()
const listeners = new Set<() => void>()

export function createInventoryErrorDetails(
  error: unknown,
  componentStack = '',
): InventoryErrorDetails {
  const inventoryPath = inventoryErrorLocation()
  const pathname = inventoryPath || '/oven'
  const name = field(error, 'name')
  const type = [
    'Error',
    'TypeError',
    'ReferenceError',
    'RangeError',
    'SyntaxError',
    'URIError',
    'EvalError',
    'AbortError',
    'TimeoutError',
  ].includes(name)
    ? name
    : 'Error'
  const origin =
    typeof window === 'undefined'
      ? 'https://invalid.test'
      : window.location.origin
  return {
    appVersion,
    timestamp: new Date().toISOString(),
    pathname,
    error: {
      type,
      message: inventoryErrorMessage(field(error, 'message')),
      stack: inventoryErrorStack(field(error, 'stack'), origin),
      componentStack: inventoryErrorStack(componentStack, origin),
    },
    ...(inventoryPath &&
    failedRequest &&
    failedRequest.pathname === pathname &&
    Date.now() - failedRequest.at < 60000
      ? { request: { ...failedRequest.request } }
      : {}),
  }
}

export function captureInventoryError(
  error: unknown,
  info: { componentStack?: string | null },
) {
  if (!inventoryErrorLocation() || !error || typeof error !== 'object') return
  latestCaptured = createInventoryErrorDetails(error, info.componentStack || '')
  captured.set(error, latestCaptured)
  listeners.forEach((listener) => listener())
}
export const inventoryErrorSnapshot = (error: unknown) =>
  error && typeof error === 'object' ? captured.get(error) || null : null
export function subscribeInventoryErrors(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function requestFailure(response?: Response, unreadable = false) {
  const pathname = inventoryErrorLocation()
  if (!pathname) return
  // Only Netlify's random request ID header is read. Never inspect response JSON or headers wholesale.
  const id = response?.headers?.get('x-nf-request-id')
  const correlationId =
    id && /^[0-9A-HJKMNP-TV-Z]{26}(?:-[0-9A-HJKMNP-TV-Z]{26})?$/.test(id)
      ? id
      : undefined
  failedRequest = {
    at: Date.now(),
    pathname,
    request: {
      path: '/api/workspace',
      status: response?.status ?? null,
      message: unreadable
        ? 'Response was not valid JSON (body omitted).'
        : response
          ? 'HTTP request failed (body omitted).'
          : 'Request did not complete (details omitted).',
      ...(correlationId ? { correlationId } : {}),
    },
  }
}

/** Same request/response semantics as fetch. Diagnostics retain no input, body or credentials. */
export async function fetchWorkspaceWithDiagnostics(init?: RequestInit) {
  let response: Response
  try {
    response = await fetch('/api/workspace', init)
  } catch (error) {
    requestFailure()
    throw error
  }
  if (response.ok) failedRequest = null
  else requestFailure(response)
  return response
}
export async function readWorkspaceJsonWithDiagnostics(response: Response) {
  try {
    return await response.json()
  } catch (error) {
    requestFailure(response, true)
    throw error
  }
}
