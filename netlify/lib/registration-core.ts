import { getUser, admin } from '@netlify/identity'
import { verifiedSession, selectedWorkspace } from './verified-session'
import { getDatabase } from '@netlify/database'
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { businessProfile, checklistSteps } from '../../src/lib/registration'
import { signupPlan } from '../../src/lib/signup-plan'
import { units } from '../../src/lib/domain'

export type RegistrationClient = {
  query: (sql: string, values?: any[]) => Promise<{ rows: any[] }>
  release: () => void
}
export type RegistrationActor = {
  id: string
  email: string
  privateTest: boolean
  platformAdmin: boolean
  selectedWorkspaceId?: string
  signupIntentId?: string
}
export class RegistrationError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message)
  }
}
export function privateRegistrationEnabled() {
  const env = globalThis.Netlify?.env
  return (
    ['dev', 'deploy-preview'].includes(env?.get('CONTEXT') || '') &&
    env?.get('REGISTRATION_PRIVATE_TESTS_ENABLED') === 'true'
  )
}
function requirePrivateFixture(actor: RegistrationActor) {
  if (
    !actor.privateTest ||
    !actor.platformAdmin ||
    !privateRegistrationEnabled()
  )
    throw new RegistrationError(
      403,
      'REGISTRATION_CLOSED',
      'Private fixture mutations are disabled for this account or deployment.',
    )
}
export async function registrationActor(
  requirePrivate = true,
  request?: Request,
): Promise<RegistrationActor> {
  const session = request ? await verifiedSession(request) : await getUser()
  if (!session)
    throw new RegistrationError(401, 'SIGN_IN_REQUIRED', 'Log in to continue.')
  let current
  try {
    current = request ? session : await admin.getUser(session.id)
  } catch {
    throw new RegistrationError(
      503,
      'IDENTITY_UNAVAILABLE',
      'Account verification is temporarily unavailable.',
    )
  }
  if (!current.confirmedAt || !Number.isFinite(Date.parse(current.confirmedAt)))
    throw new RegistrationError(
      403,
      'EMAIL_UNVERIFIED',
      'Verify your account email before continuing.',
    )
  const platformAdmin = (current.roles || []).includes('platform_admin')
  const privateTest = privateRegistrationEnabled() && platformAdmin
  if (requirePrivate && !privateTest)
    throw new RegistrationError(
      403,
      'REGISTRATION_CLOSED',
      'Public policy acceptance and activation are closed. Private testing requires an existing verified platform administrator in a test deployment.',
    )
  return {
    id: current.id,
    email: current.email || '',
    platformAdmin,
    privateTest,
    selectedWorkspaceId: request ? selectedWorkspace(request) : undefined,
    signupIntentId:
      'signupIntentId' in current ? current.signupIntentId : undefined,
  }
}
export async function registrationTransaction<T>(
  actor: RegistrationActor,
  fn: (client: RegistrationClient) => Promise<T>,
) {
  const client = (await getDatabase().pool.connect()) as RegistrationClient
  try {
    await client.query('BEGIN')
    await client.query(
      "SELECT set_config('app.identity_id',$1,true),set_config('app.registration_admin',$2,true)",
      [actor.id, String(actor.platformAdmin)],
    )
    // One lock per current identity protects drafts and retries across instances.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      'registration:' + actor.id,
    ])
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
export async function registrationRateLimit(
  client: RegistrationClient,
  subject: string,
  action: string,
  max: number,
  seconds = 3600,
) {
  const window = Math.floor(Date.now() / (seconds * 1000))
  const key = createHash('sha256')
    .update(`${action}:${subject}:${window}`)
    .digest('hex')
  const { rows } = await client.query(
    'INSERT INTO registration_limits(key,count,expires_at) VALUES($1,1,$2) ON CONFLICT(key) DO UPDATE SET count=registration_limits.count+1 RETURNING count',
    [key, new Date((window + 1) * seconds * 1000)],
  )
  if (Number(rows[0].count) > max)
    throw new RegistrationError(
      429,
      'RATE_LIMITED',
      'Too many requests. Please try again later.',
    )
}
export async function currentMembership(
  client: RegistrationClient,
  actor: RegistrationActor,
) {
  const { rows } = await client.query(
    'SELECT b.id,b.business_name,u.role,u.active FROM users u JOIN businesses b ON b.id=u.business_id WHERE u.identity_id=$1',
    [actor.id],
  )
  const active = rows.filter((row) => row.active)
  const member =
    active.find((row) => row.id === actor.selectedWorkspaceId) ||
    (active.length === 1 ? active[0] : undefined)
  if (active.length > 1 && !member)
    throw new RegistrationError(
      409,
      'WORKSPACE_SELECTION_REQUIRED',
      'Choose an oven to continue.',
    )
  if (rows.length && !active.length)
    throw new RegistrationError(
      403,
      'MEMBERSHIP_INACTIVE',
      'Your oven membership is inactive. No new oven was created.',
    )
  if (member)
    await client.query("SELECT set_config('app.business_id',$1,true)", [
      member.id,
    ])
  return member
}
export async function workspaceAccess(
  client: RegistrationClient,
  actor: RegistrationActor,
) {
  const { rows } = await client.query(
    'SELECT b.id,b.business_name AS name,u.role,u.active FROM users u JOIN businesses b ON b.id=u.business_id WHERE u.identity_id=$1 ORDER BY b.id',
    [actor.id],
  )
  const memberships = rows
    .filter((row) => row.active)
    .map(({ id, name, role }) => ({ id, name, role }))
  if (rows.length && !memberships.length)
    throw new RegistrationError(
      403,
      'MEMBERSHIP_INACTIVE',
      'Your oven membership is inactive. Contact your oven owner.',
    )
  const membership =
    memberships.find((row) => row.id === actor.selectedWorkspaceId) ||
    (memberships.length === 1 ? memberships[0] : null)
  return { memberships, membership, privateTest: actor.privateTest }
}
export async function registrationView(
  client: RegistrationClient,
  actor: RegistrationActor,
) {
  const membership = await currentMembership(client, actor)
  const { rows } = await client.query(
    'SELECT * FROM registration_drafts WHERE identity_id=$1',
    [actor.id],
  )
  return {
    privateTest: actor.privateTest,
    draft: actor.privateTest ? rows[0] || null : null,
    membership: membership
      ? {
          id: membership.id,
          name: membership.business_name,
          role: membership.role,
        }
      : null,
  }
}
const saveInput = z
  .object({
    action: z.literal('saveDraft'),
    planId: z.enum([
      'free',
      'mixing-bowl',
      'bakers-bench',
      'cottage-kitchen',
      'cottage-mercantile',
    ]),
    profile: businessProfile,
    marketingConsent: z.boolean().default(false),
  })
  .strict()
