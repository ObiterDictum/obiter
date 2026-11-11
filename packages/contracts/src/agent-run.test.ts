import { describe, expect, it } from 'bun:test'
import {
  agentRunCreateRequestSchema,
  agentRunStreamMessageSchema,
} from './agent-api'
import { agentRunSchema, isAgentRunLive, type AgentRun } from './agent-run'
import {
  agentRunSchema as exportedAgentRunSchema,
  agentSessionRunSchema as exportedAgentSessionRunSchema,
  isAgentRunLive as exportedIsAgentRunLive,
} from './index'
import { agentSessionRunSchema } from './agent-run'
import { agentTraceEventSchema } from './agent-trace'

const base = {
  id: 'arun_1',
  organisationId: 'org_1',
  matterId: 'mtr_1',
  createdBy: 'usr_1',
  goal: 'Is a limitation clause in a consumer contract enforceable?',
  context: { documentId: null, versionId: null },
  matterText: { allowed: false, sent: false },
  toolAllowList: ['search_corpus', 'get_paragraph'],
  versions: {
    agent: 'agent-1',
    prompt: 'lookup-prompt-1',
    toolRegistry: 'tools-1',
    trace: 'trace-v1',
    rateCard: 'rates-2026-11',
    model: {
      provider: 'anthropic',
      modelId: 'small-model',
      snapshot: 'small-model-20261001',
    },
  },
  budget: {
    currency: 'USD',
    tokenCap: 60000,
    costCapMicros: 250000,
    tokensReserved: 0,
    tokensUsed: 3120,
    costReservedMicros: 0,
    costUsedMicros: 4100,
  },
  stepCount: 4,
  sourcesRead: 2,
  createdAt: '2026-11-03T10:00:00.000Z',
  startedAt: '2026-11-03T10:00:01.000Z',
  finishedAt: '2026-11-03T10:00:42.000Z',
}

const answer = {
  sentences: [
    {
      text: 'A term excluding liability for negligence causing death is void.',
      evidenceIds: ['uksc-2024-1:judgment_paragraph:14'],
    },
  ],
  evidence: [
    {
      kind: 'corpus_paragraph',
      evidenceId: 'uksc-2024-1:judgment_paragraph:14',
      authorityId: 'uksc-2024-1',
      title: 'A v B',
      neutralCitation: '[2024] UKSC 1',
      paragraphNumber: 14,
    },
  ],
  droppedSentenceCount: 0,
}

describe('agent run module exports', () => {
  it('keeps legacy and session contracts available from their public entry points', () => {
    expect(exportedAgentRunSchema).toBe(agentRunSchema)
    expect(exportedAgentSessionRunSchema).toBe(agentSessionRunSchema)
    expect(exportedIsAgentRunLive).toBe(isAgentRunLive)
    expect(
      exportedAgentRunSchema.safeParse({
        ...base,
        status: 'queued',
        stopReason: null,
      }).success,
    ).toBe(true)
  })
})

