import { createHash, randomUUID } from 'node:crypto'
import { LookupError, type CatalogClient } from './catalog-handler'
import { packagePhotoPilotApproved } from './feature-flags'

export const PHOTO_ACCOUNT = '8a87b82e-1393-4c4d-9885-62f946204b6e'
export const PHOTO_WORKSPACE = '8081ae5d-576f-4bf6-8dd4-a69b39a47bf1'
export const PHOTO_MODEL = 'gpt-4.1-mini'
export const PHOTO_RATE = {
  version: 'openai-standard-2026-11-07',
  inputMicrosPerToken: 0.4,
  outputMicrosPerToken: 1.6,
  validUntil: '2026-12-07T00:00:00Z',
}
export const PHOTO_BOUNDS = {
  inputTokens: 40000,
  outputTokens: 6000,
  thoughtTokens: 0,
}
// Non-reasoning model, bounded image geometry and fixed text, explicit output cap.
// Rates expire closed; no fallback model or automatic retries are permitted.
export async function photoPilotGrant(
  c: CatalogClient,
  org: string,
  actor?: string,
) {
  if (
    !packagePhotoPilotApproved() ||
    actor !== PHOTO_ACCOUNT ||
    org !== PHOTO_WORKSPACE
  )
    return null
  return (
    (
      await c.query(
        'SELECT data FROM photo_pilot_grants WHERE business_id=$1 AND id=$2',
        [org, actor],
      )
    ).rows[0]?.data || null
  )
}
export async function photoPilotVisible(
  c: CatalogClient,
  org: string,
  actor?: string,
) {
  return (await photoPilotGrant(c, org, actor))?.enabled === true
}
function available() {
  return new LookupError(
    404,
    'FEATURE_UNAVAILABLE',
    'Package photo reading is unavailable for this account.',
  )
}

