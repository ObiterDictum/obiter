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

/**
 * Current-user data is always backed by the authenticated `GET /api/me` API.
 * A 401 is surfaced to the frame, which redirects protected routes to sign-in.
 */
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
          // Only the remembered user: a shared browser may hold another
          // account's recoverable drafts, and a 401 must not wipe those.
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

/**
 * Creates the signed-in user's organisation via POST /api/organisations.
 * On success, the current-user cache is updated immediately with the created
 * organisation (role becomes 'owner') so Settings flips from the create form
 * to the organisation summary without waiting for a refetch, and the query is invalidated
 * to reconcile with the server.
 */
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
      // Merge the created organisation into the cached /api/me so the UI
      // reflects it immediately; the role of the creating user is 'owner'.
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

/**
 * Updates the signed-in account's own display name via PATCH /api/me. The API
 * scopes the write to the session's user, so no id is sent. The canonical user
 * the server stored replaces the cached one, then the query is invalidated so
 * every /api/me consumer reconciles with the server rather than with the value
 * the form typed.
 */
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

/**
 * Owner-only rename via PATCH /api/organisations, which is scoped to the
 * caller's own organisation. The client sends no organisation id: an id in the
 * request could only be meant to address someone else's tenant. Merges the
 * renamed organisation into the cached /api/me so Settings and Home reflect it
 * immediately, then invalidates to reconcile with the server.
 */
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
