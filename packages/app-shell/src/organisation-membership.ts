import {
  useMutation,
  useQuery,
  useQueryClient,
  queryOptions,
} from '@tanstack/react-query'
import type {
  CreateOrganisationInviteInput,
  OrganisationInvite,
  OrganisationInviteAccountExists,
  OrganisationInvitePreview,
  OrganisationMember,
} from '@obiter/contracts'
import { apiFetch, ApiError } from './api'

export const organisationMembershipKeys = {
  members: (organisationId: string) =>
    ['organisation-members', organisationId] as const,
  invites: (organisationId: string) =>
    ['organisation-invites', organisationId] as const,
  invitePreview: (token: string) => ['invite-preview', token] as const,
}

const INVITE_UNAVAILABLE_CODES = [
  'invite_not_found',
  'invite_expired',
  'invite_revoked',
  'invite_already_accepted',
] as const

export type InviteUnavailableCode = (typeof INVITE_UNAVAILABLE_CODES)[number]

export type InvitePreviewResult =
  | { ok: true; organisationName: string; invitedByName: string }
  | { ok: false; code: InviteUnavailableCode; message: string }

function isInviteUnavailableCode(code: string): code is InviteUnavailableCode {
  return INVITE_UNAVAILABLE_CODES.some((value) => value === code)
}

export function invitePreviewQueryOptions(token: string) {
  return queryOptions({
    queryKey: organisationMembershipKeys.invitePreview(token),
    queryFn: async (): Promise<InvitePreviewResult> => {
      try {
        const preview = await apiFetch<OrganisationInvitePreview>(
          `/api/invites/preview?token=${encodeURIComponent(token)}`,
        )
        return { ok: true, ...preview }
      } catch (caught) {
        if (
          caught instanceof ApiError &&
          isInviteUnavailableCode(caught.code)
        ) {
          return { ok: false, code: caught.code, message: caught.message }
        }
        throw caught
      }
    },
    retry: false,
    staleTime: 30_000,
  })
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

/**
 * Whether an account already exists for the email an invite was sent to. Only
 * answerable for the invite's own email (403 otherwise). Returns null when the
 * answer is undetermined (invite unavailable, email mismatch, network failure)
 * so sign-up can fall back to its normal path instead of blocking.
 */
export async function checkInviteAccountExists(
  token: string,
  email: string,
): Promise<boolean | null> {
  try {
    const response = await apiFetch<OrganisationInviteAccountExists>(
      `/api/invites/account-exists?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`,
    )
    return response.hasAccount
  } catch {
    return null
  }
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