/** The grant row serializes every reservation across sessions. Call inside the authenticated transaction. */
export async function reservePhoto(
  c: CatalogClient,
  org: string,
  actor: string | undefined,
  key: string,
  fingerprint: string,
) {
  if (
    !packagePhotoPilotApproved() ||
    actor !== PHOTO_ACCOUNT ||
    org !== PHOTO_WORKSPACE
  )
    throw available()
  const grant = (
    await c.query(
      'SELECT data FROM photo_pilot_grants WHERE business_id=$1 AND id=$2 FOR UPDATE',
      [org, actor],
    )
  ).rows[0]?.data
  if (grant?.enabled !== true) throw available()
  if (
    grant.processingEnabled !== true ||
    grant.boundsVerified !== true ||
    Date.now() >= Date.parse(PHOTO_RATE.validUntil)
  )
    throw new LookupError(
      503,
      'PILOT_PROCESSING_DISABLED',
      'Your private photo pilot is configured. Paid processing is disabled pending provider token-bound verification; manual, URL and barcode entry remain available.',
    )
  if (!/^[a-f0-9-]{36}$/i.test(key))
    throw new LookupError(
      400,
      'REQUEST_KEY_REQUIRED',
      'Start a new extraction request.',
    )
  const daily = Number(grant.dailyLimit),
    monthly = Number(grant.monthlyLimit),
    spend = Number(grant.spendLimitMicros),
    reservation = Number(grant.reservationMicros)
  if (
    ![daily, monthly, spend, reservation].every(
      (v) => Number.isSafeInteger(v) && v > 0,
    ) ||
    daily > 20 ||
    monthly > 100 ||
    spend > 2_000_000 ||
    reservation > 50_000 ||
    reservation <
      PHOTO_BOUNDS.inputTokens * PHOTO_RATE.inputMicrosPerToken +
        (PHOTO_BOUNDS.outputTokens + PHOTO_BOUNDS.thoughtTokens) *
          PHOTO_RATE.outputMicrosPerToken
  )
    throw new LookupError(
      503,
      'PILOT_LIMIT_CONFIGURATION',
      'Photo processing limits need operator review.',
    )
  // A crashed/uncertain attempt keeps its full spend reservation; only the in-flight lock expires.
  await c.query(
    "UPDATE photo_extraction_attempts SET data=jsonb_set(data,'{status}','\"uncertain\"') WHERE business_id=$1 AND data->>'actor'=$2 AND data->>'status'='reserved' AND created_at < now()-interval '5 minutes'",
    [org, actor],
  )
  const previous = (
    await c.query(
      "SELECT id,data,created_at FROM photo_extraction_attempts WHERE business_id=$1 AND data->>'actor'=$2 AND (created_at >= date_trunc('month',now() AT TIME ZONE 'UTC') OR data->>'status'='reserved' OR created_at >= now()-interval '15 minutes')",
      [org, actor],
    )
  ).rows
  const id = createHash('sha256').update(`${actor}:${key}`).digest('hex')
  const duplicate =
    (
      await c.query(
        'SELECT id FROM photo_extraction_attempts WHERE business_id=$1 AND id=$2',
        [org, id],
      )
    ).rows.length > 0
  if (
    duplicate ||
    previous.some(
      (r) =>
        r.data.fingerprint === fingerprint &&
        Date.now() - Date.parse(String(r.created_at)) < 15 * 60_000,
    )
  )
    throw new LookupError(
      409,
      'PHOTO_DUPLICATE',
      'These photos or this request were already submitted. Review the earlier result before another extraction.',
    )
  if (previous.some((r) => r.data.status === 'reserved'))
    throw new LookupError(
      429,
      'PHOTO_IN_FLIGHT',
      'A photo extraction is already in progress. Wait for it to finish.',
    )
  if (
    previous.some(
      (r) =>
        !Number.isSafeInteger(
          Number(r.data.chargedMicros ?? r.data.reservedMicros),
        ) || Number(r.data.chargedMicros ?? r.data.reservedMicros) < 0,
    )
  )
    throw new LookupError(
      503,
      'PILOT_USAGE_REVIEW',
      'Photo usage accounting needs operator review.',
    )
  const today = new Date().toISOString().slice(0, 10)
  const currentMonth = new Date().toISOString().slice(0, 7)
  const monthRows = previous.filter((r) =>
    new Date(r.created_at).toISOString().startsWith(currentMonth),
  )
  if (
    monthRows.length >= monthly ||
    previous.filter(
      (r) => new Date(r.created_at).toISOString().slice(0, 10) === today,
    ).length >= daily ||
    previous.reduce(
      (n, r) => n + Number(r.data.chargedMicros ?? r.data.reservedMicros),
      0,
    ) +
      reservation >
      spend
  )
    throw new LookupError(
      429,
      'PHOTO_BUDGET_LIMIT',
      'The private photo usage or spending limit is reached. Manual entry remains available.',
    )
  const metadata = {
    actor,
    fingerprint,
    status: 'reserved',
    provider: 'openai',
    model: PHOTO_MODEL,
    rateVersion: PHOTO_RATE.version,
    reservedMicros: reservation,
    attempts: 0,
    requestId: randomUUID(),
  }
  await c.query(
    'INSERT INTO photo_extraction_attempts(id,business_id,data) VALUES($1,$2,$3)',
    [id, org, JSON.stringify(metadata)],
  )
  await c.query('COMMIT') // The reservation must survive any timeout, crash or disconnect before inference.
  return id
}

export async function finishPhoto(
  c: CatalogClient,
  org: string,
  id: string,
  metadata: Record<string, unknown>,
) {
  await c.query('BEGIN')
  try {
    await c.query("SELECT set_config('app.business_id',$1,true)", [org])
    await c.query(
      "UPDATE photo_extraction_attempts SET data=data || $3::jsonb,updated_at=now() WHERE business_id=$1 AND id=$2 AND data->>'status' IN ('reserved','uncertain')",
      [org, id, JSON.stringify(metadata)],
    )
    if (metadata.usageValid === false)
      await c.query(
        'UPDATE photo_pilot_grants SET data=data || \'{"processingEnabled":false,"boundsVerified":false}\'::jsonb,updated_at=now() WHERE business_id=$1 AND id=$2',
        [org, PHOTO_ACCOUNT],
      )
    await c.query('COMMIT')
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {})
    throw e
  }
}

export function photoUsageCost(usage: {
  inputTokens?: number
  outputTokens?: number
  thoughtTokens?: number
}) {
  const { inputTokens, outputTokens, thoughtTokens } = usage
  if (
    ![inputTokens, outputTokens, thoughtTokens].every(
      (v) => Number.isSafeInteger(v) && v! >= 0,
    ) ||
    inputTokens! > PHOTO_BOUNDS.inputTokens ||
    outputTokens! > PHOTO_BOUNDS.outputTokens ||
    thoughtTokens! > PHOTO_BOUNDS.thoughtTokens
  )
    return null
  return Math.ceil(
    inputTokens! * PHOTO_RATE.inputMicrosPerToken +
      (outputTokens! + thoughtTokens!) * PHOTO_RATE.outputMicrosPerToken,
  )
}
