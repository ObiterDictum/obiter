import { redirect } from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'
import type { MeResponse } from '@obiter/contracts'
import { ApiError } from './api'
import { currentUserQueryOptions } from './current-user'
import { workspaceKind } from './document-kind'
import { documentModelQueryOptions } from './document-workspace-queries'
import { documentQueryOptions } from './documents'
import { matterQueryOptions, mattersListQueryOptions } from './matters'
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

const DOCUMENT_PREFETCH_STALE_MS = 30_000

export async function prefetchDocumentRouteData(
  queryClient: QueryClient,
  matterId: string,
  documentId: string,
): Promise<void> {
  await guardAuth(queryClient, () =>
    queryClient.ensureQueryData(currentUserQueryOptions()),
  )
  void queryClient.prefetchQuery({
    ...matterQueryOptions(matterId),
    staleTime: DOCUMENT_PREFETCH_STALE_MS,
  })
  void queryClient
    .fetchQuery({
      ...documentQueryOptions(documentId),
      staleTime: DOCUMENT_PREFETCH_STALE_MS,
    })
    .then(async (detail) => {
      const current = detail.document.currentVersion
      if (
        current?.documentStatus !== 'ready' ||
        workspaceKind(current.fileType) !== 'docx'
      )
        return
      await queryClient.prefetchQuery({
        ...documentModelQueryOptions(documentId),
        staleTime: DOCUMENT_PREFETCH_STALE_MS,
      })
    })
    .catch(() => undefined)
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
