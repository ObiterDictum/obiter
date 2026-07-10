import { Hono } from 'hono'
import type { Context } from 'hono'
import type { Pool } from 'pg'
import { outputModeSchema, redactionPolicyModeSchema, spanDecisionSchema } from '@obiter/contracts'
import type { ApiErrorCode, ApiErrorResponse } from '@obiter/contracts'
import { applyPseudonymised, applyRedacted, createTokenMap, RedactionSpanIntegrityError, supplementSpans } from '@obiter/redaction-policy'
import { appendAuditLog } from '../database'
import {
  createRedactionRun,
  finalizeRedactionRun,
  getDocumentRedactionSource,
  getRedactionOutputKey,
  getRedactionRun,
  getRunTextObjectKey,
  listRedactionRuns,
  listRedactionRunsForDocument,
  publicRun,
  recordSpanDecision,
} from '../redaction-database'
import type { StorageService } from '../storage'

interface RouteUser { id: string; organisationId?: string | null }
interface RouteVariables { requestId: string; user: RouteUser | null }
type RouteContext = Context<{ Variables: RouteVariables }>

function errorResponse(c: RouteContext, code: ApiErrorCode, message: string, status: 400 | 401 | 404 | 409) {
  const body: ApiErrorResponse = { error: { code, message, requestId: c.get('requestId') } }
  return c.json(body, status)
}

function requireUser(c: RouteContext): { id: string; organisationId: string } | Response {
  const user = c.get('user')
  if (!user) return errorResponse(c, 'unauthenticated', 'Sign in is required.', 401)
  if (!user.organisationId) return errorResponse(c, 'organisation_not_found', 'The signed-in user does not have an active organisation.', 404)
  return { id: user.id, organisationId: user.organisationId }
}

