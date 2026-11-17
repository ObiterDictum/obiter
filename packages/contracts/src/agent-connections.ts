import { z } from 'zod'
import { agentApiKeySchema } from './agent-settings'

const fields = {
  name: z.string().trim().min(1).max(80),
  baseUrl: z.string().url().max(2048),
  modelIds: z.array(z.string().trim().min(1).max(128)).max(100),
  supportsReasoningEffort: z.boolean(),
}
export const agentConnectionCreateSchema = z
  .object({ ...fields, key: agentApiKeySchema })
  .strict()
export const agentConnectionUpdateSchema = z
  .object(fields)
  .partial()
  .extend({ key: agentApiKeySchema.optional() })
  .strict()
  .refine((value) => Object.keys(value).length > 0)
export const agentConnectionSchema = z
  .object({
    ...fields,
    id: z.string().uuid(),
    keyLastFour: z.string().length(4),
  })
  .strict()
export type AgentConnection = z.infer<typeof agentConnectionSchema>
export type AgentConnectionCreate = z.infer<typeof agentConnectionCreateSchema>
export type AgentConnectionUpdate = z.infer<typeof agentConnectionUpdateSchema>

export const agentModelUsageSchema = z
  .object({
    provider: z.string(),
    connectionId: z.string().uuid().nullable(),
    connectionName: z.string(),
    modelId: z.string(),
    thinking: z.enum(['off', 'low', 'medium', 'high']),
    promptTokens: z.number().int().nonnegative(),
    completionTokens: z.number().int().nonnegative(),
    reasoningTokens: z.number().int().nonnegative(),
    startedAt: z.string().datetime({ offset: true }),
    firstTokenAt: z.string().datetime({ offset: true }).nullable(),
    completedAt: z.string().datetime({ offset: true }),
    latencyMs: z.number().nonnegative(),
  })
  .strict()
export type AgentModelUsage = z.infer<typeof agentModelUsageSchema>
