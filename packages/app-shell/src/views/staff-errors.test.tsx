import '@obiter/test-dom'
import { afterEach, expect, it } from 'bun:test'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Suspense } from 'react'
import {
  createRootRoute,
  createRoute,
  createRouter,
  createMemoryHistory,
  RouterProvider,
} from '@tanstack/react-router'
import { validateStaffErrorsSearch } from '../staff-search'
import { StaffErrors, StaffErrorsRouteView } from './staff-errors'
const original = globalThis.fetch
afterEach(() => {
  cleanup()
  globalThis.fetch = original
})
it('renders error groups and opens recent samples with stack frames', async () => {
  const fingerprint = 'a'.repeat(64)
  globalThis.fetch = Object.assign(
    async (input: unknown) =>
      Response.json(
        String(input).includes(fingerprint)
          ? {
              samples: [
                {
                  source: 'web',
                  build: 'abcdef123456',
                  kind: 'TypeError',
                  message: 'Failed',
                  frames: [
                    {
                      function: 'save',
                      file: 'editor.js',
                      line: 42,
                      column: 9,
                    },
                  ],
                  route: '/matters/:value',
                  method: 'POST',
                  status: 500,
                  userId: null,
                  organisationId: null,
                  time: '2026-11-14T12:00:00.000Z',
                  fingerprint,
                },
              ],
            }
          : {
              groups: [
                {
                  fingerprint,
                  kind: 'TypeError',
                  message: 'Failed',
                  count: 3,
                  users: 2,
                  firstSeen: '2026-11-14T12:00:00.000Z',
                  lastSeen: '2026-11-14T12:00:00.000Z',
                  build: 'abcdef123456',
                  source: 'web',
                },
              ],
              daily: [{ day: '2026-11-14', count: 3 }],
            },
      ),
    { preconnect: original.preconnect },
  )
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const view = render(
    <QueryClientProvider client={client}>
      <StaffErrors />
    </QueryClientProvider>,
  )
  await waitFor(() => expect(view.getByText('Failed')).toBeTruthy())
  fireEvent.click(view.getByText('Failed'))
  await waitFor(() => expect(view.getByText('editor.js:42:9')).toBeTruthy())
  expect(view.getByText('First seen')).toBeTruthy()
  expect(view.getByText('save')).toBeTruthy()
  const panel = view.getByRole('region', { name: 'Error detail' })
  expect(panel.textContent).toContain('abcdef1')
  expect(panel.textContent).toContain('POST · 500')
  expect(panel.textContent).toContain('Sourceweb')
  fireEvent.keyDown(view.getByRole('region', { name: 'Error detail' }), {
    key: 'Escape',
  })
  expect(view.queryByRole('region', { name: 'Error detail' })).toBeNull()
  const row = view.getByRole('button', { name: 'TypeError' }).closest('tr')
  if (!row) throw new Error('Missing error row')
  fireEvent.keyDown(row, { key: 'Enter' })
  expect(view.getByRole('region', { name: 'Error detail' })).toBeTruthy()
  fireEvent.click(view.getByRole('button', { name: 'Close' }))
  fireEvent.keyDown(row, { key: ' ' })
  expect(row.getAttribute('aria-expanded')).toBe('true')
  fireEvent.click(view.getByRole('button', { name: 'Show as table' }))
  expect(
    view.getByRole('table', { name: 'Daily error counts' }).textContent,
  ).toContain('3')
  expect(
    view.getByRole('img', { name: 'Daily error count' }).querySelector('path'),
  ).toBeTruthy()
  fireEvent.focus(view.getByRole('button', { name: '14 Nov 2026: 3 errors' }))
  expect(view.getByRole('status').textContent).toBe('14 Nov 2026: 3 errors')
  client.clear()
})

it('uses the chosen period for the query and the quiet empty state', async () => {
  const paths: string[] = []
  globalThis.fetch = Object.assign(
    async (input: unknown) => {
      paths.push(String(input))
      return Response.json({ groups: [], daily: [] })
    },
    { preconnect: original.preconnect },
  )
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(['current-user'], {
    isStaff: true,
    twoFactorEnabled: true,
  })
  const root = createRootRoute()
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({
        getParentRoute: () => root,
        path: '/staff/errors',
        validateSearch: validateStaffErrorsSearch,
        component: StaffErrorsRouteView,
      }),
    ]),
    history: createMemoryHistory({ initialEntries: ['/staff/errors'] }),
  })
  const view = render(
    <QueryClientProvider client={client}>
      <Suspense fallback="Loading">
        <RouterProvider router={router} />
      </Suspense>
    </QueryClientProvider>,
  )
  await view.findByText('No errors in the last 30 days.')
  fireEvent.click(view.getByRole('button', { name: '7 days' }))
  await view.findByText('No errors in the last 7 days.')
  expect(router.state.location.searchStr).toBe('?days=7')
  expect(paths.some((path) => path.endsWith('days=7'))).toBe(true)
  client.clear()
})
