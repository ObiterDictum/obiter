import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { rootSentinelFile } from './artifacts'
import { canonicalHash, reviewedCandidates } from './governance'
import { corpusStageSpecs } from './program'
import { ProviderBatchError } from './providers'
import {
  accountTournamentError,
  assertConfiguredPricing,
  assertTournamentBudget,
  pendingAdjudicationArtifact,
  persistPendingAdjudications,
  PipelineExecutionError,
  resumePendingAdjudications,
  runPipeline,
  stopFailedTournament,
  type DocumentProcessingState,
  type TournamentCandidateCheckpointMetadata,
} from './run'
import { humanAdjudicationEvidenceHash, type QaEvidence } from './qa'
import { contentHash } from './validation'
import type {
  DocumentSpec,
  GeneratorAdapter,
  JudgeAdapter,
  LabelingAdapter,
  SyntheticDocument,
} from './types'

const directories: string[] = []
const originalLedger = process.env.SYNTHETIC_V2_LEDGER
afterEach(async () => {
  if (originalLedger === undefined) delete process.env.SYNTHETIC_V2_LEDGER
  else process.env.SYNTHETIC_V2_LEDGER = originalLedger
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  )
})

describe('pipeline paid fail-fast behavior', () => {
  it.each([undefined, 'unexpected-writer-model'])(
    'prices malformed paid responses with the configured rate (returned=%s)',
    async (returnedModel) => {
      const root = await mkdtemp(join(tmpdir(), 'synthetic-v2-ledger-'))
      directories.push(root)
      process.env.SYNTHETIC_V2_LEDGER = join(root, 'ledger.json')
      const spec = corpusStageSpecs('tournament')[0]!
      const writer: GeneratorAdapter = {
        name: 'fake:writer',
        model: 'writer',
        maxChargeAttempts: 1,
        generate: async () => {
          throw new ProviderBatchError('Malformed paid response', [
            {
              requestId: 'malformed-paid-1',
              specId: spec.id,
              role: 'writer',
              provider: 'fake',
              requestedModel: 'writer',
              returnedModel,
              usage: { inputTokens: 1_000, outputTokens: 500 },
              latencyMs: 1,
              status: 'error',
              errorCode: 'provider_missing_output',
              attempt: 1,
            },
          ])
        },
      }
      const unusedLabeler: LabelingAdapter = {
        name: 'fake:labeler',
        model: 'labeler',
        maxChargeAttempts: 1,
        label: async () => [],
        repair: async () => [],
      }
      const unusedJudge = (model: string): JudgeAdapter => ({
        name: `fake:${model}`,
        model,
        maxChargeAttempts: 1,
        judge: async () => [],
      })
      let failure: unknown
      try {
        await runPipeline(
          [spec],
          writer,
          unusedLabeler,
          unusedJudge('primary'),
          unusedJudge('dispute'),
          {
            'fake:writer': {
              inputUsdPerMillion: 100,
              outputUsdPerMillion: 200,
            },
            'fake:labeler': {
              inputUsdPerMillion: 1,
              outputUsdPerMillion: 1,
            },
            'fake:primary': {
              inputUsdPerMillion: 1,
              outputUsdPerMillion: 1,
            },
            'fake:dispute': {
              inputUsdPerMillion: 1,
              outputUsdPerMillion: 1,
            },
          },
          [],
          { maxRegenerations: 0, failFastOnTerminalState: true },
        )
      } catch (error) {
        failure = error
      }
      expect(failure).toBeInstanceOf(PipelineExecutionError)
      expect(failure).toMatchObject({
        usage: { inputTokens: 1_000, outputTokens: 500 },
        actualGbp: 0.158,
        requestTelemetry: [
          expect.objectContaining({ requestId: 'malformed-paid-1' }),
        ],
      })
    },
  )

  it('preserves a paid judge result when QA parsing fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'synthetic-v2-ledger-'))
    directories.push(root)
    process.env.SYNTHETIC_V2_LEDGER = join(root, 'ledger.json')
    const spec: DocumentSpec = {
      id: 'judge-parse-1',
      docType: 'witness_statement',
      requiredCategories: [],
      register: 'formal_pleading',
      difficulty: 'standard',
      lengthWords: 2,
      seed: 'judge-parse',
      scenario: 'Synthetic fixture.',
      hardNegatives: [],
      matrixCells: [],
    }
    const writer: GeneratorAdapter = {
      name: 'fake:writer',
      model: 'writer',
      maxChargeAttempts: 1,
      generate: async () => [
        {
          customId: spec.id,
          text: 'Fictional document.',
          generator: 'writer',
          usage: { inputTokens: 1, outputTokens: 1 },
        },
      ],
    }
    const labeler: LabelingAdapter = {
      name: 'fake:labeler',
      model: 'labeler',
      maxChargeAttempts: 1,
      label: async () => [
        {
          customId: spec.id,
          spans: [],
          generator: 'labeler',
          usage: { inputTokens: 1, outputTokens: 1 },
        },
      ],
      repair: async () => [],
    }
    const primary: JudgeAdapter = {
      name: 'fake:primary',
      model: 'primary',
      maxChargeAttempts: 1,
      judge: async () => [
        {
          id: spec.id,
          verdict: 'invalid-json',
          telemetry: {
            requestId: 'primary-paid-1',
            specId: spec.id,
            role: 'primary_judge',
            provider: 'fake',
            requestedModel: 'primary',
            returnedModel: 'primary',
            usage: { inputTokens: 10, outputTokens: 5 },
            latencyMs: 1,
            status: 'success',
            attempt: 1,
          },
        },
      ],
    }
    const dispute: JudgeAdapter = {
      name: 'fake:dispute',
      model: 'dispute',
      maxChargeAttempts: 1,
      judge: async () => [],
    }
    const pricing = Object.fromEntries(
      ['fake:writer', 'fake:labeler', 'fake:primary', 'fake:dispute'].map(
        (name) => [name, { inputUsdPerMillion: 1, outputUsdPerMillion: 1 }],
      ),
    )
    let failure: unknown
    try {
      await runPipeline(
        [spec],
        writer,
        labeler,
        primary,
        dispute,
        pricing,
        [],
        { maxRegenerations: 0, failFastOnTerminalState: true },
      )
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(PipelineExecutionError)
    expect(failure).toMatchObject({
      usage: { inputTokens: 12, outputTokens: 7 },
      requestTelemetry: [
        expect.objectContaining({ requestId: 'primary-paid-1' }),
      ],
    })
  })

  it('stops before submitting a second specification after terminal validation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'synthetic-v2-ledger-'))
    directories.push(root)
    process.env.SYNTHETIC_V2_LEDGER = join(root, 'ledger.json')
    let writerCalls = 0
    let labelCalls = 0
    let judgeCalls = 0
    const writer: GeneratorAdapter = {
      name: 'fake:writer',
      model: 'writer',
      maxChargeAttempts: 1,
      generate: async (inputs) => {
        writerCalls += inputs.length
        return inputs.map((spec) => ({
          customId: spec.id,
          text: 'Fictional document.',
          generator: 'writer',
          usage: { inputTokens: 1, outputTokens: 1 },
        }))
      },
    }
    const labeler: LabelingAdapter = {
      name: 'fake:labeler',
      model: 'labeler',
      maxChargeAttempts: 1,
      label: async (inputs) => {
        labelCalls += inputs.length
        return inputs.map(({ spec }) => ({
          customId: spec.id,
          spans: [
            {
              category: 'person_private',
              start: 0,
              end: 999,
              text: 'not in source',
            },
          ],
          generator: 'labeler',
          usage: { inputTokens: 1, outputTokens: 1 },
        }))
      },
      repair: async (inputs) => {
        labelCalls += inputs.length
        return inputs.map(({ spec }) => ({
          customId: spec.id,
          spans: [],
          generator: 'labeler',
          usage: { inputTokens: 1, outputTokens: 1 },
        }))
      },
    }
    const judge = (model: string): JudgeAdapter => ({
      name: `fake:${model}`,
      model,
      maxChargeAttempts: 1,
      judge: async (documents) => {
        judgeCalls += documents.length
        return []
      },
    })
    const pricing = Object.fromEntries(
      ['fake:writer', 'fake:labeler', 'fake:primary', 'fake:dispute'].map(
        (name) => [name, { inputUsdPerMillion: 1, outputUsdPerMillion: 1 }],
      ),
    )
    await expect(
      runPipeline(
        corpusStageSpecs('tournament').slice(0, 2),
        writer,
        labeler,
        judge('primary'),
        judge('dispute'),
        pricing,
        [],
        { maxRegenerations: 0, failFastOnTerminalState: true },
      ),
    ).rejects.toThrow('tournament-00001')
    expect(writerCalls).toBe(1)
    expect(labelCalls).toBe(2)
    expect(judgeCalls).toBe(0)
  })
})

