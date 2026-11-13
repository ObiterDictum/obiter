import '@obiter/test-dom'
import { afterEach, expect, it, mock, spyOn } from 'bun:test'
import { Suspense } from 'react'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { ToastProvider, Toaster } from '@obiter/ui'
import { StaffFeedbackRouteView } from './staff-feedback'
import { validateStaffFeedbackSearch } from '../staff'

const items = [
  {
    id: 'fb_open',
    kind: 'problem',
    message: 'Synthetic problem report',
    senderName: 'Sam Sender',
    senderEmail: 'sam@synthetic.test',
    organisationName: 'Synthetic Org',
    path: '/matters',
    appVersion: '1.2.3',
    platform: 'web',
    createdAt: '2026-11-05T10:00:00Z',
    handledAt: null,
    handledByName: null,
  },
  {
    id: 'fb_done',
    kind: 'idea',
    message: 'Synthetic idea report',
    senderName: 'Ida Ideas',
    senderEmail: 'ida@synthetic.test',
    organisationName: 'Other Org',
    path: null,
    appVersion: null,
    platform: 'desktop',
    createdAt: '2026-11-04T10:00:00Z',
    handledAt: '2026-11-04T12:00:00Z',
    handledByName: 'Staff Person',
  },
]

function staffUser(isStaff: boolean) {
  return {
    isStaff,
    user: {
      id: 'synthetic',
      name: 'Synthetic reviewer',
      email: 'staff@synthetic.test',
      role: 'member',
    },
    organisation: null,
  }
}

interface FetchLog {
  paths: string[]
  posts: { path: string; body: unknown }[]
  failPosts: boolean
}

function renderFeedback(
  isStaff: boolean,
  entry = '/staff/feedback',
): { client: QueryClient; log: FetchLog } {
  const log: FetchLog = { paths: [], posts: [], failPosts: false }
  const handledState = new Map<string, string | null>()
  spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      async (
        input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
      ) => {
        const path = String(input)
        log.paths.push(path)
        if (init?.method === 'POST') {
          const body = JSON.parse(String(init.body)) as { handled: boolean }
          log.posts.push({ path, body })
          if (log.failPosts) {
            return new Response('{}', { status: 500 })
          }
          const id = path.split('/api/staff/feedback/')[1]?.split('/')[0]
          if (id) {
            handledState.set(id, body.handled ? '2026-11-05T11:00:00Z' : null)
          }
          return new Response(
            JSON.stringify({ handledAt: '2026-11-05T11:00:00Z' }),
            { headers: { 'content-type': 'application/json' } },
          )
        }
        const url = new URL(path, 'http://localhost')
        const status = url.searchParams.get('status') ?? 'open'
        const kind = url.searchParams.get('kind')
        const feedback = items
          .map((item) => {
            const handledAt = handledState.has(item.id)
              ? handledState.get(item.id)
              : item.handledAt
            const handledByName =
              handledAt === null
                ? null
                : (item.handledByName ?? 'Synthetic reviewer')
            return { ...item, handledAt, handledByName }
          })
          .filter(
            (item) =>
              (status === 'all' ||
                (status === 'handled') === Boolean(item.handledAt)) &&
              (!kind || item.kind === kind),
          )
        return new Response(JSON.stringify({ feedback }), {
          headers: { 'content-type': 'application/json' },
        })
      },
      { preconnect: fetch.preconnect },
    ),
  )
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(['current-user'], staffUser(isStaff))
  const rootRoute = createRootRoute()
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      createRoute({
        getParentRoute: () => rootRoute,
        path: '/staff/feedback',
        validateSearch: validateStaffFeedbackSearch,
        component: StaffFeedbackRouteView,
      }),
    ]),
    history: createMemoryHistory({ initialEntries: [entry] }),
  })
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <Toaster />
        <Suspense fallback={<p>Loading…</p>}>
          <RouterProvider router={router} />
        </Suspense>
      </ToastProvider>
    </QueryClientProvider>,
  )
  return { client, log }
}

afterEach(() => {
  cleanup()
  mock.restore()
})

it('lists open feedback newest first with sender and app details', async () => {
  const { client } = renderFeedback(true)
  expect(await screen.findByText('Synthetic problem report')).toBeTruthy()
  expect(screen.queryByText('Synthetic idea report')).toBeNull()
  const item = screen.getByText('Synthetic problem report').closest('li')
  expect(item).toBeTruthy()
  const scope = within(item as HTMLElement)
  expect(scope.getByText(/Sam Sender · sam@synthetic\.test/)).toBeTruthy()
  expect(
    scope.getByText(/Synthetic Org · \/matters · 1\.2\.3 · web/),
  ).toBeTruthy()
  client.clear()
})

it('shows handled items with who handled them and when', async () => {
  const { client } = renderFeedback(true, '/staff/feedback?status=handled')
  expect(await screen.findByText('Synthetic idea report')).toBeTruthy()
  expect(screen.queryByText('Synthetic problem report')).toBeNull()
  expect(screen.getByText(/Handled by Staff Person/)).toBeTruthy()
  client.clear()
})

it('filters the inbox by kind and status through the url', async () => {
  const { client, log } = renderFeedback(true)
  await screen.findByText('Synthetic problem report')
  fireEvent.click(screen.getByRole('button', { name: 'Idea' }))
  await waitFor(() =>
    expect(log.paths.some((path) => path.includes('kind=idea'))).toBe(true),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Handled' }))
  await waitFor(() =>
    expect(
      log.paths.some(
        (path) => path.includes('status=handled') && path.includes('kind=idea'),
      ),
    ).toBe(true),
  )
  client.clear()
})

it('marks an item handled and removes it from the open inbox', async () => {
  const { client, log } = renderFeedback(true)
  await screen.findByText('Synthetic problem report')
  fireEvent.click(screen.getByRole('button', { name: 'Mark handled' }))
  await waitFor(() => expect(log.posts).toHaveLength(1))
  expect(log.posts[0].path).toContain('/api/staff/feedback/fb_open/handled')
  expect(log.posts[0].body).toEqual({ handled: true })
  expect(await screen.findByText('Marked as handled')).toBeTruthy()
  await waitFor(() =>
    expect(screen.queryByText('Synthetic problem report')).toBeNull(),
  )
  expect(screen.getByText('No feedback to show.')).toBeTruthy()
  client.clear()
})

it('rolls back and warns when marking an item handled fails', async () => {
  const { client, log } = renderFeedback(true)
  log.failPosts = true
  await screen.findByText('Synthetic problem report')
  fireEvent.click(screen.getByRole('button', { name: 'Mark handled' }))
  await waitFor(() => expect(log.posts).toHaveLength(1))
  expect(await screen.findByText('Could not update feedback')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Mark handled' })).toBeTruthy()
  client.clear()
})

it('shows the shell not-found page to a user who is not staff', async () => {
  const { client } = renderFeedback(false)
  expect(await screen.findByText('We cannot find that page')).toBeTruthy()
  client.clear()
})
