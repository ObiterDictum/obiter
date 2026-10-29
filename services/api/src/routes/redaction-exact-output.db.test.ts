import { afterAll, expect, it, mock } from 'bun:test'
import { Hono } from 'hono'
import JSZip from 'jszip'
import { createSyntheticDocx, parseDocx } from '@obiter/ooxml'
import { PDFDocument } from 'pdf-lib'
import type { AuthzVariables } from '../authz'
import { createTestPool } from '../test-database.test-support'
import {
  cleanupMatter,
  ownerUser,
  seedMatter,
  storageFor,
} from './document-write-share-revocation.test-support'

// Inference is an external boundary. The review decisions and every byte path
// below use the real implementation, storage adapter and database transactions.
mock.module('../redaction-detection', () => ({
  detectionMode: () => 'model+supplement',
  detectRedactionSpans: async (text: string) => ({
    spans: [...text.matchAll(/\bSTATE\b/gu)].map((match, index) => ({
      id: `s${index}`,
      start: match.index,
      end: match.index + 5,
      text: 'STATE',
      category: 'person_name',
      source: 'rampart_model',
      confidence: 'high',
      suggestion: 'redact',
    })),
    detectorVersion: 'synthetic',
    degraded: false,
  }),
}))
const { createRedactRunCreationRoutes } = await import('./redact-run-creation')
const { createRedactReviewRoutes } = await import('./redact-review')
const { createRedactLifecycleRoutes } = await import('./redact-lifecycle')
const pool = createTestPool()
afterAll(() => pool.end())
const original = 'STATEMENT OF THE CLAIMANT: STATE and STATE'
const expected = 'STATEMENT OF THE CLAIMANT: [PERSON_NAME_1] and STATE'
const json = (body: Record<string, string>) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})
async function visible(bytes: Uint8Array) {
  return (await parseDocx(bytes)).model.stories
    .flatMap((s) => s.paragraphs.map((p) => p.runs.map((r) => r.text).join('')))
    .join('\n')
}

it.each(['download', 'return', 'save', 'hard', 'hard-refusal'] as const)(
  'honours exact reviewed DOCX coordinates through %s',
  async (path) => {
    const seed = await seedMatter(pool, null)
    try {
      const storage = storageFor(seed)
      const zip = await JSZip.loadAsync(await createSyntheticDocx([original]))
      zip.file(
        'docProps/core.xml',
        '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>STATE</dc:creator></cp:coreProperties>',
      )
      if (path === 'hard-refusal')
        zip.file('word/embeddings/private.bin', Buffer.from('STATE', 'utf16le'))
      const bytes = Buffer.from(await zip.generateAsync({ type: 'uint8array' }))
      storage.binary.set(seed.sourceKey, bytes)
      const matterTextKey = seed.sourceKey.replace(/\/source$/u, '/text')
      storage.text.set(matterTextKey, 'Search extraction remains untouched')
      await pool.query(
        'update document_versions set text_object_key = $1 where id = $2',
        [matterTextKey, seed.versionId],
      )
      let renderInput: Buffer | undefined
      const app = new Hono<{ Variables: AuthzVariables }>()
      app.use('*', async (c, next) => {
        c.set('requestId', 'req_exact')
        c.set('user', ownerUser(seed))
        await next()
      })
      app.route('/', createRedactRunCreationRoutes(pool, storage))
      app.route(
        '/',
        createRedactReviewRoutes(pool, storage, {
          renderDocxToPdf: async (input) => {
            renderInput = input
            const pdf = await PDFDocument.create()
            pdf.addPage([200, 200])
            return new Uint8Array(await pdf.save())
          },
        }),
      )
      app.route('/', createRedactLifecycleRoutes(pool, storage))
      let created: Response
      if (path === 'return') {
        created = await app.request(
          `/api/documents/${seed.documentId}/redaction-runs`,
          json({}),
        )
      } else {
        const form = new FormData()
        form.set(
          'file',
          new File([bytes], 'synthetic.docx', {
            type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          }),
        )
        created = await app.request('/api/redaction-runs', {
          method: 'POST',
          body: form,
        })
      }
      expect(created.status).toBe(201)
      const { run } = (await created.json()) as {
        run: { id: string; spans: Array<{ id: string }> }
      }
      expect(storage.text.get(matterTextKey)).toBe(
        'Search extraction remains untouched',
      )
      for (const [index, span] of run.spans.entries()) {
        const decided = await app.request(
          `/api/redaction-runs/${run.id}/spans/${span.id}/decision`,
          json({ decision: index === 0 ? 'accept' : 'reject' }),
        )
        expect(decided.status).toBe(200)
      }
      const finalized = await app.request(
        `/api/redaction-runs/${run.id}/finalize`,
        json({
          outputMode: path.startsWith('hard') ? 'redacted' : 'pseudonymised',
        }),
      )
      if (path === 'hard-refusal') {
        expect(finalized.status).toBe(502)
        expect(renderInput).toBeUndefined()
        const result = await pool.query<{
          output_id: string | null
          status: string
        }>('select output_id, status from redaction_runs where id = $1', [
          run.id,
        ])
        expect(result.rows[0]?.output_id).toBeNull()
        expect(result.rows[0]?.status).not.toBe('finalized')
        return
      }
      expect(finalized.status).toBe(200)
      const output = await app.request(
        `/api/redaction-runs/${run.id}/output/file`,
      )
      expect(output.status).toBe(200)
      const outputBytes = new Uint8Array(await output.arrayBuffer())
      const docx = path === 'hard' ? renderInput : outputBytes
      if (!docx) throw new Error('Renderer did not receive sanitized DOCX')
      expect(await visible(docx)).toBe(
        path === 'hard'
          ? expected.replace('[PERSON_NAME_1]', '[REDACTED]')
          : expected,
      )
      expect(
        await (
          await JSZip.loadAsync(docx)
        )
          .file('docProps/core.xml')
          ?.async('string'),
      ).not.toContain('STATE')
      if (path === 'return' || path === 'save') {
        const transferred = await app.request(
          `/api/redaction-runs/${run.id}/${path === 'return' ? 'return-to-document' : 'save-to-matter'}`,
          json(
            path === 'return'
              ? { baseVersionId: seed.versionId }
              : { matterId: seed.matterId },
          ),
        )
        expect(transferred.status).toBe(201)
        const { versionId } = (await transferred.json()) as {
          versionId: string
        }
        const result = await pool.query<{ object_key: string }>(
          'select object_key from document_versions where id = $1',
          [versionId],
        )
        const stored = storage.binary.get(result.rows[0]?.object_key ?? '')
        expect(stored).toEqual(Buffer.from(outputBytes))
      }
    } finally {
      await pool.query(
        'delete from redaction_runs where organisation_id = $1',
        [seed.orgId],
      )
      await pool.query('delete from outputs where organisation_id = $1', [
        seed.orgId,
      ])
      await cleanupMatter(pool, seed)
    }
  },
)
