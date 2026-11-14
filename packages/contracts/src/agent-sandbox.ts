import { z } from 'zod'

export const sandboxAllowedHostSchema = z
  .object({
    host: z.string().min(1),
    source: z.string().min(1),
    dataPolicy: z.string().min(1),
    active: z.boolean(),
  })
  .strict()
export type SandboxAllowedHost = z.infer<typeof sandboxAllowedHostSchema>
export const organisationSandboxPolicySchema = z
  .object({
    strictLockdown: z.boolean(),
    allowedHosts: z.array(sandboxAllowedHostSchema),
  })
  .strict()
export type OrganisationSandboxPolicy = z.infer<
  typeof organisationSandboxPolicySchema
>
export const organisationSandboxPolicyUpdateRequestSchema = z
  .object({ strictLockdown: z.boolean() })
  .strict()
export type OrganisationSandboxPolicyUpdateRequest = z.infer<
  typeof organisationSandboxPolicyUpdateRequestSchema
>
