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
    await listVerificationRuns(withoutDocument.pool, user)
    const [listCall] = withoutDocument.calls
    expect(listCall?.values).toEqual(['org_1', 'usr_1'])
    expect(listCall?.text).toContain('run.organisation_id = $1')
    expect(listCall?.text).toContain('matter.created_by = $2')
    expect(listCall?.text).toContain('share.grantee_user_id = $2')
    expect(listCall?.text).not.toContain('run.document_id = $3')

    const withDocument = capturingPool()
    await listVerificationRuns(withDocument.pool, user, 'doc_1')
    const [documentCall] = withDocument.calls
    expect(documentCall?.values).toEqual(['org_1', 'usr_1', 'doc_1'])
    expect(documentCall?.text).toContain('matter.created_by = $2')
    expect(documentCall?.text).toContain('run.document_id = $3')
  })

  it('parses persisted finding payloads through the V1 schema', async () => {
    const finding = clearCaseLawFinding()
    const { pool, calls } = capturingPool([{ payload_json: finding }])
    const findings = await listVerificationFindings(pool, user, 'vrun_1')
    expect(findings).toEqual([finding])
    const [call] = calls
    expect(call?.values).toEqual(['vrun_1', 'org_1', 'usr_1'])
    expect(call?.text).toContain('matter.created_by = $3')
    expect(call?.text).toContain('share.grantee_user_id = $3')
  })

  it('refuses a persisted payload that is not a V1 finding', async () => {
    const { pool } = capturingPool([
      { payload_json: { ...clearCaseLawFinding(), explanation: '' } },
    ])
    await expect(
      listVerificationFindings(pool, user, 'vrun_1'),
    ).rejects.toThrow()
  })
})
