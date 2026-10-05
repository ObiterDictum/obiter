import { afterAll, describe, expect, it } from 'bun:test'
import { resolveMatterAccess } from '../document-access'
import { createTestPool } from '../test-database.test-support'
import {
  accessGate,
  app,
  auditCount,
  cleanupMatter,
  editableRunId,
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

const raceIterations = 5
const pool = createTestPool()

for (const spec of specs) {
  describe(spec.name, () => {
    it('denies a write whose early check passed but whose share was revoked first', async () => {
      for (let iteration = 0; iteration < raceIterations; iteration += 1) {
        const seed = await seedMatter(pool, 'edit')
        try {
          const storage = storageFor(seed)
          const gate = accessGate(pool)
          const writer = app(
            gate.pool,
            storage,
            editorUser(seed),
            'req_race_write',
          )
          const owner = shareApp(pool, ownerUser(seed), 'req_race_revoke')

          // The early decision is authorisation at request time, before the
          // revocation below commits. The service must not trust it.
          expect(
            await resolveMatterAccess(
              pool,
              {
                id: seed.editorId,
                organisationId: seed.orgId,
                role: 'member',
              },
              seed.matterId,
              'edit',
            ),
          ).toBe('edit')

          const writing = writer.request(
            spec.path(seed),
            jsonRequest(spec.method, spec.payload(seed)),
          )
          await gate.entered

          const revoked = await owner.request(
            `/api/matters/${seed.matterId}/shares/${seed.shareId}`,
            { method: 'DELETE' },
          )
          expect(revoked.status).toBe(200)

          gate.open()
          await expectConcealed(await writing)

          const after = await state(pool, seed)
          expect(after.versions).toBe(1)
          expect(after.currentVersionId).toBe(seed.versionId)
          expect(after.unresolvedComments).toBe(1)
          expect(after.shares).toBe(0)
          expect(await auditCount(pool, seed, spec.actions)).toBe(0)
          expect(storage.writes).toEqual([])
        } finally {
          await cleanupMatter(pool, seed)
        }
      }
    }, 30_000)

    it('lets a write that commits first stand and revocation proceed', async () => {
      const seed = await seedMatter(pool, 'edit')
      try {
        const storage = storageFor(seed)
        const writer = app(pool, storage, editorUser(seed), 'req_race_write')
        const owner = shareApp(pool, ownerUser(seed), 'req_race_revoke')

        const response = await writer.request(
          spec.path(seed),
          jsonRequest(spec.method, spec.payload(seed)),
        )
        expect(response.status).toBe(spec.successStatus)
        expect(await auditCount(pool, seed, spec.actions)).toBe(
          spec.actions.length,
        )
        const committed = await state(pool, seed)
        expect(committed.versions).toBe(spec.kind === 'version' ? 2 : 1)
        expect(committed.unresolvedComments).toBe(spec.unresolvedAfterWrite)

        const revoked = await owner.request(
          `/api/matters/${seed.matterId}/shares/${seed.shareId}`,
          { method: 'DELETE' },
        )
        expect(revoked.status).toBe(200)
        const after = await state(pool, seed)
        expect(after.shares).toBe(0)
        expect(after.versions).toBe(spec.kind === 'version' ? 2 : 1)
      } finally {
        await cleanupMatter(pool, seed)
      }
    })

    it('denies a writer whose edit share is downgraded to view while it waits', async () => {
      const seed = await seedMatter(pool, 'edit')
      try {
        const storage = storageFor(seed)
        const gate = accessGate(pool)
        const writer = app(
          gate.pool,
          storage,
          editorUser(seed),
          'req_race_write',
        )
        const owner = shareApp(pool, ownerUser(seed), 'req_race_revoke')

        const writing = writer.request(
          spec.path(seed),
          jsonRequest(spec.method, spec.payload(seed)),
        )
        await gate.entered

        const downgraded = await owner.request(
          `/api/matters/${seed.matterId}/shares`,
          jsonRequest('POST', {
            granteeUserId: seed.editorId,
            accessLevel: 'view',
          }),
        )
        expect(downgraded.status).toBe(201)

        gate.open()
        await expectConcealed(await writing)

        const after = await state(pool, seed)
        expect(after.versions).toBe(1)
        expect(after.unresolvedComments).toBe(1)
        expect(after.shares).toBe(1)
        expect(await auditCount(pool, seed, spec.actions)).toBe(0)
        expect(storage.writes).toEqual([])
      } finally {
        await cleanupMatter(pool, seed)
      }
    })
  })
}

describe('collaboration already_applied replay', () => {
  it('does not answer a revoked grantee with a replay of an earlier merge', async () => {
    const seed = await seedMatter(pool, 'edit')
    try {
      const storage = storageFor(seed)
      const writer = app(pool, storage, editorUser(seed), 'req_race_write')
      const owner = shareApp(pool, ownerUser(seed), 'req_race_revoke')
      const path = `/api/documents/${seed.documentId}/collaboration/merge`
      const payload = {
        baseVersionId: seed.versionId,
        syncId: `sync_${seed.documentId}`,
        operations: [
          {
            type: 'replace_run_text',
            runId: editableRunId,
            text: 'Race merge',
          },
        ],
        trackChanges: false,
      }

      const first = await writer.request(path, jsonRequest('POST', payload))
      expect(first.status).toBe(201)

      // Replay through the gate: the early check sees the pre-revocation share,
      // then revocation commits before the service re-reads authorization. A
      // revoked grantee must not receive the idempotent replay.
      const gate = accessGate(pool)
      const replayWriter = app(
        gate.pool,
        storage,
        editorUser(seed),
        'req_race_replay',
      )
      const replaying = replayWriter.request(path, jsonRequest('POST', payload))
      await gate.entered

      const revoked = await owner.request(
        `/api/matters/${seed.matterId}/shares/${seed.shareId}`,
        { method: 'DELETE' },
      )
      expect(revoked.status).toBe(200)

      gate.open()
      const replay = await replaying
      await expectConcealed(replay)
      expect(
        await auditCount(pool, seed, ['document.collaboration_merge']),
      ).toBe(1)
      expect((await state(pool, seed)).versions).toBe(2)
    } finally {
      await cleanupMatter(pool, seed)
    }
  })
})

describe('write-path controls', () => {
  it('lets an owner edit without a share', async () => {
    const seed = await seedMatter(pool, null)
    try {
      const storage = storageFor(seed)
      const writer = app(pool, storage, ownerUser(seed), 'req_control')
      const response = await writer.request(
        `/api/documents/${seed.documentId}/edit`,
        jsonRequest('POST', {
          baseVersionId: seed.versionId,
          operations: [
            {
              type: 'replace_run_text',
              runId: editableRunId,
              text: 'Owner edit',
            },
          ],
          trackChanges: false,
        }),
      )
      expect(response.status).toBe(201)
      expect((await state(pool, seed)).versions).toBe(2)
    } finally {
      await cleanupMatter(pool, seed)
    }
  })

  it('denies a view-only share at the route before any write', async () => {
    const seed = await seedMatter(pool, 'view')
    try {
      const storage = storageFor(seed)
      const writer = app(pool, storage, editorUser(seed), 'req_control')
      const response = await writer.request(
        `/api/documents/${seed.documentId}/edit`,
        jsonRequest('POST', {
          baseVersionId: seed.versionId,
          operations: [
            {
              type: 'replace_run_text',
              runId: editableRunId,
              text: 'View edit',
            },
          ],
          trackChanges: false,
        }),
      )
      await expectConcealed(response)
      expect(storage.writes).toEqual([])
      expect((await state(pool, seed)).versions).toBe(1)
    } finally {
      await cleanupMatter(pool, seed)
    }
  })

  it('denies an editor with no share and a cross-organisation stranger', async () => {
    const seed = await seedMatter(pool, null)
    try {
      const storage = storageFor(seed)
      const noShare = app(pool, storage, editorUser(seed), 'req_control')
      await expectConcealed(
        await noShare.request(
          `/api/documents/${seed.documentId}/edit`,
          jsonRequest('POST', {
            baseVersionId: seed.versionId,
            operations: [
              {
                type: 'replace_run_text',
                runId: editableRunId,
                text: 'No share',
              },
            ],
          }),
        ),
      )
      const stranger = app(
        pool,
        storage,
        {
          id: seed.strangerId,
          organisationId: seed.otherOrgId,
          role: 'member',
        },
        'req_control',
      )
      await expectConcealed(
        await stranger.request(
          `/api/documents/${seed.documentId}/edit`,
          jsonRequest('POST', {
            baseVersionId: seed.versionId,
            operations: [
              {
                type: 'replace_run_text',
                runId: editableRunId,
                text: 'Cross org',
              },
            ],
          }),
        ),
      )
      expect((await state(pool, seed)).versions).toBe(1)
      expect(storage.writes).toEqual([])
    } finally {
      await cleanupMatter(pool, seed)
    }
  })

  it('returns the stale-version conflict without creating a version', async () => {
    const seed = await seedMatter(pool, 'edit')
    try {
      const storage = storageFor(seed)
      const writer = app(pool, storage, editorUser(seed), 'req_control')
      const response = await writer.request(
        `/api/documents/${seed.documentId}/edit`,
        jsonRequest('POST', {
          baseVersionId: 'ver_stale',
          operations: [
            { type: 'replace_run_text', runId: editableRunId, text: 'Stale' },
          ],
        }),
      )
      expect(response.status).toBe(409)
      await expect(response.json()).resolves.toMatchObject({
        error: { code: 'conflict_detected' },
      })
      expect((await state(pool, seed)).versions).toBe(1)
      expect(storage.writes).toEqual([])
    } finally {
      await cleanupMatter(pool, seed)
    }
  })

  it('rolls back a failed candidate write without a version or audit', async () => {
    const seed = await seedMatter(pool, 'edit')
    try {
      const storage = storageFor(seed)
      storage.writeFailure = true
      const writer = app(pool, storage, editorUser(seed), 'req_control')
      const response = await writer.request(
        `/api/documents/${seed.documentId}/edit`,
        jsonRequest('POST', {
          baseVersionId: seed.versionId,
          operations: [
            { type: 'replace_run_text', runId: editableRunId, text: 'Fail' },
          ],
        }),
      )
      expect(response.status).toBe(500)
      const after = await state(pool, seed)
      expect(after.versions).toBe(1)
      expect(after.currentVersionId).toBe(seed.versionId)
      expect(after.shares).toBe(1)
      expect(
        await auditCount(pool, seed, [
          'document.version_create',
          'document.edit',
        ]),
      ).toBe(0)
      expect(storage.deletes).toEqual(storage.writes)
    } finally {
      await cleanupMatter(pool, seed)
    }
  })
})

afterAll(async () => {
  await pool.end()
})
