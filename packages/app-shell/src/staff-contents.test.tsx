import '@obiter/test-dom'
import { afterEach, expect, it, mock, spyOn } from 'bun:test'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { ToastProvider } from '@obiter/ui'
import { Suspense } from 'react'
import { StaffContents } from './staff-contents'

const overview = {
  accessReview: { waiting: 3, oldestWaitingAt: null },
  feedback: { unread: 2 },
  accounts: { last7Days: 4, last30Days: 9 },
  organisations: { last7Days: 1, last30Days: 3 },
  activeUsers: { today: 5, last7Days: 12, last30Days: 40 },
}

function renderContents(isStaff: boolean, pathname: string) {
  spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      async (input: Parameters<typeof fetch>[0]) => {
        const path = String(input)
        const body = path.endsWith('/api/staff/overview') ? overview : {}
        return new Response(JSON.stringify(body), {
          headers: { 'content-type': 'application/json' },
        })
      },
      { preconnect: fetch.preconnect },
    ),
  )
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(['current-user'], {
    isStaff,
    user: {
      id: 'synthetic',
      name: 'Synthetic reviewer',
      email: 'staff@synthetic.test',
      role: 'member',
    },
    organisation: null,
  })
  const rootRoute = createRootRoute()
  const contents = () => <StaffContents pathname={pathname} />
  const router = createRouter({
    routeTree: rootRoute.addChildren(
      ['/', '/staff', '/staff/access', '/staff/usage', '/staff/feedback'].map(
        (path) =>
          createRoute({
            getParentRoute: () => rootRoute,
            path,
            component: contents,
          }),
      ),
    ),
    history: createMemoryHistory({ initialEntries: [pathname] }),
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

it('lists the four staff screens in order with their counts', async () => {
  const client = renderContents(true, '/staff/usage')
  const nav = await screen.findByRole('navigation', {
    name: 'Staff sections',
  })
  const links = screen.getAllByRole('link')
  expect(
    links.map((link) => link.textContent?.replace(/\d+$/, '').trim()),
  ).toEqual(['Overview', 'Access review', 'Usage', 'Feedback'])
  await waitFor(() => {
    expect(withinLink(links[1])).toContain('3')
    expect(withinLink(links[3])).toContain('2')
  })
  expect(links[2].getAttribute('aria-current')).toBe('page')
  expect(nav).toBeTruthy()
  client.clear()
})

function withinLink(link: HTMLElement) {
  return link.textContent ?? ''
}

it('renders nothing for a user who is not staff', async () => {
  const client = renderContents(false, '/staff')
  await screen
    .findByRole('navigation', { name: 'Staff sections' })
    .catch(() => null)
  expect(
    screen.queryByRole('navigation', { name: 'Staff sections' }),
  ).toBeNull()
  client.clear()
})
