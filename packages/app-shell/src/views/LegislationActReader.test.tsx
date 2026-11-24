import '@obiter/test-dom'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { vi } from '../../../../scripts/test/vitest-compat'
import { act } from '@testing-library/react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { LegislationRouteView } from './LegislationRouteView'

const identity = 'ukpga/2025/1'
const canonicalUrl = `/ln/${identity}`
const officialUrl = `https://www.legislation.gov.uk/${identity}`

function contentsNode(
  labelPath: string,
  label: string,
  kind: 'part' | 'chapter' | 'crossheading' | 'schedule' | 'P1',
  docOrder: number,
) {
  return {
    label,
    docOrder,
    labelPath,
    href: `${canonicalUrl}/${labelPath}`,
    extent: 'E+W',
    withheld: false,
    kind,
    children: [],
  }
}

const sections = Array.from({ length: 60 }, (_, index) => ({
  ...contentsNode(`section/${index + 1}`, `s. ${index + 1}`, 'P1', index + 3),
  heading: `Section heading ${index + 1}`,
}))
const part = {
  ...contentsNode('part/1', 'Part 1', 'part', 0),
  text: 'General provisions',
}
const actDocument = {
  identity,
  title: 'Example Act 2025',
  year: 2025,
  number: 1,
  chapter: '2025 c. 1',
  extent: 'E+W',
  canonicalUrl,
  officialUrl,
  sourceUrl: officialUrl,
  totalCount: 60,
  withheldCount: 0,
  repealedCount: 0,
  contents: [{ ...part, children: sections }],
}

const entries = [part, ...sections].map((node) => ({
  labelPath: node.labelPath,
  provision:
    node.kind === 'P1'
      ? {
          officialUrl: `${officialUrl}/${node.labelPath}`,
          canonicalUrl: node.href,
          legislationStatus: 'current',
          text: `Wording of ${node.label}`,
        }
      : undefined,
}))

const scrollIntoView = mock(() => {})
Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
  configurable: true,
  value: scrollIntoView,
})

interface MockObserver {
  callback: IntersectionObserverCallback
  elements: Set<Element>
}
const observers: MockObserver[] = []

class MockIntersectionObserver implements IntersectionObserver {
  readonly root = null
  readonly rootMargin = '0px'
  readonly thresholds = [0]
  private readonly record: MockObserver
  constructor(callback: IntersectionObserverCallback) {
    this.record = { callback, elements: new Set() }
    observers.push(this.record)
  }
  observe(element: Element) {
    this.record.elements.add(element)
  }
  unobserve(element: Element) {
    this.record.elements.delete(element)
  }
  disconnect() {
    this.record.elements.clear()
  }
  takeRecords() {
    return []
  }
}

function intersect(element: Element) {
  const observer = observers.find((record) => record.elements.has(element))
  if (!observer) throw new Error('Element is not observed.')
  observer.callback(
    [{ isIntersecting: true, target: element } as IntersectionObserverEntry],
    {} as IntersectionObserver,
  )
}

const rootRoute = createRootRoute()
const legislationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/ln/$',
  component: function LegislationRoute() {
    const { _splat } = legislationRoute.useParams()
    return <LegislationRouteView path={_splat} />
  },
})

function renderRoute(initial = `/ln/${identity}`) {
  const router = createRouter({
    routeTree: rootRoute.addChildren([legislationRoute]),
    history: createMemoryHistory({ initialEntries: [initial] }),
    context: { queryClient: new QueryClient() },
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

function textRequests() {
  return vi
    .mocked(fetch)
    .mock.calls.map(([url]) => String(url))
    .filter((url) => url.includes('/text?'))
}

describe('LegislationActReader', () => {
  beforeEach(() => {
    scrollIntoView.mockClear()
    observers.length = 0
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        const url = new URL(input, 'http://localhost')
        if (!url.pathname.endsWith('/text'))
          return Response.json({ act: actDocument })
        const offset = Number(url.searchParams.get('offset'))
        const limit = Number(url.searchParams.get('limit'))
        return Response.json({
          entries: entries.slice(offset, offset + limit),
          nextOffset: offset + limit < entries.length ? offset + limit : null,
        })
      }),
    )
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('loads the containing page, scrolls and sets the URL hash when a contents entry for unloaded text is clicked', async () => {
    const router = renderRoute()
    await screen.findByText('Wording of s. 1')
    fireEvent.click(
      screen.getByRole('link', { name: 's. 55 · Section heading 55' }),
    )
    const heading = await screen.findByRole('heading', {
      name: 's. 55 · Section heading 55',
    })
    expect(router.state.location.hash).toBe('section-55')
    expect(textRequests()).toEqual([
      `/api/search/legislation/${identity}/text?offset=0&limit=50`,
      `/api/search/legislation/${identity}/text?offset=50&limit=50`,
    ])
    expect(document.activeElement).toBe(heading)
    expect(scrollIntoView).toHaveBeenCalled()
  })

  it('honours a deep link to an unloaded page on first load', async () => {
    renderRoute(`/ln/${identity}#section-55`)
    const heading = await screen.findByRole('heading', {
      name: 's. 55 · Section heading 55',
    })
    expect(textRequests()).toEqual([
      `/api/search/legislation/${identity}/text?offset=50&limit=50`,
    ])
    expect(document.activeElement).toBe(heading)
  })

  it('scrolls to an already-loaded contents entry without refetching', async () => {
    const router = renderRoute()
    await screen.findByText('Wording of s. 1')
    scrollIntoView.mockClear()
    fireEvent.click(
      screen.getByRole('link', { name: 's. 10 · Section heading 10' }),
    )
    await screen.findByRole('heading', {
      name: 's. 10 · Section heading 10',
    })
    expect(router.state.location.hash).toBe('section-10')
    expect(textRequests()).toEqual([
      `/api/search/legislation/${identity}/text?offset=0&limit=50`,
    ])
    expect(scrollIntoView).toHaveBeenCalled()
  })

  it('loads the next page automatically when the load-more control nears the viewport', async () => {
    renderRoute()
    await screen.findByText('Wording of s. 1')
    expect(screen.queryByText('Wording of s. 55')).toBeNull()
    const button = screen.getByRole('button', { name: 'Load more Act text' })
    act(() => intersect(button))
    await screen.findByText('Wording of s. 55')
    expect(textRequests()).toEqual([
      `/api/search/legislation/${identity}/text?offset=0&limit=50`,
      `/api/search/legislation/${identity}/text?offset=50&limit=50`,
    ])
    expect(
      screen.queryByRole('button', { name: 'Load more Act text' }),
    ).toBeNull()
  })
})
