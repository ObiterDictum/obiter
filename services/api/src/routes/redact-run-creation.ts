import { Hono } from 'hono'
import type { Pool } from 'pg'
import { redactionPolicyModeSchema } from '@obiter/contracts'
import { loadOoxmlZipEntries } from '@obiter/ooxml'
import { normaliseFileType } from '../document-extraction'
import {
  extractedTextWithinLimit,
  documentTextTooLongMessage,
} from '../document-extraction-limits'
import { DocumentUploadError, readDocumentUpload } from '../document-upload'
import { readLimitedFormData } from '../limited-request-body'
import {
  DEFAULT_API_REQUEST_LIMITS,
  type ApiRequestLimits,
} from '../request-limits'
import {
  getDocumentRedactionSource,
  getRedactionRun,
  listRedactionRuns,
  listRedactionRunsForDocument,
  publicRun,
} from '../redaction-database'
import { createRedactionRun } from '../redaction-run-creation'
import { retryDetectionJob } from '../redaction-detection-jobs'
import type { StorageService } from '../storage'
import {
  errorResponse,
  jsonBody,
  listItem,
  requireUser,
  type RouteVariables,
} from './redact-shared'

export function createRedactRunCreationRoutes(
  pool: Pool,
  storage: StorageService,
  limits: ApiRequestLimits = DEFAULT_API_REQUEST_LIMITS,
) {
  const routes = new Hono<{ Variables: RouteVariables }>()
  routes.get('/api/redaction-runs', async (c) => {
    const user = await requireUser(c, pool)
    if (user instanceof Response) return user
    return c.json({
      runs: (await listRedactionRuns(pool, user)).map((run) =>
        listItem(publicRun(run)),
      ),
    })
  })

  routes.post('/api/redaction-runs', async (c) => {
    const user = await requireUser(c, pool)
    if (user instanceof Response) return user
    const multipart = c.req
      .header('content-type')
      ?.toLowerCase()
      .startsWith('multipart/form-data')
    let filename: string
    let contents: Buffer
    let fileType: 'pdf' | 'docx' | 'txt'
    let policy: unknown
    if (multipart) {
      const result = await readLimitedFormData(c, limits.documentUploadMaxBytes)
      if (!result.ok) return result.response
      const file = result.form.get('file')
      if (!(file instanceof File))
        return errorResponse(
          c,
          'validation_failed',
          'A PDF, DOCX or TXT file is required.',
          400,
        )
      try {
        const upload = await readDocumentUpload(
          file,
          result.form.get('fileType')?.toString() ?? file.type,
          limits.documentUploadMaxBytes,
        )
        filename = upload.filename
        contents = upload.contents
        fileType = upload.fileType
      } catch (error) {
        if (!(error instanceof DocumentUploadError)) throw error
        return errorResponse(c, 'validation_failed', error.message, 400)
      }
      if (fileType === 'docx') {
        try {
          await loadOoxmlZipEntries(contents, limits.ooxmlLimits)
        } catch {
          return errorResponse(
            c,
            'ooxml_limits_exceeded',
            'The document package is invalid or exceeds the package limits.',
            413,
          )
        }
      }
      policy = result.form.get('policyMode') ?? 'internal_ai_minimisation'
    } else {
      const body = await jsonBody(c, limits.jsonBodyMaxBytes)
      if (body instanceof Response) return body
      if (
        typeof body?.filename !== 'string' ||
        !body.filename.trim() ||
        typeof body.text !== 'string'
      )
        return errorResponse(
          c,
          'validation_failed',
          'A source filename and document text are required.',
          400,
        )
      if (!extractedTextWithinLimit(body.text))
        return errorResponse(
          c,
          'validation_failed',
          documentTextTooLongMessage(body.text.length),
          400,
        )
      filename = body.filename.trim()
      contents = Buffer.from(body.text)
      fileType = 'txt'
      policy = body.policyMode ?? 'internal_ai_minimisation'
    }
    const policyMode = redactionPolicyModeSchema.safeParse(policy)
    if (!policyMode.success)
      return errorResponse(
        c,
        'validation_failed',
        'A valid policy mode is required.',
        400,
      )
    const id = `red_${crypto.randomUUID()}`
    const base = `org/${user.organisationId}/redaction-runs/${id}`
    if (!storage.writeBinary)
      throw new Error('Binary storage is required for redaction uploads.')
    try {
      await storage.writeBinary(`${base}/original`, contents)
      await storage.writeText(`${base}/source`, '')
      const run = await createRedactionRun({
        pool,
        id,
        organisationId: user.organisationId,
        userId: user.id,
        sourceFilename: filename,
        sourceTextObjectKey: `${base}/source`,
        sourceFileObjectKey: multipart ? `${base}/original` : null,
        sourceMimeType:
          fileType === 'pdf'
            ? 'application/pdf'
            : fileType === 'docx'
              ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
              : 'text/plain',
        spans: [],
        detectorVersion: '',
        detectionMode: 'unknown',
        policyMode: policyMode.data,
        detectionInput: { objectKey: `${base}/original`, fileType },
        requestId: c.get('requestId'),
      })
      if (!run) throw new Error('Redaction run creation returned no row.')
      return c.json({ run: publicRun(run) }, 202)
    } catch (error) {
      await storage.delete(`${base}/original`)
      await storage.delete(`${base}/source`)
      throw error
    }
  })

  routes.post('/api/documents/:documentId/redaction-runs', async (c) => {
    const user = await requireUser(c, pool)
    if (user instanceof Response) return user
    const body = await jsonBody(c)
    if (body instanceof Response) return body
    const policyMode = redactionPolicyModeSchema.safeParse(
      body?.policyMode ?? 'internal_ai_minimisation',
    )
    if (!policyMode.success)
      return errorResponse(
        c,
        'validation_failed',
        'A valid policy mode is required.',
        400,
      )
    const source = await getDocumentRedactionSource(
      pool,
      user,
      c.req.param('documentId'),
    )
    if (!source)
      return errorResponse(c, 'document_not_found', 'Document not found.', 404)
    const fileType = normaliseFileType(source.file_type)
    if (!fileType)
      return errorResponse(
        c,
        'validation_failed',
        'Unsupported document type.',
        400,
      )
    const id = `red_${crypto.randomUUID()}`
    const run = await createRedactionRun({
      pool,
      id,
      organisationId: user.organisationId,
      userId: user.id,
      sourceFilename: source.filename,
      sourceTextObjectKey: null,
      spans: [],
      detectorVersion: '',
      detectionMode: 'unknown',
      policyMode: policyMode.data,
      matterId: source.matter_id,
      documentId: c.req.param('documentId'),
      documentVersionId: source.version_id,
      detectionInput: { objectKey: source.object_key, fileType },
      requestId: c.get('requestId'),
    })
    if (!run)
      return errorResponse(c, 'document_not_found', 'Document not found.', 404)
    return c.json({ run: publicRun(run) }, 202)
  })

  routes.post('/api/redaction-runs/:runId/retry', async (c) => {
    const user = await requireUser(c, pool)
    if (user instanceof Response) return user
    const run = await getRedactionRun(pool, user, c.req.param('runId'), 'edit')
    if (!run)
      return errorResponse(
        c,
        'redaction_run_not_found',
        'Redaction run not found.',
        404,
      )
    if (
      !(await retryDetectionJob(
        pool,
        run.id,
        user.organisationId,
        user.id,
        c.get('requestId'),
      ))
    )
      return errorResponse(
        c,
        'redaction_run_not_ready',
        'Only failed detection jobs can be retried.',
        409,
      )
    const next = await getRedactionRun(pool, user, run.id, 'view')
    if (!next)
      return errorResponse(
        c,
        'redaction_run_not_found',
        'Redaction run not found.',
        404,
      )
    return c.json({ run: publicRun(next) }, 202)
  })

  routes.get('/api/documents/:documentId/redaction-runs', async (c) => {
    const user = await requireUser(c, pool)
    if (user instanceof Response) return user
    return c.json({
      runs: (
        await listRedactionRunsForDocument(
          pool,
          user,
          c.req.param('documentId'),
        )
      ).map((run) => listItem(publicRun(run))),
    })
  })
  return routes
}
