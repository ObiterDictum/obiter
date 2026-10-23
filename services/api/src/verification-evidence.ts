import type { Pool } from 'pg'
import {
  createEvidenceReferenceId,
  verificationFindingSchema,
} from '@obiter/verification-core'
import type { VerificationEvidenceResponse } from '@obiter/contracts'
import type { AuthenticatedOrgUser } from './authz'
import { matterAccessPredicate } from './matter-access-boundary'

export async function getVerificationEvidence(
  pool: Pick<Pool, 'query'>,
  user: AuthenticatedOrgUser,
  runId: string,
  findingId: string,
): Promise<VerificationEvidenceResponse | null> {
  const result = await pool.query<{ payload_json: unknown }>(
    `select finding.payload_json
     from verification_findings finding
     join verification_runs run
       on run.id = finding.run_id
      and run.organisation_id = finding.organisation_id
     join matters matter
       on matter.id = run.matter_id
      and matter.organisation_id = run.organisation_id
     join matter_documents document
       on document.id = run.document_id
      and document.matter_id = run.matter_id
      and document.organisation_id = run.organisation_id
     where finding.run_id = $1
       and finding.organisation_id = $2
       and finding.finding_id = $4
       and run.deleted_at is null
       and matter.deleted_at is null
       and document.deleted_at is null
       and ${matterAccessPredicate('$3', "'view'")}`,
    [runId, user.organisationId, user.id, findingId],
  )
  const row = result.rows[0]
  if (!row) return null
  const finding = verificationFindingSchema.parse(row.payload_json)
  const ids = new Set(finding.evidence.map(createEvidenceReferenceId))
  return {
    passages: (finding.passages ?? []).filter((passage) =>
      ids.has(passage.evidenceId),
    ),
  }
}
