// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { createAppRouter, DESKTOP_SHARED_VIEW_PATHS } from './router'

describe('desktop router parity with web shared views', () => {
  it('registers every shared-view path the web app exposes', () => {
    const router = createAppRouter(new QueryClient())
    const registered = new Set(Object.keys(router.routesByPath))

    for (const path of DESKTOP_SHARED_VIEW_PATHS) {
      expect(registered.has(path), `missing desktop route for ${path}`).toBe(
        true,
      )
    }
  })

  it('registers /case/$caseSlug so canonical search links do not fall through', () => {
    const router = createAppRouter(new QueryClient())
    expect(router.routesByPath['/case/$caseSlug']).toBeDefined()
    expect(router.routesByPath['/cases/$caseId']).toBeDefined()
  })

  it('registers /redact/$runId as a top-level sibling of /redact (not a nested child without Outlet)', () => {
    const router = createAppRouter(new QueryClient())
    const review = router.routesByPath['/redact/$runId']
    const runs = router.routesByPath['/redact']
    expect(review).toBeDefined()
    expect(runs).toBeDefined()
    expect(review.parentRoute.id).toBe(runs.parentRoute.id)
  })
})
