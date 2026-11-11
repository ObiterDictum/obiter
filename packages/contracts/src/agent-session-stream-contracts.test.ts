import { describe, expect, it } from 'bun:test'
import { agentSessionStreamMessageSchema } from './agent-api'
import { agentEvidenceSchema, agentSessionRunSchema } from './agent-run'
import {
  mcpConnectionCheckResponseSchema,
  organisationMcpServerCreateRequestSchema,
  organisationMcpServerSchema,
  organisationMcpServerUpdateRequestSchema,
} from './agent-mcp'
import {
  matterAgentMemoryCreateRequestSchema,
  organisationPlaybookCreateRequestSchema,
  userAgentMemoryCreateRequestSchema,
  userAgentMemoryListResponseSchema,
} from './agent-memory'
import { organisationSandboxPolicySchema } from './agent-sandbox'
import {
  agentSessionTraceEventSchema,
  agentTraceEventSchema,
} from './agent-trace'

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

const evidence = {
  kind: 'corpus_paragraph',
  evidenceId: 'case-1:p:2',
  authorityId: 'case-1',
  title: 'A v B',
  neutralCitation: '[2024] UKSC 1',
  paragraphNumber: 2,
}

const completedRun = (overrides = {}) => ({
  ...runBase,
  status: 'completed',
  stopReason: 'completed',
  deliverables: [
    {
      kind: 'prose',
      sentences: [
        { text: 'A supported finding.', evidenceIds: ['case-1:p:2'] },
      ],
    },
  ],
  evidence: [evidence],
  ...overrides,
})

describe('session stream and operational trace separation', () => {
  it('carries private text only in a sequenced session stream delta', () => {
    expect(
      agentSessionStreamMessageSchema.safeParse({
        type: 'text_delta',
        seq: 1,
        runId: 'run_1',
        text: 'Answer fragment.',
      }).success,
    ).toBe(true)
    expect(
      agentSessionStreamMessageSchema.safeParse({
        type: 'text_delta',
        seq: 0,
        runId: 'run_1',
        text: 'Answer fragment.',
      }).success,
    ).toBe(false)
    expect(
      agentSessionStreamMessageSchema.safeParse({
        type: 'text_delta',
        seq: 1,
        runId: 'run_1',
        text: 'private',
        extra: 'reject',
      }).success,
    ).toBe(false)
  })

  it('allows a null matter id on operational run-started traces without exposing text', () => {
    const base = {
      seq: 1,
      runId: 'run_1',
      step: 0,
      at: timestamp,
      event: 'run_started',
      goalHash: 'sha256:goal',
      matterId: null,
      toolAllowList: ['search_law'],
      matterTextAllowed: false,
      versions: runBase.versions,
    }
    expect(agentSessionTraceEventSchema.safeParse(base).success).toBe(true)
    expect(agentTraceEventSchema.safeParse(base).success).toBe(false)
    expect(
      agentSessionTraceEventSchema.safeParse({
        ...base,
        prompt: 'private prompt text',
      }).success,
    ).toBe(false)
  })
})