describe('agent run status', () => {
  it('a completed run carries an answer whose every sentence has an evidence id', () => {
    const run = agentRunSchema.parse({
      ...base,
      status: 'completed',
      stopReason: 'completed',
      answer,
    })
    expect(run.status).toBe('completed')
    expect(
      agentRunSchema.safeParse({
        ...base,
        status: 'completed',
        stopReason: 'completed',
        answer: {
          ...answer,
          sentences: [{ text: 'Unsupported.', evidenceIds: [] }],
        },
      }).success,
    ).toBe(false)
  })

  it('a refused run names its refusal code, rule and the missing setting', () => {
    const run: AgentRun = agentRunSchema.parse({
      ...base,
      status: 'refused',
      stopReason: 'policy_blocked',
      refusal: {
        code: 'policy_blocked',
        ruleId: 'matter-text-not-permitted',
        message:
          'Your organisation does not send matter documents to the model provider.',
        missing: {
          kind: 'setting',
          id: 'agent.matterTextToModel',
          label: 'Send matter documents to the model provider',
        },
      },
    })
    expect(run.status === 'refused' && run.refusal.missing?.kind).toBe(
      'setting',
    )
  })

  it('a refused run without a refusal is rejected', () => {
    expect(
      agentRunSchema.safeParse({
        ...base,
        status: 'refused',
        stopReason: 'over_budget',
      }).success,
    ).toBe(false)
  })

  it('a failed run cannot claim a refusal stop reason', () => {
    expect(
      agentRunSchema.safeParse({
        ...base,
        status: 'failed',
        stopReason: 'policy_blocked',
        message: 'Stopped.',
      }).success,
    ).toBe(false)
  })

  it('a live run has no stop reason', () => {
    expect(
      agentRunSchema.safeParse({
        ...base,
        status: 'running',
        stopReason: 'completed',
      }).success,
    ).toBe(false)
    expect(
      isAgentRunLive(
        agentRunSchema.parse({ ...base, status: 'queued', stopReason: null }),
      ),
    ).toBe(true)
  })

  it('a run records the pinned model snapshot, never only an alias', () => {
    const { snapshot: _snapshot, ...withoutSnapshot } = base.versions.model
    expect(
      agentRunSchema.safeParse({
        ...base,
        versions: { ...base.versions, model: withoutSnapshot },
        status: 'cancelled',
        stopReason: 'user_cancelled',
      }).success,
    ).toBe(false)
  })
})

describe('agent run creation', () => {
  it('requires an idempotency key so a repeated submit cannot start a second run', () => {
    expect(
      agentRunCreateRequestSchema.safeParse({ goal: 'What is the test?' })
        .success,
    ).toBe(false)
  })

  it('refuses a version without its document', () => {
    expect(
      agentRunCreateRequestSchema.safeParse({
        goal: 'Summarise the indemnity.',
        versionId: 'ver_1',
        idempotencyKey: '7c8d4c55-0a7e-4b8e-9d1f-1e0f3f9f2a11',
      }).success,
    ).toBe(false)
  })

  it('trims the goal and rejects one that is only whitespace', () => {
    expect(
      agentRunCreateRequestSchema.safeParse({
        goal: '   ',
        idempotencyKey: '7c8d4c55-0a7e-4b8e-9d1f-1e0f3f9f2a11',
      }).success,
    ).toBe(false)
  })
})

describe('agent trace events', () => {
  it('a model call records the reserved and settled amounts', () => {
    const event = agentTraceEventSchema.parse({
      seq: 3,
      runId: 'arun_1',
      step: 2,
      at: '2026-11-03T10:00:03.000Z',
      event: 'model_called',
      snapshot: 'small-model-20261001',
      promptHash: 'sha256:abc',
      reservedTokens: 8000,
      settledTokens: 1200,
      reservedCostMicros: 9000,
      settledCostMicros: 1400,
      finish: 'tool_use',
      latencyMs: 900,
    })
    expect(event.event).toBe('model_called')
  })

  it('a trace event cannot carry text fields it does not declare', () => {
    expect(
      agentTraceEventSchema.safeParse({
        seq: 4,
        runId: 'arun_1',
        step: 3,
        at: '2026-11-03T10:00:04.000Z',
        event: 'tool_called',
        tool: 'read_document_version',
        toolVersion: '1',
        argsHash: 'sha256:def',
        status: 'ok',
        errorCode: null,
        evidenceIds: ['doc_1:ver_1:0-120'],
        contentHash: 'sha256:123',
        truncated: false,
        latencyMs: 12,
        output: 'The tenant shall indemnify the landlord.',
      }).success,
    ).toBe(false)
  })

  it('the stream carries either a trace event or a run snapshot', () => {
    expect(
      agentRunStreamMessageSchema.safeParse({
        type: 'run',
        run: { ...base, status: 'running', stopReason: null },
      }).success,
    ).toBe(true)
    expect(
      agentRunStreamMessageSchema.safeParse({ type: 'answer', text: 'x' })
        .success,
    ).toBe(false)
  })
})
