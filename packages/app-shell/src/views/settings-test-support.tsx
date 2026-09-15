import { fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { vi } from 'vitest'
import type { MeResponse } from '@obiter/contracts'
import { SettingsRouteView } from './settings'

/**
 * Fixtures and render helpers shared by the Settings suites. Not collected as a
 * test: vitest's default include matches `*.test.*`, and this file is
 * `settings-test-support.tsx`. The `vi.mock` registrations stay in each test
 * file, because a mock belongs to the module graph of the file that declares
 * it, not to a helper it imports.
 */

export const ORGLESS_ME: MeResponse = {
  user: {
    id: 'usr_2',
    email: 'new@obiter.dev',
    name: 'New User',
    role: null,
  },
  organisation: null,
}

export const OWNER_ME: MeResponse = {
  user: {
    id: 'usr_1',
    email: 'owner@obiter.dev',
    name: 'Imogen Hartley',
    role: 'owner',
  },
  organisation: {
    id: 'org_1',
    name: 'Ashcombe Chambers',
    plan: 'private_beta',
  },
}

export const MEMBER_ME: MeResponse = {
  user: {
    id: 'usr_3',
    email: 'member@obiter.dev',
    name: 'Callum Whitfield',
    role: 'member',
  },
  organisation: {
    id: 'org_1',
    name: 'Ashcombe Chambers',
    plan: 'private_beta',
  },
}

export function idleMutation() {
  return { mutateAsync: vi.fn(), isPending: false, isError: false }
}

export function renderSettings() {
  const rootRoute = createRootRoute()
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <SettingsRouteView />,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

/** The value of a read-only field, by its label: <dt>label</dt><dd>value</dd>. */
export function readOnlyValue(scope: HTMLElement, label: string) {
  return within(scope).getByText(label).nextElementSibling?.textContent
}

export async function openSection(
  name: 'Account' | 'Security' | 'Organisation',
) {
  fireEvent.click(await screen.findByRole('button', { name }))
  return screen.findByRole('region', { name })
}
