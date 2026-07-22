import { join } from 'node:path'
import { rm, writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { readDatasetManifest } from './artifacts'
import { canonicalHash } from './governance'
import { promoteBenchmark } from './promote'
import { corpusStageSpecs } from './program'
import { qaSample } from './qa'
import { contentHash } from './validation'
import {
  genericFixture,
  invokeRunner,
  privateRoot,
  recordEntry,
  releaseRoot,
  stateEntry,
  type PendingFixture,
} from './resume.fixtures'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

function expectPreservedProvenance(
  metadata: Record<string, unknown>,
  fixture: PendingFixture,
) {
  expect(metadata.selection).toEqual(fixture.metadata.selection)
  expect(metadata.tournamentManifestHash).toBe(
    fixture.metadata.tournamentManifestHash,
  )
  expect(metadata.partitionRegistryHash).toBe(
    fixture.metadata.partitionRegistryHash,
  )
  expect(metadata.externalPartitionHashes).toEqual(
    fixture.metadata.externalPartitionHashes,
  )
  expect(metadata.usage).toEqual(fixture.metadata.usage)
  expect(metadata.spendGbp).toBe(fixture.metadata.spendGbp)
  expect(metadata.requestTelemetry).toEqual(fixture.metadata.requestTelemetry)
  expect(metadata.firstPassAnnotations).toEqual(
    fixture.metadata.firstPassAnnotations,
  )
  expect(metadata.finalPassAnnotations).toEqual(
    fixture.metadata.finalPassAnnotations,
  )
  if (!Array.isArray(metadata.qa)) throw new Error('Expected QA provenance')
  expect(metadata.qa).toHaveLength(fixture.metadata.qa.length)
  const pendingId = fixture.disposition.id
  for (const [id, evidence] of fixture.metadata.qa)
    if (id !== pendingId) expect(recordEntry(metadata.qa, id)).toEqual(evidence)
  expect(recordEntry(metadata.qa, pendingId).human).toEqual(fixture.disposition)
  if (!Array.isArray(metadata.documentStates))
    throw new Error('Expected document-state provenance')
  expect(metadata.documentStates).toHaveLength(
    fixture.metadata.documentStates.length,
  )
  expect(stateEntry(metadata.documentStates, pendingId).status).toBe('accepted')
}

describe.sequential('generic adjudication resume integration', () => {
  it('restores complete provenance for every non-tournament stage and promotes a resumed benchmark', async () => {
    const fixtures = [
      genericFixture('training_seed'),
      genericFixture('development_challenge'),
      genericFixture('benchmark', true),
    ]
    let benchmark:
      | {
          root: string
          destination: string
          fixture: PendingFixture
          documents: Awaited<
            ReturnType<typeof readDatasetManifest>
          >['documents']
          manifestHash: string
        }
      | undefined

    for (const fixture of fixtures) {
      const root = await privateRoot(directories)
      const stage = fixture.metadata.stage
      const checkpointPath = join(root, `${stage}-checkpoint.json`)
      const dispositionsPath = join(root, `${stage}-dispositions.json`)
      await Promise.all([
        writeFile(checkpointPath, JSON.stringify(fixture.artifact)),
        writeFile(dispositionsPath, JSON.stringify([fixture.disposition])),
      ])
      await invokeRunner(
        [
          `--stage=${stage}`,
          `--resume-pending=${checkpointPath}`,
          `--human-dispositions=${dispositionsPath}`,
        ],
        root,
      )
      const destination = join(
        root,
        stage === 'benchmark' ? 'benchmark_candidate' : stage,
      )
      const resumed = await readDatasetManifest(destination, stage)
      expect(resumed.documents).toHaveLength(corpusStageSpecs(stage).length)
      expect(
        new Set(resumed.documents.map((document) => document.id)).size,
      ).toBe(corpusStageSpecs(stage).length)
      expectPreservedProvenance(resumed.manifest.metadata, fixture)
      if (stage === 'benchmark')
        benchmark = {
          root,
          destination,
          fixture,
          documents: resumed.documents,
          manifestHash: resumed.manifest.manifestHash,
        }
    }

    if (!benchmark) throw new Error('Benchmark fixture was not resumed')
    const evidencePath = join(benchmark.root, 'promotion-evidence.json')
    const registryPath = join(benchmark.root, 'partition-registry.json')
    await Promise.all([
      writeFile(registryPath, JSON.stringify(benchmark.fixture.registry)),
      writeFile(
        evidencePath,
        JSON.stringify({
          candidateManifestHash: benchmark.manifestHash,
          partitionRegistryHash: canonicalHash(benchmark.fixture.registry),
          judgeVerdicts: [...benchmark.fixture.qa.values()].map(
            (evidence) => evidence.primary,
          ),
          disputeVerdicts: [...benchmark.fixture.qa.values()].flatMap(
            (evidence) => (evidence.dispute ? [evidence.dispute] : []),
          ),
          humanDispositions: [benchmark.fixture.disposition],
          audits: qaSample(benchmark.documents).map((document) => ({
            id: document.id,
            completed: true,
            reviewer: 'fixture auditor',
            evidenceHash: contentHash(`audit ${document.id}`),
          })),
          approval: {
            approvedBy: 'fixture approver',
            approvedAt: '2026-07-21T12:00:00.000Z',
            termsReviewReference: 'fixture-terms',
          },
        }),
      ),
    ])
    const publicRoot = await releaseRoot(directories)
    await expect(
      promoteBenchmark({
        candidateRoot: benchmark.destination,
        privateRoot: benchmark.root,
        releaseRoot: publicRoot,
        version: 'resumed-v1',
        evidencePath,
        partitionRegistryPath: registryPath,
        productRoot: process.cwd(),
      }),
    ).resolves.toBe(join(publicRoot, 'benchmark', 'resumed-v1'))
  }, 30_000)
})
