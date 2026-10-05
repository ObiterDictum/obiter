import type { Pool } from 'pg'
import {
  createVerificationFindingId,
  type VerificationFinding,
} from '@obiter/verification-core'
import type { OrganisationIsolationSeed } from './routes/organisation-isolation.seed'

export type Subject = { documentId: string; versionId: string }

/**
 * Fixtures for the V5 persistence tests. The seed gives one document and one
 * version per tenant, so the run-lifecycle tests add extra ready versions to
 * the same document rather than sharing the seeded version's single live run.
 */
export async function insertReadyVersion(
  pool: Pool,
  seed: OrganisationIsolationSeed,
  versionId: string,
  versionNumber: number,
) {
  const base = `org/${seed.orgA}/matters/${seed.matterA}/documents/${seed.documentA}/versions/${versionId}`
  await pool.query(
    `insert into document_versions (
       id, organisation_id, matter_id, matter_document_id, filename, file_type,
       size_bytes, object_key, text_object_key, document_status, failure_reason,
       version_number, content_sha256, sync_state, created_by, created_at, updated_at
     )
     values ($1, $2, $3, $4, $5, 'docx', 12, $6, $7, 'ready', null, $8, $9, 'synced', $10, now(), now())`,
    [
      versionId,
      seed.orgA,
      seed.matterA,
      seed.documentA,
      `${versionId}.docx`,
      `${base}/source`,
      `${base}/text`,
      versionNumber,
      'a'.repeat(64),
      seed.userA,
    ],
  )
}

export function clearCaseLawFinding(subject: Subject): VerificationFinding {
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

export function reviewRequiredFinding(subject: Subject): VerificationFinding {
  const location = { paragraphId: 'p1', start: 20, end: 33 }
  return {
    id: createVerificationFindingId({
      subject,
      type: 'citation_resolution',
      location,
    }),
    type: 'citation_resolution',
    subject,
    citation: { rawText: '[2099] UKSC 9', location },
    normalizedCitation: { kind: 'unresolved', reason: 'no_canonical_match' },
    status: { state: 'review_required', reason: 'citation_unresolved' },
    severity: 'medium',
    confidence: 'low',
    evidence: [],
    explanation: 'The citation did not resolve to a stored authority.',
  }
}

export async function insertFinding(
  pool: Pool,
  organisationId: string,
  runId: string,
  finding: VerificationFinding,
) {
  await pool.query(
    `insert into verification_findings (
       run_id, finding_id, organisation_id, finding_type, status_state,
       status_reason, severity, confidence, payload_json, created_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, now())`,
    [
      runId,
      finding.id,
      organisationId,
      finding.type,
      finding.status.state,
      finding.status.state === 'review_required' ? finding.status.reason : null,
      finding.severity,
      finding.confidence,
      JSON.stringify(finding),
    ],
  )
}
