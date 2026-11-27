import '@obiter/test-dom'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { QueryClient } from '@tanstack/react-query'
import { LegalSearchView, VerifyRouteView } from '@obiter/app-shell'
import { createMemoryHistory } from '@tanstack/react-router'
import { describe, expect, it, spyOn } from 'bun:test'
import { createAppRouter, DESKTOP_SHARED_VIEW_PATHS } from './router'
import { DesktopSearchPage } from '../../pages/search'
import { DesktopVerifyRoute } from '../../pages/verify'

function collectSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) return collectSources(path)
    if (!entry.isFile() || !/\.tsx?$/u.test(entry.name)) return []
    return /\.test\.tsx?$/u.test(entry.name) ? [] : [path]
  })
}

const actPath = '/ln/ukpga/2010/15#section-1'

async function loadLegislation(session: 'signed-in' | 'signed-out') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const router = createAppRouter(queryClient)
  router.update({
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [actPath] }),
    isServer: true,
  })
  const fetchMock = spyOn(globalThis, 'fetch').mockRejectedValue(
    new Error('Unexpected API request'),
  )
  if (session === 'signed-in') {
    fetchMock
      .mockResolvedValueOnce(
        Response.json({
          user: {
            id: 'usr_1',
            email: 'lex@example.com',
            name: 'Lex',
            role: null,
          },
          organisation: null,
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ act: { identity: 'ukpga/2010/15' } }),
      )
  } else {
    fetchMock.mockResolvedValueOnce(
      Response.json(
        {
          error: {
            code: 'unauthenticated',
            message: 'Sign in is required.',
            requestId: 'req_1',
          },
        },
        { status: 401 },
      ),
    )
  }
  try {
    await router.load()
    const requests = fetchMock.mock.calls.map(
      ([input]) => new URL(String(input), 'http://localhost').pathname,
    )
    return { state: router.state, requests }
  } finally {
    fetchMock.mockRestore()
    queryClient.clear()
  }
}

describe('desktop router parity with web shared views', () => {
  it('renders the shared LegalSearchView on the desktop search page', () => {
    const element = DesktopSearchPage()
    expect(element.type).toBe(LegalSearchView)
  })

  it('renders the shared VerifyRouteView on the desktop verify page', () => {
    const element = DesktopVerifyRoute()
    expect(element.type).toBe(VerifyRouteView)
  })

  it('registers every shared-view path the web app exposes', () => {
    const router = createAppRouter(new QueryClient())
    const registered = new Set(Object.keys(router.routesByPath))

    for (const path of DESKTOP_SHARED_VIEW_PATHS) {
      expect(registered.has(path), `missing desktop route for ${path}`).toBe(
        true,
      )
    }
  })

  it('renders the shared document detail view, with verification inside it', () => {
    const source = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), './router.tsx'),
      'utf8',
    )
    expect(source).toContain('<DocumentDetailLayoutView')
    expect(source).not.toMatch(
      /VerificationRunPanel|VerificationDock|VerificationEvidencePanel|verification-findings/,
    )
  })

  it('inherits the shared document selection instead of a desktop copy', () => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
    const files = collectSources(resolve(root, './src'))
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      expect(source, file).not.toMatch(
        /data-selected-text|document-selection|ParagraphSelection[Bb]inding/,
      )
    }
  })

  it('registers /case/$caseSlug so canonical search links do not fall through', () => {
    const router = createAppRouter(new QueryClient())
    expect(router.routesByPath['/case/$caseSlug']).toBeDefined()
    expect(router.routesByPath['/cases/$caseId']).toBeDefined()
  })

  it('registers /ln/$ so provision search links do not fall through', () => {
    const router = createAppRouter(new QueryClient())
    expect(router.routesByPath['/ln/$']).toBeDefined()
  })

  it('redirects signed-out legislation links to sign-in with the original destination', async () => {
    const { state, requests } = await loadLegislation('signed-out')

    expect(state.redirect?.options.to).toBe('/sign-in')
    expect(state.redirect?.options.search).toEqual({ redirect: actPath })
    expect(requests).toEqual(['/api/me'])
  })

  it('loads legislation after confirming the reader is signed in', async () => {
    const { state, requests } = await loadLegislation('signed-in')

    expect(state.redirect).toBeUndefined()
    expect(state.statusCode).toBe(200)
    expect(state.matches.at(-1)?.status).toBe('success')
    expect(requests).toEqual([
      '/api/me',
      '/api/search/legislation/ukpga/2010/15',
    ])
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
