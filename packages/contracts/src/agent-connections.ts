import { z } from 'zod'
import { agentApiKeySchema } from './agent-settings'
import {
  AGENT_CONNECTION_ENABLED_MODEL_LIMIT,
  AGENT_CONNECTION_LISTED_MODEL_LIMIT,
} from './limits'

export {
  AGENT_CONNECTION_ENABLED_MODEL_LIMIT,
  AGENT_CONNECTION_LISTED_MODEL_LIMIT,
} from './limits'
const modelIdSchema = z.string().trim().min(1).max(128)
const fields = {
  name: z.string().trim().min(1).max(80),
  baseUrl: z.string().url().max(2048),
  modelIds: z.array(modelIdSchema).max(AGENT_CONNECTION_ENABLED_MODEL_LIMIT),
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
    modelCount: z.number().int().nonnegative().optional(),
  })
  .strict()
export type AgentConnection = z.infer<typeof agentConnectionSchema>
export const agentConnectionSavedSchema = z
  .object({ ok: z.literal(true), id: z.string().uuid().optional() })
  .strict()
export type AgentConnectionSaved = z.infer<typeof agentConnectionSavedSchema>
export const agentConnectionModelSchema = z
  .object({ id: modelIdSchema, name: z.string().min(1).max(128).nullable() })
  .strict()
export type AgentConnectionModel = z.infer<typeof agentConnectionModelSchema>
export const agentConnectionTestSchema = z
  .object({ modelId: modelIdSchema.optional() })
  .strict()
export type AgentConnectionTest = z.infer<typeof agentConnectionTestSchema>
export const agentConnectionTestResponseSchema = z
  .object({
    message: z.string(),
    models: z
      .array(agentConnectionModelSchema)
      .max(AGENT_CONNECTION_LISTED_MODEL_LIMIT)
      .optional(),
    truncated: z.boolean().optional(),
  })
  .strict()
export type AgentConnectionTestResponse = z.infer<
  typeof agentConnectionTestResponseSchema
>
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
