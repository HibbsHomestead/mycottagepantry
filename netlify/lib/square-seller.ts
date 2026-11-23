import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  createHmac,
  timingSafeEqual,
} from 'node:crypto'
import {
  detectSquare,
  squareFields,
  type SquareRow,
} from '../../src/lib/square-sales'
export type SquareEnvironment = 'sandbox' | 'production'
export const squareScopes = [
  'MERCHANT_PROFILE_READ',
  'ORDERS_READ',
  'PAYMENTS_READ',
]
const env = (key: string) =>
  process.env[key] || globalThis.Netlify?.env?.get(key) || ''
export function sellerConfig(environment: SquareEnvironment) {
  const prefix = `SQUARE_${environment.toUpperCase()}_`
  const id = env(prefix + 'APPLICATION_ID'),
    secret = env(prefix + 'APPLICATION_SECRET')
  return {
    id,
    secret,
    ready: !!(id && secret),
    base:
      environment === 'sandbox'
        ? 'https://connect.squareupsandbox.com'
        : 'https://connect.squareup.com',
    version: /^\d{4}-\d{2}-\d{2}$/.test(env(prefix + 'API_VERSION'))
      ? env(prefix + 'API_VERSION')
      : '2026-01-22',
  }
}
function key(environment: SquareEnvironment) {
  const c = sellerConfig(environment)
  if (!c.ready)
    throw new Error(
      'Square connection is not available yet. Contact support.',
    )
  return createHash('sha256')
    .update('cottage-pantry:seller-sales:v1:' + c.secret)
    .digest()
}
export function sealSeller(
  value: unknown,
  environment: SquareEnvironment,
  org: string,
) {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key(environment), iv)
  cipher.setAAD(Buffer.from(org + ':' + environment))
  const body = Buffer.concat([
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final(),
  ])
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url')
}
export function openSeller(
  value: string,
  environment: SquareEnvironment,
  org: string,
) {
  const bytes = Buffer.from(value, 'base64url'),
    cipher = createDecipheriv(
      'aes-256-gcm',
      key(environment),
      bytes.subarray(0, 12),
    )
  cipher.setAAD(Buffer.from(org + ':' + environment))
  cipher.setAuthTag(bytes.subarray(12, 28))
  return JSON.parse(
    Buffer.concat([
      cipher.update(bytes.subarray(28)),
      cipher.final(),
    ]).toString(),
  )
}
export class SquareReadError extends Error {
  constructor(
    public stage: string,
    public status: number,
    public code: string,
  ) {
    super(
      `Square ${stage} failed (${status}; ${code}). ${status === 401 ? 'Reconnect Square and try again.' : 'Check application permissions and selected locations, then retry.'}`,
    )
  }
}
export async function squareRead(
  environment: SquareEnvironment,
  path: string,
  token?: string,
  body?: unknown,
) {
  const c = sellerConfig(environment)
  let response: Response
  try {
    response = await fetch(c.base + path, {
      method: body ? 'POST' : 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Square-Version': c.version,
        ...(path === '/oauth2/revoke'
          ? { Authorization: `Client ${c.secret}` }
          : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
      redirect: 'error',
    })
  } catch {
    throw new Error(
      'Square connection timed out or could not be reached. Retry without changing your selection.',
    )
  }
  const json = await response.json().catch(() => ({}))
  if (!response.ok || json.errors?.length) {
    const rawCode = json.errors?.[0]?.code || json.error
    const raw = typeof rawCode === 'string' ? rawCode.toUpperCase() : ''
    const code =
      typeof raw === 'string' && /^[A-Z_]{1,70}$/.test(raw)
        ? raw
        : 'REQUEST_FAILED'
    throw new SquareReadError(path.split('?')[0], response.status, code)
  }
  return json
}
export async function sellerIdentity(
  environment: SquareEnvironment,
  token: string,
  merchantId: string,
) {
  const merchant = await squareRead(
    environment,
    '/v2/merchants/' + encodeURIComponent(merchantId),
    token,
  )
  const locations = await squareRead(environment, '/v2/locations', token)
  if (merchant.merchant?.id !== merchantId)
    throw new Error(
      'Square merchant identity could not be verified. Reconnect.',
    )
  return {
    merchantId,
    merchantName: merchant.merchant.business_name || merchantId,
    locations: (locations.locations || [])
      .filter((l: any) => l.status === 'ACTIVE')
      .map((l: any) => ({
        id: l.id,
        name: l.name,
        timezone: l.timezone,
        currency: l.currency,
      })),
  }
}
export async function sellerCredential(
  client: any,
  org: string,
  environment: SquareEnvironment,
  data: any,
) {
  let token = openSeller(data.credential, environment, org)
  if (Date.parse(token.expires_at) < Date.now() + 86400000) {
    const c = sellerConfig(environment)
    token = await squareRead(environment, '/oauth2/token', undefined, {
      client_id: c.id,
      client_secret: c.secret,
      grant_type: 'refresh_token',
      refresh_token: token.refresh_token,
    })
    if (!token.access_token || !token.refresh_token || !token.expires_at)
      throw new Error(
        'Square refresh response was incomplete. Reconnect Square.',
      )
    data.credential = sealSeller(token, environment, org)
    await saveSeller(client, org, environment, data)
  }
  return token.access_token as string
}
export async function saveSeller(
  client: any,
  org: string,
  environment: SquareEnvironment,
  data: any,
) {
  await client.query(
    'INSERT INTO square_seller_connections(business_id,environment,data) VALUES($1,$2,$3) ON CONFLICT(business_id,environment) DO UPDATE SET data=$3',
    [org, environment, JSON.stringify(data)],
  )
}
export function sellerView(data: any, environment: SquareEnvironment) {
  return {
    environment,
    configured: sellerConfig(environment).ready,
    status: data.status || 'not_connected',
    merchantId: data.merchantId || null,
    merchantName: data.merchantName || null,
    verifiedAt: data.verifiedAt || null,
    locations: data.locations || [],
    selectedLocations: data.selectedLocations || [],
    lastSuccessfulSync: data.lastSuccessfulSync || null,
    lastAttemptedSync: data.lastAttemptedSync || null,
    lastSuccessfulRead: data.lastSuccessfulRead || null,
    error: data.error || null,
    scopes: squareScopes,
    recurringSync: false,
  }
}
export function validateSquareRange(
  start: string,
  end: string,
  locations: string[],
  available: any[],
) {
  const a = Date.parse(start),
    b = Date.parse(end)
  if (
    !/Z$/.test(start) ||
    !/Z$/.test(end) ||
    !Number.isFinite(a + b) ||
    b <= a ||
    b - a > 31 * 86400000
  )
    throw new Error(
      'Choose UTC start/end timestamps covering at most 31 days (end exclusive).',
    )
  if (
    !Array.isArray(locations) ||
    !locations.length ||
    locations.length > 10 ||
    new Set(locations).size !== locations.length ||
    locations.some((id) => !available.some((l) => l.id === id))
  )
    throw new Error('Select between one and ten verified merchant locations.')
}
/** Bounded transaction-only projection. No item quantities are invented. */
export async function sellerSample(
  environment: SquareEnvironment,
  token: string,
  input: { start: string; end: string; locations: string[] },
  locations: any[],
) {
  validateSquareRange(input.start, input.end, input.locations, locations)
  const payments: any[] = []
  let cursor: string | undefined
  let rawCount = 0
  const cursors = new Set<string>()
  do {
    const q = new URLSearchParams({
      begin_time: input.start,
      end_time: input.end,
      limit: '100',
      ...(cursor ? { cursor } : {}),
    })
    const page = await squareRead(environment, '/v2/payments?' + q, token)
    rawCount += (page.payments || []).length
    if (
      rawCount > 200 ||
      (page.cursor && (rawCount >= 200 || cursors.has(page.cursor)))
    )
      throw new Error(
        'More than 200 payments or a repeated page in this range. Narrow the range before reviewing; no sales were imported.',
      )
    if (page.cursor) cursors.add(page.cursor)
    payments.push(
      ...(page.payments || []).filter(
        (p: any) =>
          Date.parse(p.created_at) >= Date.parse(input.start) &&
          Date.parse(p.created_at) < Date.parse(input.end),
      ),
    )
    cursor = page.cursor
    if (payments.length > 200 || (cursor && payments.length >= 200))
      throw new Error(
        'More than 200 payments in this range. Narrow the range before reviewing; no sales were imported.',
      )
  } while (cursor)
  if (
    new Set(
      payments
        .filter(
          (p) =>
            p.status === 'COMPLETED' && input.locations.includes(p.location_id),
        )
        .map((p) => p.order_id),
    ).size > 50
  )
    throw new Error(
      'More than 50 orders in this range. Narrow the range before reviewing; no sales were imported.',
    )
  const orders = new Map<string, any>()
  const rows: Partial<SquareRow>[] = []
  for (const payment of payments.filter(
    (p) => p.status === 'COMPLETED' && input.locations.includes(p.location_id),
  )) {
    if (!payment.order_id)
      throw new Error(
        'A payment lacks order detail needed to separate tax, refunds and product revenue. Narrow the range or use a reconciled CSV.',
      )
    if (!orders.has(payment.order_id)) {
      const result = await squareRead(
        environment,
        '/v2/orders/' + encodeURIComponent(payment.order_id),
        token,
      )
      orders.set(payment.order_id, result.order)
    }
  }
  for (const [orderId, order] of orders) {
    if (!order || order.state !== 'COMPLETED')
      throw new Error(
        'An order is incomplete or unavailable. Review a narrower completed-sales range.',
      )
    const ps = payments.filter(
      (p) => p.order_id === orderId && p.status === 'COMPLETED',
    )
    if (ps.length !== 1)
      throw new Error(
        'Split-payment orders require manual reconciliation; no amounts were guessed.',
      )
    const payment = ps[0],
      amounts = order.net_amounts
    if (
      !amounts?.total_money ||
      !amounts?.tax_money ||
      !amounts?.tip_money ||
      !amounts?.service_charge_money
    )
      throw new Error(
        'Order net totals are incomplete; use a reconciled CSV instead.',
      )
    const currency = amounts.total_money.currency
    if (
      new Intl.NumberFormat('en', {
        style: 'currency',
        currency,
      }).resolvedOptions().maximumFractionDigits !== 2
    )
      throw new Error(
        'This API preview supports currencies with two decimal minor units. Use a reconciled CSV for other currencies.',
      )
    const money = (m: any) => {
      if (!m || m.currency !== currency || !Number.isSafeInteger(m.amount))
        throw new Error(
          'Order amounts have an unsupported currency or precision.',
        )
      return m.amount
    }
    const total = money(amounts.total_money),
      tax = money(amounts.tax_money),
      tips = money(amounts.tip_money),
      service = money(amounts.service_charge_money)
    if (service !== 0 || order.rounding_adjustment?.amount_money?.amount)
      throw new Error(
        'Service-charge or cash-rounding allocation requires a reconciled CSV; no product revenue was guessed.',
      )
    if (
      !payment.total_money ||
      money(payment.total_money) !== total ||
      (order.tenders?.length || 0) > 1
    )
      throw new Error(
        'Payment and order totals do not reconcile. Partial and split payments require a reconciled CSV.',
      )
    // Fail closed on refunds: payment-created ranges cannot establish refund activity dates.
    if (payment.refunded_money?.amount || order.returns?.length)
      throw new Error(
        'This range includes refunds/returns. Use reconciled Square CSV reports for refund activity; API refund-date reconciliation is not yet supported.',
      )
    const fees = payment.processing_fee?.length
      ? payment.processing_fee.reduce(
          (n: number, f: any) => n + money(f.amount_money),
          0,
        )
      : null
    rows.push({
      transactionId: payment.id,
      paymentId: payment.id,
      orderId,
      lineId: '',
      date: payment.created_at,
      location: payment.location_id,
      currency,
      amounts: {
        net: total - tax - tips - service,
        tax,
        tips,
        serviceCharges: service,
        payment: payment.total_money ? money(payment.total_money) : null,
        fees,
        discounts: order.total_discount_money
          ? money(order.total_discount_money)
          : null,
        refunds: 0,
        gross: order.total_discount_money
          ? total - tax - tips - service + money(order.total_discount_money)
          : null,
      },
    })
  }
  const quote = (v: unknown) =>
    '"' + String(v ?? '').replaceAll('"', '""') + '"'
  const monetary = [
    'gross',
    'discounts',
    'refunds',
    'net',
    'tax',
    'tips',
    'serviceCharges',
    'payment',
    'fees',
  ]
  const csv = [
    squareFields.join(','),
    ...rows.map((row) =>
      squareFields
        .map((f) =>
          quote(
            monetary.includes(f)
              ? row.amounts?.[f] == null
                ? ''
                : (row.amounts[f]! / 100).toFixed(2)
              : (row as any)[f],
          ),
        )
        .join(','),
    ),
  ].join('\n')
  // The canonical field names are mapped explicitly, rather than inferred from labels.
  const options = {
    ...detectSquare(rows.length ? csv : 'date,net\n2026-01-01,0'),
    type: 'transactions' as const,
    columns: Object.fromEntries(squareFields.map((f) => [f, f])),
    dateFormat: 'ISO' as const,
    timezone: 'UTC',
  }
  return { csv, options, count: rows.length }
}
export function signSquareReview(
  value: object,
  environment: SquareEnvironment,
) {
  const payload = Buffer.from(JSON.stringify(value)).toString('base64url')
  return (
    payload +
    '.' +
    createHmac('sha256', key(environment)).update(payload).digest('base64url')
  )
}
export function verifySquareReview(
  value: string,
  environment: SquareEnvironment,
  org: string,
) {
  const [payload, signature] = value.split('.')
  const expected = createHmac('sha256', key(environment))
    .update(payload || '')
    .digest('base64url')
  if (
    !signature ||
    signature.length !== expected.length ||
    !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  )
    throw new Error('Square review is invalid. Retrieve the sample again.')
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString())
  if (data.org !== org || data.expires < Date.now())
    throw new Error(
      'Square review expired or belongs to another business. Retrieve it again.',
    )
  return data
}
