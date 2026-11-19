import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SITE,
  classify,
  client,
  digest,
  execute,
  inventory,
  manifest,
  pages,
} from './database-branch-cleanup.mjs'
const policy = {
  siteId: SITE,
  protectedBranchIds: ['current-preview'],
  protectedDeployIds: [],
  currentPreviewProtected: true,
  closedWork: [
    {
      branchId: 'old',
      deployId: 'old',
      checkedAt: new Date().toISOString(),
      workflowStatus: 'closed',
      activeRun: false,
      openWork: false,
      awaitingReview: false,
      keepData: false,
      dependenciesVerified: true,
      evidence: 'Owner checked closed work and data retention.',
    },
  ],
}
const deploy = {
  id: 'old',
  database_branch_id: 'old',
  context: 'deploy-preview',
}
test('production/current preview are protected; age/completion alone never qualifies', () => {
  assert.equal(
    classify({ branch_id: 'production' }, [], policy).classification,
    'protected',
  )
  assert.equal(
    classify({ branch_id: 'current-preview' }, [], policy).classification,
    'protected',
  )
  assert.equal(
    classify({ branch_id: 'unknown', created_at: '2000-01-01' }, [], policy)
      .classification,
    'unknown',
  )
})
test('requires unique exact deploy mapping and fresh owner verification', () => {
  assert.equal(
    classify({ branch_id: 'old' }, [deploy], policy).classification,
    'candidate',
  )
  assert.equal(
    classify({ branch_id: 'old' }, [{ ...deploy, id: 'different' }], policy)
      .classification,
    'unknown',
  )
  assert.equal(
    classify({ branch_id: 'old' }, [deploy, deploy], policy).classification,
    'unknown',
  )
  assert.equal(
    classify({ branch_id: 'old' }, [deploy], policy, Date.now() + 86400001)
      .classification,
    'unknown',
  )
})
test('401/403 stop without retries or response-body leakage', async () => {
  for (const status of [401, 403]) {
    let calls = 0
    const api = client('private', async () => {
      calls++
      return new Response('sensitive', { status })
    })
    await assert.rejects(api('/test'), /Access denied/)
    assert.equal(calls, 1)
  }
})
test('transient retries bounded and rate limits respected', async () => {
  let calls = 0
  const waits = []
  const api = client(
    'private',
    async () => {
      calls++
      return calls < 3
        ? new Response('', { status: 429, headers: { 'retry-after': '1' } })
        : Response.json({ branches: [] })
    },
    async (ms) => waits.push(ms),
  )
  await api('/test')
  assert.deepEqual(waits, [1000, 1000])
  assert.equal(calls, 3)
})
test('unexpected delete response and transport ambiguity stop', async () => {
  await assert.rejects(
    client('private', async () => Response.json({}))('/test', 'DELETE'),
    /Unexpected delete/,
  )
  await assert.rejects(
    client('private', async () => {
      throw Error('secret')
    })('/test', 'DELETE'),
    /Transport failure/,
  )
})
test('pagination and strict list validation', async () => {
  let n = 0
  const result = await pages(
    async () => ({
      data: { branches: [{ branch_id: String(++n) }] },
      next: n === 1 ? '<next>; rel="next"' : null,
    }),
    '/branches',
    'branches',
  )
  assert.equal(result.length, 2)
  await assert.rejects(
    pages(
      async () => ({
        data: { branches: [{ branch_id: 'same' }] },
        next: 'rel="next"',
      }),
      '/branches',
      'branches',
    ),
    /duplicate/,
  )
})
function fixture() {
  let branches = [{ branch_id: 'old' }, { branch_id: 'production' }]
  const calls = []
  return {
    calls,
    api: async (path, method) => {
      calls.push([path, method])
      if (method === 'DELETE') {
        branches = branches.filter((b) => b.branch_id !== 'old')
        return { deleted: true }
      }
      if (path.includes('/database/branches')) return { data: { branches } }
      return { data: [deploy] }
    },
  }
}
test('execute approved list, verify reduction, resume without another delete', async () => {
  const f = fixture()
  const approved = manifest(await inventory(f.api, policy))
  const log = {}
  let saves = 0
  await execute(f.api, approved, policy, log, async () => saves++)
  assert.equal(log.before, 2)
  assert.equal(log.after, 1)
  assert.equal(log.reconciled, true)
  assert.equal(log.outcomes.old.status, 'Deleted')
  assert.ok(saves > 2)
  await execute(f.api, approved, policy, log, async () => {})
  assert.equal(f.calls.filter((c) => c[1] === 'DELETE').length, 1)
})
test('changed protection skips; manifest hash prevents expanded resume', async () => {
  const f = fixture()
  const approved = manifest(await inventory(f.api, policy))
  const log = {}
  await execute(
    f.api,
    approved,
    { ...policy, protectedBranchIds: ['old'] },
    log,
    async () => {},
  )
  assert.equal(log.outcomes.old.status, 'Skipped')
  assert.equal(f.calls.filter((c) => c[1] === 'DELETE').length, 0)
  await assert.rejects(
    execute(
      f.api,
      { ...approved, createdAt: 'changed' },
      policy,
      log,
      async () => {},
    ),
    /different manifest/,
  )
  assert.notEqual(digest(approved), digest({ ...approved, total: 0 }))
})
test('missing branch is verified already absent; unexplained counts stop', async () => {
  const f = fixture()
  const approved = manifest(await inventory(f.api, policy))
  const log = { manifestHash: digest(approved), before: 3, outcomes: {} }
  await assert.rejects(
    execute(f.api, approved, policy, log, async () => {}),
    /Counts do not reconcile/,
  )
})

test('DELETE server error is never blindly retried', async () => {
  let calls = 0
  const api = client('private', async () => {
    calls++
    return new Response('', { status: 500 })
  })
  await assert.rejects(api('/test', 'DELETE'), /outcome uncertain/)
  assert.equal(calls, 1)
})

test('verified absent target is logged without issuing DELETE', async () => {
  const f = fixture()
  const approved = manifest(await inventory(f.api, policy))
  const api = async (path, method) =>
    path.includes('/database/branches')
      ? { data: { branches: [{ branch_id: 'production' }] } }
      : f.api(path, method)
  const log = {}
  await execute(api, approved, policy, log, async () => {})
  assert.equal(log.outcomes.old.status, 'Already absent')
  assert.equal(log.before, 1)
  assert.equal(log.after, 1)
  assert.equal(f.calls.filter((c) => c[1] === 'DELETE').length, 0)
})
