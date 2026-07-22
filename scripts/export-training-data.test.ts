import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { canonicalHash } from './synthetic-v2/governance'
import { corpusStageSpecs } from './synthetic-v2/program'
import {
  contentHash,
  externalRootSentinelFile,
  nearDuplicateSignature,
} from './bench-guard'
import { exportTrainingData, type InputRun } from './export-training-data'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

async function externalRoot(kind: 'private-corpus' | 'benchmark-release') {
  const directory = await mkdtemp(join(tmpdir(), 'obiter-training-export-'))
  directories.push(directory)
  await writeFile(
    join(directory, externalRootSentinelFile),
    JSON.stringify({ kind }),
  )
  return directory
}

async function benchmarkManifest(root: string, id: string, text: string) {
  const manifest = join(root, 'MANIFEST.json')
  const targetId = corpusStageSpecs('benchmark').some((spec) => spec.id === id)
    ? id
    : corpusStageSpecs('benchmark')[0]!.id
  const documents = corpusStageSpecs('benchmark').map((spec, index) => ({
    id: spec.id,
    textHash:
      spec.id === targetId
        ? contentHash(text)
        : String(index).padStart(64, 'a'),
    recordHash: String(index).padStart(64, 'b'),
  }))
  const nearDuplicateSignatures = documents.map((document, index) =>
    document.id === targetId
      ? nearDuplicateSignature(targetId, text)
      : {
          id: document.id,
          textHash: document.textHash,
          shingles: [`frozen benchmark shingle ${index}`],
        },
  )
  const unsigned = {
    version: 'synthetic-v2-release:v2' as const,
    stage: 'benchmark' as const,
    metadata: { stage: 'benchmark' },
    documents,
    nearDuplicateSignatures,
  }
  await writeFile(
    manifest,
    JSON.stringify({ ...unsigned, manifestHash: canonicalHash(unsigned) }),
  )
  return manifest
}

function run(text: string, organisationId = 'org-1'): InputRun {
  return {
    id: 'run-1',
    organisationId,
    status: 'finalized',
    fullyReviewed: true,
    text,
    spans: [],
    decisions: {},
  }
}

async function expectMissing(path: string) {
  await expect(access(path)).rejects.toMatchObject({ code: 'ENOENT' })
}

