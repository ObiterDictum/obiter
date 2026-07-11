// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { ApiError } from './api'
import { guardAuth } from './route-loaders'

const noopQueryClient = new QueryClient()

/** jsdom's window.location is non-configurable, so swap the whole object. */
function stubLocationAssign(assign: (url: string) => void) {
  const original = window.location
  Object.defineProperty(window, 'location', {
    value: { ...original, assign },
    writable: true,
    configurable: true,
  })
  return () => {
    Object.defineProperty(window, 'location', {
      value: original,
      writable: true,
      configurable: true,
    })
  }
}

describe('guardAuth', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('passes through when the wrapped call succeeds', async () => {
    const run = vi.fn().mockResolvedValue(undefined)
    await expect(guardAuth(noopQueryClient, run)).resolves.toBeUndefined()
    expect(run).toHaveBeenCalledOnce()
  })

  it('redirects to /sign-in on an unauthenticated ApiError instead of surfacing a broken screen', async () => {
    const assign = vi.fn()
    const restore = stubLocationAssign(assign)

    const run = vi.fn().mockRejectedValue(
      new ApiError('unauthenticated', 'Sign in is required.', 401, 'req_1'),
    )

    await expect(guardAuth(noopQueryClient, run)).resolves.toBeUndefined()
    expect(assign).toHaveBeenCalledWith('/sign-in')

    restore()
  })

  it('rethrows non-auth errors so the router handles them normally', async () => {
    const run = vi.fn().mockRejectedValue(
      new ApiError('matter_not_found', 'Matter not found.', 404, 'req_2'),
    )

    await expect(guardAuth(noopQueryClient, run)).rejects.toMatchObject({
      code: 'matter_not_found',
    })
  })
})
