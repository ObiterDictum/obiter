import { expectRejection } from '../../../scripts/test/expect-rejection'
import { describe, expect, it } from 'bun:test'
import { vi } from '../../../scripts/test/vitest-compat'
import { isRedirect } from '@tanstack/react-router'
import { QueryClient } from '@tanstack/react-query'
import type { MeResponse } from '@obiter/contracts'
import { ApiError } from './api'
import {
  guardAuth,
  prefetchHomeData,
  prefetchVerifyData,
} from './route-loaders'

const noopQueryClient = new QueryClient()

const CURRENT_USER_QUERY_KEY = ['current-user'] as const

const ORGLESS_ME: MeResponse = {
  user: { id: 'usr_1', email: 'lex@obiter.dev', name: 'Lex', role: null },
  organisation: null,
}

const ORG_ME: MeResponse = {
  user: { id: 'usr_1', email: 'lex@obiter.dev', name: 'Lex', role: 'owner' },
  organisation: { id: 'org_1', name: 'Obiter Legal', plan: 'private_beta' },
}

describe('guardAuth', () => {
  it('passes through when the wrapped call succeeds', async () => {
    const run = vi.fn().mockResolvedValue(undefined)
    await expect(guardAuth(noopQueryClient, run)).resolves.toBeUndefined()
    expect(run).toHaveBeenCalledOnce()
  })

  it('throws a router redirect to /sign-in on an unauthenticated ApiError (not swallowed)', async () => {
    const run = vi
      .fn()
      .mockRejectedValue(
        new ApiError('unauthenticated', 'Sign in is required.', 401, 'req_1'),
      )

    await expectRejection(guardAuth(noopQueryClient, run), (error: unknown) => {
      if (!isRedirect(error)) return false
      const opts = (error as { options?: { to?: string } }).options
      return opts?.to === '/sign-in'
    })
  })

  it('does not report success or run further work after a 401', async () => {
    const after = vi.fn().mockResolvedValue(undefined)
    const failing = vi
      .fn()
      .mockRejectedValue(
        new ApiError('unauthenticated', 'Sign in is required.', 401, 'req_9'),
      )

    await expectRejection(
      guardAuth(noopQueryClient, async () => {
        await failing()
        await after()
      }),
      (error: unknown) => isRedirect(error),
    )

    expect(after).not.toHaveBeenCalled()
  })

  it('works with no window present (SSR): still throws a redirect, does not swallow', async () => {
    const originalWindow = globalThis.window
    vi.stubGlobal('window', undefined as unknown as Window)

    const run = vi
      .fn()
      .mockRejectedValue(
        new ApiError('unauthenticated', 'Sign in is required.', 401, 'req_2'),
      )

    try {
      await expectRejection(guardAuth(noopQueryClient, run), (error: unknown) =>
        isRedirect(error),
      )
    } finally {
      vi.stubGlobal('window', originalWindow)
      vi.unstubAllGlobals()
    }
  })

  it('rethrows non-auth errors so the router handles them normally', async () => {
    const run = vi
      .fn()
      .mockRejectedValue(
        new ApiError('matter_not_found', 'Matter not found.', 404, 'req_3'),
      )

    await expect(guardAuth(noopQueryClient, run)).rejects.toMatchObject({
      code: 'matter_not_found',
    })
  })
})

describe('prefetchHomeData', () => {
  it('prefetches the matters list when the user has an organisation', async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(CURRENT_USER_QUERY_KEY, ORG_ME)
    const prefetchSpy = vi
      .spyOn(queryClient, 'prefetchQuery')
      .mockResolvedValue(undefined)
    vi.spyOn(queryClient, 'ensureQueryData').mockResolvedValue(undefined)

    await prefetchHomeData(queryClient)

    expect(prefetchSpy).toHaveBeenCalledTimes(1)
  })

  it('prefetches the matters list for an org-less user (API provisions a workspace)', async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(CURRENT_USER_QUERY_KEY, ORGLESS_ME)
    const prefetchSpy = vi
      .spyOn(queryClient, 'prefetchQuery')
      .mockResolvedValue(undefined)
    vi.spyOn(queryClient, 'ensureQueryData').mockResolvedValue(undefined)

    await prefetchHomeData(queryClient)

    expect(prefetchSpy).toHaveBeenCalledTimes(1)
  })

  it('redirects to /sign-in when the current-user fetch is unauthenticated', async () => {
    const queryClient = new QueryClient()
    vi.spyOn(queryClient, 'ensureQueryData').mockRejectedValueOnce(
      new ApiError('unauthenticated', 'Sign in is required.', 401, 'req_6'),
    )

    await expectRejection(prefetchHomeData(queryClient), (error: unknown) => {
      if (!isRedirect(error)) return false
      const opts = (error as { options?: { to?: string } }).options
      return opts?.to === '/sign-in'
    })
  })
})

describe('prefetchVerifyData', () => {
  it('prefetches verification runs, matters and run documents for an organisation user', async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(CURRENT_USER_QUERY_KEY, ORG_ME)
    queryClient.setQueryData(['verification-runs'], {
      pages: [{ runs: [{ documentId: 'doc_1' }], nextCursor: null }],
      pageParams: [null],
    })
    const prefetchQuery = vi
      .spyOn(queryClient, 'prefetchQuery')
      .mockResolvedValue(undefined)
    const prefetchInfiniteQuery = vi
      .spyOn(queryClient, 'prefetchInfiniteQuery')
      .mockResolvedValue(undefined)
    vi.spyOn(queryClient, 'ensureQueryData').mockResolvedValue(undefined)

    await prefetchVerifyData(queryClient)

    expect(prefetchInfiniteQuery).toHaveBeenCalledTimes(1)
    expect(prefetchQuery).toHaveBeenCalledTimes(2)
    expect(prefetchQuery).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ['matters', 'list'] }),
    )
    expect(prefetchQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ['documents', 'detail', 'doc_1'],
        staleTime: 30_000,
      }),
    )
  })

  it('prefetches only the current user for an organisation-less user', async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(CURRENT_USER_QUERY_KEY, ORGLESS_ME)
    const prefetchQuery = vi
      .spyOn(queryClient, 'prefetchQuery')
      .mockResolvedValue(undefined)
    const prefetchInfiniteQuery = vi
      .spyOn(queryClient, 'prefetchInfiniteQuery')
      .mockResolvedValue(undefined)
    vi.spyOn(queryClient, 'ensureQueryData').mockResolvedValue(undefined)

    await prefetchVerifyData(queryClient)

    expect(prefetchInfiniteQuery).not.toHaveBeenCalled()
    expect(prefetchQuery).not.toHaveBeenCalled()
  })

  it('redirects to /sign-in when the current-user fetch is unauthenticated', async () => {
    const queryClient = new QueryClient()
    vi.spyOn(queryClient, 'ensureQueryData').mockRejectedValueOnce(
      new ApiError('unauthenticated', 'Sign in is required.', 401, 'req_7'),
    )

    await expectRejection(prefetchVerifyData(queryClient), (error: unknown) => {
      if (!isRedirect(error)) return false
      const opts = (error as { options?: { to?: string } }).options
      return opts?.to === '/sign-in'
    })
  })
})