describe('training data export', () => {
  it('exports one explicit organisation to a sentinel-protected external root', async () => {
    const inputRoot = await externalRoot('private-corpus')
    const benchmarkRoot = await externalRoot('benchmark-release')
    const input = join(inputRoot, 'reviewed-runs.json')
    const outputDirectory = join(inputRoot, 'exports')
    const output = join(outputDirectory, 'org-1.jsonl')
    await mkdir(outputDirectory)
    await writeFile(
      input,
      JSON.stringify([run('Reviewed fictional training text.')]),
    )
    const manifest = await benchmarkManifest(
      benchmarkRoot,
      'bench-1',
      'Separate benchmark text with no overlap at all.',
    )

    await exportTrainingData({
      inputPath: input,
      outputPath: output,
      organisationId: 'org-1',
      benchmarkManifestPath: manifest,
    })

    const exported = await readFile(output, 'utf8')
    expect(JSON.parse(exported)).toMatchObject({
      text: 'Reviewed fictional training text.',
      info: { id: 'run-1' },
    })
  })

  it('rejects partial or unfinalized runs rather than silently exporting them', async () => {
    const root = await externalRoot('private-corpus')
    const benchmarkRoot = await externalRoot('benchmark-release')
    const input = join(root, 'reviewed-runs.json')
    const output = join(root, 'org-1.jsonl')
    const manifest = await benchmarkManifest(
      benchmarkRoot,
      'bench-1',
      'Separate benchmark text with no overlap at all.',
    )
    await writeFile(
      input,
      JSON.stringify([
        { ...run('Partial fictional text.'), fullyReviewed: false },
      ]),
    )
    await expect(
      exportTrainingData({
        inputPath: input,
        outputPath: output,
        organisationId: 'org-1',
        benchmarkManifestPath: manifest,
      }),
    ).rejects.toThrow('finalized, fully reviewed')
    await expectMissing(output)
  })

  it('rejects repository-local or unsentinelized input roots', async () => {
    const benchmarkRoot = await externalRoot('benchmark-release')
    const privateRoot = await externalRoot('private-corpus')
    const local = await mkdtemp(join(tmpdir(), 'obiter-local-input-'))
    directories.push(local)
    const input = join(local, 'reviewed-runs.json')
    const output = join(privateRoot, 'org-1.jsonl')
    const manifest = await benchmarkManifest(
      benchmarkRoot,
      'bench-1',
      'Separate benchmark text with no overlap at all.',
    )
    await writeFile(input, JSON.stringify([run('Reviewed fictional text.')]))
    await expect(
      exportTrainingData({
        inputPath: input,
        outputPath: output,
        organisationId: 'org-1',
        benchmarkManifestPath: manifest,
      }),
    ).rejects.toThrow('Training input must be under an external')
    await expectMissing(output)
  })

  it('rejects an unscoped batch without creating an output', async () => {
    const root = await externalRoot('private-corpus')
    const benchmarkRoot = await externalRoot('benchmark-release')
    const input = join(root, 'reviewed-runs.json')
    const output = join(root, 'org-1.jsonl')
    await writeFile(input, JSON.stringify([run('Text', 'org-2')]))
    const manifest = await benchmarkManifest(
      benchmarkRoot,
      'bench-1',
      'A distinct benchmark text with enough words.',
    )

    await expect(
      exportTrainingData({
        inputPath: input,
        outputPath: output,
        organisationId: 'org-1',
        benchmarkManifestPath: manifest,
      }),
    ).rejects.toThrow('not exclusively scoped')
    await expectMissing(output)
  })

  it('requires an explicit organisation scope and a sentinel-protected output', async () => {
    const root = await externalRoot('private-corpus')
    const benchmarkRoot = await externalRoot('benchmark-release')
    const unprotected = await mkdtemp(
      join(tmpdir(), 'obiter-unprotected-output-'),
    )
    directories.push(unprotected)
    const input = join(root, 'reviewed-runs.json')
    const manifest = await benchmarkManifest(
      benchmarkRoot,
      'bench-1',
      'A distinct benchmark text with enough words for comparison.',
    )
    await writeFile(input, JSON.stringify([run('Safe reviewed text.')]))

    await expect(
      exportTrainingData({
        inputPath: input,
        outputPath: join(root, 'missing-org.jsonl'),
        organisationId: '',
        benchmarkManifestPath: manifest,
      }),
    ).rejects.toThrow('explicit organisation scope')
    await expect(
      exportTrainingData({
        inputPath: input,
        outputPath: join(unprotected, 'org-1.jsonl'),
        organisationId: 'org-1',
        benchmarkManifestPath: manifest,
      }),
    ).rejects.toThrow('SYNTHETIC_V2_ROOT.json')
  })

  it('checks exact and near benchmark duplicates before writing', async () => {
    const root = await externalRoot('private-corpus')
    const benchmarkRoot = await externalRoot('benchmark-release')
    const input = join(root, 'reviewed-runs.json')
    const output = join(root, 'org-1.jsonl')
    const benchmarkText =
      'The fictional claimant signed the confidential settlement agreement at the solicitors office after reviewing all draft terms with independent legal advice yesterday afternoon.'
    const manifest = await benchmarkManifest(
      benchmarkRoot,
      'bench-1',
      benchmarkText,
    )

    await writeFile(input, JSON.stringify([run(benchmarkText)]))
    await expect(
      exportTrainingData({
        inputPath: input,
        outputPath: output,
        organisationId: 'org-1',
        benchmarkManifestPath: manifest,
      }),
    ).rejects.toThrow('Benchmark contamination detected')
    await expectMissing(output)

    await writeFile(
      input,
      JSON.stringify([
        run(
          'The fictional claimant signed the confidential settlement agreement at the solicitors office after reviewing all draft terms with independent legal advice yesterday morning.',
        ),
      ]),
    )
    await expect(
      exportTrainingData({
        inputPath: input,
        outputPath: output,
        organisationId: 'org-1',
        benchmarkManifestPath: manifest,
      }),
    ).rejects.toThrow('Benchmark near-duplicate contamination detected')
    await expectMissing(output)
  })
})
