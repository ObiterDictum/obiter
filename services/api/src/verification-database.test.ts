import type { QueryResultRow } from 'pg'
import { describe, expect, it } from 'vitest'
import {
  createVerificationFindingId,
  type VerificationFinding,
} from '@obiter/verification-core'
import type { AuthenticatedOrgUser } from './authz'
import {
  getVerificationRun,
  listVerificationFindings,
  listVerificationRuns,
} from './verification-database'
import { queryDouble, queryResult } from './query-double.test-support'

const user: AuthenticatedOrgUser = {
  id: 'usr_1',
  organisationId: 'org_1',
  role: 'owner',
}
const subject = { documentId: 'doc_1', versionId: 'ver_1' }

/** Records every query and parameter list the store builds, and answers with
 * the supplied rows. Matching parameters to their `$n` placeholders is the
 * whole point: the placeholder contract is what the store's SQL depends on. */
function capturingPool(rows: QueryResultRow[] = []) {
  return queryDouble(() => queryResult(rows))
}

function clearCaseLawFinding(): VerificationFinding {
  const location = { paragraphId: 'p1', start: 0, end: 13 }
  return {
    id: createVerificationFindingId({
      subject,
      type: 'authority_existence',
      location,
    }),
    type: 'authority_existence',
    subject,
    citation: { rawText: '[2024] UKSC 1', location },
    normalizedCitation: {
      kind: 'case_law',
      neutralCitation: '[2024] UKSC 1',
      sourceId: 'uksc-1',
    },
    status: { state: 'clear' },
    severity: 'medium',
    confidence: 'high',
    evidence: [
      {
        sourceType: 'judgment',
        granularity: 'document',
        sourceId: 'uksc-1',
      },
    ],
    explanation: 'The stored sources hold this authority.',
  }
}

describe('verification database access', () => {
  it('binds the viewer id to $3 when loading one run by id', async () => {
    const { pool, calls } = capturingPool()
    await getVerificationRun(pool, user, 'vrun_1')
    const [call] = calls
    expect(call?.values).toEqual(['vrun_1', 'org_1', 'usr_1'])
    expect(call?.text).toContain('run.id = $1')
    expect(call?.text).toContain('run.organisation_id = $2')
    // The access predicate must read the user id from the third parameter, not
    // the run id or the organisation.
    expect(call?.text).toContain('matter.created_by = $3')
    expect(call?.text).toContain('share.grantee_user_id = $3')
    expect(call?.text).not.toContain('matter.created_by = $1')
  })

  it('binds the viewer id to $2 when listing, and the document to $3', async () => {
    const withoutDocument = capturingPool()
    await listVerificationRuns(withoutDocument.pool, user, {
      limit: 25,
      cursor: null,
    })
    const [listCall] = withoutDocument.calls
    expect(listCall?.values).toEqual(['org_1', 'usr_1', 26])
    expect(listCall?.text).toContain('run.organisation_id = $1')
    expect(listCall?.text).toContain('matter.created_by = $2')
    expect(listCall?.text).toContain('share.grantee_user_id = $2')
    expect(listCall?.text).not.toContain('run.document_id = $3')
    // Deterministic keyset ordering with an id tiebreaker, bounded server-side.
    expect(listCall?.text).toContain(
      'order by run.created_at desc, run.id desc',
    )
    expect(listCall?.text).toContain('limit $3')

    const withDocument = capturingPool()
    await listVerificationRuns(withDocument.pool, user, {
      documentId: 'doc_1',
      limit: 25,
      cursor: null,
    })
    const [documentCall] = withDocument.calls
    expect(documentCall?.values).toEqual(['org_1', 'usr_1', 'doc_1', 26])
    expect(documentCall?.text).toContain('matter.created_by = $2')
    expect(documentCall?.text).toContain('run.document_id = $3')
  })

  it('scopes a keyset page after the cursor with the id tiebreaker', async () => {
    const { pool, calls } = capturingPool()
    await listVerificationRuns(pool, user, {
      documentId: 'doc_1',
      limit: 10,
      cursor: { createdAt: '2026-09-14T00:00:00.000Z', id: 'vrun_9' },
    })
    const [call] = calls
    expect(call?.values).toEqual([
      'org_1',
      'usr_1',
      'doc_1',
      '2026-09-14T00:00:00.000Z',
      'vrun_9',
      11,
    ])
    expect(call?.text).toContain(
      '(run.created_at, run.id) < ($4::timestamptz, $5)',
    )
  })

  it('never folds the findings table into a run-list aggregate', async () => {
    const { pool, calls } = capturingPool()
    await listVerificationRuns(pool, user, { limit: 25, cursor: null })
    const [call] = calls
    expect(call?.text).not.toContain('group by run_id, organisation_id')
    expect(call?.text).toContain('left join lateral')
    expect(call?.text).toContain('finding.run_id = run.id')
  })

  it('parses persisted finding payloads through the V1 schema', async () => {
    const finding = clearCaseLawFinding()
    const { pool, calls } = capturingPool([{ payload_json: finding }])
    const page = await listVerificationFindings(pool, user, 'vrun_1', {
      limit: 50,
      cursor: null,
    })
    expect(page.findings).toEqual([finding])
    expect(page.nextCursor).toBeNull()
    const [call] = calls
    expect(call?.values).toEqual(['vrun_1', 'org_1', 'usr_1', 51])
    expect(call?.text).toContain('matter.created_by = $3')
    expect(call?.text).toContain('share.grantee_user_id = $3')
    expect(call?.text).toContain(
      'order by finding.created_at, finding.finding_id',
    )
  })

  it('refuses a persisted payload that is not a V1 finding', async () => {
    const { pool } = capturingPool([
      { payload_json: { ...clearCaseLawFinding(), explanation: '' } },
    ])
    await expect(
      listVerificationFindings(pool, user, 'vrun_1', {
        limit: 50,
        cursor: null,
      }),
    ).rejects.toThrow()
  })
})
