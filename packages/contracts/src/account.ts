import { z } from 'zod'
import { MAX_PASSWORD_LENGTH } from './limits'
import { currentUserSchema, displayNameField } from './organisation'

export const USER_NAME_MAX_LENGTH = 120

export const accountNameFieldSchema = displayNameField(
  'Name',
  USER_NAME_MAX_LENGTH,
)

export const updateProfileInputSchema = z.object({
  name: accountNameFieldSchema,
})
export type UpdateProfileInput = z.infer<typeof updateProfileInputSchema>

export const updateProfileResponseSchema = z.object({
  user: currentUserSchema,
})
export type UpdateProfileResponse = z.infer<typeof updateProfileResponseSchema>

export const accountSessionSchema = z.object({
  id: z.string(),
  token: z.string(),
  userAgent: z
    .string()
    .nullish()
    .transform((value) => value ?? null),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type AccountSession = z.infer<typeof accountSessionSchema>

export const accountSessionsResponseSchema = z.array(accountSessionSchema)

export const deleteAccountInputSchema = z.object({
  password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
})
export type DeleteAccountInput = z.infer<typeof deleteAccountInputSchema>

export { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from './limits'
