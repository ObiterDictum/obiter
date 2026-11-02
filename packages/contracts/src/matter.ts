import { z } from 'zod'
import { apiErrorResponseSchema } from './api-error'

export const matterStatusSchema = z.enum(['active', 'archived', 'deleted'])
export type MatterStatus = z.infer<typeof matterStatusSchema>

export const matterRecordSchema = z.object({
  id: z.string().min(1),
  organisationId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable(),
  primaryJurisdiction: z.string(),
  secondaryJurisdictions: z.array(z.string()),
  legalDomains: z.array(z.string()),
  clientReference: z.string(),
  status: matterStatusSchema,
  createdBy: z.string().min(1),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  deletedAt: z.string().datetime({ offset: true }).nullable(),
  deletedBy: z.string().nullable(),
})
export type MatterRecord = z.infer<typeof matterRecordSchema>

export const matterTransferRequestSchema = z.object({
  newOwnerUserId: z.string().min(1),
})
export type MatterTransferRequest = z.infer<typeof matterTransferRequestSchema>

export const matterTransferResponseSchema = z.object({
  matter: matterRecordSchema,
})
export type MatterTransferResponse = z.infer<
  typeof matterTransferResponseSchema
>

export const matterOwnershipTransferSchema = matterTransferRequestSchema.extend(
  {
    matterId: z.string().min(1),
  },
)
export type MatterOwnershipTransfer = z.infer<
  typeof matterOwnershipTransferSchema
>

export const removeOrganisationMemberRequestSchema = z.object({
  transfers: z.array(matterOwnershipTransferSchema).optional(),
})
export type RemoveOrganisationMemberRequest = z.infer<
  typeof removeOrganisationMemberRequestSchema
>

export const removeOrganisationMemberResponseSchema = z.undefined()
export type RemoveOrganisationMemberResponse = z.infer<
  typeof removeOrganisationMemberResponseSchema
>

export const ownedMatterSchema = z.object({
  matterId: z.string().min(1),
  title: z.string().min(1),
})
export type OwnedMatter = z.infer<typeof ownedMatterSchema>

export const memberOwnedMattersResponseSchema = z.object({
  matters: z.array(ownedMatterSchema),
})
export type MemberOwnedMattersResponse = z.infer<
  typeof memberOwnedMattersResponseSchema
>

export const removeOrganisationMemberConflictResponseSchema = z.object({
  error: apiErrorResponseSchema.shape.error.extend({
    code: z.literal('conflict_detected'),
    uncoveredMatters: z.array(ownedMatterSchema).min(1),
  }),
})
export type RemoveOrganisationMemberConflictResponse = z.infer<
  typeof removeOrganisationMemberConflictResponseSchema
>
