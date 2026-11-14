import { z } from 'zod'
import {
  agentAnswerSentenceSchema,
  agentEvidenceSchema,
  agentFailureReasonSchema,
  agentRefusalCodeSchema,
  agentRefusalReasonSchema,
  agentRefusalSchema,
  agentRunBaseSchema,
  agentRunBudgetSchema,
  agentToolCallSchema,
  agentToolIdSchema,
} from './agent-legacy-run'

const timestampSchema = z.string().datetime({ offset: true })
const idSchema = z.string().min(1)

export const agentSessionToolIdSchema = z.enum([
  'search_law',
  'read_authority',
  'sweep_matter',
  'read_matter_document',
  'map_matter_documents',
  'stage_document_changes',
  'read_tool_result',
  'toolbox',
  ...agentToolIdSchema.options,
])
export type AgentSessionToolId = z.infer<typeof agentSessionToolIdSchema>

export const agentSessionRunBudgetSchema = agentRunBudgetSchema.extend({
  cachedInputTokens: z.number().int().nonnegative().default(0),
  freshInputTokens: z.number().int().nonnegative().default(0),
  outputTokens: z.number().int().nonnegative().default(0),
})
export type AgentSessionRunBudget = z.infer<typeof agentSessionRunBudgetSchema>

export const agentSessionModeSchema = z.enum(['supervised', 'auto_tracked'])
export type AgentSessionMode = z.infer<typeof agentSessionModeSchema>
export const agentSessionTaintSchema = z.enum(['clean', 'matter_tainted'])
export type AgentSessionTaint = z.infer<typeof agentSessionTaintSchema>

export const agentSessionSchema = z
  .object({
    id: idSchema,
    matterId: idSchema.nullable(),
    title: z.string().min(1),
    mode: agentSessionModeSchema,
    taint: agentSessionTaintSchema,
    turnCount: z.number().int().nonnegative(),
    activeRunId: idSchema.nullable(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict()
  .refine(
    (session) =>
      session.matterId === null || session.taint === 'matter_tainted',
    'Matter sessions are tainted.',
  )
export type AgentSession = z.infer<typeof agentSessionSchema>

export const pendingApprovalSummarySchema = z
  .object({
    id: idSchema,
    kind: z.enum(['document_changes', 'mcp_egress']),
    payloadSha256: z.string().regex(/^[a-f0-9]{64}$/),
    baseVersionId: idSchema.nullable(),
    expiresAt: timestampSchema,
  })
  .strict()
  .refine(
    (approval) =>
      approval.kind !== 'document_changes' || approval.baseVersionId !== null,
    'Document changes require a base version.',
  )
export type PendingApprovalSummary = z.infer<
  typeof pendingApprovalSummarySchema
>

export const agentDeliverableBlockSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('prose'),
      sentences: z.array(agentAnswerSentenceSchema).min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal('table'),
      headers: z.array(z.string().min(1)).min(1),
      rows: z.array(z.array(agentAnswerSentenceSchema).min(1)).min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal('document_change_set'),
      documentId: idSchema,
      baseVersionId: idSchema,
      trackedCount: z.number().int().nonnegative(),
      untrackedStructuralCount: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('scope_caveats'),
      caveats: z.array(z.string().min(1)).min(1),
    })
    .strict(),
])
export type AgentDeliverableBlock = z.infer<typeof agentDeliverableBlockSchema>

export const agentSessionEvidenceSchema = z.union([
  agentEvidenceSchema,
  z
    .object({
      kind: z.literal('legislation_provision'),
      evidenceId: idSchema,
      authorityId: idSchema,
      title: z.string().min(1),
      provisionPath: z.string().min(1),
      status: z.string().min(1),
      currencyVerified: z.boolean(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('mcp_result'),
      evidenceId: idSchema,
      serverSlug: idSchema,
      toolName: idSchema,
      summary: z.string().min(1),
    })
    .strict(),
])
export type AgentSessionEvidence = z.infer<typeof agentSessionEvidenceSchema>

const sessionRunBaseSchema = agentRunBaseSchema.extend({
  matterId: idSchema.nullable(),
  sessionId: idSchema,
  budget: agentSessionRunBudgetSchema,
  mode: agentSessionModeSchema,
  toolAllowList: z.array(agentSessionToolIdSchema),
})
export const agentSessionRefusalCodeSchema = z.enum([
  ...agentRefusalCodeSchema.options,
  'org_monthly_cap',
  'approval_stale',
  'strict_lockdown_conflict',
])
export type AgentSessionRefusalCode = z.infer<
  typeof agentSessionRefusalCodeSchema
>
const agentSessionRefusalSchema = agentRefusalSchema.extend({
  code: agentSessionRefusalCodeSchema,
})

export const agentSessionRunSchema = z
  .discriminatedUnion('status', [
    sessionRunBaseSchema.extend({
      status: z.enum(['queued', 'running']),
      stopReason: z.null(),
    }),
    sessionRunBaseSchema.extend({
      status: z.literal('waiting_for_approval'),
      stopReason: z.null(),
      pendingApproval: pendingApprovalSummarySchema,
    }),
    sessionRunBaseSchema.extend({
      status: z.literal('completed'),
      stopReason: z.literal('completed'),
      deliverables: z.array(agentDeliverableBlockSchema),
      evidence: z.array(agentSessionEvidenceSchema),
    }),
    sessionRunBaseSchema.extend({
      status: z.literal('failed'),
      stopReason: agentFailureReasonSchema,
      message: z.string().min(1),
    }),
    sessionRunBaseSchema.extend({
      status: z.literal('cancelled'),
      stopReason: z.literal('user_cancelled'),
    }),
    sessionRunBaseSchema.extend({
      status: z.literal('refused'),
      stopReason: agentRefusalReasonSchema,
      refusal: agentSessionRefusalSchema,
    }),
  ])
  .superRefine((run, context) => {
    if (run.status !== 'completed') return
    const ids = new Set(run.evidence.map((item) => item.evidenceId))
    for (const [blockIndex, block] of run.deliverables.entries()) {
      const sentences =
        block.kind === 'prose'
          ? block.sentences
          : block.kind === 'table'
            ? block.rows.flat()
            : []
      if (
        sentences.some((sentence) =>
          sentence.evidenceIds.some((id) => !ids.has(id)),
        )
      )
        context.addIssue({
          code: 'custom',
          path: ['deliverables', blockIndex],
          message: 'Every citation must refer to supplied evidence.',
        })
      if (
        block.kind === 'table' &&
        block.rows.some((row) => row.length !== block.headers.length)
      )
        context.addIssue({
          code: 'custom',
          path: ['deliverables', blockIndex, 'rows'],
          message: 'Table rows must match the header count.',
        })
    }
  })
export type AgentSessionRun = z.infer<typeof agentSessionRunSchema>

export const agentSessionToolCallSchema = agentToolCallSchema.extend({
  matterId: idSchema.nullable(),
  tool: agentSessionToolIdSchema,
})
export type AgentSessionToolCall = z.infer<typeof agentSessionToolCallSchema>