describe('MCP, memory, and sandbox payloads', () => {
  it('accepts consistent HTTP and desktop transports and rejects mismatched configuration', () => {
    const http = {
      slug: 'research',
      transport: 'http',
      endpointUrl: 'https://tools.example/mcp',
      authKind: 'none',
      authHeaderName: null,
      allowMatterData: false,
      writePolicy: 'read_only_trusted',
      enabled: true,
    }
    expect(
      organisationMcpServerCreateRequestSchema.safeParse(http).success,
    ).toBe(true)
    expect(
      organisationMcpServerCreateRequestSchema.safeParse({
        ...http,
        transport: 'desktop_stdio',
      }).success,
    ).toBe(false)
    expect(
      organisationMcpServerCreateRequestSchema.safeParse({
        ...http,
        authKind: 'custom_header',
        authHeaderName: null,
      }).success,
    ).toBe(false)
    expect(organisationMcpServerUpdateRequestSchema.safeParse({}).success).toBe(
      false,
    )
    expect(
      organisationMcpServerSchema.safeParse({
        ...http,
        id: 'mcp_1',
        hasSecret: false,
        updatedAt: timestamp,
      }).success,
    ).toBe(true)
    expect(
      mcpConnectionCheckResponseSchema.safeParse({
        ok: false,
        message: 'Connection refused.',
      }).success,
    ).toBe(true)
  })

  it('preserves private memory provenance and caps user memory lists at twenty-five', () => {
    expect(
      userAgentMemoryCreateRequestSchema.safeParse({
        content: 'Use concise summaries.',
        provenance: 'confirmed_suggestion',
      }).success,
    ).toBe(true)
    expect(
      userAgentMemoryCreateRequestSchema.safeParse({
        content: 'Preference',
        provenance: 'unknown',
      }).success,
    ).toBe(false)
    expect(
      matterAgentMemoryCreateRequestSchema.safeParse({
        content: 'Matter instruction.',
      }).success,
    ).toBe(true)
    expect(
      organisationPlaybookCreateRequestSchema.safeParse({
        slug: 'research-note',
        title: 'Research',
        triggerDescription: 'For research tasks',
        bodyMarkdown: 'Use the verified source list.',
        enabled: true,
      }).success,
    ).toBe(true)
    const item = {
      id: 'memory_1',
      organisationId: 'org_1',
      userId: 'user_1',
      content: 'Preference',
      provenance: 'user_entered',
      createdAt: timestamp,
    }
    expect(
      userAgentMemoryListResponseSchema.safeParse({
        enabled: true,
        items: Array.from({ length: 25 }, (_, i) => ({
          ...item,
          id: `memory_${i}`,
        })),
      }).success,
    ).toBe(true)
    expect(
      userAgentMemoryListResponseSchema.safeParse({
        enabled: true,
        items: Array.from({ length: 26 }, (_, i) => ({
          ...item,
          id: `memory_${i}`,
        })),
      }).success,
    ).toBe(false)
  })

  it('strictly validates sandbox host policy fields', () => {
    expect(
      organisationSandboxPolicySchema.safeParse({
        strictLockdown: true,
        allowedHosts: [
          {
            host: 'tools.example',
            source: 'organisation',
            dataPolicy: 'no_matter_data',
            active: true,
          },
        ],
      }).success,
    ).toBe(true)
    expect(
      organisationSandboxPolicySchema.safeParse({
        strictLockdown: true,
        allowedHosts: [
          {
            host: 'tools.example',
            source: 'organisation',
            dataPolicy: 'no_matter_data',
            active: true,
            secret: true,
          },
        ],
      }).success,
    ).toBe(false)
  })
})

describe('legislation and MCP evidence variants', () => {
  it('accepts structured provision and tool-result citations while rejecting unknown fields', () => {
    expect(agentEvidenceSchema.safeParse(evidence).success).toBe(true)
    expect(
      agentSessionRunSchema.safeParse(
        completedRun({
          evidence: [
            {
              kind: 'legislation_provision',
              evidenceId: 'act:s:1',
              authorityId: 'act',
              title: 'Act',
              provisionPath: 's. 1',
              status: 'in_force',
              currencyVerified: true,
            },
          ],
          deliverables: [
            {
              kind: 'prose',
              sentences: [
                { text: 'Provision applies.', evidenceIds: ['act:s:1'] },
              ],
            },
          ],
        }),
      ).success,
    ).toBe(true)
    expect(
      agentSessionRunSchema.safeParse(
        completedRun({
          evidence: [
            {
              kind: 'mcp_result',
              evidenceId: 'mcp:1',
              serverSlug: 'research',
              toolName: 'lookup',
              summary: 'One result',
              privatePayload: 'reject',
            },
          ],
          deliverables: [
            {
              kind: 'prose',
              sentences: [{ text: 'Tool result.', evidenceIds: ['mcp:1'] }],
            },
          ],
        }),
      ).success,
    ).toBe(false)
  })
})
