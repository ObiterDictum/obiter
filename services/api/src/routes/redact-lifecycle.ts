import { Hono } from 'hono'
import type { Pool } from 'pg'
import { requireManageRole } from '../authz'
import {
  buildAuditReport,
  renderAuditHtml,
  renderAuditMarkdown,
} from '../redaction-audit-report'
import {
  getRedactionRun,
  listRedactionAuditLog,
  publicRun,
  restoreRedactionRunWithAudit,
  softDeleteRedactionRun,
} from '../redaction-database'
import { redetectRedactionRun } from '../redaction-redetect'
import type { StorageService } from '../storage'
import {
  errorResponse,
  requireUser,
  type RouteVariables,
} from './redact-shared'

export function createRedactLifecycleRoutes(
  pool: Pool,
  storage: StorageService,
) {
  const routes = new Hono<{ Variables: RouteVariables }>()

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

  return routes
}
