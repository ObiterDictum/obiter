import { afterAll, describe, expect, it } from 'bun:test'
import { createTestPool } from '../test-database.test-support'
import {
  app,
  auditCount,
  cleanupMatter,
  editorUser,
  expectConcealed,
  jsonRequest,
  ownerUser,
  seedMatter,
  shareApp,
  specs,
  state,
  storageFor,
} from './document-write-share-revocation.test-support'
import {
  isMatterLockStatement,
  transactionObserveGate,
  transactionPauseGate,
  waitForLockWait,
} from './matter-lock-race.test-support'

type WriteSpec = (typeof specs)[number]

const pool = createTestPool()

function requirePid(pid: number | undefined, label: string) {
  if (pid === undefined)
    throw new Error(`${label} backend pid was not captured`)
  return pid
}

async function openRevocation(
  seed: Awaited<ReturnType<typeof seedMatter>>,
  revocation: 'revoke' | 'downgrade',
) {
  const revoker = transactionPauseGate(pool, isMatterLockStatement)
  const owner = shareApp(revoker.pool, ownerUser(seed), 'req_race')
  const request =
    revocation === 'revoke'
      ? owner.request(`/api/matters/${seed.matterId}/shares/${seed.shareId}`, {
          method: 'DELETE',
        })
      : owner.request(
          `/api/matters/${seed.matterId}/shares`,
          jsonRequest('POST', {
            granteeUserId: seed.editorId,
            accessLevel: 'view',
          }),
        )
  await revoker.entered
  return { revoker, request }
}

async function runWriterBlocked(
  spec: WriteSpec,
  revocation: 'revoke' | 'downgrade',
) {
  const seed = await seedMatter(pool, 'edit')
  try {
    const storage = storageFor(seed)
    const writerGate = transactionObserveGate(pool, isMatterLockStatement)
    const writer = app(writerGate.pool, storage, editorUser(seed), 'req_race')
    const { revoker, request } = await openRevocation(seed, revocation)

    const writing = writer.request(
      spec.path(seed),
      jsonRequest(spec.method, spec.payload(seed)),
    )
    await writerGate.entered

    const blockers = await waitForLockWait(
      pool,
      requirePid(writerGate.backendPid, 'writer'),
    )
    expect(blockers).toContain(requirePid(revoker.backendPid, 'revoker'))

    revoker.open()
    const revoked = await request
    expect(revoked.status).toBe(revocation === 'revoke' ? 200 : 201)

    await expectConcealed(await writing)

    const after = await state(pool, seed)
    expect(after.versions).toBe(1)
    expect(after.currentVersionId).toBe(seed.versionId)
    expect(after.unresolvedComments).toBe(1)
    expect(after.shares).toBe(revocation === 'revoke' ? 0 : 1)
    expect(await auditCount(pool, seed, spec.actions)).toBe(0)
    expect(storage.writes).toEqual([])
  } finally {
    await cleanupMatter(pool, seed)
  }
}

async function runWriterWins(spec: WriteSpec) {
  const seed = await seedMatter(pool, 'edit')
  try {
    const storage = storageFor(seed)
    const writerGate = transactionPauseGate(pool, isMatterLockStatement)
    const revokerGate = transactionObserveGate(pool, isMatterLockStatement)
    const writer = app(writerGate.pool, storage, editorUser(seed), 'req_race')
    const owner = shareApp(revokerGate.pool, ownerUser(seed), 'req_race')

    const writing = writer.request(
      spec.path(seed),
      jsonRequest(spec.method, spec.payload(seed)),
    )
    await writerGate.entered

    const revoking = owner.request(
      `/api/matters/${seed.matterId}/shares/${seed.shareId}`,
      { method: 'DELETE' },
    )
    await revokerGate.entered

    const blockers = await waitForLockWait(
      pool,
      requirePid(revokerGate.backendPid, 'revoker'),
    )
    expect(blockers).toContain(requirePid(writerGate.backendPid, 'writer'))

    writerGate.open()
    const written = await writing
    expect(written.status).toBe(spec.successStatus)
    expect(await auditCount(pool, seed, spec.actions)).toBe(spec.actions.length)

    const revoked = await revoking
    expect(revoked.status).toBe(200)
    const after = await state(pool, seed)
    expect(after.versions).toBe(spec.kind === 'version' ? 2 : 1)
    expect(after.unresolvedComments).toBe(spec.unresolvedAfterWrite)
    expect(after.shares).toBe(0)
  } finally {
    await cleanupMatter(pool, seed)
  }
}

for (const spec of specs) {
  describe(`${spec.name} blocked on a revocation-held matter lock`, () => {
    it('denies the write after an explicit share revocation commits', async () => {
      await runWriterBlocked(spec, 'revoke')
    }, 30_000)

    it('denies the write after an edit-to-view downgrade commits', async () => {
      await runWriterBlocked(spec, 'downgrade')
    }, 30_000)

    it('lets the write that holds the matter lock commit before revocation', async () => {
      await runWriterWins(spec)
    }, 30_000)
  })
}

afterAll(async () => {
  await pool.end()
})
