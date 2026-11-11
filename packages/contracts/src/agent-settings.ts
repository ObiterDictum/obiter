import { z } from 'zod'
import { secureHttpsUrlSchema } from './agent-secure-url'

export const agentProviderSchema = z.enum(['anthropic'])
export type AgentProvider = z.infer<typeof agentProviderSchema>

export const AGENT_PROVIDERS = {
  anthropic: {
    label: 'Anthropic',
    modelIdPattern: /^claude-[a-z0-9]+(?:[.-][a-z0-9]+)*$/,
    modelIdExample: 'claude-sonnet-4-5',
  },
} as const satisfies Record<
  AgentProvider,
  { label: string; modelIdPattern: RegExp; modelIdExample: string }
>

const modelIdSchema = z.string().trim().min(1).max(128)

export const agentModelChoiceSchema = z
  .object({
    provider: agentProviderSchema,
    modelId: modelIdSchema,
    snapshot: modelIdSchema.nullable(),
  })
  .strict()
  .superRefine((choice, context) => {
    const { modelIdPattern, modelIdExample, label } =
      AGENT_PROVIDERS[choice.provider]
    for (const field of ['modelId', 'snapshot'] as const) {
      const value = choice[field]
      if (value !== null && !modelIdPattern.test(value))
        context.addIssue({
          code: 'custom',
          path: [field],
          message: `${label} model ids look like ${modelIdExample}.`,
        })
    }
  })
export type AgentModelChoice = z.infer<typeof agentModelChoiceSchema>

export const agentApiKeySchema = z
  .string()
  .min(16)
  .max(512)
  .regex(/^\S+$/, 'A key has no spaces.')

export const organisationAgentSettingsSchema = z
  .object({
    matterTextToModel: z.boolean(),
    model: agentModelChoiceSchema.nullable(),
    keyLastFour: z.string().length(4).nullable(),
    keySetAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict()
  .refine(
    (settings) =>
      (settings.keyLastFour === null) === (settings.keySetAt === null),
    { message: 'A stored key has a set date.', path: ['keySetAt'] },
  )
export type OrganisationAgentSettings = z.infer<
  typeof organisationAgentSettingsSchema
>

export const agentKeyChangeSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('replace'), value: agentApiKeySchema }).strict(),
  z.object({ action: z.literal('remove') }).strict(),
])
export type AgentKeyChange = z.infer<typeof agentKeyChangeSchema>

export const organisationAgentSettingsUpdateSchema = z
  .object({
    matterTextToModel: z.boolean().optional(),
    model: agentModelChoiceSchema.optional(),
    key: agentKeyChangeSchema.optional(),
  })
  .strict()
  .refine((update) => Object.keys(update).length > 0, {
    message: 'Nothing to change.',
  })
export type OrganisationAgentSettingsUpdate = z.infer<
  typeof organisationAgentSettingsUpdateSchema
>

export const agentAccessModeSchema = z.enum(['managed_eu', 'byok', 'disabled'])
export type AgentAccessMode = z.infer<typeof agentAccessModeSchema>
export const agentSessionProviderSchema = z.enum([
  'obiter_eu',
  'anthropic',
  'openai',
  'gemini',
  'openai_compatible',
])
export type AgentSessionProvider = z.infer<typeof agentSessionProviderSchema>
export const AGENT_SESSION_PROVIDERS = {
  ...AGENT_PROVIDERS,
  obiter_eu: {
    label: 'Managed EU',
    modelIdPattern: /^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/,
    modelIdExample: 'managed-model',
  },
  openai: {
    label: 'OpenAI',
    modelIdPattern: /^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/,
    modelIdExample: 'gpt-model',
  },
  gemini: {
    label: 'Gemini',
    modelIdPattern: /^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/,
    modelIdExample: 'gemini-model',
  },
  openai_compatible: {
    label: 'OpenAI compatible',
    modelIdPattern: /^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/,
    modelIdExample: 'model-name',
  },
} as const satisfies Record<
  AgentSessionProvider,
  { label: string; modelIdPattern: RegExp; modelIdExample: string }
>

export const agentSessionModelChoiceSchema = z
  .object({
    provider: agentSessionProviderSchema,
    modelId: modelIdSchema,
    snapshot: modelIdSchema.nullable(),
  })
  .strict()
  .superRefine((choice, context) => {
    const { modelIdPattern, modelIdExample, label } =
      AGENT_SESSION_PROVIDERS[choice.provider]
    for (const field of ['modelId', 'snapshot'] as const) {
      const value = choice[field]
      if (value !== null && !modelIdPattern.test(value))
        context.addIssue({
          code: 'custom',
          path: [field],
          message: `${label} model ids look like ${modelIdExample}.`,
        })
    }
  })