export async function saveRegistrationDraft(
  client: RegistrationClient,
  actor: RegistrationActor,
  input: unknown,
) {
  requirePrivateFixture(actor)
  const data = saveInput.parse(input)
  await registrationRateLimit(client, actor.id, 'draft', 60)
  await client.query(
    'INSERT INTO registration_drafts(identity_id,plan_id,profile,marketing_consent) VALUES($1,$2,$3,$4) ON CONFLICT(identity_id) DO UPDATE SET plan_id=EXCLUDED.plan_id,profile=EXCLUDED.profile,marketing_consent=EXCLUDED.marketing_consent,updated_at=NOW()',
    [
      actor.id,
      signupPlan(data.planId),
      JSON.stringify(data.profile),
      data.marketingConsent,
    ],
  )
  return registrationView(client, actor)
}
export async function acceptFixturePolicy(
  client: RegistrationClient,
  actor: RegistrationActor,
  input: unknown,
) {
  requirePrivateFixture(actor)
  const data = z
    .object({
      action: z.literal('acceptFixture'),
      version: z.literal('fixture:registration-v1'),
      accepted: z.literal(true),
    })
    .strict()
    .parse(input)
  const { rows } = await client.query(
    'SELECT identity_id FROM registration_drafts WHERE identity_id=$1',
    [actor.id],
  )
  if (!rows.length)
    throw new RegistrationError(
      409,
      'SETUP_REQUIRED',
      'Save your test business details first.',
    )
  await registrationRateLimit(client, actor.id, 'fixture-consent', 10)
  await client.query(
    'INSERT INTO registration_acceptances(identity_id,policy_version,test_only) SELECT $1,$2,true WHERE NOT EXISTS (SELECT 1 FROM registration_acceptances WHERE identity_id=$1 AND policy_version=$2)',
    [actor.id, data.version],
  )
  return {
    testOnly: true,
    accepted: true,
    message:
      'Development fixture only. This is not production legal acceptance.',
  }
}
export async function provisionTestWorkspace(
  client: RegistrationClient,
  actor: RegistrationActor,
) {
  requirePrivateFixture(actor)
  const existing = await currentMembership(client, actor)
  // Membership/invitation acceptance always wins; never create a second business.
  if (existing) return { existing: true, workspaceId: existing.id }
  const { rows } = await client.query(
    'SELECT * FROM registration_drafts WHERE identity_id=$1 FOR UPDATE',
    [actor.id],
  )
  const draft = rows[0]
  if (!draft?.test_only)
    throw new RegistrationError(
      409,
      'SETUP_REQUIRED',
      'Save your private test setup first.',
    )
  const profile = businessProfile.parse(draft.profile)
  const accepted = await client.query(
    "SELECT id FROM registration_acceptances WHERE identity_id=$1 AND test_only=true AND policy_version='fixture:registration-v1'",
    [actor.id],
  )
  if (!accepted.rows.length)
    throw new RegistrationError(
      409,
      'FIXTURE_ACCEPTANCE_REQUIRED',
      'Read and accept the development-only fixture first.',
    )
  // Paid and unfinished plans cannot enter a workspace without payment evidence.
  if (draft.plan_id !== 'free')
    throw new RegistrationError(
      409,
      'CHECKOUT_UNAVAILABLE',
      'Paid activation requires verified billing and explicit approval. Your draft is saved.',
    )
  await registrationRateLimit(client, actor.id, 'provision', 5)
  const id = randomUUID()
  await client.query(
    'INSERT INTO businesses(id,business_name,identity_owner) VALUES($1,$2,$3)',
    [id, profile.name, actor.id],
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
  const settings = {
    id: 'business',
    ...profile,
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
  }
  await client.query(
    'INSERT INTO settings(id,business_id,data) VALUES($1,$2,$3)',
    ['business', id, JSON.stringify(settings)],
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
  await client.query(
    "INSERT INTO workspace_billing(business_id,plan_id,source,status) VALUES($1,'free','free_sandbox','free_active')",
    [id],
  )
  await client.query(
    "UPDATE registration_drafts SET workspace_id=$2,stage='free_active',updated_at=NOW() WHERE identity_id=$1",
    [actor.id, id],
  )
  await client.query(
    "INSERT INTO registration_audit(actor_identity,business_id,action) VALUES($1,$2,'test_workspace_provisioned')",
    [actor.id, id],
  )
  return {
    existing: false,
    workspaceId: id,
    testOnly: true,
    message: 'You’re ready to get started. Private test oven only.',
  }
}
export async function saveChecklist(
  client: RegistrationClient,
  actor: RegistrationActor,
  input: unknown,
) {
  requirePrivateFixture(actor)
  const data = z
    .object({
      action: z.literal('checklist'),
      completed: z.array(z.enum(checklistSteps.map((s) => s[0]))).max(6),
    })
    .strict()
    .parse(input)
  await client.query(
    'UPDATE registration_drafts SET checklist=$2,updated_at=NOW() WHERE identity_id=$1',
    [actor.id, JSON.stringify([...new Set(data.completed)])],
  )
  return { saved: true }
}
export async function billingView(
  client: RegistrationClient,
  actor: RegistrationActor,
) {
  const { stripeOwnerView } = await import('./stripe-subscriptions')
  return stripeOwnerView(client, actor)
}
