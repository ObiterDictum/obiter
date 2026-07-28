import { Hono } from 'hono'
import type { Context } from 'hono'
import type { Pool } from 'pg'
import {
  redactionFinalizeInputSchema,
  redactionPolicyModeSchema,
  spanDecisionSchema,
} from '@obiter/contracts'
import type {
  ApiErrorCode,
  ApiErrorResponse,
  UserRole,
} from '@obiter/contracts'
import {
  applyPseudonymised,
  applyRedacted,
  createTokenMap,
  RedactionSpanIntegrityError,
} from '@obiter/redaction-policy'
import { detectionMode, detectRedactionSpans } from '../redaction-detection'
import {
  DocumentExtractionError,
  extractDocumentText,
} from '../document-extraction'
import { DocumentUploadError, readDocumentUpload } from '../document-upload'
import { appendAuditLog } from '../database'
import {
  finalizeRedactionRun,
  getDocumentRedactionSource,
  getRedactionOutputKey,
  getRedactionRun,
  getRunTextObjectKey,
  listRedactionRuns,
  listRedactionRunsForDocument,
  listRedactionAuditLog,
  publicRun,
  recordSpanDecision,
  restoreRedactionRunWithAudit,
  softDeleteRedactionRun,
} from '../redaction-database'
import { createRedactionRun } from '../redaction-run-creation'
import type { StorageService } from '../storage'
import { redetectRedactionRun } from '../redaction-redetect'
import {
  buildAuditReport,
  renderAuditHtml,
  renderAuditMarkdown,
} from '../redaction-audit-report'
import { requireManageRole } from '../authz'

interface RouteUser {
  id: string
  organisationId?: string | null
  role?: UserRole | null
}
interface RouteVariables {
  requestId: string
  user: RouteUser | null
}
type RouteContext = Context<{ Variables: RouteVariables }>

function errorResponse(
  c: RouteContext,
  code: ApiErrorCode,
  message: string,
  status: 400 | 401 | 403 | 404 | 409 | 500 | 503,
) {
  const body: ApiErrorResponse = {
    error: { code, message, requestId: c.get('requestId') },
  }
  return c.json(body, status)
}

function requireUser(
  c: RouteContext,
): { id: string; organisationId: string } | Response {
  const user = c.get('user')
  if (!user)
    return errorResponse(c, 'unauthenticated', 'Sign in is required.', 401)
  if (!user.organisationId)
    return errorResponse(
      c,
      'no_organisation',
      'Create an organisation to use this area.',
      403,
    )
  return { id: user.id, organisationId: user.organisationId }
}

