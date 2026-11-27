import { notFound, redirect } from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'
import type { MeResponse } from '@obiter/contracts'
import { ApiError, isApiNotFound } from './api'
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

export type RouteLocation = { href: string }

export async function guardAuth<T>(
  location: RouteLocation,
  run: () => Promise<T>,
): Promise<void> {
  try {
    await run()
  } catch (error) {
    if (
      error instanceof ApiError &&
      (error.status === 401 || error.code === 'unauthenticated')
    ) {
      throw redirect({
        to: '/sign-in',
        search: location.href === '/' ? {} : { redirect: location.href },
      })
    }
    throw error
  }
}

export async function guardNotFound<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (isApiNotFound(error)) throw notFound({ data: error.code })
    throw error
  }
}

export async function prefetchHomeData(
  queryClient: QueryClient,
): Promise<void> {
  await guardAuth({ href: '/' }, () =>
    queryClient.ensureQueryData(currentUserQueryOptions()),
  )
  await queryClient.prefetchQuery(mattersListQueryOptions())
}

const DOCUMENT_PREFETCH_STALE_MS = 30_000

export async function prefetchDocumentRouteData(
  queryClient: QueryClient,
  location: RouteLocation,
  matterId: string,
  documentId: string,
): Promise<void> {
  await guardAuth(location, () =>
    queryClient.ensureQueryData(currentUserQueryOptions()),
  )
  void queryClient.prefetchQuery({
    ...matterQueryOptions(matterId),
    staleTime: DOCUMENT_PREFETCH_STALE_MS,
  })
  const detail = await guardNotFound(() =>
    queryClient.fetchQuery({
      ...documentQueryOptions(documentId),
      staleTime: DOCUMENT_PREFETCH_STALE_MS,
    }),
  )
  if (detail.document.matterId !== matterId) {
    throw notFound({ data: 'document_not_found' })
  }
  const current = detail.document.currentVersion
  if (
    current?.documentStatus === 'ready' &&
    workspaceKind(current.fileType) === 'docx'
  ) {
    void queryClient.prefetchQuery({
      ...documentModelQueryOptions(documentId),
      staleTime: DOCUMENT_PREFETCH_STALE_MS,
    })
  }
}

export async function prefetchVerifyData(
  queryClient: QueryClient,
  location: RouteLocation,
): Promise<void> {
  await guardAuth(location, () =>
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