async function jsonBody(c: RouteContext) {
  const value: unknown = await c.req.json().catch(() => null)
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function sourceInput(body: Record<string, unknown> | null) {
  const filename = typeof body?.filename === 'string' ? body.filename.trim() : ''
  const text = typeof body?.text === 'string' ? body.text : null
  const policyMode = redactionPolicyModeSchema.safeParse(body?.policyMode ?? 'internal_ai_minimisation')
  return { filename, text, policyMode }
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
    const input = sourceInput(await jsonBody(c))
    if (!input.filename || input.text === null || !input.policyMode.success) {
      return errorResponse(c, 'validation_failed', 'A source filename, document text, and valid policy mode are required.', 400)
    }
    const id = `red_${crypto.randomUUID()}`
    const sourceTextObjectKey = `org/${user.organisationId}/redaction-runs/${id}/source`
    await storage.writeText(sourceTextObjectKey, input.text)
    let run
    try {
      run = await createRedactionRun({
        pool, id, organisationId: user.organisationId, userId: user.id, sourceFilename: input.filename,
        sourceTextObjectKey, spans: supplementSpans(input.text), policyMode: input.policyMode.data,
      })
    } catch (error) {
      await storage.delete(sourceTextObjectKey)
      throw error
    }
    await appendAuditLog(pool, {
      organisationId: user.organisationId, userId: user.id, entityType: 'redaction_run', entityId: run.id,
      action: 'redaction.run_create', metadata: { policyMode: run.policyMode, spanCount: run.spans.length }, requestId: c.get('requestId'),
    })
    return c.json({ run: publicRun(run) }, 201)
  })

  routes.post('/api/documents/:documentId/redaction-runs', async (c) => {
    const user = requireUser(c)
    if (user instanceof Response) return user
    const body = await jsonBody(c)
    const policyMode = redactionPolicyModeSchema.safeParse(body?.policyMode ?? 'internal_ai_minimisation')
    if (!policyMode.success) return errorResponse(c, 'validation_failed', 'A valid policy mode is required.', 400)
    const source = await getDocumentRedactionSource(pool, user.organisationId, c.req.param('documentId'))
    if (!source) return errorResponse(c, 'document_not_found', 'Document not found.', 404)
    if (!source.text_object_key) return errorResponse(c, 'document_version_not_found', 'Document text is not available for redaction.', 404)
    const text = await storage.readText(source.text_object_key)
    const run = await createRedactionRun({
      pool, id: `red_${crypto.randomUUID()}`, organisationId: user.organisationId, userId: user.id,
      sourceFilename: source.filename, sourceTextObjectKey: null, spans: supplementSpans(text), policyMode: policyMode.data,
      matterId: source.matter_id, documentId: c.req.param('documentId'), documentVersionId: source.version_id,
    })
    await appendAuditLog(pool, {
      organisationId: user.organisationId, userId: user.id, entityType: 'redaction_run', entityId: run.id,
      action: 'redaction.run_create', metadata: { policyMode: run.policyMode, spanCount: run.spans.length }, requestId: c.get('requestId'),
    })
    return c.json({ run: publicRun(run) }, 201)
  })

  routes.get('/api/documents/:documentId/redaction-runs', async (c) => {
    const user = requireUser(c)
    if (user instanceof Response) return user
    const runs = await listRedactionRunsForDocument(pool, user.organisationId, c.req.param('documentId'))
    return c.json({ runs: runs.map((run) => listItem(publicRun(run))) })
  })

  routes.get('/api/redaction-runs/:runId', async (c) => {
    const user = requireUser(c)
    if (user instanceof Response) return user
    const run = await getRedactionRun(pool, user.organisationId, c.req.param('runId'))
    if (!run) return errorResponse(c, 'redaction_run_not_found', 'Redaction run not found.', 404)
    return c.json({ run: publicRun(run) })
  })

  routes.get('/api/redaction-runs/:runId/document-text', async (c) => {
    const user = requireUser(c)
    if (user instanceof Response) return user
    const run = await getRedactionRun(pool, user.organisationId, c.req.param('runId'))
    if (!run) return errorResponse(c, 'redaction_run_not_found', 'Redaction run not found.', 404)
    const textObjectKey = await getRunTextObjectKey(pool, run)
    if (!textObjectKey) return errorResponse(c, 'document_version_not_found', 'Document text is not available for this run.', 404)
    return c.json({ text: await storage.readText(textObjectKey) })
  })

  routes.post('/api/redaction-runs/:runId/spans/:spanId/decision', async (c) => {
    const user = requireUser(c)
    if (user instanceof Response) return user
    const body = await jsonBody(c)
    const decision = spanDecisionSchema.safeParse(body?.decision)
    if (!decision.success) return errorResponse(c, 'validation_failed', 'A valid span decision is required.', 400)
    const result = await recordSpanDecision({ pool, organisationId: user.organisationId, runId: c.req.param('runId'), spanId: c.req.param('spanId'), decision: decision.data, userId: user.id })
    if (result.kind === 'not_found') return errorResponse(c, 'redaction_run_not_found', 'Redaction run not found.', 404)
    if (result.kind === 'span_not_found') return errorResponse(c, 'span_not_found', 'Span not found in this redaction run.', 404)
    if (result.kind === 'finalized') return errorResponse(c, 'redaction_already_finalized', 'Finalized redaction runs cannot be changed.', 409)
    if (result.kind === 'not_reviewable') return errorResponse(c, 'redaction_run_not_reviewable', 'This run is not ready for review.', 400)
    await appendAuditLog(pool, { organisationId: user.organisationId, userId: user.id, entityType: 'redaction_run', entityId: result.run.id, action: 'redaction.span_decision', metadata: { spanId: result.span.id, decision: decision.data, category: result.span.category }, requestId: c.get('requestId') })
    return c.json({ run: publicRun(result.run) })
  })

  routes.post('/api/redaction-runs/:runId/finalize', async (c) => {
    const user = requireUser(c)
    if (user instanceof Response) return user
    const body = await jsonBody(c)
    const outputMode = outputModeSchema.safeParse(body?.outputMode)
    if (!outputMode.success) return errorResponse(c, 'validation_failed', 'A valid output mode is required.', 400)
    const run = await getRedactionRun(pool, user.organisationId, c.req.param('runId'))
    if (!run) return errorResponse(c, 'redaction_run_not_found', 'Redaction run not found.', 404)
    if (run.status === 'finalized') return errorResponse(c, 'redaction_already_finalized', 'This run has already been finalized.', 409)
    if (run.status !== 'ready_for_review' && run.status !== 'reviewing') return errorResponse(c, 'redaction_run_not_reviewable', 'This run is not ready for finalization.', 400)
    const textObjectKey = await getRunTextObjectKey(pool, run)
    if (!textObjectKey) return errorResponse(c, 'document_version_not_found', 'Document text is not available for this run.', 404)
    const text = await storage.readText(textObjectKey)
    let output: string
    let tokenMap: Record<string, string>
    try {
      tokenMap = createTokenMap(text, run.spans, run.decisions)
      output = outputMode.data === 'redacted' ? applyRedacted(text, run.spans, run.decisions) : applyPseudonymised(text, run.spans, run.decisions)
    } catch (error) {
      if (error instanceof RedactionSpanIntegrityError) return errorResponse(c, 'redaction_span_integrity_error', 'The document text changed; create a new redaction run before finalizing.', 409)
      throw error
    }
    const artifactId = `art_${crypto.randomUUID()}`
    const objectKey = run.matterId ? `org/${run.organisationId}/matters/${run.matterId}/artifacts/${artifactId}` : `org/${run.organisationId}/artifacts/${artifactId}`
    await storage.writeText(objectKey, output)
    let result
    try { result = await finalizeRedactionRun({ pool, organisationId: user.organisationId, runId: run.id, outputMode: outputMode.data, tokenMap, artifactId }) } catch (error) { await storage.delete(objectKey); throw error }
    if (result.kind === 'not_found') { await storage.delete(objectKey); return errorResponse(c, 'redaction_run_not_found', 'Redaction run not found.', 404) }
    if (result.kind === 'already_finalized') { await storage.delete(objectKey); return errorResponse(c, 'redaction_already_finalized', 'This run has already been finalized.', 409) }
    if (result.kind === 'not_reviewable') { await storage.delete(objectKey); return errorResponse(c, 'redaction_run_not_reviewable', 'This run is not ready for finalization.', 400) }
    await appendAuditLog(pool, { organisationId: user.organisationId, userId: user.id, entityType: 'redaction_run', entityId: result.run.id, action: 'redaction.finalize', metadata: { outputMode: outputMode.data, artifactId: result.artifact.id, spanCount: result.run.summary.totalSpans, reviewedCount: result.run.summary.reviewedCount, unreviewedCount: result.run.summary.unreviewedCount }, requestId: c.get('requestId') })
    const unreviewedSpanIds = result.run.spans.filter((span) => !result.run.decisions[span.id]).map((span) => span.id)
    return c.json({ run: publicRun(result.run), artifact: result.artifact, warnings: { unreviewedSpanIds } })
  })

  routes.get('/api/redaction-runs/:runId/output', async (c) => {
    const user = requireUser(c)
    if (user instanceof Response) return user
    const run = await getRedactionRun(pool, user.organisationId, c.req.param('runId'))
    if (!run) return errorResponse(c, 'redaction_run_not_found', 'Redaction run not found.', 404)
    if (!run.outputArtifactId) return errorResponse(c, 'redaction_run_not_reviewable', 'This run has not been finalized.', 400)
    const objectKey = await getRedactionOutputKey(pool, user.organisationId, run.outputArtifactId)
    if (!objectKey) return errorResponse(c, 'artifact_not_found', 'Redaction output is not available.', 404)
    return c.json({ text: await storage.readText(objectKey) })
  })

  routes.get('/api/redaction-runs/:runId/token-map', async (c) => {
    const user = requireUser(c)
    if (user instanceof Response) return user
    const run = await getRedactionRun(pool, user.organisationId, c.req.param('runId'))
    if (!run) return errorResponse(c, 'redaction_run_not_found', 'Redaction run not found.', 404)
    if (run.status !== 'finalized' || run.summary.outputMode !== 'pseudonymised' || !run.summary.tokenMap) return errorResponse(c, 'redaction_run_not_reviewable', 'No pseudonymisation token map exists for this run.', 400)
    await appendAuditLog(pool, { organisationId: user.organisationId, userId: user.id, entityType: 'redaction_run', entityId: run.id, action: 'redaction.token_map_access', metadata: { tokenCount: Object.keys(run.summary.tokenMap).length }, requestId: c.get('requestId') })
    return c.json({ tokenMap: run.summary.tokenMap })
  })

  return routes
}