async function jsonBody(c: RouteContext) {
  const value: unknown = await c.req.json().catch(() => null)
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function sourceInput(body: Record<string, unknown> | null) {
  const filename =
    typeof body?.filename === 'string' ? body.filename.trim() : ''
  const text = typeof body?.text === 'string' ? body.text : null
  const policyMode = redactionPolicyModeSchema.safeParse(
    body?.policyMode ?? 'internal_ai_minimisation',
  )
  return { filename, text, policyMode }
}

export const MAX_REDACTION_SOURCE_TEXT_LENGTH = 200_000

function validSourceText(text: string) {
  return (
    text.trim().length > 0 && text.length <= MAX_REDACTION_SOURCE_TEXT_LENGTH
  )
}

async function detectForRoute(c: RouteContext, text: string) {
  try {
    return await detectRedactionSpans(text)
  } catch (error) {
    console.error('redaction_detection_failed', {
      requestId: c.get('requestId'),
      reason: error instanceof Error ? error.message : 'unknown failure',
    })
    return errorResponse(
      c,
      'redaction_detection_failed',
      'Redaction detection could not complete for this document.',
      500,
    )
  }
}

function listItem(run: ReturnType<typeof publicRun>) {
  const { spans: _spans, decisions: _decisions, ...item } = run
  return item
}

export function createRedactRoutes(pool: Pool, storage: StorageService) {
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
            'Document text could not be read for redaction.',
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
        text.trim().length === 0
          ? 'The document contains no extractable text.'
          : `Extracted text must be at most ${MAX_REDACTION_SOURCE_TEXT_LENGTH} characters.`,
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
        text.trim().length === 0
          ? 'The document contains no extractable text.'
          : `Extracted text must be at most ${MAX_REDACTION_SOURCE_TEXT_LENGTH} characters.`,
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

  routes.get('/api/redaction-runs/:runId', async (c) => {
    const user = requireUser(c)
    if (user instanceof Response) return user
    const run = await getRedactionRun(
      pool,
      user.organisationId,
      c.req.param('runId'),
    )
    if (!run)
      return errorResponse(
        c,
        'redaction_run_not_found',
        'Redaction run not found.',
        404,
      )
    return c.json({ run: publicRun(run) })
  })

  routes.post('/api/redaction-runs/:runId/redetect', async (c) => {
    const user = requireUser(c)
    if (user instanceof Response) return user
    const result = await redetectRedactionRun({
      pool,
      storage,
      organisationId: user.organisationId,
      userId: user.id,
      runId: c.req.param('runId'),
      requestId: c.get('requestId'),
    })
    if (result.kind === 'not_found')
      return errorResponse(
        c,
        'redaction_run_not_found',
        'Redaction run not found.',
        404,
      )
    if (result.kind === 'already_model_detected')
      return errorResponse(
        c,
        'conflict_detected',
        'This run already records model detection.',
        409,
      )
    if (result.kind === 'source_unavailable')
      return errorResponse(
        c,
        'document_version_not_found',
        'Document text is not available for this run.',
        404,
      )
    if (result.kind === 'linked_source_unavailable')
      return errorResponse(
        c,
        'document_version_not_found',
        'The original linked document version is no longer available for re-detection.',
        404,
      )
    if (result.kind === 'model_unavailable')
      return errorResponse(
        c,
        'redaction_model_unavailable',
        'Model detection is still unavailable. Try again later.',
        503,
      )
    if (result.kind === 'detection_failed') {
      console.error('redaction_detection_failed', {
        requestId: c.get('requestId'),
        reason: result.reason,
      })
      return errorResponse(
        c,
        'redaction_detection_failed',
        'Redaction detection could not complete for this document.',
        500,
      )
    }
    c.header('location', `/api/redaction-runs/${result.run.id}`)
    return c.json(
      { run: publicRun(result.run), redetectedFromRunId: c.req.param('runId') },
      result.kind === 'existing' ? 200 : 201,
    )
  })

  routes.delete('/api/redaction-runs/:runId', async (c) => {
    const user = requireManageRole(c)
    if (user instanceof Response) return user
    const run = await softDeleteRedactionRun(pool, {
      organisationId: user.organisationId,
      userId: user.id,
      runId: c.req.param('runId'),
      requestId: c.get('requestId'),
    })
    if (!run)
      return errorResponse(
        c,
        'redaction_run_not_found',
        'Redaction run not found.',
        404,
      )
    return c.json({ run: publicRun(run) })
  })

  routes.patch('/api/redaction-runs/:runId/restore', async (c) => {
    const user = requireManageRole(c)
    if (user instanceof Response) return user
    const result = await restoreRedactionRunWithAudit(pool, {
      organisationId: user.organisationId,
      userId: user.id,
      runId: c.req.param('runId'),
      requestId: c.get('requestId'),
    })
    if (result.kind === 'not_found')
      return errorResponse(
        c,
        'redaction_run_not_found',
        'Deleted redaction run not found.',
        404,
      )
    if (result.kind === 'replacement_exists')
      return errorResponse(
        c,
        'conflict_detected',
        `Run ${result.sourceRunId} has already been re-detected as ${result.replacementRunId}. Delete that replacement before restoring this run.`,
        409,
      )
    return c.json({ run: publicRun(result.run) })
  })

  routes.get('/api/redaction-runs/:runId/document-text', async (c) => {
    const user = requireUser(c)
    if (user instanceof Response) return user
    const run = await getRedactionRun(
      pool,
      user.organisationId,
      c.req.param('runId'),
    )
    if (!run)
      return errorResponse(
        c,
        'redaction_run_not_found',
        'Redaction run not found.',
        404,
      )
    const textObjectKey = await getRunTextObjectKey(pool, run)
    if (!textObjectKey)
      return errorResponse(
        c,
        'document_version_not_found',
        'Document text is not available for this run.',
        404,
      )
    return c.json({ text: await storage.readText(textObjectKey) })
  })

  routes.post(
    '/api/redaction-runs/:runId/spans/:spanId/decision',
    async (c) => {
      const user = requireUser(c)
      if (user instanceof Response) return user
      const body = await jsonBody(c)
      const decision = spanDecisionSchema.safeParse(body?.decision)
      if (!decision.success)
        return errorResponse(
          c,
          'validation_failed',
          'A valid span decision is required.',
          400,
        )
      const result = await recordSpanDecision({
        pool,
        organisationId: user.organisationId,
        runId: c.req.param('runId'),
        spanId: c.req.param('spanId'),
        decision: decision.data,
        userId: user.id,
      })
      if (result.kind === 'not_found')
        return errorResponse(
          c,
          'redaction_run_not_found',
          'Redaction run not found.',
          404,
        )
      if (result.kind === 'span_not_found')
        return errorResponse(
          c,
          'span_not_found',
          'Span not found in this redaction run.',
          404,
        )
      if (result.kind === 'finalized')
        return errorResponse(
          c,
          'redaction_already_finalized',
          'Finalized redaction runs cannot be changed.',
          409,
        )
      if (result.kind === 'replaced')
        return errorResponse(
          c,
          'conflict_detected',
          `This run was replaced by ${result.replacementRunId} and can no longer be changed.`,
          409,
        )
      if (result.kind === 'not_reviewable')
        return errorResponse(
          c,
          'redaction_run_not_reviewable',
          'This run is not ready for review.',
          400,
        )
      await appendAuditLog(pool, {
        organisationId: user.organisationId,
        userId: user.id,
        entityType: 'redaction_run',
        entityId: result.run.id,
        action: 'redaction.span_decision',
        metadata: {
          spanId: result.span.id,
          decision: decision.data,
          category: result.span.category,
        },
        requestId: c.get('requestId'),
      })
      return c.json({ run: publicRun(result.run) })
    },
  )

  routes.post('/api/redaction-runs/:runId/finalize', async (c) => {
    const user = requireUser(c)
    if (user instanceof Response) return user
    const body = redactionFinalizeInputSchema.safeParse(await jsonBody(c))
    if (!body.success)
      return errorResponse(
        c,
        'validation_failed',
        'A valid output mode and acknowledgement value are required.',
        400,
      )
    const run = await getRedactionRun(
      pool,
      user.organisationId,
      c.req.param('runId'),
    )
    if (!run)
      return errorResponse(
        c,
        'redaction_run_not_found',
        'Redaction run not found.',
        404,
      )
    if (run.status === 'finalized')
      return errorResponse(
        c,
        'redaction_already_finalized',
        'This run has already been finalized.',
        409,
      )
    if (run.replacementRunId)
      return errorResponse(
        c,
        'conflict_detected',
        `This run was replaced by ${run.replacementRunId}. Review and finalize the replacement instead.`,
        409,
      )
    if (run.status !== 'ready_for_review' && run.status !== 'reviewing')
      return errorResponse(
        c,
        'redaction_run_not_reviewable',
        'This run is not ready for finalization.',
        400,
      )
    if (
      run.detectionMode === 'heuristics+supplement' &&
      body.data.degradedDetectionAcknowledged !== true
    )
      return errorResponse(
        c,
        'validation_failed',
        'Acknowledge that model detection did not run before finalising.',
        400,
      )
    if (
      run.detectionMode === 'unknown' &&
      body.data.unknownDetectionAcknowledged !== true
    )
      return errorResponse(
        c,
        'validation_failed',
        'Acknowledge that the detection mode was not recorded before finalising.',
        400,
      )
    const textObjectKey = await getRunTextObjectKey(pool, run)
    if (!textObjectKey)
      return errorResponse(
        c,
        'document_version_not_found',
        'Document text is not available for this run.',
        404,
      )
    const text = await storage.readText(textObjectKey)
    let output: string
    let tokenMap: Record<string, string>
    try {
      tokenMap = createTokenMap(text, run.spans, run.decisions)
      output =
        body.data.outputMode === 'redacted'
          ? applyRedacted(text, run.spans, run.decisions)
          : applyPseudonymised(text, run.spans, run.decisions)
    } catch (error) {
      if (error instanceof RedactionSpanIntegrityError)
        return errorResponse(
          c,
          'redaction_span_integrity_error',
          'The document text changed; create a new redaction run before finalizing.',
          409,
        )
      throw error
    }
    const artifactId = `art_${crypto.randomUUID()}`
    const objectKey = run.matterId
      ? `org/${run.organisationId}/matters/${run.matterId}/artifacts/${artifactId}`
      : `org/${run.organisationId}/artifacts/${artifactId}`
    await storage.writeText(objectKey, output)
    let result
    try {
      result = await finalizeRedactionRun({
        pool,
        organisationId: user.organisationId,
        runId: run.id,
        outputMode: body.data.outputMode,
        tokenMap,
        artifactId,
        userId: user.id,
        requestId: c.get('requestId'),
        degradedDetectionAcknowledged:
          body.data.degradedDetectionAcknowledged === true,
        unknownDetectionAcknowledged:
          body.data.unknownDetectionAcknowledged === true,
      })
    } catch (error) {
      await storage.delete(objectKey)
      throw error
    }
    if (result.kind === 'not_found') {
      await storage.delete(objectKey)
      return errorResponse(
        c,
        'redaction_run_not_found',
        'Redaction run not found.',
        404,
      )
    }
    if (result.kind === 'already_finalized') {
      await storage.delete(objectKey)
      return errorResponse(
        c,
        'redaction_already_finalized',
        'This run has already been finalized.',
        409,
      )
    }
    if (result.kind === 'replaced') {
      await storage.delete(objectKey)
      return errorResponse(
        c,
        'conflict_detected',
        `This run was replaced by ${result.replacementRunId}. Review and finalize the replacement instead.`,
        409,
      )
    }
    if (result.kind === 'not_reviewable') {
      await storage.delete(objectKey)
      return errorResponse(
        c,
        'redaction_run_not_reviewable',
        'This run is not ready for finalization.',
        400,
      )
    }
    if (result.kind === 'acknowledgement_required') {
      await storage.delete(objectKey)
      return errorResponse(
        c,
        'validation_failed',
        run.detectionMode === 'unknown'
          ? 'Acknowledge that the detection mode was not recorded before finalising.'
          : 'Acknowledge that model detection did not run before finalising.',
        400,
      )
    }
    const unreviewedSpanIds = result.run.spans
      .filter((span) => !result.run.decisions[span.id])
      .map((span) => span.id)
    return c.json({
      run: publicRun(result.run),
      artifact: result.artifact,
      warnings: { unreviewedSpanIds },
    })
  })

  routes.get('/api/redaction-runs/:runId/output', async (c) => {
    const user = requireUser(c)
    if (user instanceof Response) return user
    const run = await getRedactionRun(
      pool,
      user.organisationId,
      c.req.param('runId'),
    )
    if (!run)
      return errorResponse(
        c,
        'redaction_run_not_found',
        'Redaction run not found.',
        404,
      )
    if (!run.outputArtifactId)
      return errorResponse(
        c,
        'redaction_run_not_reviewable',
        'This run has not been finalized.',
        400,
      )
    const objectKey = await getRedactionOutputKey(
      pool,
      user.organisationId,
      run.outputArtifactId,
    )
    if (!objectKey)
      return errorResponse(
        c,
        'artifact_not_found',
        'Redaction output is not available.',
        404,
      )
    return c.json({ text: await storage.readText(objectKey) })
  })

  routes.get('/api/redaction-runs/:runId/audit', async (c) => {
    const user = requireUser(c)
    if (user instanceof Response) return user
    // The audit report survives deletion (ruling 2): fetch with includeDeleted
    // so a deleted finalized run's report stays retrievable. A deleted run is
    // sensitive (the run itself is gone from every other surface), so only
    // owner/admin may read it, while live runs' audit access is unchanged.
    const run = await getRedactionRun(
      pool,
      user.organisationId,
      c.req.param('runId'),
      { includeDeleted: true },
    )
    if (!run)
      return errorResponse(
        c,
        'redaction_run_not_found',
        'Redaction run not found.',
        404,
      )
    if (run.deletedAt) {
      const manageUser = requireManageRole(c)
      if (manageUser instanceof Response) return manageUser
    }
    if (run.status !== 'finalized')
      return errorResponse(
        c,
        'redaction_run_not_reviewable',
        'An audit report is available after finalization.',
        400,
      )
    const report = buildAuditReport(
      run,
      await listRedactionAuditLog(pool, user.organisationId, run.id),
    )
    const format = c.req.query('format') ?? 'json'
    if (format === 'json') return c.json(report)
    if (format === 'markdown')
      return c.body(renderAuditMarkdown(report), 200, {
        'content-type': 'text/markdown; charset=utf-8',
      })
    if (format === 'html')
      return c.body(renderAuditHtml(report), 200, {
        'content-type': 'text/html; charset=utf-8',
      })
    return errorResponse(
      c,
      'validation_failed',
      'Audit format must be json, markdown, or html.',
      400,
    )
  })

  routes.get('/api/redaction-runs/:runId/token-map', async (c) => {
    const user = requireUser(c)
    if (user instanceof Response) return user
    const run = await getRedactionRun(
      pool,
      user.organisationId,
      c.req.param('runId'),
    )
    if (!run)
      return errorResponse(
        c,
        'redaction_run_not_found',
        'Redaction run not found.',
        404,
      )
    if (
      run.status !== 'finalized' ||
      run.summary.outputMode !== 'pseudonymised' ||
      !run.summary.tokenMap
    )
      return errorResponse(
        c,
        'redaction_run_not_reviewable',
        'No pseudonymisation token map exists for this run.',
        400,
      )
    await appendAuditLog(pool, {
      organisationId: user.organisationId,
      userId: user.id,
      entityType: 'redaction_run',
      entityId: run.id,
      action: 'redaction.token_map_access',
      metadata: { tokenCount: Object.keys(run.summary.tokenMap).length },
      requestId: c.get('requestId'),
    })
    return c.json({ tokenMap: run.summary.tokenMap })
  })

  return routes
}
