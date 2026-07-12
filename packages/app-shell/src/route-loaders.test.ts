import { describe, expect, it, vi } from 'vitest'
import { isRedirect } from '@tanstack/react-router'
import { QueryClient } from '@tanstack/react-query'
import type { MeResponse } from '@obiter/contracts'
import { ApiError } from './api'
import {
  ensureOrganisation,
  guardAuth,
  prefetchHomeData,
} from './route-loaders'

const noopQueryClient = new QueryClient()

// Canonical current-user query key (see current-user.ts). Kept as a literal
// here rather than exported from the module to avoid widening the shell's
// public surface.
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

    await expect(guardAuth(noopQueryClient, run)).rejects.toSatisfy(
      (error: unknown) => {
        if (!isRedirect(error)) return false
        const opts = (error as { options?: { to?: string } }).options
        return opts?.to === '/sign-in'
      },
    )
  })

  it('does not report success or run further work after a 401', async () => {
    const after = vi.fn().mockResolvedValue(undefined)
    const failing = vi
      .fn()
      .mockRejectedValue(
        new ApiError('unauthenticated', 'Sign in is required.', 401, 'req_9'),
      )

    await expect(
      guardAuth(noopQueryClient, async () => {
        await failing()
        await after()
      }),
    ).rejects.toSatisfy((error: unknown) => isRedirect(error))

    expect(after).not.toHaveBeenCalled()
  })

  it('works with no window present (SSR): still throws a redirect, does not swallow', async () => {
    const originalWindow = globalThis.window
    // Simulate an SSR environment where `window` is undefined.
    vi.stubGlobal('window', undefined as unknown as Window)

    const run = vi
      .fn()
      .mockRejectedValue(
        new ApiError('unauthenticated', 'Sign in is required.', 401, 'req_2'),
      )

    try {
      await expect(guardAuth(noopQueryClient, run)).rejects.toSatisfy(
        (error: unknown) => isRedirect(error),
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

describe('ensureOrganisation', () => {
  it('passes through when the user has an organisation', async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(CURRENT_USER_QUERY_KEY, ORG_ME)

    await expect(ensureOrganisation(queryClient)).resolves.toBeUndefined()
  })

  it('redirects an org-less user to Home (create-organisation)', async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(CURRENT_USER_QUERY_KEY, ORGLESS_ME)

    await expect(ensureOrganisation(queryClient)).rejects.toSatisfy(
      (error: unknown) => {
        if (!isRedirect(error)) return false
        const opts = (error as { options?: { to?: string } }).options
        return opts?.to === '/'
      },
    )
  })

  it('redirects to /sign-in on a 401 (expired session) instead of surfacing the ApiError', async () => {
    const queryClient = new QueryClient()
    // Force the cached /api/me fetch to reject with an unauthenticated error.
    vi.spyOn(queryClient, 'ensureQueryData').mockRejectedValueOnce(
      new ApiError('unauthenticated', 'Sign in is required.', 401, 'req_4'),
    )

    await expect(ensureOrganisation(queryClient)).rejects.toSatisfy(
      (error: unknown) => {
        if (!isRedirect(error)) return false
        const opts = (error as { options?: { to?: string } }).options
        return opts?.to === '/sign-in'
      },
    )
  })

  it('rethrows non-auth errors from the /api/me fetch', async () => {
    const queryClient = new QueryClient()
    vi.spyOn(queryClient, 'ensureQueryData').mockRejectedValueOnce(
      new ApiError(
        'storage_unavailable',
        'The API is unavailable.',
        500,
        'req_5',
      ),
    )

    await expect(ensureOrganisation(queryClient)).rejects.toMatchObject({
      code: 'storage_unavailable',
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
    // ensureQueryData resolves from cache (current-user + changelog).
    vi.spyOn(queryClient, 'ensureQueryData').mockResolvedValue(undefined)

    await prefetchHomeData(queryClient)

    expect(prefetchSpy).toHaveBeenCalledTimes(1)
  })

  it('does not prefetch the matters list for an org-less user (avoids a 403)', async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(CURRENT_USER_QUERY_KEY, ORGLESS_ME)
    const prefetchSpy = vi
      .spyOn(queryClient, 'prefetchQuery')
      .mockResolvedValue(undefined)
    vi.spyOn(queryClient, 'ensureQueryData').mockResolvedValue(undefined)

    await prefetchHomeData(queryClient)

    expect(prefetchSpy).not.toHaveBeenCalled()
  })

  it('redirects to /sign-in when the current-user fetch is unauthenticated', async () => {
    const queryClient = new QueryClient()
    vi.spyOn(queryClient, 'ensureQueryData').mockRejectedValueOnce(
      new ApiError('unauthenticated', 'Sign in is required.', 401, 'req_6'),
    )

    await expect(prefetchHomeData(queryClient)).rejects.toSatisfy(
      (error: unknown) => {
        if (!isRedirect(error)) return false
        const opts = (error as { options?: { to?: string } }).options
        return opts?.to === '/sign-in'
      },
    )
  })
})
