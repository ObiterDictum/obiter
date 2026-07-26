import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ts from 'typescript'
import { afterEach, describe, expect, it } from 'vitest'
import { personCategoryPriority } from './annotations'
import {
  assertMatchingTournamentCanary,
  assertReviewedTournamentJudgeConfiguration,
  canaryReceiptEligibility,
  createTournamentCanaryReceipt,
  reviewedTournamentJudgeConfiguration,
  tournamentCanaryContractSourceHash,
  tournamentCanaryContractVersion,
  tournamentCanarySpecificationHash,
} from './canary'
import { canonicalHash, reviewedCandidates } from './governance'
import { corpusStageSpecs } from './program'
import {
  annotationSchema,
  annotationValidationAttempts,
  judgeSchema,
  judgeValidationAttempts,
} from './providers'
import { spanCategories } from './types'
import { nearDuplicateSimilarityThreshold } from './validation'

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

function namedContractDeclarations(
  path: string,
  source: string,
  names: readonly string[],
) {
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  const declarations = new Map<string, ts.Node>()
  for (const statement of sourceFile.statements)
    if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement)) &&
      statement.name
    )
      declarations.set(statement.name.text, statement)
  return names.map((name) => {
    const declaration = declarations.get(name)
    if (!declaration)
      throw new Error(`Canary contract declaration is missing: ${path}:${name}`)
    return `${name}\n${source.slice(
      declaration.getStart(sourceFile),
      declaration.end,
    )}`
  })
}

async function contractSource(path: string, names?: readonly string[]) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8')
  return names ? namedContractDeclarations(path, source, names) : [source]
}

describe('synthetic v2 tournament canary gate', () => {
  it('pins the qualification contract to provider-facing source', async () => {
    const contractSections = await Promise.all([
      contractSource('prompts.ts'),
      contractSource('annotations.ts', [
        'sourceTokens',
        'parseAnnotationResponse',
        'canonicalizePersonOverlaps',
        'resolveExactQuoteOccurrence',
        'occurrences',
      ]),
      contractSource('qa.ts', [
        'supplementMisses',
        'judgePrompt',
        'parseJudgeVerdict',
        'parseIndependentJudgeReference',
        'evaluateIndependentReference',
        'resolveQuoteOccurrence',
        'occurrences',
        'isHardNegativeJudgeResult',
        'isSyntheticSpan',
        'isObviousMiss',
        'validateJudgeReference',
        'requiresRegeneration',
        'escalationReasons',
        'reviewDocuments',
        'applyAdjudicatedReference',
        'responsesById',
        'sameReference',
        'sortedSpans',
        'sortedHardNegatives',
        'assertIndependentJudges',
      ]),
      contractSource('validation.ts', [
        'createAnnotatedCandidate',
        'candidateQualityReasons',
        'candidateFromSpans',
        'assertStructuralDocumentBinding',
        'assertHardNegatives',
        'contentHash',
        'normalizedShingles',
        'nearDuplicateSignature',
        'similarity',
        'NearDuplicateIndex',
        'occurrences',
      ]),
      contractSource('providers.ts', [
        'OpenRouterLabeler',
        'IndependentJudge',
        'DeepSeekGenerator',
        'withRetries',
        'judgeValidationErrorCode',
        'annotationValidationErrorCode',
        'isRetryable',
      ]),
    ])
    const hash = createHash('sha256')
    // Raw declaration slices include comments inside function and class bodies.
    // Comment-only edits should repin without invalidating paid receipts.
    for (const section of contractSections.flat()) {
      hash.update(section)
      hash.update('\0')
    }
    hash.update(
      JSON.stringify({
        annotationSchema,
        judgeSchema,
        annotationValidationAttempts,
        judgeValidationAttempts,
        personCategoryPriority,
        spanCategories,
        nearDuplicateSimilarityThreshold,
      }),
    )
    const actual = hash.digest('hex')

    expect(
      actual,
      `Tournament canary contract sources changed. If qualification changed, bump tournamentCanaryContractVersion from ${tournamentCanaryContractVersion} and repin tournamentCanaryContractSourceHash. For comment-only or formatting changes, repin without invalidating paid receipts.`,
    ).toBe(tournamentCanaryContractSourceHash)
  })

  it('permits only the reviewed tournament judge route', () => {
    expect(() =>
      assertReviewedTournamentJudgeConfiguration(
        reviewedTournamentJudgeConfiguration,
      ),
    ).not.toThrow()
    expect(() =>
      assertReviewedTournamentJudgeConfiguration(configuration),
    ).toThrow('openai/gpt-4.1')
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

  it('keeps receipt eligibility and receipt validation aligned for a structurally repaired candidate', async () => {
    const results = reviewedCandidates.map((candidate, index) => ({
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
    }))
    expect(
      canaryReceiptEligibility(results, 'tournament-canary', undefined)
        .eligible,
    ).toBe(false)
    const root = await validCanaryRoot({ results })
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
