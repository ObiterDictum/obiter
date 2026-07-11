import { describe, expect, it, vi } from 'vitest'
import { isRedirect } from '@tanstack/react-router'
import { QueryClient } from '@tanstack/react-query'
import { ApiError } from './api'
import { guardAuth } from './route-loaders'

const noopQueryClient = new QueryClient()

describe('guardAuth', () => {
  it('passes through when the wrapped call succeeds', async () => {
    const run = vi.fn().mockResolvedValue(undefined)
    await expect(guardAuth(noopQueryClient, run)).resolves.toBeUndefined()
    expect(run).toHaveBeenCalledOnce()
  })

  it('throws a router redirect to /sign-in on an unauthenticated ApiError (not swallowed)', async () => {
    const run = vi.fn().mockRejectedValue(
      new ApiError('unauthenticated', 'Sign in is required.', 401, 'req_1'),
    )

    await expect(guardAuth(noopQueryClient, run)).rejects.toSatisfy((error: unknown) => {
      if (!isRedirect(error)) return false
      const opts = (error as { options?: { to?: string } }).options
      return opts?.to === '/sign-in'
    })
  })

  it('does not report success or run further work after a 401', async () => {
    const after = vi.fn().mockResolvedValue(undefined)
    const failing = vi.fn().mockRejectedValue(
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

    const run = vi.fn().mockRejectedValue(
      new ApiError('unauthenticated', 'Sign in is required.', 401, 'req_2'),
    )

    try {
      await expect(guardAuth(noopQueryClient, run)).rejects.toSatisfy((error: unknown) =>
        isRedirect(error),
      )
    } finally {
      vi.stubGlobal('window', originalWindow)
      vi.unstubAllGlobals()
    }
  })

  it('rethrows non-auth errors so the router handles them normally', async () => {
    const run = vi.fn().mockRejectedValue(
      new ApiError('matter_not_found', 'Matter not found.', 404, 'req_3'),
    )

    await expect(guardAuth(noopQueryClient, run)).rejects.toMatchObject({
      code: 'matter_not_found',
    })
  })
})
