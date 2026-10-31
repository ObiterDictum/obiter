import { redirect } from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'
import type { MeResponse } from '@obiter/contracts'
import { ApiError } from './api'
import { currentUserQueryOptions } from './current-user'
import { documentQueryOptions } from './documents'
import { mattersListQueryOptions } from './matters'
import { invitePreviewQueryOptions } from './organisation-membership'
import {
  organisationVerificationRunDocumentIds,
  organisationVerificationRunsQueryOptions,
} from './verification-runs'

export async function guardAuth<T>(
  _queryClient: QueryClient,
  run: () => Promise<T>,
): Promise<void> {
  try {
    await run()
  } catch (error) {
    if (error instanceof ApiError && error.code === 'unauthenticated') {
      throw redirect({ to: '/sign-in' })
    }
    throw error
  }
}

export async function prefetchHomeData(
  queryClient: QueryClient,
): Promise<void> {
  await guardAuth(queryClient, () =>
    queryClient.ensureQueryData(currentUserQueryOptions()),
  )
  await queryClient.prefetchQuery(mattersListQueryOptions())
}

export async function prefetchVerifyData(
  queryClient: QueryClient,
): Promise<void> {
  await guardAuth(queryClient, () =>
    queryClient.ensureQueryData(currentUserQueryOptions()),
  )
  const me = queryClient.getQueryData<MeResponse>(['current-user'])
  if (!me?.organisation) return
  await Promise.all([
    queryClient.prefetchInfiniteQuery(
      organisationVerificationRunsQueryOptions(),
    ),
    queryClient.prefetchQuery(mattersListQueryOptions()),
  ])
  const documentIds = organisationVerificationRunDocumentIds(queryClient)
  await Promise.all(
    documentIds.map((documentId) =>
      queryClient.prefetchQuery({
        ...documentQueryOptions(documentId),
        staleTime: 30_000,
      }),
    ),
  )
}

export async function prefetchInviteAcceptData(
  queryClient: QueryClient,
  token: string,
): Promise<void> {
  if (!token) return
  await queryClient.ensureQueryData(invitePreviewQueryOptions(token))
}
