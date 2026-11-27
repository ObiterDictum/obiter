import { QueryClient } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { afterEach, expect, it, spyOn } from 'bun:test'
import { Route } from './src/routes/ln/$.tsx'

const path = '/ln/ukpga/2010/15#section-1'
const root = createRootRoute()
const routeTree = root.addChildren([
  createRoute({ ...Route.options, path: '/ln/$', getParentRoute: () => root }),
])
const me = {
  user: { id: 'usr_1', email: 'lex@example.com', name: 'Lex', role: null },
  organisation: null,
}

const fetchMock = spyOn(globalThis, 'fetch')
afterEach(() => fetchMock.mockReset())

async function loadLegislation() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
    context: { queryClient },
    isServer: true,
  })
  try {
    await router.load()
    return router.state
  } finally {
    queryClient.clear()
  }
}

it('redirects signed-out readers before requesting legislation', async () => {
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }))

  const state = await loadLegislation()

  expect(state.redirect?.options.to).toBe('/sign-in')
  expect(state.redirect?.options.search).toEqual({ redirect: path })
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(new URL(String(fetchMock.mock.calls[0]?.[0])).pathname).toBe('/api/me')
})

it('redirects to sign-in when legislation returns 401 after the account check', async () => {
  fetchMock
    .mockResolvedValueOnce(Response.json(me))
    .mockImplementation(async () => new Response(null, { status: 401 }))

  const state = await loadLegislation()

  expect(state.redirect?.options.to).toBe('/sign-in')
  expect(state.redirect?.options.search).toEqual({ redirect: path })
  expect(new URL(String(fetchMock.mock.calls[1]?.[0])).pathname).toBe(
    '/api/search/legislation/ukpga/2010/15',
  )
})

it('keeps a missing Act as not found', async () => {
  fetchMock
    .mockResolvedValueOnce(Response.json(me))
    .mockResolvedValueOnce(new Response(null, { status: 404 }))

  const state = await loadLegislation()

  expect(state.statusCode).toBe(404)
  expect(state.redirect).toBeUndefined()
})

it('adds noindex metadata when a signed-in reader opens an Act', async () => {
  fetchMock
    .mockResolvedValueOnce(Response.json(me))
    .mockResolvedValueOnce(Response.json({ act: {} }))

  const state = await loadLegislation()

  expect(state.statusCode).toBe(200)
  expect(state.matches.at(-1)?.meta).toContainEqual({
    name: 'robots',
    content: 'noindex, nofollow, noarchive',
  })
})
