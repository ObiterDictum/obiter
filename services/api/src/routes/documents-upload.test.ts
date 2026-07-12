import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import type { Pool } from 'pg'
import { afterEach, describe, expect, it } from 'vitest'
import { createDocumentsRoutes, MAX_DOCUMENT_UPLOAD_BYTES } from './documents'
import { createLocalStorage } from '../storage'

const roots: string[] = []
const hash = (value: Buffer) => createHash('sha256').update(value).digest('hex')
const fixture = await readFile('../../data/evals/redact/demo-fixture.docx')

function matterRow() { return { id: 'mtr_1', organisation_id: 'org_1', name: 'Matter', description: null, primary_jurisdiction: 'england_and_wales', secondary_jurisdictions: [], legal_domains: [], client_reference: '', status: 'active', created_by: 'usr_1', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z', deleted_at: null } }
function documentRow(versionId: string | null = null) { return { id: 'doc_1', organisation_id: 'org_1', matter_id: 'mtr_1', current_version_id: versionId, logical_key: 'logical', created_by: 'usr_1', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z', deleted_at: null } }
function versionRow(id: string, status = 'queued', textKey: string | null = null, reason: string | null = null) { return { id, organisation_id: 'org_1', matter_id: 'mtr_1', matter_document_id: 'doc_1', filename: 'fixture.docx', file_type: 'docx', size_bytes: String(fixture.length), object_key: `org/org_1/matters/mtr_1/documents/doc_1/versions/${id}/source`, text_object_key: textKey, document_status: status, failure_reason: reason, version_number: 1, content_sha256: hash(fixture), sync_state: 'synced', created_by: 'usr_1', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' } }
function pool(): Pool {
  const query = async (sql: string, params?: unknown[]) => {
    if (sql === 'begin' || sql === 'commit' || sql === 'rollback' || sql.includes('insert into audit_logs')) return { rows: [] }
    if (sql.includes('from matters')) return { rows: [matterRow()] }
    if (sql.includes('insert into matter_documents')) return { rows: [documentRow()] }
    if (sql.includes('insert into document_versions')) { const id = String(params?.[0]); return { rows: [versionRow(id)] } }
    if (sql.includes('update matter_documents')) return { rows: [documentRow(String(params?.[2]))] }
    if (sql.includes('update document_versions')) { const id = String(params?.[0]); const key = params?.[2] as string | null; const status = String(params?.[3]); return { rows: [versionRow(id, status, key, params?.[4] as string | null)] } }
    throw new Error(`Unexpected query: ${sql}`)
  }
  return { query, connect: async () => ({ query, release: () => undefined }) } as unknown as Pool
}
async function app(root: string, storage = createLocalStorage(root)) {
  const api = new Hono<{ Variables: { requestId: string; user: { id: string; organisationId: string } } }>()
  api.use('*', async (c, next) => { c.set('requestId', 'req_test'); c.set('user', { id: 'usr_1', organisationId: 'org_1' }); await next() })
  api.route('/', createDocumentsRoutes(pool(), storage))
  return api
}
async function upload(api: Awaited<ReturnType<typeof app>>, name: string, bytes: Buffer, claimed = 'docx', suppliedHash = hash(bytes)) {
  const form = new FormData(); form.set('file', new File([bytes], name)); form.set('fileType', claimed); form.set('contentSha256', suppliedHash)
  return api.request('/api/matters/mtr_1/documents', { method: 'POST', body: form })
}
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

describe('multipart document extraction', () => {
  it('stores DOCX source and extracted text with a server-computed hash', async () => {
    const root = await mkdtemp(join(tmpdir(), 'obiter-upload-')); roots.push(root); const api = await app(root)
    const response = await upload(api, 'fixture.docx', fixture); const body = await response.json() as { version: { objectKey: string; textObjectKey: string; documentStatus: string; contentSha256: string } }
    expect(response.status).toBe(201); expect(body.version.documentStatus).toBe('ready'); expect(body.version.contentSha256).toBe(hash(fixture))
    await expect(readFile(join(root, body.version.objectKey))).resolves.toEqual(fixture); await expect(readFile(join(root, body.version.textObjectKey), 'utf8')).resolves.toContain('Mr James Cartwright')
  })
  it('stores TXT source and text', async () => {
    const root = await mkdtemp(join(tmpdir(), 'obiter-upload-')); roots.push(root); const api = await app(root); const bytes = Buffer.from('Plain text')
    const response = await upload(api, 'fixture.txt', bytes, 'txt'); const body = await response.json() as { version: { objectKey: string; textObjectKey: string; documentStatus: string } }
    expect(response.status).toBe(201); expect(body.version.documentStatus).toBe('ready'); await expect(readFile(join(root, body.version.objectKey))).resolves.toEqual(bytes); await expect(readFile(join(root, body.version.textObjectKey), 'utf8')).resolves.toBe('Plain text')
  })
  it('stores corrupt DOCX source and records extraction failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'obiter-upload-')); roots.push(root); const api = await app(root); const bytes = Buffer.from('PK broken archive')
    const response = await upload(api, 'broken.docx', bytes); const body = await response.json() as { version: { objectKey: string; documentStatus: string; failureReason: string } }
    expect(response.status).toBe(201); expect(body.version.documentStatus).toBe('failed'); expect(body.version.failureReason).toContain('extraction failed'); await expect(readFile(join(root, body.version.objectKey))).resolves.toEqual(bytes)
  })
  it.each([
    ['too large', 'fixture.txt', Buffer.alloc(MAX_DOCUMENT_UPLOAD_BYTES + 1), 'txt', hash(Buffer.alloc(MAX_DOCUMENT_UPLOAD_BYTES + 1))],
    ['non zip docx', 'fixture.docx', Buffer.from('not zip'), 'docx', hash(Buffer.from('not zip'))],
    ['hash mismatch', 'fixture.docx', fixture, 'docx', '0'.repeat(64)],
  ])('rejects %s without writing storage', async (_name, filename, bytes, type, suppliedHash) => {
    const root = await mkdtemp(join(tmpdir(), 'obiter-upload-')); roots.push(root); const response = await upload(await app(root), filename, bytes, type, suppliedHash)
    expect(response.status).toBe(400); await expect(readFile(join(root, 'org'))).rejects.toThrow()
  })
  it('returns storage_unavailable when binary storage is unavailable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'obiter-upload-')); roots.push(root); const storage = createLocalStorage(root); delete storage.writeBinary
    const response = await upload(await app(root, storage), 'fixture.docx', fixture); expect(response.status).toBe(400); await expect(response.json()).resolves.toMatchObject({ error: { code: 'storage_unavailable' } })
  })
})
