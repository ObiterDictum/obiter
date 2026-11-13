import '@obiter/test-dom'
import { afterEach, expect, it, mock, spyOn } from 'bun:test'
import { Suspense } from 'react'
import { cleanup, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { ToastProvider } from '@obiter/ui'
import { StaffOverviewRouteView } from './staff-overview'

const overview = {
  accessReview: {
    waiting: 3,
    oldestWaitingAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  },
  feedback: { unread: 2 },
  accounts: { last7Days: 4, last30Days: 9 },
  organisations: { last7Days: 1, last30Days: 3 },
  activeUsers: { today: 5, last7Days: 12, last30Days: 40 },
}

function staffUser(isStaff: boolean) {
  return {
    isStaff,
    twoFactorEnabled: isStaff,
    user: {
      id: 'synthetic',
      name: 'Synthetic reviewer',
      email: 'staff@synthetic.test',
      role: 'member',
    },
    organisation: null,
  }
}

function renderOverview(isStaff: boolean) {
  spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      async (input: Parameters<typeof fetch>[0]) => {
        const path = String(input)
        const body = path.endsWith('/api/staff/overview')
          ? overview
          : { error: { code: 'not_found', message: 'missing' } }
        return new Response(JSON.stringify(body), {
          status: path.endsWith('/api/staff/overview') ? 200 : 404,
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
  const page = (path: string, component: () => React.ReactNode) =>
    createRoute({ getParentRoute: () => rootRoute, path, component })
  const stub = () => <p>Stub</p>
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      page('/staff', StaffOverviewRouteView),
      page('/staff/access', stub),
      page('/staff/usage', stub),
      page('/staff/feedback', stub),
    ]),
    history: createMemoryHistory({ initialEntries: ['/staff'] }),
  })
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <Suspense fallback={<p>Loading…</p>}>
          <RouterProvider router={router} />
        </Suspense>
      </ToastProvider>
    </QueryClientProvider>,
  )
  return client
}

afterEach(() => {
  cleanup()
  mock.restore()
})

it('shows each overview figure and links it to its staff screen', async () => {
  const client = renderOverview(true)
  const access = await screen.findByRole('link', { name: /Access review/ })
  expect(within(access).getByText('3')).toBeTruthy()
  expect(within(access).getByText(/Oldest wait 2 hours ago/)).toBeTruthy()
  const feedback = screen.getByRole('link', { name: /Feedback/ })
  expect(within(feedback).getByText('2')).toBeTruthy()
  const cards = screen.getAllByRole('link')
  const usageCards = cards.filter((link) =>
    /New accounts|New organisations|Active users/.test(link.textContent ?? ''),
  )
  expect(usageCards).toHaveLength(3)
  for (const link of usageCards) {
    expect(link.getAttribute('href')).toContain('/staff/usage')
  }
  expect(access.getAttribute('href')).toContain('/staff/access')
  expect(feedback.getAttribute('href')).toContain('/staff/feedback')
  expect(within(usageCards[0]).getByText('9')).toBeTruthy()
  client.clear()
})

it('shows the shell not-found page to a user who is not staff', async () => {
  const client = renderOverview(false)
  expect(await screen.findByText('We cannot find that page')).toBeTruthy()
  client.clear()
})
