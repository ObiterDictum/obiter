import { queryOptions, useMutation } from '@tanstack/react-query'
import {
  confirmAccessRequestResponseSchema,
  type CreateAccessRequestInput,
  type CreateAccessRequestResponse,
} from '@obiter/contracts'
import { ApiError, apiFetch } from './api'

export const FREE_WEBMAIL_MESSAGE =
  'Please use your work or university email address.'

export const NON_UK_ADDRESS_MESSAGE =
  'Obiter is available to legal professionals, researchers and students in the UK.'

const RATE_LIMITED_MESSAGE =
  'Too many requests from this address. Wait a few minutes and try again.'

const INVALID_REQUEST_MESSAGE =
  'We could not accept this request. Check the form and try again.'

const UNREACHABLE_MESSAGE =
  'We could not send your request. Check your connection and try again.'

export type AccessRequestFailure =
  { field: 'email'; message: string } | { field: 'form'; message: string }

export function accessRequestFailure(cause: unknown): AccessRequestFailure {
  if (cause instanceof ApiError) {
    switch (cause.code) {
      case 'webmail_address':
        return { field: 'email', message: FREE_WEBMAIL_MESSAGE }
      case 'non_uk_address':
        return { field: 'email', message: NON_UK_ADDRESS_MESSAGE }
      case 'rate_limited':
        return { field: 'form', message: RATE_LIMITED_MESSAGE }
      case 'invalid_request':
        return { field: 'form', message: INVALID_REQUEST_MESSAGE }
      default:
        return { field: 'form', message: cause.message }
    }
  }
  return { field: 'form', message: UNREACHABLE_MESSAGE }
}

export function useCreateAccessRequest() {
  return useMutation({
    mutationFn: (input: CreateAccessRequestInput) =>
      apiFetch<CreateAccessRequestResponse>('/api/access-requests', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
  })
}

export function confirmAccessRequestQueryOptions(token: string) {
  return queryOptions({
    queryKey: ['access-request-confirm', token] as const,
    queryFn: async () =>
      confirmAccessRequestResponseSchema.parse(
        await apiFetch<unknown>('/api/access-requests/confirm', {
          method: 'POST',
          body: JSON.stringify({ token }),
        }),
      ),
    enabled: token.length > 0 && typeof window !== 'undefined',
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
}
