import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  readDatasetManifest,
  rootSentinelFile,
  writeDatasetAtomically,
} from './artifacts'
import {
  assertBenchmarkCandidate,
  assertPromotionPartitionDisjointness,
  finalizeTournamentFromFiles,
  promoteBenchmark,
} from './promote'
import {
  assertExternalPartitionRegistry,
  assertSelectionManifest,
  assertTournamentManifest,
  blindReviewPackage,
  canonicalHash,
  partitionManifest,
  partitionRegistry,
  reviewedCandidates,
  tournamentManifestVersion,
} from './governance'
import { generationSpecIdentity } from './matrix'
import { corpusStageSpecs } from './program'
import type { NearDuplicateSignature } from './validation'
import { contentHash } from './validation'
import type { SyntheticDocument } from './types'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

const document = {
  id: 'bench-1',
  text: 'Synthetic benchmark document.',
  spans: [],
  generator: 'fixture',
  specCell: 'x',
  matrixCells: [],
  contentHash: contentHash('Synthetic benchmark document.'),
} satisfies SyntheticDocument

async function root(kind: 'private-corpus' | 'benchmark-release') {
  const directory = await mkdtemp(join(tmpdir(), 'synthetic-v2-promote-'))
  directories.push(directory)
  await writeFile(join(directory, rootSentinelFile), JSON.stringify({ kind }))
  return directory
}

function priorPartition(stage: 'training_seed' | 'development_challenge') {
  const prefix = stage === 'training_seed' ? 'a' : 'c'
  const documents = corpusStageSpecs(stage).map((spec, index) => ({
    id: spec.id,
    textHash:
      stage === 'training_seed' && index === 0
        ? contentHash(document.text)
        : `${index}`.padStart(64, prefix),
    recordHash: `${index}`.padStart(64, prefix === 'a' ? 'b' : 'd'),
  }))
  const signatures: NearDuplicateSignature[] = documents.map(
    (document, index) => ({
      id: document.id,
      textHash: document.textHash,
      shingles: [`${stage} unique shingle ${index}`],
    }),
  )
  return partitionManifest(stage, documents, signatures)
}

function benchmarkRegistry() {
  return partitionRegistry('benchmark', [
    priorPartition('training_seed'),
    priorPartition('development_challenge'),
  ])
}

