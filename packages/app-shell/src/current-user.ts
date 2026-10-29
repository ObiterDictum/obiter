import {
  type MutationOptions,
  queryOptions,
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query'
import type {
  CurrentOrganisation,
  MeResponse,
  UpdateProfileResponse,
} from '@obiter/contracts'
import { apiFetch, ApiError } from './api'
import {
  clearStoredDocumentDrafts,
  rememberDocumentDraftUser,
  resumeDocumentDraftWrites,
  suspendDocumentDraftWrites,
} from './document-draft-store'

export function currentUserQueryOptions() {
  return queryOptions({
    queryKey: ['current-user'],
    queryFn: async () => {
      try {
        const me = await apiFetch<MeResponse>('/api/me')
        rememberDocumentDraftUser(me.user.id)
        resumeDocumentDraftWrites()
        return me
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          suspendDocumentDraftWrites()
          clearStoredDocumentDrafts()
        }
        throw error
      }
    },
    staleTime: 60 * 1000,
  })
}

export function useCurrentUser() {
  return useSuspenseQuery(currentUserQueryOptions())
}

export interface CreateOrganisationResult {
  ok: boolean
  message?: string
  organisation?: CurrentOrganisation
}

export function createOrganisationMutationOptions(): MutationOptions<
  CurrentOrganisation,
  ApiError,
  { name: string }
> {
  const queryClient = useQueryClient()
  return {
    mutationFn: async (input) => {
      const result = await apiFetch<{ organisation: CurrentOrganisation }>(
        '/api/organisations',
        {
          method: 'POST',
          body: JSON.stringify({ name: input.name }),
        },
      )
      return result.organisation
    },
    onSuccess: (organisation) => {
      queryClient.setQueryData<MeResponse>(['current-user'], (prev) =>
        prev ? { user: { ...prev.user, role: 'owner' }, organisation } : prev,
      )
      void queryClient.invalidateQueries({ queryKey: ['current-user'] })
    },
  }
}

export function useCreateOrganisation() {
  return useMutation(createOrganisationMutationOptions())
}

export function useUpdateProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { name: string }) => {
      const result = await apiFetch<UpdateProfileResponse>('/api/me', {
        method: 'PATCH',
        body: JSON.stringify({ name: input.name }),
      })
      return result.user
    },
    onSuccess: (user) => {
      queryClient.setQueryData<MeResponse>(['current-user'], (prev) =>
        prev ? { ...prev, user } : prev,
      )
      void queryClient.invalidateQueries({ queryKey: ['current-user'] })
    },
  })
}

export function useRenameOrganisation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { name: string }) => {
      const result = await apiFetch<{ organisation: CurrentOrganisation }>(
        '/api/organisations',
        { method: 'PATCH', body: JSON.stringify({ name: input.name }) },
      )
      return result.organisation
    },
    onSuccess: (organisation) => {
      queryClient.setQueryData<MeResponse>(['current-user'], (prev) =>
        prev ? { ...prev, organisation } : prev,
      )
      void queryClient.invalidateQueries({ queryKey: ['current-user'] })
    },
  })
}
