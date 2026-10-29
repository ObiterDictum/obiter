import { Hono } from 'hono'
import { afterAll, expect, it } from 'bun:test'
import { verificationEvidenceResponseSchema } from '@obiter/contracts'
import { createAuth } from './auth'
import type { AuthzVariables } from './authz'
import { createTestApiEnv } from './test-api-env'
import { createTestPool } from './test-database.test-support'
import { checkQuoteFidelity } from './quote-fidelity'
import { insertJudgment, judgmentCitation } from './quote-fidelity.test-support'
import { insertFinding } from './verification-runs.test-support'
import { createVerificationRunRoutes } from './routes/verification-runs'
import {
  seedOrganisationIsolation,
  cleanupOrganisationIsolation,
} from './routes/organisation-isolation.seed'

const pool = createTestPool()
afterAll(() => pool.end())

it('serves the exact checked paragraph after corpus changes, with real-session organisation and matter isolation', async () => {
  const seed = await seedOrganisationIsolation(pool)
  const auth = createAuth(createTestApiEnv(), pool)
  const userIds: string[] = []
  const sourceId = `evidence-${seed.suffix}`
  const runId = `vrun_evidence_${seed.suffix}`
  const text = 'Thereafter only to the extent that the contract allows.'
  try {
    const tokens: string[] = []
    for (const orgId of [seed.orgA, seed.orgB]) {
      const email = `evidence-${crypto.randomUUID()}@example.test`
      const password = `Synthetic-${crypto.randomUUID()}`
      const signed = await auth.api.signUpEmail({
        body: { name: 'Synthetic evidence reviewer', email, password },
      })
      userIds.push(signed.user.id)
      await pool.query(
        'update users set "emailVerified" = true, role = $2 where id = $1',
        [signed.user.id, 'owner'],
      )
      tokens.push(
        (await auth.api.signInEmail({ body: { email, password } })).token,
      )
      await pool.query('update users set "organisationId" = $2 where id = $1', [
        signed.user.id,
        orgId,
      ])
    }
    await pool.query('update matters set created_by = $1 where id = $2', [
      userIds[0],
      seed.matterA,
    ])
    await insertJudgment(pool, {
      id: sourceId,
      neutralCitation: '[2066] UKSC 1',
      paragraphs: [{ paragraphNumber: 11, text }],
    })
    const quote = text.replace('contract', 'court')
    const finding = await checkQuoteFidelity(pool, {
      subject: { documentId: seed.documentA, versionId: seed.versionA },
      quote: {
        rawText: quote,
        location: { paragraphId: 'p1', start: 0, end: quote.length },
      },
      normalizedCitation: judgmentCitation(sourceId),
    })
    expect(finding.status.state).toBe('flagged')
    await pool.query(
      `insert into verification_runs (id, organisation_id, matter_id, document_id, document_version_id, status, created_by, completed_at) values ($1, $2, $3, $4, $5, 'completed', $6, now())`,
      [
        runId,
        seed.orgA,
        seed.matterA,
        seed.documentA,
        seed.versionA,
        userIds[0],
      ],
    )
    await insertFinding(pool, seed.orgA, runId, finding)
    await pool.query(
      'delete from legal_source_documents where document_id = $1',
      [sourceId],
    )
    const app = new Hono<{ Variables: AuthzVariables }>()
    app.use('*', async (c, next) => {
      const session = await auth.api.getSession({ headers: c.req.raw.headers })
      c.set('user', session?.user ?? null)
      c.set('requestId', 'evidence-test')
      await next()
    })
    const storage = {
      readText: async () => '',
      writeText: async () => {},
      readBinary: async () => Buffer.alloc(0),
      writeBinary: async () => {},
      delete: async () => {},
    }
    app.route('/', createVerificationRunRoutes(pool, storage))
    const url = `/api/verification-runs/${runId}/findings/${encodeURIComponent(finding.id)}/evidence`
    const headers = { authorization: `Bearer ${tokens[0]}` }
    const allowed = await app.request(url, { headers })
    expect(allowed.status).toBe(200)
    expect(
      verificationEvidenceResponseSchema.parse(await allowed.json()),
    ).toEqual({
      passages: [{ evidenceId: `${sourceId}:judgment_paragraph:1`, text }],
    })
    expect(
      (
        await app.request(url, {
          headers: { authorization: `Bearer ${tokens[1]}` },
        })
      ).status,
    ).toBe(404)
    expect((await app.request(url)).status).toBe(401)
    await pool.query('update matters set created_by = $1 where id = $2', [
      seed.userA,
      seed.matterA,
    ])
    expect((await app.request(url, { headers })).status).toBe(404)
    await pool.query('update matters set created_by = $1 where id = $2', [
      userIds[0],
      seed.matterA,
    ])
    const { passages: _passages, ...historical } = finding
    await pool.query(
      'update verification_findings set payload_json = $1 where run_id = $2',
      [JSON.stringify(historical), runId],
    )
    expect(
      verificationEvidenceResponseSchema.parse(
        await (await app.request(url, { headers })).json(),
      ),
    ).toEqual({ passages: [] })
  } finally {
    await pool.query(
      'delete from legal_source_documents where document_id = $1',
      [sourceId],
    )
    await pool.query('delete from verification_findings where run_id = $1', [
      runId,
    ])
    await pool.query('delete from verification_runs where id = $1', [runId])
    await pool.query(
      'update users set "organisationId" = null where id = any($1::text[])',
      [userIds],
    )
    await pool.query('delete from sessions where "userId" = any($1::text[])', [
      userIds,
    ])
    await cleanupOrganisationIsolation(pool, seed)
    await pool.query('delete from audit_logs where user_id = any($1::text[])', [
      userIds,
    ])
    await pool.query('delete from users where id = any($1::text[])', [userIds])
  }
})
