import { API_ERROR_CODES, type ApiErrorCode } from './api-error-codes'

export type { ApiErrorCode }

const API_ERROR_CODE_SET = new Set<string>(API_ERROR_CODES)

export interface ApiErrorResponse {
  error: {
    code: ApiErrorCode
    message: string
    requestId: string
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return typeof value === 'string' && API_ERROR_CODE_SET.has(value)
}

export function parseApiErrorResponse(value: unknown): ApiErrorResponse | null {
  if (!isRecord(value)) return null
  const error = value.error
  if (!isRecord(error)) return null
  const { code, message, requestId } = error
  if (!isApiErrorCode(code)) return null
  if (typeof message !== 'string' || message.length === 0) return null
  if (typeof requestId !== 'string' || requestId.length === 0) return null
  return { error: { code, message, requestId } }
}