describe('benchmark promotion command', () => {
  it('reruns exact and near-duplicate partition checks against bound registry evidence', () => {
    const registry = benchmarkRegistry()
    assertExternalPartitionRegistry(registry, 'benchmark')
    const evidence = {
      judgeVerdicts: [],
      disputeVerdicts: [],
      audits: [],
      partitionRegistryHash: canonicalHash(registry),
    }
    const exact = { ...document, contentHash: contentHash(document.text) }
    expect(() =>
      assertPromotionPartitionDisjointness([exact], registry, evidence),
    ).toThrow('exact prior-partition overlap')

    const nearText = 'alpha beta gamma delta epsilon zeta'
    const near = {
      ...document,
      text: nearText,
      contentHash: contentHash(nearText),
    }
    const signatures =
      registry.partitions[0]!.manifest.nearDuplicateSignatures.map(
        (signature, index) =>
          index === 1
            ? {
                ...signature,
                shingles: [
                  'alpha beta gamma delta epsilon',
                  'beta gamma delta epsilon zeta',
                ],
              }
            : signature,
      )
    const nearRegistry = {
      ...registry,
      partitions: registry.partitions.map((entry, index) => {
        const manifest =
          index === 0
            ? partitionManifest(
                entry.manifest.stage,
                entry.manifest.documents,
                signatures,
              )
            : entry.manifest
        return { ...entry, manifest, manifestHash: manifest.manifestHash }
      }),
    }
    expect(() =>
      assertPromotionPartitionDisjointness([near], nearRegistry, {
        ...evidence,
        partitionRegistryHash: canonicalHash(nearRegistry),
      }),
    ).toThrow('near-duplicate prior-partition overlap')
    expect(() =>
      assertPromotionPartitionDisjointness([near], nearRegistry, evidence),
    ).toThrow('does not bind')
  })

  it('accepts generated artifacts with the canonical multi-cell specification identity', () => {
    const candidates = corpusStageSpecs('benchmark').map((spec) => {
      const values = spec.requiredCategories.map(
        (category) => `value-${category}`,
      )
      const text = [
        ...values,
        ...spec.hardNegatives.map((item) => item.quote),
      ].join(' ')
      let cursor = 0
      const spans = spec.requiredCategories.map((category, index) => {
        const value = values[index]!
        const start = cursor
        cursor += value.length + 1
        return { category, start, end: start + value.length, text: value }
      })
      return {
        id: spec.id,
        text,
        spans,
        generator: 'fake:writer',
        specCell: generationSpecIdentity(spec),
        matrixCells: spec.matrixCells,
        contentHash: contentHash(text),
        hardNegatives: spec.hardNegatives,
      }
    })

    expect(() => assertBenchmarkCandidate(candidates)).not.toThrow()

    const overlapping = candidates.map((candidate) => ({ ...candidate }))
    overlapping[0] = {
      ...overlapping[0]!,
      spans: [
        ...overlapping[0]!.spans,
        { ...overlapping[0]!.spans[0]!, category: 'person_private' },
      ],
    }
    expect(() => assertBenchmarkCandidate(overlapping)).toThrow('Overlapping')

    const missingCategory = candidates.map((candidate) => ({ ...candidate }))
    missingCategory[0] = {
      ...missingCategory[0]!,
      spans: missingCategory[0]!.spans.slice(1),
    }
    expect(() => assertBenchmarkCandidate(missingCategory)).toThrow(
      'omitted required category',
    )

    const forgedCoverage = candidates.map((candidate) => ({ ...candidate }))
    forgedCoverage[0] = { ...forgedCoverage[0]!, matrixCells: [] }
    expect(() => assertBenchmarkCandidate(forgedCoverage)).toThrow(
      'invalid matrix coverage',
    )

    const hardNegativeIndex = candidates.findIndex(
      (candidate) => (candidate.hardNegatives?.length ?? 0) > 0,
    )
    const forgedHardNegatives = candidates.map((candidate) => ({
      ...candidate,
    }))
    forgedHardNegatives[hardNegativeIndex] = {
      ...forgedHardNegatives[hardNegativeIndex]!,
      hardNegatives: [],
    }
    expect(() => assertBenchmarkCandidate(forgedHardNegatives)).toThrow(
      'invalid hard-negative assertions',
    )

    candidates[0]!.specCell = candidates[0]!.matrixCells[0]!
    expect(() => assertBenchmarkCandidate(candidates)).toThrow(
      'invalid specification identity',
    )
  })

  it('writes standalone loader-compatible finalized tournament and selection manifests', async () => {
    const packageByCandidate = reviewedCandidates.map((_, index) =>
      blindReviewPackage(`review-${index + 1}`, [
        {
          ...document,
          id: `tournament-document-${index + 1}`,
          generator: `provider:model-${index + 1}`,
        },
      ]),
    )
    const unsigned = {
      version: tournamentManifestVersion,
      candidates: reviewedCandidates.map((candidate, index) => ({
        candidateId: candidate.id,
        blindId: `review-${index + 1}`,
        specificationIds: [`tournament-${index + 1}`],
        seeds: [`seed-${index + 1}`],
        canonicalArtifactHash: String(index).repeat(64),
        blindReviewPackageHash: canonicalHash(packageByCandidate[index]),
        finalStatus: 'pending_review' as const,
      })),
    }
    const pending = { ...unsigned, manifestHash: canonicalHash(unsigned) }
    const finalization = {
      tournamentManifestHash: pending.manifestHash,
      reviews: pending.candidates.map((candidate, index) => ({
        candidateId: candidate.candidateId,
        blindReviewPackage: packageByCandidate[index],
        completedScorecard: {
          annotation_accuracy: 5,
          hard_negative_handling: 5,
          realism: 5,
        },
        finalStatus: 'reviewed' as const,
      })),
      selectedCandidateId: reviewedCandidates[0]!.id,
      approvedAt: '2026-07-20T12:00:00.000Z',
      approvedBy: 'reviewer',
      termsReviewReference: 'terms-2026-07',
    }
    const directory = await mkdtemp(join(tmpdir(), 'synthetic-v2-finalize-'))
    directories.push(directory)
    const tournamentPath = join(directory, 'pending.json')
    const finalizationPath = join(directory, 'review.json')
    const outputPath = join(directory, 'finalized')
    await Promise.all([
      writeFile(tournamentPath, JSON.stringify(pending)),
      writeFile(finalizationPath, JSON.stringify(finalization)),
    ])

    await finalizeTournamentFromFiles({
      tournamentManifestPath: tournamentPath,
      finalizationPath,
      outputPath,
    })
    const [tournament, selection] = await Promise.all([
      readFile(`${outputPath}.tournament.json`, 'utf8').then(JSON.parse),
      readFile(`${outputPath}.selection.json`, 'utf8').then(JSON.parse),
    ])
    expect(() => {
      assertTournamentManifest(tournament)
      assertSelectionManifest(selection)
    }).not.toThrow()
    expect(JSON.stringify(packageByCandidate)).not.toContain('provider:model')
  })

  it('rejects a candidate that does not bind the exact frozen benchmark specification set', async () => {
    const [privateRoot, releaseRoot, productRoot] = await Promise.all([
      root('private-corpus'),
      root('benchmark-release'),
      mkdtemp(join(tmpdir(), 'product-')),
    ])
    directories.push(productRoot)
    const candidateRoot = await writeDatasetAtomically([document], {
      root: privateRoot,
      productRoot,
      rootKind: 'private-corpus',
      stage: 'benchmark_candidate',
      metadata: {
        stage: 'benchmark',
        requestTelemetry: [{ rationale: 'private QA detail' }],
      },
    })
    const { manifest } = await readDatasetManifest(candidateRoot, 'benchmark')
    const evidencePath = join(privateRoot, 'promotion-evidence.json')
    await writeFile(
      evidencePath,
      JSON.stringify({
        candidateManifestHash: manifest.manifestHash,
        judgeVerdicts: [
          {
            id: document.id,
            allProposedSpansCorrect: true,
            hardNegativesCorrect: true,
            hardNegativeAssertions: [],
            referenceSpans: [],
            obviousUnmarkedSpans: [],
            realismScore: 5,
            confidence: 1,
            rationale: 'private judge rationale',
          },
        ],
        disputeVerdicts: [],
        audits: [
          {
            id: document.id,
            completed: true,
            reviewer: 'private reviewer',
            evidenceHash: 'a'.repeat(64),
          },
        ],
        approval: {
          approvedBy: 'private approver',
          approvedAt: '2026-07-20T12:00:00.000Z',
          termsReviewReference: 'terms-2026-07',
        },
      }),
    )

    await expect(
      promoteBenchmark({
        candidateRoot,
        privateRoot,
        releaseRoot,
        version: 'v1',
        evidencePath,
        productRoot,
      }),
    ).rejects.toThrow('exactly 280 documents')
  })

  it('refuses a candidate whose persisted records no longer match its manifest', async () => {
    const [privateRoot, releaseRoot, productRoot] = await Promise.all([
      root('private-corpus'),
      root('benchmark-release'),
      mkdtemp(join(tmpdir(), 'product-')),
    ])
    directories.push(productRoot)
    const candidateRoot = await writeDatasetAtomically([document], {
      root: privateRoot,
      productRoot,
      rootKind: 'private-corpus',
      stage: 'benchmark_candidate',
      metadata: { stage: 'benchmark' },
    })
    await writeFile(
      join(candidateRoot, 'documents.jsonl'),
      `${JSON.stringify({ ...document, text: 'Tampered.' })}\n`,
    )
    const evidencePath = join(privateRoot, 'promotion-evidence.json')
    await writeFile(evidencePath, '{}')
    await expect(
      promoteBenchmark({
        candidateRoot,
        privateRoot,
        releaseRoot,
        version: 'v1',
        evidencePath,
        productRoot,
      }),
    ).rejects.toThrow('content hash is invalid')
  })
})
