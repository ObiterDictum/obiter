import { describe, expect, it } from 'bun:test'
import {
  agentApprovalDecisionRequestSchema,
  agentSessionAttachMatterRequestSchema,
  agentSessionCreateRequestSchema,
  agentSessionTurnRequestSchema,
} from './agent-api'
import {
  agentDeliverableBlockSchema,
  agentRunBudgetSchema,
  agentSessionRunBudgetSchema,
  agentSessionRunSchema,
  agentSessionSchema,
  agentSessionToolIdSchema,
  pendingApprovalSummarySchema,
} from './agent-run'
import { organisationMcpServerCreateRequestSchema } from './agent-mcp'
import {
  agentSessionSettingsSchema,
  agentSessionSettingsUpdateSchema,
  agentSessionModelChoiceSchema,
  organisationAgentSettingsSchema,
} from './agent-settings'
const timestamp = '2026-11-04T09:30:00.000Z'
const key = '7c8d4c55-0a7e-4b8e-9d1f-1e0f3f9f2a11'
const approvalHash = 'a'.repeat(64)

const choice = (provider: string, modelId: string) => ({
  provider,
  modelId,
  snapshot: `${modelId}-snapshot`,
})

const session = {
  id: 'session_1',
  matterId: null,
  title: 'Research question',
  mode: 'supervised',
  taint: 'clean',
  turnCount: 0,
  activeRunId: null,
  createdAt: timestamp,
  updatedAt: timestamp,
}

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

describe('additive session access settings', () => {
  it('keeps stored legacy settings valid without requiring session fields', () => {
    expect(
      organisationAgentSettingsSchema.parse({
        matterTextToModel: false,
        model: null,
        keyLastFour: null,
        keySetAt: null,
      }).model,
    ).toBeNull()
  })

  it('accepts configured Managed EU and BYOK settings with monthly usage', () => {
    const base = {
      keyLastFour: null,
      keySetAt: null,
      baseUrl: null,
      fastModel: null,
      monthlyUsage: {
        periodYm: '2026-11',
        reservedMicros: 10,
        usedMicros: 20,
        capMicros: 100,
      },
      managedMatterOptOut: false,
      effectiveMatterTextAllowed: true,
    }
    expect(
      agentSessionSettingsSchema.parse({
        ...base,
        accessMode: 'managed_eu',
        matterTextToModel: true,
        model: choice('obiter_eu', 'managed-small'),
      }).accessMode,
    ).toBe('managed_eu')
    expect(
      agentSessionSettingsSchema.parse({
        ...base,
        accessMode: 'byok',
        matterTextToModel: false,
        model: choice('anthropic', 'claude-sonnet-4-5'),
      }).model?.provider,
    ).toBe('anthropic')
  })

  it('rejects a non-HTTPS model endpoint and a non-HTTPS MCP endpoint', () => {
    expect(
      agentSessionSettingsUpdateSchema.safeParse({
        baseUrl: 'http://model.example',
      }).success,
    ).toBe(false)
    expect(
      organisationMcpServerCreateRequestSchema.safeParse({
        slug: 'research',
        transport: 'http',
        endpointUrl: 'http://tool.example',
        authKind: 'none',
        authHeaderName: null,
        allowMatterData: false,
        writePolicy: 'supervised',
        enabled: true,
      }).success,
    ).toBe(false)
  })

  it('requires fast models and the primary model to use a compatible provider', () => {
    const base = {
      accessMode: 'byok',
      matterTextToModel: false,
      model: choice('anthropic', 'claude-sonnet-4-5'),
      keyLastFour: null,
      keySetAt: null,
      baseUrl: null,
      monthlyUsage: null,
      managedMatterOptOut: false,
      effectiveMatterTextAllowed: false,
    }
    expect(
      agentSessionSettingsSchema.safeParse({
        ...base,
        fastModel: choice('openai', 'gpt-fast'),
      }).success,
    ).toBe(false)
    expect(
      agentSessionSettingsSchema.safeParse({
        ...base,
        fastModel: choice('anthropic', 'claude-haiku-4-5'),
      }).success,
    ).toBe(true)
    expect(
      agentSessionSettingsSchema.safeParse({
        ...base,
        model: choice('obiter_eu', 'managed-small'),
      }).success,
    ).toBe(false)
    expect(
      agentSessionSettingsSchema.safeParse({
        ...base,
        accessMode: 'managed_eu',
      }).success,
    ).toBe(false)
    expect(
      agentSessionModelChoiceSchema.safeParse(
        choice('openai_compatible', 'model-v1'),
      ).success,
    ).toBe(true)
  })

  it('rejects unknown settings fields and invalid monthly allowance periods', () => {
    const valid = {
      accessMode: 'disabled',
      matterTextToModel: false,
      model: null,
      keyLastFour: null,
      keySetAt: null,
      baseUrl: null,
      fastModel: null,
      monthlyUsage: {
        periodYm: '2026-11',
        reservedMicros: 0,
        usedMicros: 0,
        capMicros: 0,
      },
      managedMatterOptOut: false,
      effectiveMatterTextAllowed: false,
    }
    expect(
      agentSessionSettingsSchema.safeParse({ ...valid, internal: true })
        .success,
    ).toBe(false)
    expect(
      agentSessionSettingsSchema.safeParse({
        ...valid,
        monthlyUsage: { ...valid.monthlyUsage, periodYm: '2026-13' },
      }).success,
    ).toBe(false)
  })
})

