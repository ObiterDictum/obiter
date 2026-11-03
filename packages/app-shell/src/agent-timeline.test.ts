import { describe, expect, it } from 'bun:test'
import {
  agentTraceEventSchema,
  type AgentRun,
  type AgentTraceEvent,
} from '@obiter/contracts'
import { applyAgentStreamMessage, parseEventStreamChunk } from './agent-runs'
import { agentRunSummary, agentTimelineRows } from './agent-timeline'

const at = '2026-11-03T10:00:00.000Z'

function event(
  seq: number,
  step: number,
  body: Record<string, unknown>,
): AgentTraceEvent {
  return agentTraceEventSchema.parse({
    seq,
    runId: 'arun_1',
    step,
    at,
    ...body,
  })
}

const run = {
  id: 'arun_1',
  organisationId: 'org_1',
  matterId: 'mtr_1',
  createdBy: 'usr_1',
  goal: 'Is the clause enforceable?',
  context: { documentId: null, versionId: null },
  matterText: { allowed: false, sent: false },
  toolAllowList: ['search_corpus', 'get_paragraph'],
  versions: {
    agent: 'agent-1',
    prompt: 'prompt-1',
    toolRegistry: 'tools-1',
    trace: 'trace-v1',
    rateCard: 'rates-1',
    model: { provider: 'anthropic', modelId: 'm', snapshot: 'm-1' },
  },
  budget: {
    currency: 'USD',
    tokenCap: 1000,
    costCapMicros: 1000,
    tokensReserved: 0,
    tokensUsed: 0,
    costReservedMicros: 0,
    costUsedMicros: 0,
  },
  stepCount: 3,
  sourcesRead: 3,
  createdAt: at,
  startedAt: '2026-11-03T10:00:00.000Z',
  finishedAt: '2026-11-03T10:00:41.000Z',
  status: 'cancelled',
  stopReason: 'user_cancelled',
} satisfies AgentRun

describe('agent run timeline', () => {
  it('names each step by its tool and marks it done when the tool returns', () => {
    const rows = agentTimelineRows([
      event(1, 1, {
        event: 'step_started',
        kind: 'tool',
        tool: 'search_corpus',
      }),
      event(2, 1, {
        event: 'tool_called',
        tool: 'search_corpus',
        toolVersion: '1',
        argsHash: 'h',
        status: 'ok',
        errorCode: null,
        evidenceIds: ['a:judgment_paragraph:1'],
        contentHash: 'c',
        truncated: false,
        latencyMs: 3,
      }),
      event(3, 2, {
        event: 'step_started',
        kind: 'tool',
        tool: 'get_paragraph',
      }),
    ])
    expect(rows).toEqual([
      { step: 1, label: 'Searched the law', status: 'done' },
      { step: 2, label: 'Read a paragraph', status: 'running' },
    ])
  })

  it('shows a refused tool request as refused, not as a failure', () => {
    const rows = agentTimelineRows([
      event(1, 1, {
        event: 'tool_refused',
        tool: 'send_email',
        code: 'policy_blocked',
        ruleId: 'tool-not-allowed',
      }),
    ])
    expect(rows[0]?.status).toBe('refused')
  })

  it('shows a citation the run never read as an error', () => {
    const rows = agentTimelineRows([
      event(1, 4, {
        event: 'claim_dropped',
        claimIndex: 0,
        reason: 'fabricated_evidence_id',
      }),
    ])
    expect(rows[0]).toEqual({
      step: 4,
      label: 'Cited a source it had not read',
      status: 'error',
    })
  })

  it('summarises a finished run by elapsed time and sources read', () => {
    expect(agentRunSummary(run)).toBe('Worked for 41s · read 3 sources')
  })
})

describe('agent run stream', () => {
  it('keeps an unfinished message for the next chunk', () => {
    const message = JSON.stringify({ type: 'run', run })
    const first = parseEventStreamChunk(`id: 1\ndata: ${message}\n\ndata: {"ty`)
    expect(first.messages).toHaveLength(1)
    expect(first.rest).toBe('data: {"ty')
  })

  it('refuses a message the contract does not know', () => {
    expect(() =>
      parseEventStreamChunk('data: {"type":"answer","text":"x"}\n\n'),
    ).toThrow('unrecognised')
  })

  it('ignores an event it has already applied after a reconnect', () => {
    const started = event(1, 1, {
      event: 'step_started',
      kind: 'model',
      tool: null,
    })
    const detail = { run, steps: [], toolCalls: [], events: [started] }
    expect(
      applyAgentStreamMessage(detail, { type: 'event', event: started }).events,
    ).toHaveLength(1)
  })
})
