import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { businessProfile } from '../../src/lib/registration'
import { currentRegistrationPolicy } from './registration-policies'
import { units } from '../../src/lib/domain'
import {
  currentMembership,
  RegistrationError,
  type RegistrationActor,
  type RegistrationClient,
} from './registration-core'

const freeSetup = z
  .object({
    action: z.literal('createFreeWorkspace'),
    profile: businessProfile,
    consent: z
      .object({ accepted: z.literal(true), revision: z.string().min(1) })
      .strict()
      .optional(),
  })
  .strict()

/** Called only inside registrationTransaction: its identity lock serializes retries. */
export async function createFreeWorkspace(
  client: RegistrationClient,
  actor: RegistrationActor,
  input: unknown,
) {
  const data = freeSetup.parse(input)
  const existing = await currentMembership(client, actor)
  if (existing) return { existing: true, workspaceId: existing.id }
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('registration-policies',0))",
  )
  const policy = await currentRegistrationPolicy(client)
  if (!policy && data.consent)
    throw new RegistrationError(
      409,
      'POLICY_CHANGED',
      'No policies are published. Refresh the policy check and retry without policy acceptance.',
    )
  if (policy && data.consent?.revision !== policy.revision)
    throw new RegistrationError(
      409,
      'POLICY_CHANGED',
      'Review the current Terms and Privacy before creating your oven.',
    )
  // A legacy owner without an active membership must be repaired, never replaced.
  const owned = await client.query(
    'SELECT id FROM businesses WHERE identity_owner=$1',
    [actor.id],
  )
  if (owned.rows.length)
    throw new RegistrationError(
      409,
      'EXISTING_WORKSPACE',
      'An existing business belongs to this account. Contact support to restore access; no replacement was created.',
    )
  const id = randomUUID()
  await client.query(
    'INSERT INTO businesses(id,business_name,identity_owner) VALUES($1,$2,$3)',
    [id, data.profile.name, actor.id],
  )
  await client.query("SELECT set_config('app.business_id',$1,true)", [id])
  await client.query(
    'INSERT INTO users(id,business_id,identity_id,role,data) VALUES($1,$2,$3,$4,$5)',
    [
      randomUUID(),
      id,
      actor.id,
      'Owner',
      JSON.stringify({ name: actor.email }),
    ],
  )
  await client.query(
    'INSERT INTO settings(id,business_id,data) VALUES($1,$2,$3)',
    [
      'business',
      id,
      JSON.stringify({
        id: 'business',
        ...data.profile,
        email: actor.email,
        owner: '',
        address: '',
        jurisdiction: '',
        laborRate: 0,
        targetMargin: 0,
        taxRate: 0,
        taxRates: [],
        disclaimer: '',
        appearance: { theme: 'cottage', mode: 'light' },
        freeRegistration: {
          plan: 'free',
          identityId: actor.id,
          ...(policy && data.consent
            ? {
                acceptedPolicyRevision: policy.revision,
                acceptedAt: new Date().toISOString(),
              }
            : {}),
        },
      }),
    ],
  )
  for (const [abbreviation, unit] of Object.entries(units))
    await client.query(
      'INSERT INTO units(id,business_id,data) VALUES($1,$2,$3)',
      [
        abbreviation,
        id,
        JSON.stringify({
          id: abbreviation,
          name: abbreviation,
          abbreviation,
          category: unit.category,
          baseUnitFactor: unit.factor || null,
          active: true,
          custom: false,
        }),
      ],
    )
  // No billing row, checkout, subscription, fixture consent, seed, or external call.
  return { existing: false, workspaceId: id }
}
