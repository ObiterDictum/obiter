import '@obiter/test-dom'
import { spyOn } from 'bun:test'
import { Suspense } from 'react'
import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { ToastProvider } from '@obiter/ui'
import { StaffUsageRouteView } from './staff-usage'
import { validateStaffUsageSearch } from '../staff'

const counts = {
  activeUsers: 10,
  newAccounts: 2,
  documentsOpened: 30,
  documentsSaved: 20,
  mattersCreated: 4,
  redactionRuns: 1,
  verificationRuns: 3,
  agentRuns: 0,
  sourcesSaved: 5,
}

export const usage = {
  windowWeeks: 12,
  weeks: [
    { weekStart: '2026-01-05', ...counts, activeUsers: 10, newAccounts: 2 },
    { weekStart: '2026-01-12', ...counts, activeUsers: 14, newAccounts: 3 },
    { weekStart: '2026-01-19', ...counts, activeUsers: 12, newAccounts: 1 },
  ],
  organisations: [
    {
      organisationId: 'org_beta',
      name: 'Beta Org',
      memberCount: 5,
      ...counts,
      activeUsers: 4,
      verificationRuns: 2,
    },
    {
      organisationId: 'org_alpha',
      name: 'Alpha Org',
      memberCount: 8,
      ...counts,
      activeUsers: 20,
      verificationRuns: 7,
    },
    {
      organisationId: 'zz_alpha_dup',
      name: 'Alpha Org',
      memberCount: 6,
      ...counts,
      activeUsers: 1,
      verificationRuns: 9,
    },
  ],
  retention: [
    {
      cohortWeek: '2026-01-05',
      cohortSize: 4,
      weekStart: '2026-01-05',
      activeUsers: 4,
    },
    {
      cohortWeek: '2026-01-05',
      cohortSize: 4,
      weekStart: '2026-01-12',
      activeUsers: 2,
    },
    {
      cohortWeek: '2026-01-12',
      cohortSize: 3,
      weekStart: '2026-01-12',
      activeUsers: 3,
    },
  ],
}

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

export function renderUsage(isStaff: boolean, entry = '/staff/usage') {
  const requested: string[] = []
  spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      async (input: Parameters<typeof fetch>[0]) => {
        const path = String(input)
        requested.push(path)
        const body = path.includes('/api/staff/usage') ? usage : {}
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
  client.setQueryData(['current-user'], staffUser(isStaff))
  const rootRoute = createRootRoute()
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      createRoute({
        getParentRoute: () => rootRoute,
        path: '/staff/usage',
        validateSearch: validateStaffUsageSearch,
        component: StaffUsageRouteView,
      }),
    ]),
    history: createMemoryHistory({ initialEntries: [entry] }),
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
  return { client, requested }
}

export function tableWithHeaders(names: string[]) {
  const table = screen
    .getAllByRole('table')
    .find((candidate) =>
      names.every((name) =>
        within(candidate).queryByRole('columnheader', { name }),
      ),
    )
  if (!table) throw new Error(`no table with headers: ${names.join(', ')}`)
  return table
}

export function section(name: string) {
  return screen.getByRole('region', { name })
}
