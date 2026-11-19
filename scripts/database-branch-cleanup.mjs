#!/usr/bin/env node
// Administrative CLI only. Never imported by the application.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
export const SITE = '299e7942-6246-467a-bef5-fa3f6817b210'
export const digest = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex')
const id = (value) =>
  typeof value === 'string' && /^[a-zA-Z0-9_-]+$/.test(value)
const fail = (message) => {
  throw new Error(message)
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
export function client(token, fetcher = fetch, sleep = pause) {
  if (!token)
    fail(
      'Set NETLIFY_AUTH_TOKEN securely in your shell or secret manager; never paste it into chat.',
    )
  return async (path, method = 'GET') => {
    for (let attempt = 0; attempt < 3; attempt++) {
      let response
      try {
        response = await fetcher(`https://api.netlify.com/api/v1${path}`, {
          method,
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(30000),
        })
      } catch {
        fail(
          'Transport failure; outcome is uncertain. Re-inventory before resuming.',
        )
      }
      if ([401, 403].includes(response.status))
        fail(
          `Access denied (${response.status}); stopped. Use an owner-authorized Netlify access token with site/database access.`,
        )
      if (method === 'DELETE' && response.status >= 500)
        fail(
          'Delete outcome uncertain after server error; re-inventory before resuming.',
        )
      if (response.status === 429 || response.status >= 500) {
        if (attempt === 2)
          fail(`Transient HTTP ${response.status}; retry limit reached.`)
        const retry = response.headers.get('retry-after')
        const delay = retry
          ? /^\d+$/.test(retry)
            ? Number(retry) * 1000
            : Date.parse(retry) - Date.now()
          : 1000 * 2 ** attempt
        if (!Number.isFinite(delay) || delay > 60000)
          fail('Rate limit requires a longer wait; resume later.')
        await sleep(Math.max(0, delay))
        continue
      }
      if (method === 'DELETE') {
        if (response.status === 204) return { deleted: true }
        if (response.status === 404) return { absent: true }
        fail(`Unexpected delete HTTP ${response.status}; stopped.`)
      }
      if (response.status !== 200)
        fail(`Unexpected inventory HTTP ${response.status}; stopped.`)
      try {
        return {
          data: await response.json(),
          next: response.headers.get('link'),
        }
      } catch {
        fail('Unexpected API response; stopped.')
      }
    }
  }
}
export async function pages(api, path, key) {
  const items = []
  const seen = new Set()
  for (let page = 1; page <= 10000; page++) {
    const result = await api(
      `${path}${path.includes('?') ? '&' : '?'}page=${page}&per_page=100`,
    )
    const batch = key ? result.data[key] : result.data
    if (!Array.isArray(batch)) fail('Unexpected list schema; stopped.')
    for (const item of batch) {
      const identity = key ? item.branch_id : item.id
      if (!id(identity) || seen.has(identity))
        fail('Invalid/duplicate paginated identity; stopped.')
      seen.add(identity)
      items.push(item)
    }
    // Branch listing currently returns all branches without pagination parameters.
    if (key && !result.next?.includes('rel="next"')) return items
    if (!key && batch.length < 100 && !result.next?.includes('rel="next"'))
      return items
  }
  fail('Pagination limit exceeded; stopped.')
}
export function classify(branch, deploys, policy, now = Date.now()) {
  const matching = deploys.filter(
    (d) => d.database_branch_id === branch.branch_id,
  )
  const deploy = matching.length === 1 ? matching[0] : null
  const attestation = policy.closedWork?.find(
    (a) => a.branchId === branch.branch_id && a.deployId === deploy?.id,
  )
  const record = {
    branchId: branch.branch_id,
    name: branch.name || null,
    deployId: deploy?.id || null,
    pr: deploy?.review_id ?? null,
    gitBranch: deploy?.branch ?? null,
    agentRun: null,
    createdAt: branch.created_at || null,
    lastActiveAt: branch.last_active_at || branch.updated_at || null,
    workflowStatus: attestation?.workflowStatus || 'unverified',
    databaseState: branch.state || null,
    classification: 'unknown',
    evidence: [
      'Workflow/dependency/preview data retention requires owner verification.',
    ],
  }
  const protectedBranch =
    branch.branch_id === 'production' ||
    matching.some((d) => d.context === 'production') ||
    policy.protectedBranchIds?.includes(branch.branch_id) ||
    matching.some((d) => policy.protectedDeployIds?.includes(d.id)) ||
    /^(production|staging)$/i.test(branch.name || '')
  if (protectedBranch)
    return {
      ...record,
      classification: 'protected',
      evidence: ['Production/staging or explicit retention/review hold.'],
    }
  // Reconcile both API contracts: NEVER put a different branch ID into a deploy-ID delete path.
  if (!deploy || deploy.id !== branch.branch_id)
    return {
      ...record,
      evidence: [
        'No unique API-verified deploy association with identical branch/deploy IDs; deletion blocked.',
      ],
    }
  if (!['deploy-preview', 'branch-deploy'].includes(deploy.context))
    return record
  const fresh =
    attestation &&
    now - Date.parse(attestation.checkedAt) >= 0 &&
    now - Date.parse(attestation.checkedAt) < 86400000
  if (
    fresh &&
    attestation.workflowStatus === 'closed' &&
    attestation.activeRun === false &&
    attestation.openWork === false &&
    attestation.awaitingReview === false &&
    attestation.keepData === false &&
    attestation.dependenciesVerified === true &&
    typeof attestation.evidence === 'string' &&
    attestation.evidence.trim()
  ) {
    return {
      ...record,
      classification: 'candidate',
      evidence: [
        'API deploy.database_branch_id matches exactly.',
        attestation.evidence,
      ],
      reason:
        'Owner verified closed work, no active run, review hold, retained data or dependencies.',
    }
  }
  return record
}
export async function inventory(api, policy) {
  if (
    policy.siteId !== SITE ||
    !Array.isArray(policy.protectedBranchIds) ||
    !Array.isArray(policy.protectedDeployIds) ||
    policy.currentPreviewProtected !== true
  )
    fail(
      'Policy must identify this site and explicitly protect current preview/work and retained environments.',
    )
  const branches = await pages(
    api,
    `/sites/${SITE}/database/branches`,
    'branches',
  )
  const deploys = await pages(api, `/sites/${SITE}/deploys`)
  return branches.map((b) => classify(b, deploys, policy))
}
export function manifest(records) {
  const targets = records
    .filter((r) => r.classification === 'candidate')
    .map(({ branchId, deployId, reason, evidence }) => ({
      branchId,
      deployId,
      reason,
      evidence,
    }))
  return {
    version: 1,
    siteId: SITE,
    createdAt: new Date().toISOString(),
    total: targets.length,
    targets,
    excluded: records.filter((r) => r.classification !== 'candidate'),
  }
}
export async function execute(api, approved, policy, log, save) {
  if (
    approved.siteId !== SITE ||
    approved.version !== 1 ||
    approved.total !== approved.targets?.length ||
    !Array.isArray(approved.excluded)
  )
    fail('Invalid manifest.')
  const identities = new Set()
  for (const t of approved.targets) {
    if (
      !id(t.branchId) ||
      !id(t.deployId) ||
      t.branchId !== t.deployId ||
      !t.reason ||
      identities.has(t.branchId)
    )
      fail('Ambiguous/duplicate target; stopped.')
    identities.add(t.branchId)
  }
  const hash = digest(approved)
  if (log.manifestHash && log.manifestHash !== hash)
    fail('Resume log belongs to a different manifest.')
  log.manifestHash = hash
  log.outcomes ||= {}
  const before = await inventory(api, policy)
  log.before ??= before.length
  await save(log)
  for (const target of approved.targets) {
    if (
      ['Deleted', 'Already absent'].includes(
        log.outcomes[target.branchId]?.status,
      )
    )
      continue
    const current = await inventory(api, policy)
    const found = current.find((r) => r.branchId === target.branchId)
    if (!found)
      log.outcomes[target.branchId] = {
        status: 'Already absent',
        checkedAt: new Date().toISOString(),
      }
    else if (
      found.classification !== 'candidate' ||
      found.deployId !== target.deployId
    )
      log.outcomes[target.branchId] = {
        status: 'Skipped',
        reason: 'Identity or protection state changed.',
      }
    else {
      // Log intent before mutation; an interrupted request is reconciled by the next inventory.
      log.outcomes[target.branchId] = { status: 'Pending' }
      await save(log)
      try {
        const result = await api(
          `/sites/${SITE}/database/branch/${encodeURIComponent(target.deployId)}`,
          'DELETE',
        )
        const refreshed = await inventory(api, policy)
        if (refreshed.some((r) => r.branchId === target.branchId))
          fail('Deleted target remains present; stopped.')
        log.outcomes[target.branchId] = {
          status: result.deleted ? 'Deleted' : 'Already absent',
          checkedAt: new Date().toISOString(),
        }
      } catch (error) {
        log.outcomes[target.branchId] = {
          status: 'Failed',
          reason: error.message,
        }
        await save(log)
        throw error
      }
    }
    await save(log)
  }
  const after = await inventory(api, policy)
  const deleted = Object.values(log.outcomes).filter(
    (o) => o.status === 'Deleted',
  ).length
  log.after = after.length
  log.remaining = after
  log.reconciled = log.before - log.after === deleted
  await save(log)
  if (!log.reconciled)
    fail(
      'Counts do not reconcile (including external changes or interrupted deletions); inspect inventories before proceeding.',
    )
  return log
}
async function main() {
  const [mode = 'inventory', ...rest] = process.argv.slice(2)
  const options = Object.fromEntries(
    rest.map((arg) => {
      const at = arg.indexOf('=')
      if (!arg.startsWith('--') || at < 3) fail('Use --name=value options.')
      return [arg.slice(2, at), arg.slice(at + 1)]
    }),
  )
  if (!['inventory', 'execute'].includes(mode))
    fail('Modes: inventory (default), execute.')
  const directory = resolve('.netlify/database-cleanup')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const json = async (path) => JSON.parse(await readFile(path, 'utf8'))
  const policy = await json(options.policy || `${directory}/policy.json`)
  const api = client(process.env.NETLIFY_AUTH_TOKEN)
  if (mode === 'inventory') {
    const records = await inventory(api, policy)
    const proposal = manifest(records)
    await writeFile(
      `${directory}/inventory.json`,
      JSON.stringify(records, null, 2),
      { mode: 0o600 },
    )
    await writeFile(
      `${directory}/manifest.json`,
      JSON.stringify(proposal, null, 2),
      { mode: 0o600 },
    )
    const table = [
      '| Database branch | Deploy | Status | Evidence |',
      '|---|---|---|---|',
      ...records.map(
        (r) =>
          `| ${r.branchId} | ${r.deployId || 'unverified'} | ${r.classification} | ${r.evidence.join(' ').replaceAll('|', '\\|')} |`,
      ),
    ].join('\n')
    await writeFile(`${directory}/report.md`, table, { mode: 0o600 })
    console.log(
      `Branches: ${records.length}; proposed: ${proposal.total}. Private report and manifest: ${directory}. SHA256: ${digest(proposal)}`,
    )
  } else {
    if (!options.manifest || !options['approve-sha256'])
      fail(
        'Execution requires an exact manifest file and its owner-approved SHA256.',
      )
    const approved = await json(options.manifest)
    if (digest(approved) !== options['approve-sha256'])
      fail('Approval digest does not match manifest.')
    const path = options.log || `${directory}/execution.json`
    let log = {}
    try {
      log = await json(path)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    const save = async (value) => {
      // Atomic replacement prevents a partially written resume log.
      const { rename } = await import('node:fs/promises')
      await writeFile(`${path}.tmp`, JSON.stringify(value, null, 2), {
        mode: 0o600,
      })
      await rename(`${path}.tmp`, path)
    }
    const result = await execute(api, approved, policy, log, save)
    console.log(
      `Before: ${result.before}; after: ${result.after}; outcomes: ${JSON.stringify(result.outcomes)}; reconciled: ${result.reconciled}`,
    )
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
