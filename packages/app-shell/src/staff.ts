import { queryOptions } from '@tanstack/react-query'
import {
  staffQueueResponseSchema,
  staffDecisionsResponseSchema,
  staffOrganisationsResponseSchema,
} from '@obiter/contracts'
import { apiFetch } from './api'

export function staffQueueQueryOptions() {
  return queryOptions({
    queryKey: ['staff', 'queue'],
    queryFn: async () =>
      staffQueueResponseSchema.parse(await apiFetch('/api/staff/access')),
  })
}
export function staffDecisionsQueryOptions() {
  return queryOptions({
    queryKey: ['staff', 'decisions'],
    queryFn: async () =>
      staffDecisionsResponseSchema.parse(
        await apiFetch('/api/staff/access/decisions'),
      ),
  })
}
export function staffOrganisationsQueryOptions() {
  return queryOptions({
    queryKey: ['staff', 'organisations'],
    queryFn: async () =>
      staffOrganisationsResponseSchema.parse(
        await apiFetch('/api/staff/organisations'),
      ),
  })
}
