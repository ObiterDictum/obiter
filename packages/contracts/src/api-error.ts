import { z } from 'zod'
import { API_ERROR_CODES, type ApiErrorCode } from './api-error-codes'
import type { ApiErrorResponse } from './api-error-response'

export type { ApiErrorCode, ApiErrorResponse }

export const apiErrorCodeSchema = z.enum(API_ERROR_CODES)

export const apiErrorResponseSchema = z.object({
  error: z.object({
    code: apiErrorCodeSchema,
    message: z.string().min(1),
    requestId: z.string().min(1),
  }),
})
