import { Hono } from 'hono'
import type { Pool } from 'pg'
import { redactionPolicyModeSchema } from '@obiter/contracts'
import { appendAuditLog } from '../database'
import {
  DocumentExtractionError,
  extractDocumentText,
} from '../document-extraction'
import { DocumentUploadError, readDocumentUpload } from '../document-upload'
import {
  getDocumentRedactionSource,
  listRedactionRuns,
  listRedactionRunsForDocument,
  publicRun,
} from '../redaction-database'
import { detectionMode } from '../redaction-detection'
import { createRedactionRun } from '../redaction-run-creation'
import type { StorageService } from '../storage'
import {
  detectForRoute,
  errorResponse,
  jsonBody,
  listItem,
  MAX_REDACTION_SOURCE_TEXT_LENGTH,
  requireUser,
  type RouteVariables,
  validSourceText,
} from './redact-shared'

function sourceInput(body: Record<string, unknown> | null) {
  const filename =
    typeof body?.filename === 'string' ? body.filename.trim() : ''
  const text = typeof body?.text === 'string' ? body.text : null
  const policyMode = redactionPolicyModeSchema.safeParse(
    body?.policyMode ?? 'internal_ai_minimisation',
  )
  return { filename, text, policyMode }
}

export function createRedactRunCreationRoutes(
  pool: Pool,
  storage: StorageService,
) {
  const routes = new Hono<{ Variables: RouteVariables }>()

  routes.get('/api/redaction-runs', async (c) => {
    const user = requireUser(c)
    if (user instanceof Response) return user
    const runs = await listRedactionRuns(pool, user.organisationId)
    return c.json({ runs: runs.map((run) => listItem(publicRun(run))) })
  })

  routes.post('/api/redaction-runs', async (c) => {
    const user = requireUser(c)
    if (user instanceof Response) return user

    const isMultipart =
      c.req
        .header('content-type')
        ?.toLowerCase()
        .startsWith('multipart/form-data') ?? false
    const form = isMultipart ? await c.req.formData().catch(() => null) : null
    if (isMultipart && !form)
      return errorResponse(
        c,
        'validation_failed',
        'The uploaded file could not be read. Please try again.',
        400,
      )
    const input = sourceInput(
      form ? { policyMode: form.get('policyMode') } : await jsonBody(c),
    )
    let filename = input.filename
    let text = input.text

    if (form) {
      const file = form.get('file')
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
          form.get('fileType')?.toString() ?? file.type,
        )
        filename = upload.filename
        text = await extractDocumentText(upload.fileType, upload.contents)
      } catch (error) {
        if (error instanceof DocumentUploadError)
          return errorResponse(c, 'validation_failed', error.message, 400)
        if (error instanceof DocumentExtractionError)
          return errorResponse(
            c,
            'validation_failed',
            // Curated messages name the actual obstacle, e.g. that the document
            // needs OCR. Wrapped library failures stay generic.
            error.userFacing
              ? error.message
              : 'Document text could not be read for redaction.',
            400,
          )
        throw error
      }
    }

    if (!filename || text === null || !input.policyMode.success) {
      return errorResponse(
        c,
        'validation_failed',
        'A source filename, document text, and valid policy mode are required.',
        400,
      )
    }
    if (!validSourceText(text))
      return errorResponse(
        c,
        'validation_failed',
        `Extracted text must be at most ${MAX_REDACTION_SOURCE_TEXT_LENGTH} characters.`,
        400,
      )
    const id = `red_${crypto.randomUUID()}`
    const sourceTextObjectKey = `org/${user.organisationId}/redaction-runs/${id}/source`
    await storage.writeText(sourceTextObjectKey, text)
    const detection = await detectForRoute(c, text)
    if (detection instanceof Response) {
      await storage.delete(sourceTextObjectKey)
      return detection
    }
    let run
    try {
      run = await createRedactionRun({
        pool,
        id,
        organisationId: user.organisationId,
        userId: user.id,
        sourceFilename: filename,
        sourceTextObjectKey,
        spans: detection.spans,
        detectorVersion: detection.detectorVersion,
        detectionMode: detectionMode(detection.degraded),
        policyMode: input.policyMode.data,
      })
    } catch (error) {
      await storage.delete(sourceTextObjectKey)
      throw error
    }
    if (!run)
      throw new Error('Standalone redaction run creation returned no row.')
    await appendAuditLog(pool, {
      organisationId: user.organisationId,
      userId: user.id,
      entityType: 'redaction_run',
      entityId: run.id,
      action: 'redaction.run_create',
      metadata: {
        policyMode: run.policyMode,
        detectionMode: run.detectionMode,
        spanCount: run.spans.length,
      },
      requestId: c.get('requestId'),
    })
    return c.json({ run: publicRun(run) }, 201)
  })

  routes.post('/api/documents/:documentId/redaction-runs', async (c) => {
    const user = requireUser(c)
    if (user instanceof Response) return user
    const body = await jsonBody(c)
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
      user.organisationId,
      c.req.param('documentId'),
    )
    if (!source)
      return errorResponse(c, 'document_not_found', 'Document not found.', 404)
    if (!source.text_object_key)
      return errorResponse(
        c,
        'document_version_not_found',
        'Document text is not available for redaction.',
        404,
      )
    const text = await storage.readText(source.text_object_key)
    if (!validSourceText(text))
      return errorResponse(
        c,
        'validation_failed',
        `Extracted text must be at most ${MAX_REDACTION_SOURCE_TEXT_LENGTH} characters.`,
        400,
      )
    const detection = await detectForRoute(c, text)
    if (detection instanceof Response) return detection
    const run = await createRedactionRun({
      pool,
      id: `red_${crypto.randomUUID()}`,
      organisationId: user.organisationId,
      userId: user.id,
      sourceFilename: source.filename,
      sourceTextObjectKey: null,
      spans: detection.spans,
      detectorVersion: detection.detectorVersion,
      detectionMode: detectionMode(detection.degraded),
      policyMode: policyMode.data,
      matterId: source.matter_id,
      documentId: c.req.param('documentId'),
      documentVersionId: source.version_id,
    })
    if (!run)
      return errorResponse(c, 'document_not_found', 'Document not found.', 404)
    await appendAuditLog(pool, {
      organisationId: user.organisationId,
      userId: user.id,
      entityType: 'redaction_run',
      entityId: run.id,
      action: 'redaction.run_create',
      metadata: {
        policyMode: run.policyMode,
        detectionMode: run.detectionMode,
        spanCount: run.spans.length,
      },
      requestId: c.get('requestId'),
    })
    return c.json({ run: publicRun(run) }, 201)
  })

  routes.get('/api/documents/:documentId/redaction-runs', async (c) => {
    const user = requireUser(c)
    if (user instanceof Response) return user
    const runs = await listRedactionRunsForDocument(
      pool,
      user.organisationId,
      c.req.param('documentId'),
    )
    return c.json({ runs: runs.map((run) => listItem(publicRun(run))) })
  })

  return routes
}
