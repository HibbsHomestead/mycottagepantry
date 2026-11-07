// @vitest-environment node
import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from 'vitest'
import {
  PHOTO_ACCOUNT,
  PHOTO_WORKSPACE,
  PHOTO_BOUNDS,
  PHOTO_RATE,
  photoPilotVisible,
  reservePhoto,
  finishPhoto,
  photoUsageCost,
} from '../../netlify/lib/photo-pilot'
import type { Item } from './domain'
const db = new PGlite()
const c = {
  query: async (sql: string, params?: unknown[]) => ({
    rows: (await db.query(sql, params)).rows as Item[],
  }),
}
const grant = {
  enabled: true,
  processingEnabled: true,
  boundsVerified: true,
  dailyLimit: 20,
  monthlyLimit: 100,
  spendLimitMicros: 2_000_000,
  reservationMicros: 50_000,
}
const key = () => crypto.randomUUID()
async function limits(patch: object) {
  await db.query('UPDATE photo_pilot_grants SET data=$1 WHERE business_id=$2', [
    JSON.stringify({ ...grant, ...patch }),
    PHOTO_WORKSPACE,
  ])
}
async function reserve(
  requestKey = key(),
  fingerprint = key(),
  actor = PHOTO_ACCOUNT,
  org = PHOTO_WORKSPACE,
) {
  await db.exec('BEGIN')
  try {
    return await reservePhoto(c, org, actor, requestKey, fingerprint)
  } catch (e) {
    await db.exec('ROLLBACK')
    throw e
  }
}
beforeAll(async () => {
  await db.exec(
    'CREATE TABLE businesses(id uuid PRIMARY KEY); CREATE TABLE users(business_id uuid,identity_id text,role text,active boolean);',
  )
  await db.query('INSERT INTO businesses VALUES($1)', [PHOTO_WORKSPACE])
  await db.query('INSERT INTO users VALUES($1,$2,$3,true)', [
    PHOTO_WORKSPACE,
    PHOTO_ACCOUNT,
    'Owner',
  ])
  await db.exec(
    await readFile(
      'netlify/database/migrations/20261122010000_add_private_photo_pilot/migration.sql',
      'utf8',
    ),
  )
})
beforeEach(async () => {
  await db.exec('DELETE FROM photo_extraction_attempts')
  await limits({})
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
afterAll(() => db.close())
it('enforces exact account/workspace and kill switch independently of roles and tiers', async () => {
  expect(await photoPilotVisible(c, PHOTO_WORKSPACE, PHOTO_ACCOUNT)).toBe(true)
  expect(await photoPilotVisible(c, PHOTO_WORKSPACE, 'another-owner')).toBe(
    false,
  )
  expect(await photoPilotVisible(c, 'another-workspace', PHOTO_ACCOUNT)).toBe(
    false,
  )
  await expect(reserve(key(), key(), 'another-owner')).rejects.toMatchObject({
    code: 'FEATURE_UNAVAILABLE',
  })
  vi.stubGlobal('Netlify', { env: { get: () => 'false' } })
  await expect(reserve()).rejects.toMatchObject({ code: 'FEATURE_UNAVAILABLE' })
})
it('keeps paid processing disabled until verified bounds and an explicit processing release exist', async () => {
  await limits({ boundsVerified: false })
  await expect(reserve()).rejects.toMatchObject({
    code: 'PILOT_PROCESSING_DISABLED',
  })
  await limits({ processingEnabled: false })
  await expect(reserve()).rejects.toMatchObject({
    code: 'PILOT_PROCESSING_DISABLED',
  })
  expect(
    (await db.query('SELECT * FROM photo_extraction_attempts')).rows,
  ).toHaveLength(0)
})
it('reserves more than the conservative token maximum and rejects expired rates before dispatch', async () => {
  const maximum = photoUsageCost({
    inputTokens: PHOTO_BOUNDS.inputTokens,
    outputTokens: PHOTO_BOUNDS.outputTokens,
    thoughtTokens: PHOTO_BOUNDS.thoughtTokens,
  })
  expect(maximum).toBe(25600)
  expect(grant.reservationMicros).toBeGreaterThan(maximum!)
  vi.useFakeTimers()
  vi.setSystemTime(new Date(PHOTO_RATE.validUntil))
  await expect(reserve()).rejects.toMatchObject({
    code: 'PILOT_PROCESSING_DISABLED',
  })
  expect(
    (await db.query('SELECT * FROM photo_extraction_attempts')).rows,
  ).toHaveLength(0)
})
it('persists a reservation before inference, prevents duplicate keys/content and permits only one in flight', async () => {
  const request = key(),
    fingerprint = key(),
    id = await reserve(request, fingerprint)
  const row = (
    await db.query<{ data: Item }>(
      'SELECT data FROM photo_extraction_attempts WHERE id=$1',
      [id],
    )
  ).rows[0].data
  expect(row).toMatchObject({
    reservedMicros: 50000,
    attempts: 0,
    status: 'reserved',
    actor: PHOTO_ACCOUNT,
  })
  await expect(reserve(request, key())).rejects.toMatchObject({
    code: 'PHOTO_DUPLICATE',
  })
  await expect(reserve(key(), fingerprint)).rejects.toMatchObject({
    code: 'PHOTO_DUPLICATE',
  })
  await expect(reserve()).rejects.toMatchObject({ code: 'PHOTO_IN_FLIGHT' })
  await finishPhoto(c, PHOTO_WORKSPACE, id, {
    status: 'success',
    chargedMicros: 5000,
    attempts: 1,
    inputTokens: 4000,
    outputTokens: 800,
    thoughtTokens: 0,
  })
  await expect(reserve()).resolves.toBeTypeOf('string')
})
it('enforces daily, monthly and spending limits on owners; unknown outcomes retain the reservation', async () => {
  await limits({ dailyLimit: 1 })
  const id = await reserve()
  await finishPhoto(c, PHOTO_WORKSPACE, id, {
    status: 'uncertain',
    attempts: 1,
  })
  await expect(reserve()).rejects.toMatchObject({ code: 'PHOTO_BUDGET_LIMIT' })
  await limits({ monthlyLimit: 1 })
  await expect(reserve()).rejects.toMatchObject({ code: 'PHOTO_BUDGET_LIMIT' })
  await limits({ spendLimitMicros: 75000 })
  await expect(reserve()).rejects.toMatchObject({ code: 'PHOTO_BUDGET_LIMIT' })
  await limits({ reservationMicros: 1 })
  await expect(reserve()).rejects.toMatchObject({
    code: 'PILOT_LIMIT_CONFIGURATION',
  })
})
it('conservatively accounts for stale requests and verifies content-free separate thought-token cost', async () => {
  const id = await reserve()
  await db.query(
    "UPDATE photo_extraction_attempts SET created_at=now()-interval '6 minutes' WHERE id=$1",
    [id],
  )
  await expect(reserve()).resolves.toBeTypeOf('string')
  const stale = (
    await db.query<{ data: Item }>(
      'SELECT data FROM photo_extraction_attempts WHERE id=$1',
      [id],
    )
  ).rows[0].data
  expect(stale).toMatchObject({ status: 'uncertain', reservedMicros: 50000 })
  expect(
    photoUsageCost({
      inputTokens: 4000,
      outputTokens: 800,
      thoughtTokens: 0,
    }),
  ).toBe(2880)
  expect(photoUsageCost({ inputTokens: 4000, outputTokens: 800 })).toBeNull()
  expect(
    photoUsageCost({
      inputTokens: 4000,
      outputTokens: 800,
      thoughtTokens: 9999,
    }),
  ).toBeNull()
  expect(Object.keys(stale)).not.toContain('images')
  expect(Object.keys(stale)).not.toContain('fields')
})

it('automatically suspends processing after an unverified model or out-of-bounds usage response', async () => {
  const id = await reserve()
  await finishPhoto(c, PHOTO_WORKSPACE, id, {
    status: 'uncertain',
    usageValid: false,
    attempts: 1,
  })
  await expect(reserve()).rejects.toMatchObject({
    code: 'PILOT_PROCESSING_DISABLED',
  })
  expect(await photoPilotVisible(c, PHOTO_WORKSPACE, PHOTO_ACCOUNT)).toBe(true)
})