describe('tournament spend preflight', () => {
  it('requires an explicit cap at or above the conservative estimate', () => {
    expect(() => assertTournamentBudget(30.2, undefined)).toThrow(
      'must explicitly cap',
    )
    expect(() => assertTournamentBudget(30.2, '30')).toThrow('exceeds cap')
    expect(assertTournamentBudget(30.2, '30.2')).toBe(30.2)
    expect(() => assertTournamentBudget(Number.NaN, '100')).toThrow(
      'estimate must be positive',
    )
  })
})

describe('tournament terminal failure handling', () => {
  it('retains paid result accounting when post-processing fails', () => {
    const telemetry = {
      requestId: 'request-1',
      specId: 'tournament-00001',
      role: 'primary_judge' as const,
      provider: 'opencode-go',
      requestedModel: 'glm-5.2',
      returnedModel: 'glm-5.2',
      usage: { inputTokens: 10, outputTokens: 5 },
      latencyMs: 10,
      status: 'success' as const,
      attempt: 1,
    }
    const accounted = accountTournamentError(new Error('scoring failed'), {
      documents: [],
      firstPassAnnotations: new Map(),
      finalPassAnnotations: new Map(),
      pendingAdjudications: [],
      qa: new Map(),
      documentStates: [],
      usage: { inputTokens: 10, outputTokens: 5 },
      actualGbp: 0.25,
      requestTelemetry: [telemetry],
    })
    expect(accounted).toBeInstanceOf(PipelineExecutionError)
    expect(accounted).toMatchObject({
      message: 'scoring failed',
      usage: { inputTokens: 10, outputTokens: 5 },
      actualGbp: 0.25,
      requestTelemetry: [telemetry],
    })
  })

  it('persists private evidence and rejects instead of completing silently', async () => {
    const root = await mkdtemp(join(tmpdir(), 'synthetic-v2-failure-'))
    directories.push(root)
    await mkdir(join(root, 'failed-tournaments'))
    await expect(
      stopFailedTournament({
        approvedRoot: root,
        candidateId: 'deepseek-pro-gemini-flash',
        primaryJudgeProvider: 'opencode-go',
        primaryJudgeModel: 'glm-5.2',
        disputeJudgeProvider: 'opencode-go',
        disputeJudgeModel: 'grok-4.5',
        candidateArtifacts: [{ status: 'failed', errorCode: 'fixture_error' }],
        completedCandidates: [],
        error: new Error('terminal fixture failure'),
        diagnosticSummary: 'openrouter:model:fixture_error',
      }),
    ).rejects.toThrow('tournament stopped')
    const entries = await readdir(join(root, 'failed-tournaments'))
    expect(entries).toHaveLength(1)
    const artifact = JSON.parse(
      await readFile(join(root, 'failed-tournaments', entries[0]!), 'utf8'),
    )
    expect(artifact.failedCandidateId).toBe('deepseek-pro-gemini-flash')
    expect(artifact.candidateArtifacts[0].errorCode).toBe('fixture_error')
  })
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
