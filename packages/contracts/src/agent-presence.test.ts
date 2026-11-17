import { describe, expect, it } from 'bun:test'
import {
  agentPresence,
  agentPresenceSchema,
  type AgentPresence,
} from './agent-presence'
import { agentSessionRunSchema } from './agent-session-run'
import { agentSessionTraceEventSchema } from './agent-trace'

const timestamp = '2026-11-04T09:30:00.000Z'
const runBase = {
  id: 'run_1',
  organisationId: 'org_1',
  matterId: null,
  createdBy: 'user_1',
  goal: 'Summarise the relevant rule.',
  context: { documentId: null, versionId: null },
  matterText: { allowed: false, sent: false },
  toolAllowList: ['search_law'],
  versions: {
    agent: 'agent-v2',
    prompt: 'prompt-v2',
    toolRegistry: 'tools-v2',
    trace: 'trace-v2',
    rateCard: 'rates-v2',
    model: {
      provider: 'obiter_eu',
      modelId: 'managed-small',
      snapshot: 'managed-small-1',
    },
  },
  budget: {
    currency: 'USD',
    tokenCap: 10000,
    costCapMicros: 5000,
    tokensReserved: 0,
    tokensUsed: 500,
    costReservedMicros: 0,
    costUsedMicros: 200,
  },
  stepCount: 2,
  sourcesRead: 1,
  createdAt: timestamp,
  startedAt: timestamp,
  finishedAt: timestamp,
  sessionId: 'session_1',
  mode: 'supervised',
}

function run(overrides: Record<string, unknown>) {
  return agentSessionRunSchema.parse({ ...runBase, ...overrides })
}

function trace(event: Record<string, unknown>) {
  return agentSessionTraceEventSchema.parse({
    seq: 1,
    runId: 'run_1',
    step: 1,
    at: timestamp,
    ...event,
  })
}

const cases: Array<{
  name: string
  run?: Record<string, unknown>
  event?: Record<string, unknown>
  expected: AgentPresence
}> = [
  { name: 'no run yet', expected: 'idle' },
  {
    name: 'a cancelled run',
    run: { status: 'cancelled', stopReason: 'user_cancelled' },
    expected: 'idle',
  },
  {
    name: 'a queued run without a trace event',
    run: { status: 'queued', stopReason: null },
    expected: 'thinking',
  },
  {
    name: 'a running run without a trace event',
    run: { status: 'running', stopReason: null },
    expected: 'thinking',
  },
  {
    name: 'a running run whose latest step is the model',
    run: { status: 'running', stopReason: null },
    event: { event: 'step_started', kind: 'model', tool: null },
    expected: 'thinking',
  },
  {
    name: 'a running run whose latest step is a tool start',
    run: { status: 'running', stopReason: null },
    event: { event: 'step_started', kind: 'tool', tool: 'search_law' },
    expected: 'working',
  },
  {
    name: 'a running run that has already reported its tool call',
    run: { status: 'running', stopReason: null },
    event: {
      event: 'tool_called',
      tool: 'search_law',
      toolVersion: 'tools-v2',
      argsHash: 'hash',
      status: 'ok',
      errorCode: null,
      evidenceIds: [],
      contentHash: null,
      truncated: false,
      latencyMs: 12,
    },
    expected: 'thinking',
  },
  {
    name: 'a run waiting for approval',
    run: {
      status: 'waiting_for_approval',
      stopReason: null,
      pendingApproval: {
        id: 'approval_1',
        kind: 'document_changes',
        payloadSha256: 'a'.repeat(64),
        baseVersionId: 'version_1',
        expiresAt: timestamp,
      },
    },
    expected: 'needs_approval',
  },
  {
    name: 'a completed run',
    run: {
      status: 'completed',
      stopReason: 'completed',
      deliverables: [],
      evidence: [],
    },
    expected: 'done',
  },
  {
    name: 'a failed run',
    run: {
      status: 'failed',
      stopReason: 'system_error',
      message: 'The tool failed.',
    },
    expected: 'stuck',
  },
  {
    name: 'a refused run',
    run: {
      status: 'refused',
      stopReason: 'policy_blocked',
      refusal: {
        code: 'policy_blocked',
        ruleId: 'rule_1',
        message: 'The request was refused.',
        missing: null,
      },
    },
    expected: 'stuck',
  },
]

describe('agent presence derivation', () => {
  for (const item of cases)
    it(`maps ${item.name} to ${item.expected}`, () => {
      expect(
        agentPresence(
          item.run ? run(item.run) : undefined,
          item.event ? trace(item.event) : undefined,
        ),
      ).toBe(item.expected)
    })

  it('rejects a presence the agent cannot show', () => {
    expect(agentPresenceSchema.safeParse('paused').success).toBe(false)
  })
})
