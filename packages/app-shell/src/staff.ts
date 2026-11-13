import {
  keepPreviousData,
  queryOptions,
  useQueryClient,
  type QueryKey,
} from '@tanstack/react-query'
import type { MutationOptions } from '@tanstack/react-query'
import { useToast } from '@obiter/ui'
import {
  staffQueueResponseSchema,
  staffDecisionsResponseSchema,
  staffOrganisationsResponseSchema,
  staffOverviewResponseSchema,
  staffUsageResponseSchema,
  staffFeedbackListResponseSchema,
  staffFeedbackHandledResponseSchema,
  type MeResponse,
  type StaffFeedbackHandledResponse,
  type StaffFeedbackListResponse,
  type StaffFeedbackQuery,
} from '@obiter/contracts'
import { apiFetch, ApiError } from './api'

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

export function staffOverviewQueryOptions() {
  return queryOptions({
    queryKey: ['staff', 'overview'],
    queryFn: async () =>
      staffOverviewResponseSchema.parse(await apiFetch('/api/staff/overview')),
  })
}

export function staffUsageQueryOptions(weeks: number) {
  return queryOptions({
    queryKey: ['staff', 'usage', weeks],
    placeholderData: keepPreviousData,
    queryFn: async () =>
      staffUsageResponseSchema.parse(
        await apiFetch(`/api/staff/usage?weeks=${weeks}`),
      ),
  })
}

export function staffFeedbackQueryOptions(filters: StaffFeedbackQuery) {
  return queryOptions({
    queryKey: ['staff', 'feedback', filters.status, filters.kind ?? 'all'],
    queryFn: async () => {
      const params = new URLSearchParams({ status: filters.status })
      if (filters.kind) params.set('kind', filters.kind)
      return staffFeedbackListResponseSchema.parse(
        await apiFetch(`/api/staff/feedback?${params.toString()}`),
      )
    },
  })
}

export interface StaffFeedbackHandledVariables {
  id: string
  handled: boolean
}

export function staffFeedbackHandledMutationOptions(): MutationOptions<
  StaffFeedbackHandledResponse,
  ApiError,
  StaffFeedbackHandledVariables,
  { snapshots: [QueryKey, StaffFeedbackListResponse | undefined][] }
> {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  return {
    mutationFn: async (input) =>
      staffFeedbackHandledResponseSchema.parse(
        await apiFetch(`/api/staff/feedback/${input.id}/handled`, {
          method: 'POST',
          body: JSON.stringify({ handled: input.handled }),
        }),
      ),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ['staff', 'feedback'] })
      const snapshots = queryClient.getQueriesData<StaffFeedbackListResponse>({
        queryKey: ['staff', 'feedback'],
      })
      const me = queryClient.getQueryData<MeResponse>(['current-user'])
      const handledByName = me?.user.name ?? null
      const handledAt = new Date().toISOString()
      for (const [key, data] of snapshots) {
        if (!data) continue
        const status = key[2]
        const next = {
          feedback: data.feedback.flatMap((item) => {
            if (item.id !== input.id) return [item]
            const visible = input.handled
              ? status === 'handled' || status === 'all'
              : status === 'open' || status === 'all'
            if (!visible) return []
            return [
              {
                ...item,
                handledAt: input.handled ? handledAt : null,
                handledByName: input.handled ? handledByName : null,
              },
            ]
          }),
        }
        queryClient.setQueryData(key, next)
      }
      return { snapshots }
    },
    onError: (_error, _input, context) => {
      for (const [key, data] of context?.snapshots ?? []) {
        if (data !== undefined) queryClient.setQueryData(key, data)
      }
      toast({
        title: 'Could not update feedback',
        description: 'Try again.',
        tone: 'danger',
      })
    },
    onSuccess: (_data, input) => {
      toast({
        title: input.handled ? 'Marked as handled' : 'Reopened',
        description: 'Feedback updated.',
        tone: 'success',
      })
      void queryClient.invalidateQueries({ queryKey: ['staff', 'feedback'] })
      void queryClient.invalidateQueries({ queryKey: ['staff', 'overview'] })
    },
  }
}

const STAFF_USAGE_WEEKS = new Set([4, 12, 26, 52])

export function validateStaffUsageSearch(search: Record<string, unknown>) {
  const weeks = Number(search.weeks)
  return STAFF_USAGE_WEEKS.has(weeks) ? { weeks } : {}
}

export function validateStaffFeedbackSearch(
  search: Record<string, unknown>,
): StaffFeedbackQuery {
  const kind =
    search.kind === 'problem' ||
    search.kind === 'idea' ||
    search.kind === 'question'
      ? search.kind
      : undefined
  const status =
    search.status === 'handled' || search.status === 'all'
      ? search.status
      : 'open'
  return { ...(kind ? { kind } : {}), status }
}

export function staffUsageWeeks(search: Record<string, unknown>): number {
  return validateStaffUsageSearch(search).weeks ?? 12
}
