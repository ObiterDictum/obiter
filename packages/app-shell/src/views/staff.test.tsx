import '@obiter/test-dom'
import { afterEach, expect, it, mock, spyOn } from 'bun:test'
import { Suspense } from 'react'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { ToastProvider } from '@obiter/ui'
import { StaffRouteView } from './staff'

const group = {
  domain: 'synthetic.test',
  organisationNames: ['Synthetic Legal'],
  count: 1,
  categories: ['legal_professional'],
  countries: ['scotland'],
  oldestCreatedAt: '2026-11-01T10:00:00Z',
  requests: [
    {
      id: 'ar_synthetic',
      name: 'Synthetic applicant',
      email: 'applicant@synthetic.test',
      category: 'legal_professional',
      createdAt: '2026-11-01T10:00:00Z',
    },
  ],
}
afterEach(() => {
  cleanup()
  mock.restore()
})
for (const [label, target, decision] of [
  ['Approve organisation', 'domain', 'approve'],
  ['Decline', 'domain', 'decline'],
  ['Approve only this person', 'person', 'approve'],
  ['Decline', 'person', 'decline'],
] as const) {
  it(`confirms ${decision} for a ${target} and refreshes the queue`, async () => {
    const requests: unknown[] = []
    let queueReads = 0
    spyOn(globalThis, 'fetch').mockImplementation(
      Object.assign(
        async (
          input: Parameters<typeof fetch>[0],
          init?: Parameters<typeof fetch>[1],
        ) => {
          const path = String(input)
          let body: unknown = {}
          if (init?.method === 'POST') {
            requests.push(JSON.parse(String(init.body)))
            body = { count: 1 }
          } else if (path.endsWith('/api/staff/access')) {
            queueReads++
            body = { groups: queueReads === 1 ? [group] : [] }
          } else if (path.endsWith('/decisions')) body = { decisions: [] }
          else if (path.endsWith('/organisations')) body = { organisations: [] }
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
      isStaff: true,
      twoFactorEnabled: true,
      user: {
        id: 'synthetic',
        name: 'Synthetic reviewer',
        email: 'staff@synthetic.test',
        role: 'member',
      },
      organisation: null,
    })
    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <Suspense fallback={<p>Loading review…</p>}>
            <StaffRouteView />
          </Suspense>
        </ToastProvider>
      </QueryClientProvider>,
    )
    expect(await screen.findByText('Synthetic Legal')).toBeTruthy()
    const buttons = screen.getAllByRole('button', { name: label })
    fireEvent.click(
      buttons[target === 'person' && decision === 'decline' ? 1 : 0],
    )
    const confirmation =
      decision === 'approve' ? 'Confirm approval' : 'Confirm decline'
    expect(await screen.findByRole('dialog')).toBeTruthy()
    expect(requests).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: confirmation }))
    await waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0]).toEqual({
      target:
        target === 'domain'
          ? { kind: target, domain: group.domain }
          : { kind: target, requestId: 'ar_synthetic' },
      decision,
    })
    expect(
      await screen.findByText('No requests are waiting for review.'),
    ).toBeTruthy()
    expect(queueReads).toBeGreaterThan(1)
    client.clear()
  })
}

function renderStaff(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <Suspense fallback={<p>Loading review…</p>}>
          <StaffRouteView />
        </Suspense>
      </ToastProvider>
    </QueryClientProvider>,
  )
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

it('shows the shell not-found page to a user who is not staff', async () => {
  spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      async () =>
        new Response(JSON.stringify({ groups: [] }), {
          headers: { 'content-type': 'application/json' },
        }),
      { preconnect: fetch.preconnect },
    ),
  )
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(['current-user'], staffUser(false))
  const rootRoute = createRootRoute()
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: StaffRouteView,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>,
  )
  expect(await screen.findByText('We cannot find that page')).toBeTruthy()
  client.clear()
})

it('lists past decisions in a table only once the Decisions view opens', async () => {
  const paths: string[] = []
  spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      async (input: Parameters<typeof fetch>[0]) => {
        const path = String(input)
        paths.push(path)
        const body = path.endsWith('/decisions')
          ? {
              decisions: [
                {
                  id: 'sd_1',
                  targetKind: 'domain',
                  target: 'synthetic.test',
                  decision: 'approve',
                  staffName: 'Synthetic reviewer',
                  createdAt: '2026-11-02T10:00:00Z',
                },
              ],
            }
          : path.endsWith('/organisations')
            ? { organisations: [] }
            : { groups: [], decisions: [] }
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
  client.setQueryData(['current-user'], staffUser(true))
  renderStaff(client)
  expect(
    await screen.findByText('No requests are waiting for review.'),
  ).toBeTruthy()
  expect(paths.some((path) => path.endsWith('/decisions'))).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'Decisions' }))
  expect(
    await screen.findByRole('cell', { name: /Domain: synthetic\.test/ }),
  ).toBeTruthy()
  expect(screen.getByRole('columnheader', { name: 'Target' })).toBeTruthy()
  expect(screen.getByRole('columnheader', { name: 'When' })).toBeTruthy()
  client.clear()
})
