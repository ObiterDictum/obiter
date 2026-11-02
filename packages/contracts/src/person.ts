import { z } from 'zod'

export const formerMemberFieldSchema = z.boolean().optional()

export const personAttributionSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    formerMember: formerMemberFieldSchema,
  })
  .strict()
export type PersonAttribution = z.infer<typeof personAttributionSchema>
