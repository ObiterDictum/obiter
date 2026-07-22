import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertMatchingTournamentCanary,
  assertReviewedTournamentJudgeConfiguration,
  createTournamentCanaryReceipt,
  reviewedTournamentJudgeConfiguration,
  tournamentCanarySpecificationHash,
} from './canary'
import { canonicalHash, reviewedCandidates } from './governance'
import { corpusStageSpecs } from './program'

const roots: string[] = []
const configuration = {
  primaryJudgeProvider: 'opencode-go',
  primaryJudgeModel: 'glm-5.2',
  disputeJudgeProvider: 'opencode-go',
  disputeJudgeModel: 'grok-4.5',
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  )
})

async function validCanaryRoot(
  artifactOverrides: Record<string, unknown> = {},
) {
  const root = await mkdtemp(join(tmpdir(), 'synthetic-v2-canary-'))
  roots.push(root)
  await mkdir(join(root, 'smoke'))
  await mkdir(join(root, 'tournament-canaries'))
  const unsignedArtifact = {
    version: 'synthetic-v2-provider-smoke:v1',
    purpose: 'diagnostic-only-not-a-corpus-partition',
    profile: 'tournament-canary',
    specification: corpusStageSpecs('tournament')[0],
    tournamentSpecificationHash: tournamentCanarySpecificationHash(),
    ...configuration,
    requestedCandidateId: undefined,
    results: reviewedCandidates.map((candidate) => ({
      candidateId: candidate.id,
      writer: candidate.writer,
      annotator: candidate.annotator,
      status: 'human_adjudication_required',
      firstAttemptValid: true,
      requestTelemetry: [
        { role: 'writer', status: 'success' },
        { role: 'annotator', status: 'success' },
        { role: 'primary_judge', status: 'success' },
        { role: 'dispute_judge', status: 'success' },
      ],
      documentStates: [
        {
          generationAttempts: 1,
          annotationAttempts: 1,
          repairAttempts: 0,
          regenerationAttempts: 0,
        },
      ],
    })),
    ...artifactOverrides,
  }
  const artifactHash = canonicalHash(unsignedArtifact)
  await writeFile(
    join(root, 'smoke', `${artifactHash}.json`),
    JSON.stringify({ ...unsignedArtifact, artifactHash }),
  )
  const receipt = createTournamentCanaryReceipt(configuration, artifactHash)
  await writeFile(
    join(root, 'tournament-canaries', `${receipt.receiptHash}.json`),
    JSON.stringify(receipt),
  )
  return root
}

describe('synthetic v2 tournament canary gate', () => {
  it('permits only the reviewed tournament judge route', () => {
    expect(() =>
      assertReviewedTournamentJudgeConfiguration(
        reviewedTournamentJudgeConfiguration,
      ),
    ).not.toThrow()
    expect(() =>
      assertReviewedTournamentJudgeConfiguration(configuration),
    ).toThrow('openai/gpt-5.4-mini')
  })

  it('accepts matching successful full-candidate evidence', async () => {
    const root = await validCanaryRoot()
    await expect(
      assertMatchingTournamentCanary(root, configuration),
    ).resolves.toMatch(/^[a-f0-9]{64}$/)
  })

  it('accepts first-attempt provider conformance with candidate-quality rejection', async () => {
    const results = reviewedCandidates.map((candidate) => ({
      candidateId: candidate.id,
      writer: candidate.writer,
      annotator: candidate.annotator,
      status: 'candidate_quality_rejected',
      firstAttemptValid: true,
      requestTelemetry: [
        { role: 'writer', status: 'success' },
        { role: 'annotator', status: 'success' },
        { role: 'primary_judge', status: 'success' },
        { role: 'dispute_judge', status: 'success' },
      ],
      documentStates: [
        {
          generationAttempts: 1,
          annotationAttempts: 1,
          repairAttempts: 0,
          regenerationAttempts: 0,
        },
      ],
    }))
    const root = await validCanaryRoot({ results })
    await expect(
      assertMatchingTournamentCanary(root, configuration),
    ).resolves.toMatch(/^[a-f0-9]{64}$/)
  })

  it('rejects a structurally repaired candidate', async () => {
    const root = await validCanaryRoot({
      results: reviewedCandidates.map((candidate, index) => ({
        candidateId: candidate.id,
        writer: candidate.writer,
        annotator: candidate.annotator,
        status: 'human_adjudication_required',
        firstAttemptValid: index !== 0,
        requestTelemetry: [
          { role: 'writer', status: 'success' },
          { role: 'annotator', status: 'success' },
          { role: 'primary_judge', status: 'success' },
          { role: 'dispute_judge', status: 'success' },
        ],
        documentStates: [
          {
            generationAttempts: 1,
            annotationAttempts: index === 0 ? 2 : 1,
            repairAttempts: 0,
            regenerationAttempts: 0,
          },
        ],
      })),
    })
    await expect(
      assertMatchingTournamentCanary(root, configuration),
    ).rejects.toThrow('no matching successful')
  })

  it('rejects stale judge configuration', async () => {
    const root = await validCanaryRoot()
    await expect(
      assertMatchingTournamentCanary(root, {
        ...configuration,
        primaryJudgeModel: 'different-model',
      }),
    ).rejects.toThrow('no matching successful')
  })

  it('rejects a receipt whose executed specification is missing or changed', async () => {
    const missing = await validCanaryRoot({ specification: undefined })
    await expect(
      assertMatchingTournamentCanary(missing, configuration),
    ).rejects.toThrow('no matching successful')

    const source = corpusStageSpecs('tournament')[0]!
    const changed = await validCanaryRoot({
      specification: { ...source, seed: `changed:${source.seed}` },
    })
    await expect(
      assertMatchingTournamentCanary(changed, configuration),
    ).rejects.toThrow('no matching successful')
  })

  it('rejects an artifact with the wrong version or purpose', async () => {
    const version = await validCanaryRoot({ version: 'unexpected' })
    await expect(
      assertMatchingTournamentCanary(version, configuration),
    ).rejects.toThrow('no matching successful')

    const purpose = await validCanaryRoot({ purpose: 'corpus-partition' })
    await expect(
      assertMatchingTournamentCanary(purpose, configuration),
    ).rejects.toThrow('no matching successful')
  })

  it('rejects missing canary evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'synthetic-v2-canary-'))
    roots.push(root)
    await expect(
      assertMatchingTournamentCanary(root, configuration),
    ).rejects.toThrow('requires a successful')
  })
})
