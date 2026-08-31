import { Hono } from 'hono'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AuthzVariables } from '../authz'
import { createTestApiEnv } from '../test-api-env'
import { createCommentsRoutes } from './comments'
import { createDocumentAccessRoutes } from './document-access'
import { createDocumentsRoutes } from './documents'
import { createMattersRoutes } from './matters'
import {
  cleanupOrganisationIsolation,
  seedOrganisationIsolation,
  type OrganisationIsolationSeed,
} from './organisation-isolation.seed'
import { createOrganisationsRoutes } from './organisations'
import { createRedactLifecycleRoutes } from './redact-lifecycle'
import { createRedactReviewRoutes } from './redact-review'
import { createRedactRunCreationRoutes } from './redact-run-creation'

const storage = {
  readText: async () => {
    throw new Error('isolation tests must not read storage')
  },
  writeText: async () => undefined,
  readBinary: async () => {
    throw new Error('isolation tests must not read storage')
  },
  writeBinary: async () => undefined,
  delete: async () => undefined,
}

function app(pool: Pool, userId: string, organisationId: string) {
  const routes = new Hono<{ Variables: AuthzVariables }>()
  routes.use('*', async (context, next) => {
    context.set('requestId', 'req_isolation_db')
    context.set('user', {
      id: userId,
      organisationId,
      role: 'owner',
    })
    await next()
  })
  routes.route('/', createMattersRoutes(pool))
  routes.route('/', createDocumentAccessRoutes(pool))
  routes.route('/', createDocumentsRoutes(pool))
  routes.route('/', createCommentsRoutes(pool, storage))
  routes.route('/', createOrganisationsRoutes(pool, createTestApiEnv()))
  routes.route('/', createRedactRunCreationRoutes(pool, storage))
  routes.route('/', createRedactReviewRoutes(pool, storage))
  routes.route('/', createRedactLifecycleRoutes(pool, storage))
  return routes
}

function foreignNeedles(seed: OrganisationIsolationSeed) {
  return [
    seed.orgB,
    seed.userB,
    seed.matterB,
    seed.documentB,
    seed.versionB,
    seed.shareB,
    seed.runB,
    seed.auditB,
    seed.artifactB,
    seed.inviteB,
    seed.commentB,
  ]
}

async function assertHidden(
  response: Response,
  needles: string[],
  listOk = false,
) {
  const body = await response.text()
  for (const needle of needles) {
    expect(body).not.toContain(needle)
  }
  if (listOk && response.status === 200) return
  expect([403, 404]).toContain(response.status)
}

const json = (body: unknown, method: 'POST' | 'PATCH' = 'POST') => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

describe('organisation isolation against Postgres (V10)', () => {
  const connectionString = process.env.TEST_DATABASE_URL
  if (!connectionString) {
    throw new Error(
      'TEST_DATABASE_URL is required for organisation-isolation.db.test.ts',
    )
  }

  const pool = new Pool({ connectionString })
  let seed: OrganisationIsolationSeed

  beforeAll(async () => {
    seed = await seedOrganisationIsolation(pool)
  })

  afterAll(async () => {
    if (seed) await cleanupOrganisationIsolation(pool, seed)
    await pool.end()
  })

  it('refuses organisation B resources to a session user in organisation A', async () => {
    const userA = app(pool, seed.userA, seed.orgA)
    const hidden = foreignNeedles(seed)

    const ownMatter = await userA.request(`/api/matters/${seed.matterA}`)
    expect(ownMatter.status).toBe(200)

    const matters = await userA.request('/api/matters')
    await assertHidden(matters, hidden, true)

    await assertHidden(
      await userA.request(`/api/matters/${seed.matterB}`),
      hidden,
    )
    await assertHidden(
      await userA.request(
        `/api/matters/${seed.matterB}`,
        json({ name: 'taken' }, 'PATCH'),
      ),
      hidden,
    )
    await assertHidden(
      await userA.request(`/api/matters/${seed.matterB}`, { method: 'DELETE' }),
      hidden,
    )

    await assertHidden(
      await userA.request(`/api/matters/${seed.matterB}/shares`),
      hidden,
    )
    await assertHidden(
      await userA.request(
        `/api/matters/${seed.matterB}/shares`,
        json({ granteeUserId: seed.userA, accessLevel: 'view' }),
      ),
      hidden,
    )
    await assertHidden(
      await userA.request(
        `/api/matters/${seed.matterB}/shares/${seed.shareB}`,
        { method: 'DELETE' },
      ),
      hidden,
    )

    const ownDocuments = await userA.request(
      `/api/matters/${seed.matterA}/documents`,
    )
    expect(ownDocuments.status).toBe(200)
    await assertHidden(ownDocuments, hidden, true)
    await assertHidden(
      await userA.request(`/api/matters/${seed.matterB}/documents`),
      hidden,
    )
    const ownDocument = await userA.request(`/api/documents/${seed.documentA}`)
    expect(ownDocument.status).toBe(200)
    await assertHidden(ownDocument, hidden, true)
    await assertHidden(
      await userA.request(`/api/documents/${seed.documentB}`),
      hidden,
    )
    await assertHidden(
      await userA.request(`/api/documents/${seed.documentB}`, {
        method: 'DELETE',
      }),
      hidden,
    )

    const ownComments = await userA.request(
      `/api/documents/${seed.documentA}/comments`,
    )
    expect(ownComments.status).toBe(200)
    await assertHidden(ownComments, hidden, true)
    await assertHidden(
      await userA.request(`/api/documents/${seed.documentB}/comments`),
      hidden,
    )
    await assertHidden(
      await userA.request(
        `/api/documents/${seed.documentB}/comments`,
        json({
          body: 'taken',
          anchor: { paragraphId: 'p1', startOffset: 0, endOffset: 1 },
        }),
      ),
      hidden,
    )
    await assertHidden(
      await userA.request(
        `/api/documents/${seed.documentB}/comments/${seed.commentB}/resolve`,
        json({}, 'PATCH'),
      ),
      hidden,
    )

    const runs = await userA.request('/api/redaction-runs')
    await assertHidden(runs, hidden, true)
    await assertHidden(
      await userA.request(`/api/redaction-runs/${seed.runB}`),
      hidden,
    )
    await assertHidden(
      await userA.request(`/api/redaction-runs/${seed.runB}/output`),
      hidden,
    )
    await assertHidden(
      await userA.request(`/api/redaction-runs/${seed.runB}/audit`),
      hidden,
    )
    await assertHidden(
      await userA.request(`/api/redaction-runs/${seed.runB}`, {
        method: 'DELETE',
      }),
      hidden,
    )

    const membersA = await userA.request(
      `/api/organisations/${seed.orgA}/members`,
    )
    await assertHidden(membersA, [seed.userB, seed.orgB], true)
    await assertHidden(
      await userA.request(`/api/organisations/${seed.orgB}/members`),
      hidden,
    )
    await assertHidden(
      await userA.request(
        `/api/organisations/${seed.orgB}/members/${seed.userB}`,
        { method: 'DELETE' },
      ),
      hidden,
    )

    const invitesA = await userA.request(
      `/api/organisations/${seed.orgA}/invites`,
    )
    await assertHidden(invitesA, [seed.inviteB, seed.orgB], true)
    await assertHidden(
      await userA.request(`/api/organisations/${seed.orgB}/invites`),
      hidden,
    )
    await assertHidden(
      await userA.request(
        `/api/organisations/${seed.orgB}/invites/${seed.inviteB}`,
        { method: 'DELETE' },
      ),
      hidden,
    )
  })
})
