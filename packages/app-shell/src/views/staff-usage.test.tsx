import '@obiter/test-dom'
import { afterEach, expect, it, mock, spyOn } from 'bun:test'
import { Suspense } from 'react'
import {
  cleanup,
  fireEvent,
  render,
  screen,
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

const usage = {
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
    },
    {
      organisationId: 'org_alpha',
      name: 'Alpha Org',
      memberCount: 8,
      ...counts,
      activeUsers: 20,
    },
    {
      organisationId: 'zz_alpha_dup',
      name: 'Alpha Org',
      memberCount: 6,
      ...counts,
      activeUsers: 1,
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

function renderUsage(isStaff: boolean, entry = '/staff/usage') {
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

afterEach(() => {
  cleanup()
  mock.restore()
})

function tableWithHeaders(names: string[]) {
  const table = screen
    .getAllByRole('table')
    .find((candidate) =>
      names.every((name) =>
        within(candidate).queryByRole('columnheader', { name }),
      ),
    )
  expect(table).toBeTruthy()
  return table as HTMLElement
}

it('renders the weekly chart, counts, organisations and retention for staff', async () => {
  const { client, requested } = renderUsage(true)
  expect(
    await screen.findByRole('img', {
      name: /Line chart of active users and new accounts/,
    }),
  ).toBeTruthy()
  expect(screen.getByText(/Obiter staff organisation is excluded/)).toBeTruthy()
  const weekly = tableWithHeaders(['Week', 'Agent'])
  expect(
    within(weekly).getByRole('columnheader', { name: 'Verify' }),
  ).toBeTruthy()
  const orgTable = tableWithHeaders(['Organisation', 'Members'])
  const bodyRows = within(orgTable).getAllByRole('row').slice(1)
  expect(within(bodyRows[0]).getByText('Alpha Org')).toBeTruthy()
  expect(bodyRows[0].textContent).toContain('org_al')
  expect(within(bodyRows[1]).getByText('Beta Org')).toBeTruthy()
  expect(within(bodyRows[2]).getByText('Alpha Org')).toBeTruthy()
  expect(bodyRows[2].textContent).toContain('zz_alp')
  expect(requested.some((path) => path.includes('weeks=12'))).toBe(true)
  const retention = tableWithHeaders(['Signup week', 'Week 0'])
  const firstCohort = within(retention).getByRole('cell', {
    name: 'Week 0: 100 percent, 4 of 4 active',
  })
  expect(within(firstCohort).getByText('100%')).toBeTruthy()
  expect(within(firstCohort).getByText('4')).toBeTruthy()
  const secondCell = within(retention).getByRole('cell', {
    name: 'Week 1: 50 percent, 2 of 4 active',
  })
  expect(within(secondCell).getByText('50%')).toBeTruthy()
  expect(within(secondCell).getByText('2')).toBeTruthy()
  const newestCohortCell = within(retention).getByRole('cell', {
    name: 'Week 0: 100 percent, 3 of 3 active',
  })
  expect(within(newestCohortCell).getByText('3')).toBeTruthy()
  const cohortRows = within(retention).getAllByRole('row').slice(1)
  const newestCohort = within(cohortRows[1]).getAllByRole('cell')
  expect(newestCohort[newestCohort.length - 1].textContent).toBe('')
  client.clear()
})

it('reads the weeks window from the url and ignores unsupported values', async () => {
  const first = renderUsage(true, '/staff/usage?weeks=4')
  await screen.findByRole('img', {
    name: /Line chart of active users and new accounts/,
  })
  expect(first.requested.some((path) => path.includes('weeks=4'))).toBe(true)
  first.client.clear()
  cleanup()
  const second = renderUsage(true, '/staff/usage?weeks=7')
  await screen.findByRole('img', {
    name: /Line chart of active users and new accounts/,
  })
  expect(second.requested.some((path) => path.includes('weeks=7'))).toBe(false)
  expect(second.requested.some((path) => path.includes('weeks=12'))).toBe(true)
  second.client.clear()
})

it('marks the sorted organisation column with aria-sort', async () => {
  const { client } = renderUsage(true)
  await screen.findByRole('img', {
    name: /Line chart of active users and new accounts/,
  })
  const orgTable = tableWithHeaders(['Organisation', 'Members'])
  const activeHeader = within(orgTable).getByRole('columnheader', {
    name: 'Active',
  })
  expect(activeHeader.getAttribute('aria-sort')).toBe('descending')
  fireEvent.click(within(orgTable).getByRole('button', { name: 'Members' }))
  const membersHeader = within(orgTable).getByRole('columnheader', {
    name: /Members/,
  })
  expect(membersHeader.getAttribute('aria-sort')).toBe('descending')
  const bodyRows = within(orgTable).getAllByRole('row').slice(1)
  expect(within(bodyRows[0]).getByText('Alpha Org')).toBeTruthy()
  fireEvent.click(within(orgTable).getByRole('button', { name: 'Members' }))
  expect(membersHeader.getAttribute('aria-sort')).toBe('ascending')
  const sortedRows = within(orgTable).getAllByRole('row').slice(1)
  expect(within(sortedRows[0]).getByText('Beta Org')).toBeTruthy()
  client.clear()
})

it('shows the shell not-found page to a user who is not staff', async () => {
  const { client } = renderUsage(false)
  expect(await screen.findByText('We cannot find that page')).toBeTruthy()
  client.clear()
})
