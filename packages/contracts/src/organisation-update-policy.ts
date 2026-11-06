import { z } from 'zod'

export const organisationUpdatePolicySchema = z
  .object({ requireUpdates: z.boolean() })
  .strict()
export type OrganisationUpdatePolicy = z.infer<
  typeof organisationUpdatePolicySchema
>
