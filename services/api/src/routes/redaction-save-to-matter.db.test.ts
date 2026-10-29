import { createHash } from 'node:crypto'
import { afterAll, describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import type { AuthzVariables } from '../authz'
import { createTestPool } from '../test-database.test-support'
import { createRedactLifecycleRoutes } from './redact-lifecycle'
import {
  cleanupMatter,
  editorUser,
  ownerUser,
  seedMatter,
  storageFor,
} from './document-write-share-revocation.test-support'

/**
 * Filing a standalone run's copy into a matter, against a real database and a
 * real route. A run that began as a loose upload has no version to return to,
 * so this path creates the document: the access check on the chosen matter, the
 * stored bytes, the extraction and the audit entries all have to be the real
 * production path, not a mock of it.
 */
const pool = createTestPool()
const copyBytes = Buffer.from(
  'Synthetic redacted witness statement for the schema test.\n',
)
const copySha256 = createHash('sha256').update(copyBytes).digest('hex')

type Seed = Awaited<ReturnType<typeof seedMatter>>

interface StandaloneSeed extends Seed {
  runId: string
  outputId: string
  outputKey: string
}

async function seedStandaloneRun(seed: Seed): Promise<StandaloneSeed> {
  const runId = `red_standalone_${seed.documentId}`
  const outputId = `out_standalone_${seed.documentId}`
  // The outputs table constrains the key shape: org/<org>/outputs/<id>.
  const outputKey = `org/${seed.orgId}/outputs/${outputId}`
  await pool.query(
    `insert into outputs (
       id, organisation_id, matter_id, document_id, document_version_id,
       output_type, status, object_key, created_by, created_at, updated_at
     ) values ($1, $2, null, null, null, 'redaction_output', 'ready', $3, $4,
       now(), now())`,
    [outputId, seed.orgId, outputKey, seed.ownerId],
  )
  await pool.query(
    `insert into redaction_runs (
       id, organisation_id, matter_id, document_id, document_version_id,
       source_filename, status, policy_mode, spans_json, decisions_json,
       output_id, summary_json, detection_mode, created_by,
       created_at, updated_at
     ) values ($1, $2, null, null, null, 'pasted-extract.txt', 'finalized',
       'internal_ai_minimisation', '[]'::jsonb, '{}'::jsonb, $3, $4::jsonb,
       'model+supplement', $5, now(), now())`,
    [
      runId,
      seed.orgId,
      outputId,
      JSON.stringify({
        outputMimeType: 'text/plain',
        outputFilename: 'pasted-extract-redacted.txt',
        outputSha256: copySha256,
      }),
      seed.ownerId,
    ],
  )
  return { ...seed, runId, outputId, outputKey }
}

function saveApp(storage: unknown, user: AuthzVariables['user']) {
  const routes = new Hono<{ Variables: AuthzVariables }>()
  routes.use('*', async (c, next) => {
    c.set('requestId', 'req_save_to_matter')
    c.set('user', user)
    await next()
  })
  routes.route(
    '/',
    createRedactLifecycleRoutes(
      pool,
      storage as Parameters<typeof createRedactLifecycleRoutes>[1],
    ),
  )
  return routes
}

function saveRequest(matterId: string) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ matterId }),
  }
}

async function cleanupRun(seed: StandaloneSeed) {
  await pool.query(`delete from redaction_runs where organisation_id = $1`, [
    seed.orgId,
  ])
  await pool.query(`delete from outputs where organisation_id = $1`, [
    seed.orgId,
  ])
  await cleanupMatter(pool, seed)
}

