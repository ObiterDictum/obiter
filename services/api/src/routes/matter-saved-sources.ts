import { Hono } from 'hono'
import type { Context } from 'hono'
import type { Pool } from 'pg'
import {
  savedMatterSourceCreateRequestSchema,
  type ApiErrorCode,
  type ApiErrorResponse,
  type SavedMatterSource,
  type UserRole,
} from '@obiter/contracts'
import { appendAuditLog } from '../audit-log'
import { getMatter } from '../database'
import { ensureOrgUser } from '../authz'
import { lockMatterForEdit } from '../matter-lock'

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

interface SavedSourceRow {
  id: string
  matter_id: string
  source_kind: string
  source_id: string
  title: string
  citation: string | null
  source_url: string | null
  created_by: string
  created_at: string
}

const savedSourceColumns = `id, matter_id, source_kind, source_id, title,
  citation, source_url, created_by, created_at`

function mapSavedSource(row: SavedSourceRow): SavedMatterSource {
  return {
    id: row.id,
    matterId: row.matter_id,
    kind: row.source_kind === 'legislation' ? 'legislation' : 'judgment',
    sourceId: row.source_id,
    title: row.title,
    citation: row.citation,
    sourceUrl: row.source_url,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at).toISOString(),
  }
}

function errorResponse(
  c: RouteContext,
  code: ApiErrorCode,
  message: string,
  status: 400 | 401 | 403 | 404,
) {
  const body: ApiErrorResponse = {
    error: { code, message, requestId: c.get('requestId') },
  }
  return c.json(body, status)
}

export function createMatterSavedSourcesRoutes(pool: Pool) {
  const routes = new Hono<{ Variables: RouteVariables }>()

  routes.get('/api/matters/:matterId/saved-sources', async (c) => {
    const user = await ensureOrgUser(c, pool)
    if (user instanceof Response) return user

    const matter = await getMatter(pool, user, c.req.param('matterId'), 'view')
    if (!matter) {
      return errorResponse(c, 'matter_not_found', 'Matter not found.', 404)
    }
    const result = await pool.query<SavedSourceRow>(
      `select ${savedSourceColumns}
         from matter_saved_sources
        where organisation_id = $1 and matter_id = $2 and deleted_at is null
        order by created_at desc`,
      [user.organisationId, matter.id],
    )
    return c.json({ savedSources: result.rows.map(mapSavedSource) })
  })

  routes.post('/api/matters/:matterId/saved-sources', async (c) => {
    const user = await ensureOrgUser(c, pool)
    if (user instanceof Response) return user

    const parsed = savedMatterSourceCreateRequestSchema.safeParse(
      await c.req.json().catch(() => null),
    )
    if (!parsed.success) {
      return errorResponse(
        c,
        'validation_failed',
        'Saved source request is invalid.',
        400,
      )
    }
    const matter = await getMatter(pool, user, c.req.param('matterId'), 'edit')
    if (!matter) {
      return errorResponse(c, 'matter_not_found', 'Matter not found.', 404)
    }
    const client = await pool.connect()
    let committed = false
    try {
      await client.query('begin')
      if (
        !(await lockMatterForEdit(client, {
          organisationId: user.organisationId,
          userId: user.id,
          matterId: matter.id,
        }))
      )
        return errorResponse(c, 'matter_not_found', 'Matter not found.', 404)
      const result = await client.query<SavedSourceRow>(
        `insert into matter_saved_sources (
         organisation_id, matter_id, source_kind, source_id, title, citation,
         source_url, created_by
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (matter_id, source_kind, source_id) do update set
         title = excluded.title,
         citation = excluded.citation,
         source_url = excluded.source_url,
         deleted_at = null,
         deleted_by = null
       returning ${savedSourceColumns}`,
        [
          user.organisationId,
          matter.id,
          parsed.data.kind,
          parsed.data.sourceId,
          parsed.data.title,
          parsed.data.citation ?? null,
          parsed.data.sourceUrl ?? null,
          user.id,
        ],
      )
      const savedSource = mapSavedSource(result.rows[0]!)
      await appendAuditLog(client, {
        organisationId: user.organisationId,
        userId: user.id,
        entityType: 'matter',
        entityId: matter.id,
        action: 'matter.source_save',
        metadata: { savedSourceId: savedSource.id, kind: savedSource.kind },
        requestId: c.get('requestId'),
      })
      await client.query('commit')
      committed = true
      return c.json({ savedSource }, 201)
    } finally {
      try {
        if (!committed) await client.query('rollback')
      } finally {
        client.release()
      }
    }
  })

  routes.delete(
    '/api/matters/:matterId/saved-sources/:savedSourceId',
    async (c) => {
      const user = await ensureOrgUser(c, pool)
      if (user instanceof Response) return user

      const matter = await getMatter(
        pool,
        user,
        c.req.param('matterId'),
        'edit',
      )
      if (!matter) {
        return errorResponse(c, 'matter_not_found', 'Matter not found.', 404)
      }
      const client = await pool.connect()
      let committed = false
      try {
        await client.query('begin')
        if (
          !(await lockMatterForEdit(client, {
            organisationId: user.organisationId,
            userId: user.id,
            matterId: matter.id,
          }))
        )
          return errorResponse(c, 'matter_not_found', 'Matter not found.', 404)
        const result = await client.query<{ id: string }>(
          `update matter_saved_sources
            set deleted_at = now(), deleted_by = $1
          where id = $2 and organisation_id = $3 and matter_id = $4
            and deleted_at is null
        returning id`,
          [
            user.id,
            c.req.param('savedSourceId'),
            user.organisationId,
            matter.id,
          ],
        )
        if (!result.rows[0]) {
          return errorResponse(
            c,
            'saved_source_not_found',
            'Saved source not found.',
            404,
          )
        }
        await appendAuditLog(client, {
          organisationId: user.organisationId,
          userId: user.id,
          entityType: 'matter',
          entityId: matter.id,
          action: 'matter.source_remove',
          metadata: { savedSourceId: result.rows[0].id },
          requestId: c.get('requestId'),
        })
        await client.query('commit')
        committed = true
        return c.json({ removed: true, savedSourceId: result.rows[0].id })
      } finally {
        try {
          if (!committed) await client.query('rollback')
        } finally {
          client.release()
        }
      }
    },
  )

  return routes
}
