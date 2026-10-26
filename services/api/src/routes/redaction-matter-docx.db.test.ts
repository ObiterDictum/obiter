import { afterAll, expect, it, mock } from 'bun:test'
import { Hono } from 'hono'
import { PDFDocument } from 'pdf-lib'
import type { AuthzVariables } from '../authz'
import { extractDocumentContent } from '../document-extraction'
import { createTestPool } from '../test-database.test-support'
import {
  cleanupMatter,
  editorUser,
  seedMatter,
  storageFor,
} from './document-write-share-revocation.test-support'

const target = 'Cartwright'
mock.module('../redaction-detection', () => ({
  detectionMode: () => 'model+supplement',
  detectRedactionSpans: async (text: string) => ({
    spans: [
      {
        id: 'detected',
        text: target,
        start: text.indexOf(target),
        end: text.indexOf(target) + target.length,
        category: 'person_name',
        source: 'rampart_model',
        confidence: 'high',
        suggestion: 'redact',
      },
    ],
    detectorVersion: 'test',
    degraded: false,
  }),
}))
// Loaded after the mock: these modules capture detection at module scope.
const { createRedactRunCreationRoutes } = await import('./redact-run-creation')
const { createRedactReviewRoutes } = await import('./redact-review')

const pool = createTestPool()
afterAll(() => pool.end())

it('finalizes a tracked-change matter DOCX in redacted mode from Redact coordinates, not the matter text', async () => {
  const seed = await seedMatter(pool, 'edit')
  try {
    const storage = storageFor(seed)
    // The matter keeps its Search extraction, which omits deleted text and so
    // cannot address the Word package.
    const matterTextKey = seed.sourceKey.replace(/\/source$/u, '/text')
    const matterText = (
      await extractDocumentContent(
        'docx',
        Buffer.from(storage.binary.get(seed.sourceKey) ?? []),
      )
    ).text
    storage.text.set(matterTextKey, matterText)
    await pool.query(
      `update document_versions set text_object_key = $1 where id = $2`,
      [matterTextKey, seed.versionId],
    )
    const routes = new Hono<{ Variables: AuthzVariables }>()
    routes.use('*', async (c, next) => {
      c.set('requestId', 'req_matter_docx')
      c.set('user', editorUser(seed))
      await next()
    })
    routes.route('/', createRedactRunCreationRoutes(pool, storage))
    routes.route(
      '/',
      createRedactReviewRoutes(pool, storage, {
        renderDocxToPdf: async () => {
          const pdf = await PDFDocument.create()
          pdf.addPage([200, 200])
          return new Uint8Array(await pdf.save())
        },
      }),
    )

    const created = await routes.request(
      `/api/documents/${seed.documentId}/redaction-runs`,
      { method: 'POST', body: '{}' },
    )
    expect(created.status).toBe(201)
    const { run } = (await created.json()) as {
      run: { id: string; spans: Array<{ id: string }> }
    }
    expect(storage.text.get(matterTextKey)).toBe(matterText)
    await pool.query(
      `update redaction_runs set decisions_json = $1::jsonb where id = $2`,
      [
        JSON.stringify({
          [run.spans[0]?.id ?? '']: {
            decision: 'accept',
            decidedBy: seed.editorId,
            decidedAt: '2026-10-26T00:00:00.000Z',
          },
        }),
        run.id,
      ],
    )
    const finalized = await routes.request(
      `/api/redaction-runs/${run.id}/finalize`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ outputMode: 'redacted' }),
      },
    )
    expect(finalized.status).toBe(200)
    const summary = await pool.query<{ summary_json: object }>(
      `select summary_json from redaction_runs where id = $1`,
      [run.id],
    )
    expect(summary.rows[0]?.summary_json).toMatchObject({
      outputMimeType: 'application/pdf',
      securePdf: true,
      outputDowngrade: null,
    })
  } finally {
    await pool.query(`delete from redaction_runs where organisation_id = $1`, [
      seed.orgId,
    ])
    await pool.query(`delete from outputs where organisation_id = $1`, [
      seed.orgId,
    ])
    await cleanupMatter(pool, seed)
  }
})
