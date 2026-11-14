import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { getDatabase } from '@netlify/database'

// Run only in a trusted operator environment with the intended Netlify Database
// branch injected. No browser endpoint, email matching, or first-signup bootstrap.
const siteId = '299e7942-6246-467a-bef5-fa3f6817b210'
function fail(): never {
  throw new Error(
    'Bootstrap refused. Verify operator ownership, the confirmed Identity ID, database branch, and migration readiness. No automatic account selection is supported.',
  )
}
function api(operation: string, data: Record<string, string>) {
  try {
    return JSON.parse(
      execFileSync(
        'netlify',
        ['api', operation, '--data', JSON.stringify(data)],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000 },
      ),
    )
  } catch {
    return fail()
  }
}
async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help')) {
    console.log(
      'Trusted operator bootstrap: --identity-id UUID --confirm-identity UUID --branch production|preview --confirm-branch production|preview. Requires owner-authenticated Netlify CLI and the intended Netlify Database runtime connection. Never accepts an email address as identity proof.',
    )
    return
  }
  const options = new Map<string, string>()
  for (let i = 0; i < args.length; i += 2) {
    if (
      ![
        '--identity-id',
        '--confirm-identity',
        '--branch',
        '--confirm-branch',
      ].includes(args[i]) ||
      !args[i + 1] ||
      options.has(args[i])
    )
      fail()
    options.set(args[i], args[i + 1])
  }
  const id = options.get('--identity-id')
  const branch = options.get('--branch')
  if (
    !id ||
    !/^[a-f0-9-]{36}$/i.test(id) ||
    id !== options.get('--confirm-identity') ||
    !['production', 'preview'].includes(branch || '') ||
    branch !== options.get('--confirm-branch')
  )
    fail()
  const configuredBranch = process.env.NETLIFY_DB_BRANCH
  if (
    !configuredBranch ||
    (branch === 'production'
      ? configuredBranch !== 'production'
      : configuredBranch === 'production')
  )
    fail()
  const site = api('getSite', { site_id: siteId })
  const operator = api('getCurrentUser', {})
  if (
    site.id !== siteId ||
    !operator.id ||
    site.user_id !== operator.id ||
    !site.identity_instance_id
  )
    fail()
  const identity = api('getIdentityUser', {
    site_id: siteId,
    identity_id: site.identity_instance_id,
    user_id: id,
  })
  if (
    identity.id !== id ||
    !identity.confirmed_at ||
    !Number.isFinite(Date.parse(identity.confirmed_at))
  )
    fail()
  // The verified site owner explicitly confirms this immutable Identity account.
  const client = await getDatabase().pool.connect()
  try {
    await client.query('BEGIN')
    await client.query("SELECT set_config('app.platform_gateway','true',true)")
    await client.query('SELECT pg_advisory_xact_lock(719113852)')
    const existing = await client.query(
      'SELECT identity_id FROM platform_admins LIMIT 1',
    )
    if (existing.rows.length) fail()
    await client.query(
      "INSERT INTO platform_admins(identity_id,role,granted_by,reason) VALUES($1,'owner',$2,$3)",
      [
        id,
        operator.id,
        'Initial owner bootstrap: verified Netlify site owner explicitly confirmed the immutable Identity account.',
      ],
    )
    await client.query(
      "INSERT INTO platform_audit(actor_id,action,target,outcome,reason,before,after,request_id) VALUES($1,'owner_bootstrap',$2,'success',$3,$4,$5,$6)",
      [
        operator.id,
        id,
        'Controlled owner bootstrap',
        JSON.stringify({ platformAccess: false }),
        JSON.stringify({ role: 'owner', sensitiveVerificationRequired: true }),
        randomUUID(),
      ],
    )
    await client.query('COMMIT')
    console.log(
      'Initial platform owner provisioned on the explicitly confirmed database branch. Complete password sign-in, then verify your password or an enrolled authenticator before sensitive actions. No customer, billing or subscription records were changed.',
    )
  } catch {
    await client.query('ROLLBACK')
    fail()
  } finally {
    client.release()
  }
}
main().catch(() => {
  console.error(
    'Controlled owner bootstrap did not complete. No credentials or provider details are printed.',
  )
  process.exitCode = 1
})
