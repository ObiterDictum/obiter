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
import {
  decodeVerificationCursor,
  parseRunListLimit,
  resolveFindingsListLimit,
  resolveRunListLimit,
  VerificationListLimitError,
} from '../verification-pagination'
import { toPublicFinding } from '../verification-present'
import { errorResponse } from './redact-shared'

/** The run and finding list pagination contract, validated together so a
 * malformed limit or cursor is a 400 rather than an unbounded query. */
function listQuery(c: { req: { query: (key: string) => string | undefined } }) {
  const rawCursor = c.req.query('cursor')
  const cursor =
    rawCursor === undefined || rawCursor === ''
      ? null
      : decodeVerificationCursor(rawCursor)
  if (rawCursor && !cursor) return { ok: false as const }
  return {
    ok: true as const,
    cursor,
    rawLimit: parseRunListLimit(c.req.query('limit')),
  }
}

export function createVerificationRunRoutes(
  pool: Pool,
  storage: StorageService,
  corpusPool: Pick<Pool, 'query'> = pool,
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
      corpusPool,
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
    const query = listQuery(c)
    let limit: number
    try {
      limit = resolveRunListLimit(query.ok ? query.rawLimit : undefined)
    } catch (error) {
      if (!(error instanceof VerificationListLimitError)) throw error
      return errorResponse(c, 'validation_failed', error.message, 400)
    }
    if (!query.ok) {
      return errorResponse(
        c,
        'validation_failed',
        'The cursor is malformed.',
        400,
      )
    }
    const page = await listVerificationRuns(pool, user, {
      documentId: c.req.param('documentId'),
      limit,
      cursor: query.cursor,
    })
    return c.json(page)
  })

  routes.get('/api/verification-runs', async (c) => {
    const user = await ensureOrgUser(c, pool)
    if (user instanceof Response) return user
    const query = listQuery(c)
    let limit: number
    try {
      limit = resolveRunListLimit(query.ok ? query.rawLimit : undefined)
    } catch (error) {
      if (!(error instanceof VerificationListLimitError)) throw error
      return errorResponse(c, 'validation_failed', error.message, 400)
    }
    if (!query.ok) {
      return errorResponse(
        c,
        'validation_failed',
        'The cursor is malformed.',
        400,
      )
    }
    const page = await listVerificationRuns(pool, user, {
      limit,
      cursor: query.cursor,
    })
    return c.json(page)
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
    const query = listQuery(c)
    let limit: number
    try {
      limit = resolveFindingsListLimit(query.ok ? query.rawLimit : undefined)
    } catch (error) {
      if (!(error instanceof VerificationListLimitError)) throw error
      return errorResponse(c, 'validation_failed', error.message, 400)
    }
    if (!query.ok) {
      return errorResponse(
        c,
        'validation_failed',
        'The cursor is malformed.',
        400,
      )
    }
    const page = await listVerificationFindings(
      pool,
      user,
      c.req.param('runId'),
      {
        limit,
        cursor: query.cursor,
      },
    )
    return c.json({
      run,
      findings: page.findings.map(toPublicFinding),
      nextCursor: page.nextCursor,
    })
  })

  return routes
}