describe('POST /api/redaction-runs/:runId/save-to-matter', () => {
  it('creates the document, its version, its text and the audit record', async () => {
    const seed = await seedStandaloneRun(await seedMatter(pool, null))
    try {
      const storage = storageFor(seed)
      storage.binary.set(seed.outputKey, copyBytes)
      const app = saveApp(storage, ownerUser(seed))
      const response = await app.request(
        `/api/redaction-runs/${seed.runId}/save-to-matter`,
        saveRequest(seed.matterId),
      )

      expect(response.status).toBe(201)
      const body = (await response.json()) as {
        status: string
        matterId: string
        documentId: string
        versionId: string
        versionNumber: number
      }
      expect(body.status).toBe('saved')
      expect(body.matterId).toBe(seed.matterId)
      expect(body.versionNumber).toBe(1)

      // The redacted copy is the stored output byte for byte, filed in the matter.
      const stored = await pool.query<{ object_key: string }>(
        `select object_key from document_versions where id = $1`,
        [body.versionId],
      )
      expect(
        storage.binary.get(stored.rows[0]!.object_key)?.equals(copyBytes),
      ).toBe(true)

      // Text extraction ran, so the new document can be opened and searched.
      const version = await pool.query<{
        document_status: string
        text_object_key: string | null
        filename: string
      }>(
        `select document_status, text_object_key, filename from document_versions
         where id = $1`,
        [body.versionId],
      )
      expect(version.rows[0]?.document_status).toBe('ready')
      expect(version.rows[0]?.filename).toBe('pasted-extract-redacted.txt')
      expect(storage.text.get(version.rows[0]!.text_object_key!)).toContain(
        'Synthetic redacted witness statement',
      )

      const audit = await pool.query<{ action: string }>(
        `select action from audit_logs
         where organisation_id = $1 and entity_id in ($2, $3, $4)
         order by action`,
        [seed.orgId, body.documentId, body.versionId, seed.runId],
      )
      expect(audit.rows.map((row) => row.action)).toEqual([
        'document.upload',
        'document.version_create',
        'redaction.saved_to_matter',
      ])

      const run = await pool.query<{
        returned_document_version_id: string | null
      }>(
        `select returned_document_version_id from redaction_runs where id = $1`,
        [seed.runId],
      )
      expect(run.rows[0]?.returned_document_version_id).toBe(body.versionId)

      // A retry resolves to the version it already created, never a second one.
      const again = await app.request(
        `/api/redaction-runs/${seed.runId}/save-to-matter`,
        saveRequest(seed.matterId),
      )
      expect(again.status).toBe(200)
      const repeated = (await again.json()) as { versionId: string }
      expect(repeated.versionId).toBe(body.versionId)
      const documents = await pool.query(
        `select id from matter_documents where matter_id = $1`,
        [seed.matterId],
      )
      expect(documents.rows).toHaveLength(2)
    } finally {
      await cleanupRun(seed)
    }
  })

  it('coalesces simultaneous saves into one document and one audit trail', async () => {
    const seed = await seedStandaloneRun(await seedMatter(pool, null))
    try {
      const storage = storageFor(seed)
      storage.binary.set(seed.outputKey, copyBytes)
      const app = saveApp(storage, ownerUser(seed))
      const readBinary = storage.readBinary.bind(storage)
      let reads = 0
      let release: () => void = () => undefined
      const bothReading = new Promise<void>((resolve) => {
        release = resolve
      })
      storage.readBinary = async (key) => {
        const bytes = await readBinary(key)
        if (++reads === 2) release()
        await bothReading
        return bytes
      }
      const responses = await Promise.all(
        [1, 2].map(() =>
          app.request(
            `/api/redaction-runs/${seed.runId}/save-to-matter`,
            saveRequest(seed.matterId),
          ),
        ),
      )
      expect(responses.map((response) => response.status).sort()).toEqual([
        200, 201,
      ])
      const bodies = await Promise.all(
        responses.map(
          async (response) => (await response.json()) as { versionId: string },
        ),
      )
      expect(bodies[0].versionId).toBe(bodies[1].versionId)
      const documents = await pool.query(
        'select id from matter_documents where matter_id = $1',
        [seed.matterId],
      )
      expect(documents.rows).toHaveLength(2)
      const audit = await pool.query(
        "select id from audit_logs where entity_id = $1 and action = 'redaction.saved_to_matter'",
        [seed.runId],
      )
      expect(audit.rows).toHaveLength(1)
    } finally {
      await cleanupRun(seed)
    }
  })

  it('rolls back a failed storage write so retry creates only one copy', async () => {
    const seed = await seedStandaloneRun(await seedMatter(pool, null))
    try {
      const storage = storageFor(seed)
      storage.binary.set(seed.outputKey, copyBytes)
      const originalKeys = [...storage.binary.keys()].sort()
      const writeText = storage.writeText.bind(storage)
      storage.writeText = async () => {
        throw new Error('storage unavailable')
      }
      const failed = await saveApp(storage, ownerUser(seed)).request(
        `/api/redaction-runs/${seed.runId}/save-to-matter`,
        saveRequest(seed.matterId),
      )
      expect(failed.status).toBe(422)
      const afterFailure = await pool.query(
        'select id from matter_documents where matter_id = $1',
        [seed.matterId],
      )
      expect(afterFailure.rows).toHaveLength(1)
      expect([...storage.binary.keys()].sort()).toEqual(originalKeys)
      expect(
        [...storage.text.keys()].some((key) => key.endsWith('/text')),
      ).toBe(false)
      storage.writeText = writeText
      const retried = await saveApp(storage, ownerUser(seed)).request(
        `/api/redaction-runs/${seed.runId}/save-to-matter`,
        saveRequest(seed.matterId),
      )
      expect(retried.status).toBe(201)
      const afterRetry = await pool.query(
        'select id from matter_documents where matter_id = $1',
        [seed.matterId],
      )
      expect(afterRetry.rows).toHaveLength(2)
    } finally {
      await cleanupRun(seed)
    }
  })

  it('conceals a saved copy after the destination share is revoked', async () => {
    const seed = await seedStandaloneRun(await seedMatter(pool, 'edit'))
    try {
      await pool.query(
        'update redaction_runs set created_by = $2 where id = $1',
        [seed.runId, seed.editorId],
      )
      const storage = storageFor(seed)
      storage.binary.set(seed.outputKey, copyBytes)
      const app = saveApp(storage, editorUser(seed))
      const first = await app.request(
        `/api/redaction-runs/${seed.runId}/save-to-matter`,
        saveRequest(seed.matterId),
      )
      expect(first.status).toBe(201)
      await pool.query('delete from matter_shares where id = $1', [
        seed.shareId,
      ])
      const retry = await app.request(
        `/api/redaction-runs/${seed.runId}/save-to-matter`,
        saveRequest(seed.matterId),
      )
      expect(retry.status).toBe(404)
      expect(await retry.text()).not.toContain('versionId')
    } finally {
      await cleanupRun(seed)
    }
  })

  it('refuses a matter the reviewer can only view', async () => {
    const seed = await seedStandaloneRun(await seedMatter(pool, 'view'))
    try {
      const storage = storageFor(seed)
      storage.binary.set(seed.outputKey, copyBytes)
      const app = saveApp(storage, editorUser(seed))
      const response = await app.request(
        `/api/redaction-runs/${seed.runId}/save-to-matter`,
        saveRequest(seed.matterId),
      )
      expect(response.status).toBe(404)
      const documents = await pool.query(
        `select id from matter_documents where matter_id = $1`,
        [seed.matterId],
      )
      expect(documents.rows).toHaveLength(1)
    } finally {
      await cleanupRun(seed)
    }
  })

  it('refuses bytes that no longer match the hash recorded at finalisation', async () => {
    const seed = await seedStandaloneRun(await seedMatter(pool, null))
    try {
      const storage = storageFor(seed)
      storage.binary.set(seed.outputKey, Buffer.from('tampered copy'))
      const app = saveApp(storage, ownerUser(seed))
      const response = await app.request(
        `/api/redaction-runs/${seed.runId}/save-to-matter`,
        saveRequest(seed.matterId),
      )
      expect(response.status).toBe(422)
      const documents = await pool.query(
        `select id from matter_documents where matter_id = $1`,
        [seed.matterId],
      )
      expect(documents.rows).toHaveLength(1)
    } finally {
      await cleanupRun(seed)
    }
  })
})

afterAll(() => pool.end())
