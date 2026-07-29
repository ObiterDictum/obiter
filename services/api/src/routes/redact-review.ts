import { Hono } from 'hono'
import type { Pool } from 'pg'
import {
  redactionFinalizeInputSchema,
  spanDecisionSchema,
} from '@obiter/contracts'
import {
  applyPseudonymised,
  applyRedacted,
  createTokenMap,
  RedactionSpanIntegrityError,
} from '@obiter/redaction-policy'
import { appendAuditLog } from '../database'
import {
  finalizeRedactionRun,
  getRedactionOutputKey,
  getRedactionRun,
  getRunTextObjectKey,
  publicRun,
  recordSpanDecision,
} from '../redaction-database'
import type { StorageService } from '../storage'
import {
  errorResponse,
  jsonBody,
  requireUser,
  type RouteVariables,
} from './redact-shared'

export function createRedactReviewRoutes(pool: Pool, storage: StorageService) {
  const routes = new Hono<{ Variables: RouteVariables }>()

  routes.get('/api/redaction-runs/:runId', async (c) => {
    const user = await requireUser(c, pool)
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

  routes.get('/api/redaction-runs/:runId/document-text', async (c) => {
    const user = await requireUser(c, pool)
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
      const user = await requireUser(c, pool)
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
    const user = await requireUser(c, pool)
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
    const user = await requireUser(c, pool)
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

  routes.get('/api/redaction-runs/:runId/token-map', async (c) => {
    const user = await requireUser(c, pool)
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
