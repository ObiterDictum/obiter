import { Hono } from 'hono'
import type { Pool } from 'pg'
import { verificationRunCreateRequestSchema } from '@obiter/contracts'
import type { AuthzVariables } from '../authz'
import { ensureOrgUser } from '../authz'
import { readLimitedJsonBody } from '../limited-request-body'
import { DEFAULT_JSON_BODY_MAX_BYTES } from '../request-limit-defaults'
import type { StorageService } from '../storage'
import {
  getVerificationRun,
  listVerificationFindings,
  listVerificationRuns,
} from '../verification-database'
import { createAndExecuteVerificationRun } from '../verification-execution'
import { toPublicFinding } from '../verification-present'
import { errorResponse } from './redact-shared'

export function createVerificationRunRoutes(
  pool: Pool,
  storage: StorageService,
) {
  const routes = new Hono<{ Variables: AuthzVariables }>()

  routes.post('/api/documents/:documentId/verification-runs', async (c) => {
    const user = await ensureOrgUser(c, pool)
    if (user instanceof Response) return user
    const body = await readLimitedJsonBody(c, DEFAULT_JSON_BODY_MAX_BYTES)
    if (body instanceof Response) return body
    const parsed = verificationRunCreateRequestSchema.safeParse(body)
    if (!parsed.success) {
      return errorResponse(
        c,
        'validation_failed',
        'A document version id is required.',
        400,
      )
    }
    const created = await createAndExecuteVerificationRun({
      pool,
      storage,
      user,
      documentId: c.req.param('documentId'),
      versionId: parsed.data.versionId,
      requestId: c.get('requestId'),
    })
    if (!created.ok) {
      if (created.denied.reason === 'version_not_ready') {
        return errorResponse(
          c,
          'document_version_not_found',
          'This document version is not ready to verify.',
          404,
        )
      }
      return errorResponse(c, 'document_not_found', 'Document not found.', 404)
    }
    const run = await getVerificationRun(pool, user, created.runId, 'view')
    if (!run) {
      return errorResponse(
        c,
        'verification_run_not_found',
        'Verification run not found.',
        404,
      )
    }
    return c.json({ run }, 201)
  })

  routes.get('/api/documents/:documentId/verification-runs', async (c) => {
    const user = await ensureOrgUser(c, pool)
    if (user instanceof Response) return user
    const runs = await listVerificationRuns(
      pool,
      user,
      c.req.param('documentId'),
    )
    return c.json({ runs })
  })

  routes.get('/api/verification-runs', async (c) => {
    const user = await ensureOrgUser(c, pool)
    if (user instanceof Response) return user
    const runs = await listVerificationRuns(pool, user)
    return c.json({ runs })
  })

  routes.get('/api/verification-runs/:runId', async (c) => {
    const user = await ensureOrgUser(c, pool)
    if (user instanceof Response) return user
    const run = await getVerificationRun(pool, user, c.req.param('runId'))
    if (!run) {
      return errorResponse(
        c,
        'verification_run_not_found',
        'Verification run not found.',
        404,
      )
    }
    return c.json({ run })
  })

  routes.get('/api/verification-runs/:runId/findings', async (c) => {
    const user = await ensureOrgUser(c, pool)
    if (user instanceof Response) return user
    const run = await getVerificationRun(pool, user, c.req.param('runId'))
    if (!run) {
      return errorResponse(
        c,
        'verification_run_not_found',
        'Verification run not found.',
        404,
      )
    }
    const findings = await listVerificationFindings(
      pool,
      user,
      c.req.param('runId'),
    )
    return c.json({
      run,
      findings: findings.map(toPublicFinding),
    })
  })

  return routes
}
