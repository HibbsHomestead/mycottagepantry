import {
  currentMembership,
  RegistrationError,
  type RegistrationClient,
  type RegistrationActor,
} from './registration-core'

export async function stripeBillingOwner(
  c: RegistrationClient,
  actor: RegistrationActor,
) {
  const member = await currentMembership(c, actor)
  if (!member)
    throw new RegistrationError(
      409,
      'BUSINESS_SETUP_REQUIRED',
      'Complete your verified business setup before opening billing. Choosing a plan does not activate paid access.',
    )
  if (member.role !== 'Owner')
    throw new RegistrationError(
      403,
      'OWNER_REQUIRED',
      'Only an active business owner can manage billing for this business.',
    )
  await c.query("SELECT set_config('app.billing_worker','true',true)")
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,717))', [
    member.id,
  ])
  return member
}
