import { z } from 'zod'
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

export const MIN_PASSWORD_LENGTH = 8
export const MAX_PASSWORD_LENGTH = 128
