import { afterAll, describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import type { AuthzVariables } from '../authz'
import { computeSummary } from '../redaction-database'
import type { Decisions, RedactionSpan } from '@obiter/redaction-policy'
import { createTestPool } from '../test-database.test-support'
import { createRedactReviewRoutes } from './redact-review'

/**
 * The same text decided both ways leaves one occurrence in the copy that leaves
 * the firm. Both halves of the guard are exercised against a real database and
 * the real route: repeating a decision on every occurrence, and refusing to
 * finalise while a group still disagrees.
 */
const pool = createTestPool()

const spans: RedactionSpan[] = [
  {
    id: 'span_1',
    start: 0,
    end: 10,
    text: 'Priya Shah',
    category: 'person_name',
    source: 'rampart_model',
    confidence: 'high',
    suggestion: 'redact',
  },
  {
    id: 'span_2',
    start: 40,
    end: 50,
    text: 'Priya Shah',
    category: 'person_name',
    source: 'rampart_model',
    confidence: 'high',
    suggestion: 'redact',
  },
]

async function seedRun(decisions: Decisions) {
  const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 12)
  const orgId = `org_mixed_${suffix}`
  const userId = `usr_mixed_${suffix}`
  const runId = `red_mixed_${suffix}`
  await pool.query(
    `insert into organisations (id, name, created_at, updated_at)
     values ($1, $2, now(), now())`,
    [orgId, `Mixed text org ${suffix}`],
  )
  await pool.query(
    `insert into users (
       id, name, email, "emailVerified", "organisationId", role,
       "createdAt", "updatedAt"
     ) values ($1, 'Mixed Reviewer', $2, true, $3, 'owner', now(), now())`,
    [userId, `${userId}@example.com`, orgId],
  )
  await pool.query(
    `insert into redaction_runs (
       id, organisation_id, source_filename, status, policy_mode,
       spans_json, decisions_json, summary_json, detection_mode, created_by,
       created_at, updated_at
     ) values ($1, $2, 'pasted-extract.txt', 'reviewing',
       'internal_ai_minimisation', $3::jsonb, $4::jsonb, $5::jsonb,
       'model+supplement', $6, now(), now())`,
    [
      runId,
      orgId,
      JSON.stringify(spans),
      JSON.stringify(decisions),
      JSON.stringify(computeSummary(spans, decisions)),
      userId,
    ],
  )
  return { orgId, userId, runId }
}

function mixedDecisions(userId: string): Decisions {
  return {
    span_1: {
      decision: 'accept',
      decidedBy: userId,
      decidedAt: '2026-10-28T10:00:00.000Z',
    },
    span_2: {
      decision: 'reject',
      decidedBy: userId,
      decidedAt: '2026-10-28T10:01:00.000Z',
    },
  }
}

function reviewApp(user: { id: string; organisationId: string }) {
  const routes = new Hono<{ Variables: AuthzVariables }>()
  routes.use('*', async (c, next) => {
    c.set('requestId', 'req_mixed_text')
    c.set('user', { ...user, role: 'owner' })
    await next()
  })
  routes.route(
    '/',
    createRedactReviewRoutes(pool, {
      readText: async () =>
        'Priya Shah filed the statement. Priya Shah signed it.',
      writeText: async () => undefined,
      readBinary: async () => {
        throw new Error('mixed-text tests must not read binary storage')
      },
      writeBinary: async () => undefined,
      delete: async () => undefined,
    }),
  )
  return routes
}

async function cleanup(orgId: string) {
  await pool.query(`delete from redaction_runs where organisation_id = $1`, [
    orgId,
  ])
  await pool.query(`delete from audit_logs where organisation_id = $1`, [orgId])
  await pool.query(`delete from users where "organisationId" = $1`, [orgId])
  await pool.query(`delete from organisations where id = $1`, [orgId])
}

describe('same text decided both ways', () => {
  it('refuses to finalise and creates no output', async () => {
    const seed = await seedRun(mixedDecisions('pending'))
    try {
      await pool.query(
        `update redaction_runs set decisions_json = $2::jsonb where id = $1`,
        [seed.runId, JSON.stringify(mixedDecisions(seed.userId))],
      )
      const app = reviewApp({ id: seed.userId, organisationId: seed.orgId })
      const response = await app.request(
        `/api/redaction-runs/${seed.runId}/finalize`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ outputMode: 'pseudonymised' }),
        },
      )
      expect(response.status).toBe(409)
      const body = (await response.json()) as {
        error: { code: string; message: string }
      }
      expect(body.error.code).toBe('mixed_text_decisions')
      expect(body.error.message).toContain(
        'redacted in one place and kept visible in another',
      )
      const runs = await pool.query<{ output_id: string | null }>(
        `select output_id from redaction_runs where id = $1`,
        [seed.runId],
      )
      expect(runs.rows[0]?.output_id).toBeNull()
    } finally {
      await cleanup(seed.orgId)
    }
  })

  it('repeats one decision on every occurrence in a single recorded action', async () => {
    const seed = await seedRun({
      span_1: {
        decision: 'accept',
        decidedBy: 'pending',
        decidedAt: '2026-10-28T10:00:00.000Z',
      },
    })
    try {
      const app = reviewApp({ id: seed.userId, organisationId: seed.orgId })
      const response = await app.request(
        `/api/redaction-runs/${seed.runId}/spans/span_1/decision`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ decision: 'accept', applyToSameText: true }),
        },
      )
      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        run: { decisions: Record<string, { decision: string }> }
      }
      expect(Object.keys(body.run.decisions).sort()).toEqual([
        'span_1',
        'span_2',
      ])
      expect(body.run.decisions.span_2?.decision).toBe('accept')

      const audit = await pool.query<{ metadata_json: unknown }>(
        `select metadata_json from audit_logs
         where organisation_id = $1 and action = 'redaction.span_decision'`,
        [seed.orgId],
      )
      // One recorded action naming every span it decided.
      expect(audit.rows).toHaveLength(1)
      expect(audit.rows[0]?.metadata_json).toMatchObject({
        spanId: 'span_1',
        spanIds: ['span_1', 'span_2'],
      })
    } finally {
      await cleanup(seed.orgId)
    }
  })
})

afterAll(() => pool.end())