export type AgentSessionModelChoice = z.infer<
  typeof agentSessionModelChoiceSchema
>
const sessionSettingsFields = {
  accessMode: agentAccessModeSchema.optional(),
  matterTextToModel: z.boolean(),
  model: agentSessionModelChoiceSchema.nullable(),
  keyLastFour: z.string().length(4).nullable(),
  keySetAt: z.string().datetime({ offset: true }).nullable(),
  baseUrl: secureHttpsUrlSchema.nullable().optional(),
  fastModel: agentSessionModelChoiceSchema.nullable().optional(),
  monthlyUsage: z
    .object({
      periodYm: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
      reservedMicros: z.number().int().nonnegative(),
      usedMicros: z.number().int().nonnegative(),
      capMicros: z.number().int().nonnegative(),
    })
    .strict()
    .nullable()
    .optional(),
  managedMatterOptOut: z.boolean().optional(),
  effectiveMatterTextAllowed: z.boolean().optional(),
}
export const agentSessionSettingsSchema = z
  .object(sessionSettingsFields)
  .strict()
  .transform((settings) => {
    const accessMode =
      settings.accessMode ?? (settings.model === null ? 'managed_eu' : 'byok')
    const managedMatterOptOut = settings.managedMatterOptOut ?? false
    return {
      ...settings,
      accessMode,
      baseUrl: settings.baseUrl ?? null,
      fastModel: settings.fastModel ?? null,
      monthlyUsage: settings.monthlyUsage ?? null,
      managedMatterOptOut,
      effectiveMatterTextAllowed:
        settings.effectiveMatterTextAllowed ??
        (accessMode === 'managed_eu'
          ? !managedMatterOptOut
          : accessMode === 'byok' && settings.matterTextToModel),
    }
  })
  .superRefine((settings, context) => {
    if ((settings.keyLastFour === null) !== (settings.keySetAt === null))
      context.addIssue({
        code: 'custom',
        path: ['keySetAt'],
        message: 'A stored key has a set date.',
      })
    if (
      settings.fastModel &&
      (!settings.model ||
        settings.fastModel.provider !== settings.model.provider)
    )
      context.addIssue({
        code: 'custom',
        path: ['fastModel'],
        message: 'Fast model must use the same provider.',
      })
    if (
      settings.accessMode === 'managed_eu' &&
      settings.model &&
      settings.model.provider !== 'obiter_eu'
    )
      context.addIssue({
        code: 'custom',
        path: ['model'],
        message: 'Managed access requires a managed model.',
      })
    if (
      settings.accessMode === 'byok' &&
      settings.model?.provider === 'obiter_eu'
    )
      context.addIssue({
        code: 'custom',
        path: ['model'],
        message: 'BYOK requires an external provider.',
      })
  })
export type AgentSessionSettings = z.infer<typeof agentSessionSettingsSchema>
export const agentSessionSettingsUpdateSchema = z
  .object({
    matterTextToModel: z.boolean().optional(),
    model: agentSessionModelChoiceSchema.optional(),
    key: agentKeyChangeSchema.optional(),
    accessMode: agentAccessModeSchema.optional(),
    baseUrl: secureHttpsUrlSchema.nullable().optional(),
    fastModel: agentSessionModelChoiceSchema.nullable().optional(),
    managedMatterOptOut: z.boolean().optional(),
    strictLockdown: z.boolean().optional(),
  })
  .strict()
  .refine((update) => Object.keys(update).length > 0, 'Nothing to change.')
  .refine(
    (update) =>
      !update.model ||
      !update.fastModel ||
      update.model.provider === update.fastModel.provider,
    'Fast model must use the same provider.',
  )
  .refine(
    (update) =>
      update.strictLockdown !== true ||
      update.accessMode === undefined ||
      update.accessMode === 'managed_eu',
    'Strict lockdown requires managed access.',
  )
  .refine(
    (update) =>
      !update.model ||
      update.accessMode === undefined ||
      update.accessMode === 'disabled' ||
      (update.accessMode === 'managed_eu'
        ? update.model.provider === 'obiter_eu'
        : update.model.provider !== 'obiter_eu'),
    'Model provider must match the access mode.',
  )
export type AgentSessionSettingsUpdate = z.infer<
  typeof agentSessionSettingsUpdateSchema
>
