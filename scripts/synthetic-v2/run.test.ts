import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { rootSentinelFile } from './artifacts'
import { canonicalHash, reviewedCandidates } from './governance'
import { corpusStageSpecs } from './program'
import {
  assertConfiguredPricing,
  pendingAdjudicationArtifact,
  persistPendingAdjudications,
  resumePendingAdjudications,
  type DocumentProcessingState,
  type TournamentCandidateCheckpointMetadata,
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

const specs = corpusStageSpecs('tournament')
const pendingSpec = specs[0]!
const document: SyntheticDocument = {
  id: pendingSpec.id,
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

function processingState(
  id: string,
  status: DocumentProcessingState['status'],
): DocumentProcessingState {
  return {
    id,
    status,
    generationAttempts: 1,
    annotationAttempts: 1,
    repairAttempts: 0,
    regenerationAttempts: 0,
    qaAttempts: 1,
    transitions: [],
    telemetryRequestIds: [],
  }
}

function completedDocument(id: string): SyntheticDocument {
  const text = `Fictional ${id}.`
  return {
    id,
    text,
    spans: [],
    generator: 'fake',
    specCell: 'fixture',
    matrixCells: [],
    contentHash: contentHash(text),
    hardNegatives: [],
  }
}

function acceptedEvidence(id: string): QaEvidence {
  const accepted = { ...primary, id }
  return {
    primary: accepted,
    dispute: { ...accepted },
    escalationReasons: [],
    outcome: 'accepted',
    accepted: true,
    adjudicatedReference: {
      source: 'independent_judge_agreement',
      spans: [],
    },
  }
}

function tournamentCheckpoint() {
  const accepted = specs.slice(1).map((spec) => completedDocument(spec.id))
  const documents = [document, ...accepted]
  const states = [
    processingState(document.id, 'human_adjudication_required'),
    ...accepted.map((entry) => processingState(entry.id, 'accepted')),
  ]
  const qa = new Map<string, QaEvidence>([
    [document.id, evidence],
    ...accepted.map((entry) => [entry.id, acceptedEvidence(entry.id)] as const),
  ])
  const candidate = reviewedCandidates[0]!
  const metadata: TournamentCandidateCheckpointMetadata = {
    version: 'synthetic-v2-tournament-candidate:v1',
    stage: 'tournament',
    candidate: {
      candidateId: candidate.id,
      writer: candidate.writer,
      annotator: candidate.annotator,
      blindId: 'review-1',
      specificationIds: specs.map((spec) => spec.id),
      seeds: specs.map((spec) => spec.seed),
    },
    qa: [...qa],
    firstPassAnnotations: documents.map((entry) => [entry.id, entry.spans]),
    finalPassAnnotations: documents.map((entry) => [entry.id, entry.spans]),
    documentStates: states,
    usage: { inputTokens: 1, outputTokens: 1 },
    spendGbp: 0.01,
    requestTelemetry: [],
  }
  return {
    accepted,
    artifact: pendingAdjudicationArtifact(
      'tournament',
      specs.map((spec) => spec.id),
      metadata,
      accepted,
      [{ document, evidence, state: states[0]! }],
    ),
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
  it('persists a complete private checkpoint and resumes accepted or rejected dispositions without providers', async () => {
    const { accepted: completed, artifact } = tournamentCheckpoint()
    const resumed = resumePendingAdjudications(artifact, [disposition()])
    expect(resumed.accepted).toEqual([
      { ...document, spans: dispute.referenceSpans },
      ...completed,
    ])
    expect(resumed.rejected).toEqual([])
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

  it('validates frozen stage IDs rather than trusting checkpoint declarations', () => {
    const { artifactHash: _, ...unsigned } = tournamentCheckpoint().artifact
    const invalidUnsigned = {
      ...unsigned,
      expectedSpecificationIds: specs.slice(1).map((spec) => spec.id),
    }
    const invalid = {
      ...invalidUnsigned,
      artifactHash: canonicalHash(invalidUnsigned),
    }
    expect(() => resumePendingAdjudications(invalid, [disposition()])).toThrow(
      'actual stage specifications',
    )
  })

  it('rejects stale evidence and invalid human reference spans', () => {
    const { artifact } = tournamentCheckpoint()
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
