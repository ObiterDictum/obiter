import { redirect } from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'
import { ApiError } from './api'
import { currentUserQueryOptions } from './current-user'
import { mattersListQueryOptions } from './matters'
import { invitePreviewQueryOptions } from './organisation-membership'

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

export async function prefetchInviteAcceptData(
  queryClient: QueryClient,
  token: string,
): Promise<void> {
  if (!token) return
  await queryClient.ensureQueryData(invitePreviewQueryOptions(token))
}