describe('session, deliverable, and approval contracts', () => {
  it('accepts a matter-free session only while its taint is clean', () => {
    expect(agentSessionSchema.safeParse(session).success).toBe(true)
    expect(
      agentSessionSchema.safeParse({ ...session, matterId: 'matter_1' })
        .success,
    ).toBe(false)
    expect(
      agentSessionSchema.safeParse({
        ...session,
        matterId: 'matter_1',
        taint: 'matter_tainted',
      }).success,
    ).toBe(true)
  })

  it('keeps new tool identifiers additive to all persisted tool identifiers', () => {
    for (const tool of [
      'search_corpus',
      'get_paragraph',
      'matter_documents',
      'read_document_version',
      'search_law',
      'read_authority',
      'sweep_matter',
      'read_matter_document',
      'map_matter_documents',
      'stage_document_changes',
      'read_tool_result',
      'toolbox',
    ]) {
      expect(agentSessionToolIdSchema.safeParse(tool).success).toBe(true)
    }
    expect(agentSessionToolIdSchema.safeParse('unknown_tool').success).toBe(
      false,
    )
  })

  it('preserves legacy budget omissions and defaults token detail on session runs', () => {
    expect(
      agentRunBudgetSchema.parse(runBase.budget).cachedInputTokens,
    ).toBeUndefined()
    expect(
      agentRunBudgetSchema.parse(runBase.budget).freshInputTokens,
    ).toBeUndefined()
    expect(
      agentRunBudgetSchema.parse(runBase.budget).outputTokens,
    ).toBeUndefined()
    expect(
      agentSessionRunBudgetSchema.parse(runBase.budget).cachedInputTokens,
    ).toBe(0)
    expect(
      agentSessionRunBudgetSchema.parse(runBase.budget).freshInputTokens,
    ).toBe(0)
    expect(agentSessionRunBudgetSchema.parse(runBase.budget).outputTokens).toBe(
      0,
    )
    expect(
      agentSessionRunSchema.parse(completedRun()).budget.outputTokens,
    ).toBe(0)
    expect(
      agentSessionRunSchema.parse(completedRun()).budget.cachedInputTokens,
    ).toBe(0)
    expect(
      agentSessionRunSchema.parse(completedRun()).budget.freshInputTokens,
    ).toBe(0)
    expect(
      agentRunBudgetSchema.safeParse({
        ...runBase.budget,
        cachedInputTokens: -1,
      }).success,
    ).toBe(false)
  })

  it('requires evidence ids on prose and table cells and resolves every citation', () => {
    expect(
      agentDeliverableBlockSchema.safeParse({
        kind: 'prose',
        sentences: [{ text: 'Claim.', evidenceIds: ['e1'] }],
      }).success,
    ).toBe(true)
    expect(
      agentDeliverableBlockSchema.safeParse({
        kind: 'prose',
        sentences: [{ text: 'Claim.', evidenceIds: [] }],
      }).success,
    ).toBe(false)
    expect(agentSessionRunSchema.safeParse(completedRun()).success).toBe(true)
    expect(
      agentSessionRunSchema.safeParse(
        completedRun({
          deliverables: [
            {
              kind: 'prose',
              sentences: [{ text: 'Claim.', evidenceIds: ['missing'] }],
            },
          ],
        }),
      ).success,
    ).toBe(false)
    expect(
      agentSessionRunSchema.safeParse(
        completedRun({
          deliverables: [
            {
              kind: 'table',
              headers: ['Finding', 'Source'],
              rows: [[{ text: 'Only one cell', evidenceIds: ['case-1:p:2'] }]],
            },
          ],
        }),
      ).success,
    ).toBe(false)
  })

  it('accepts structural edit counts while keeping approval payloads bound to a base version', () => {
    expect(
      agentDeliverableBlockSchema.safeParse({
        kind: 'document_change_set',
        documentId: 'doc_1',
        baseVersionId: 'ver_1',
        trackedCount: 2,
        untrackedStructuralCount: 1,
      }).success,
    ).toBe(true)
    expect(
      agentDeliverableBlockSchema.safeParse({
        kind: 'document_change_set',
        documentId: 'doc_1',
        baseVersionId: 'ver_1',
        trackedCount: -1,
        untrackedStructuralCount: 1,
      }).success,
    ).toBe(false)
    expect(
      pendingApprovalSummarySchema.safeParse({
        id: 'approval_1',
        kind: 'document_changes',
        payloadSha256: approvalHash,
        baseVersionId: 'ver_1',
        expiresAt: timestamp,
      }).success,
    ).toBe(true)
    expect(
      pendingApprovalSummarySchema.safeParse({
        id: 'approval_1',
        kind: 'document_changes',
        payloadSha256: approvalHash,
        baseVersionId: null,
        expiresAt: timestamp,
      }).success,
    ).toBe(false)
    expect(
      pendingApprovalSummarySchema.safeParse({
        id: 'approval_1',
        kind: 'mcp_egress',
        payloadSha256: approvalHash,
        baseVersionId: null,
        expiresAt: timestamp,
      }).success,
    ).toBe(true)
  })

  it('requires idempotency and the expected payload digest for session writes', () => {
    expect(
      agentSessionCreateRequestSchema.safeParse({
        matterId: null,
        title: 'New session',
        mode: 'auto_tracked',
        idempotencyKey: key,
      }).success,
    ).toBe(true)
    expect(
      agentSessionCreateRequestSchema.safeParse({
        matterId: null,
        title: 'New session',
        mode: 'auto_tracked',
      }).success,
    ).toBe(false)
    expect(
      agentSessionTurnRequestSchema.safeParse({
        kind: 'steer',
        text: 'Change the approach.',
        idempotencyKey: key,
      }).success,
    ).toBe(true)
    expect(
      agentSessionAttachMatterRequestSchema.safeParse({
        matterId: 'matter_1',
        idempotencyKey: key,
      }).success,
    ).toBe(true)
    expect(
      agentApprovalDecisionRequestSchema.safeParse({
        decision: 'approve',
        idempotencyKey: key,
        expectedPayloadSha256: approvalHash,
      }).success,
    ).toBe(true)
    expect(
      agentApprovalDecisionRequestSchema.safeParse({
        decision: 'approve',
        idempotencyKey: key,
        expectedPayloadSha256: 'not-a-digest',
      }).success,
    ).toBe(false)
  })
})
