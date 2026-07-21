import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { rootSentinelFile } from './artifacts'
import {
  assertConfiguredPricing,
  pendingAdjudicationArtifact,
  persistPendingAdjudications,
  resumePendingAdjudications,
} from './run'
import { humanAdjudicationEvidenceHash, type QaEvidence } from './qa'
import { contentHash } from './validation'
import type { SyntheticDocument } from './types'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  )
})

const document: SyntheticDocument = {
  id: 'pending-1',
  text: 'Fictional.',
  spans: [],
  generator: 'fake',
  specCell: 'fixture',
  matrixCells: [],
  contentHash: contentHash('Fictional.'),
  hardNegatives: [],
}
const primary = {
  id: document.id,
  allProposedSpansCorrect: true,
  hardNegativesCorrect: true,
  hardNegativeAssertions: [],
  referenceSpans: [],
  obviousUnmarkedSpans: [],
  realismScore: 5,
  confidence: 1,
  rationale: 'primary',
}
const dispute = {
  ...primary,
  referenceSpans: [
    {
      category: 'person_private' as const,
      start: 0,
      end: 9,
      text: 'Fictional',
    },
  ],
  rationale: 'dispute',
}
const evidence: QaEvidence = {
  primary,
  dispute,
  escalationReasons: [],
  outcome: 'human_adjudication_required',
  accepted: false,
}

function disposition(decision: 'approved' | 'rejected' = 'approved') {
  return {
    id: document.id,
    decision,
    reviewer: 'reviewer',
    adjudicatedAt: '2026-07-20T12:00:00.000Z',
    rationale: 'reviewed',
    referenceSpans: dispute.referenceSpans,
    evidenceHash: humanAdjudicationEvidenceHash(document, primary, dispute),
  }
}

describe('provider pricing preflight', () => {
  it('rejects a missing judge price before provider submission', () => {
    expect(() =>
      assertConfiguredPricing(
        {
          writer: { inputUsdPerMillion: 1, outputUsdPerMillion: 1 },
          annotator: { inputUsdPerMillion: 1, outputUsdPerMillion: 1 },
        },
        [
          { model: 'writer' },
          { model: 'annotator' },
          { model: 'primary-judge' },
          { model: 'dispute-judge' },
        ],
      ),
    ).toThrow('primary-judge')
  })
})

describe('pending human adjudication artifacts', () => {
  it('persists a private checkpoint and resumes accepted or rejected dispositions without providers', async () => {
    const artifact = pendingAdjudicationArtifact('benchmark', [
      {
        document,
        evidence,
        state: {
          id: document.id,
          status: 'human_adjudication_required',
          generationAttempts: 1,
          annotationAttempts: 1,
          repairAttempts: 0,
          regenerationAttempts: 0,
          qaAttempts: 1,
          transitions: [],
          telemetryRequestIds: [],
        },
      },
    ])
    const accepted = resumePendingAdjudications(artifact, [disposition()])
    expect(accepted.accepted[0]?.spans).toEqual(dispute.referenceSpans)
    expect(accepted.rejected).toEqual([])
    expect(
      resumePendingAdjudications(artifact, [disposition('rejected')]).rejected,
    ).toEqual([document.id])

    const root = await mkdtemp(join(tmpdir(), 'synthetic-v2-private-'))
    const product = await mkdtemp(join(tmpdir(), 'synthetic-v2-product-'))
    directories.push(root, product)
    await writeFile(
      join(root, rootSentinelFile),
      JSON.stringify({ kind: 'private-corpus' }),
    )
    const path = await persistPendingAdjudications(root, product, artifact)
    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({
      artifactHash: artifact.artifactHash,
    })
  })

  it('rejects stale evidence and invalid human reference spans', () => {
    const artifact = pendingAdjudicationArtifact('benchmark', [
      {
        document,
        evidence,
        state: {
          id: document.id,
          status: 'human_adjudication_required',
          generationAttempts: 1,
          annotationAttempts: 1,
          repairAttempts: 0,
          regenerationAttempts: 0,
          qaAttempts: 1,
          transitions: [],
          telemetryRequestIds: [],
        },
      },
    ])
    expect(() =>
      resumePendingAdjudications(
        { ...artifact, artifactHash: 'a'.repeat(64) },
        [disposition()],
      ),
    ).toThrow('stale or invalid')
    expect(() =>
      resumePendingAdjudications(artifact, [
        {
          ...disposition(),
          referenceSpans: [{ ...dispute.referenceSpans[0]!, end: 8 }],
        },
      ]),
    ).toThrow()
  })
})
