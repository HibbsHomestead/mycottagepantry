import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { signupPlanDetails } from '../../src/lib/signup-plan'
import {
  RegistrationError,
  type RegistrationActor,
  type RegistrationClient,
} from './registration-core'

export const signupIntentInput = z.discriminatedUnion('action', [
  z
    .object({ action: z.literal('prepare'), planId: z.string().max(40) })
    .strict(),
  z
    .object({
      action: z.literal('resume'),
      planId: z.string().max(40).optional(),
    })
    .strict(),
])
export function signupIntentCookie(request: Request) {
  const value = request.headers
    .get('cookie')
    ?.match(/(?:^|;\s*)cp_signup_intent=([^;]*)/)?.[1]
  return value && z.uuid().safeParse(value).success ? value : undefined
}
function details(planId: unknown) {
  try {
    return signupPlanDetails(planId)
  } catch {
    throw new RegistrationError(
      400,
      'INVALID_PLAN',
      'Choose a listed plan. No different plan was selected.',
    )
  }
}

/** Only called within a worker-scoped database transaction. Holds no credentials,
 * policy acceptance, workspace, subscription or access assignment. */
export async function prepareSignupIntent(
  client: RegistrationClient,
  planId: string,
) {
  const selection = details(planId)
  const id = randomUUID()
  await client.query(
    "INSERT INTO signup_plan_intents(id,plan_id,expires_at) VALUES($1,$2,now()+interval '30 days')",
    [id, selection.planId],
  )
  return { intentId: id, selection }
}

export async function currentSignupSelection(
  client: RegistrationClient,
  actor: RegistrationActor,
) {
  const row = (
    await client.query(
      'SELECT id,plan_id FROM signup_plan_intents WHERE identity_id=$1 ORDER BY updated_at DESC,id DESC LIMIT 1',
      [actor.id],
    )
  ).rows[0]
  return row ? details(row.plan_id) : null
}

/** A verified account claims its own signup reference. Metadata is user-editable:
 * only a validated preference is read from the DB, never a privilege. */
export async function resumeSignupIntent(
  client: RegistrationClient,
  actor: RegistrationActor,
  planId?: string,
  cookieId?: string,
) {
  const requested = planId === undefined ? undefined : details(planId)
  const existing = await currentSignupSelection(client, actor)
  if (requested && requested.planId === existing?.planId)
    return { selection: existing }
  if (requested) {
    await client.query(
      'INSERT INTO signup_plan_intents(id,plan_id,identity_id,expires_at) VALUES($1,$2,$3,now())',
      [randomUUID(), requested.planId, actor.id],
    )
    return { selection: requested }
  }
  if (existing) return { selection: existing }
  const reference = actor.signupIntentId || cookieId
  if (!reference) return { selection: null }
  const row = (
    await client.query(
      'SELECT * FROM signup_plan_intents WHERE id=$1 FOR UPDATE',
      [reference],
    )
  ).rows[0]
  if (
    !row ||
    (row.identity_id && row.identity_id !== actor.id) ||
    (!row.identity_id && new Date(row.expires_at).getTime() <= Date.now())
  )
    throw new RegistrationError(
      409,
      'PLAN_SELECTION_EXPIRED',
      'Your saved plan choice is unavailable or expired. Choose your intended plan again; no plan or access was changed.',
    )
  const selection = details(row.plan_id)
  await client.query(
    'UPDATE signup_plan_intents SET identity_id=$1,updated_at=now() WHERE id=$2',
    [actor.id, row.id],
  )
  return { selection }
}
