import { getDatabase } from '@netlify/database'
import { z } from 'zod'
import {
  registrationPolicySchema,
  type RegistrationPolicy,
} from '../../src/lib/free-registration-policy'
import { AdminError, audit, type AdminClient } from './platform-admin-core'
import type { RegistrationClient } from './registration-core'
import type { AdminMetadata } from '../../src/lib/platform-admin-types'
import { limitedBody } from './support-core'

export async function currentRegistrationPolicy(
  client: Pick<RegistrationClient, 'query'>,
): Promise<RegistrationPolicy | null> {
  const row = (
    await client.query(
      'SELECT revision,terms,privacy FROM registration_policies ORDER BY id DESC LIMIT 1',
    )
  ).rows[0]
  return row ? registrationPolicySchema.parse(row) : null
}

export async function publicRegistrationPolicy() {
  const client = await getDatabase().pool.connect()
  try {
    return await currentRegistrationPolicy(client)
  } finally {
    client.release()
  }
}

/** The caller has verified the platform session, host, origin, and rate limit. */
export async function handleRegistrationPolicies(
  client: AdminClient,
  request: Request,
  session: AdminMetadata,
  reference: string,
) {
  if (!session.mfa_at || session.role !== 'owner')
    throw new AdminError(
      403,
      'OWNER_REQUIRED',
      'A verified platform owner must publish registration policies.',
    )
  if (request.method === 'GET') {
    return {
      policy: await currentRegistrationPolicy(client),
      history: (
        await client.query(
          'SELECT revision,published_at FROM registration_policies ORDER BY id DESC LIMIT 20',
        )
      ).rows,
    }
  }
  if (request.method !== 'POST')
    throw new AdminError(405, 'METHOD_NOT_ALLOWED', 'Use GET or POST.')
  const data = z
    .object({
      policy: registrationPolicySchema,
      approved: z.literal(true),
      expectedRevision: z.string().max(100).nullable(),
    })
    .strict()
    .parse(JSON.parse((await limitedBody(request, 1250000)).toString()))
  // Shared with provisioning: accepted revision is current at transaction commit.
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('registration-policies',0))",
  )
  const previous = await currentRegistrationPolicy(client)
  if ((previous?.revision ?? null) !== data.expectedRevision)
    throw new AdminError(
      409,
      'POLICY_CHANGED',
      'Another policy version was published. Reload published policies and review before publishing; your editor is preserved.',
    )
  const duplicate = await client.query(
    'SELECT revision FROM registration_policies WHERE revision=$1',
    [data.policy.revision],
  )
  if (duplicate.rows.length)
    throw new AdminError(
      409,
      'REVISION_EXISTS',
      'Use a new revision. Published policy versions cannot be overwritten.',
    )
  await client.query(
    'INSERT INTO registration_policies(revision,terms,privacy,published_by) VALUES($1,$2,$3,$4)',
    [
      data.policy.revision,
      data.policy.terms,
      data.policy.privacy,
      session.identity_id,
    ],
  )
  await audit(
    client,
    session.identity_id,
    'publish:registration-policies',
    data.policy.revision,
    'success',
    reference,
    null,
    { revision: previous?.revision ?? null },
    { revision: data.policy.revision },
  )
  return { policy: data.policy }
}
