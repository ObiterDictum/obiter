import {
  useMutation,
  useQuery,
  useQueryClient,
  queryOptions,
} from '@tanstack/react-query'
import type {
  CreateOrganisationInviteInput,
  OrganisationInvite,
  OrganisationMember,
} from '@obiter/contracts'
import { apiFetch } from './api'

export const organisationMembershipKeys = {
  members: (organisationId: string) =>
    ['organisation-members', organisationId] as const,
  invites: (organisationId: string) =>
    ['organisation-invites', organisationId] as const,
}

export function organisationMembersQueryOptions(organisationId: string) {
  return queryOptions({
    queryKey: organisationMembershipKeys.members(organisationId),
    queryFn: async () => {
      const response = await apiFetch<{ members: OrganisationMember[] }>(
        `/api/organisations/${organisationId}/members`,
      )
      return response.members
    },
  })
}

export function organisationInvitesQueryOptions(organisationId: string) {
  return queryOptions({
    queryKey: organisationMembershipKeys.invites(organisationId),
    queryFn: async () => {
      const response = await apiFetch<{ invites: OrganisationInvite[] }>(
        `/api/organisations/${organisationId}/invites`,
      )
      return response.invites
    },
  })
}

export function useOrganisationMembers(
  organisationId: string,
  options?: { enabled?: boolean },
) {
  return useQuery({
    ...organisationMembersQueryOptions(organisationId),
    enabled: options?.enabled ?? true,
  })
}

export function useOrganisationInvites(
  organisationId: string,
  options?: { enabled?: boolean },
) {
  return useQuery({
    ...organisationInvitesQueryOptions(organisationId),
    enabled: options?.enabled ?? true,
  })
}

export function useCreateOrganisationInvite(organisationId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateOrganisationInviteInput) => {
      const response = await apiFetch<{ invite: OrganisationInvite }>(
        `/api/organisations/${organisationId}/invites`,
        {
          method: 'POST',
          body: JSON.stringify(input),
        },
      )
      return response.invite
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: organisationMembershipKeys.invites(organisationId),
      })
    },
  })
}

export function useRevokeOrganisationInvite(organisationId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (inviteId: string) => {
      await apiFetch(
        `/api/organisations/${organisationId}/invites/${inviteId}`,
        { method: 'DELETE' },
      )
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: organisationMembershipKeys.invites(organisationId),
      })
    },
  })
}

export function useRemoveOrganisationMember(organisationId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (userId: string) => {
      await apiFetch(`/api/organisations/${organisationId}/members/${userId}`, {
        method: 'DELETE',
      })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: organisationMembershipKeys.members(organisationId),
      })
    },
  })
}
