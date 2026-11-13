import '@obiter/test-dom'
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { vi } from '../../../scripts/test/vitest-compat'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { ToastProvider } from '@obiter/ui'
import type { AppPlatform, MeResponse } from '@obiter/contracts'
import type { MatterRecord } from './matters'
import type { MatterDocumentRecord } from './documents'

const mocks = vi.hoisted(() => ({
  matters: [] as MatterRecord[],
  documents: [] as MatterDocumentRecord[],
}))

const me: MeResponse = {
  user: {
    id: 'usr_1',
    email: 'alex.morgan@example.com',
    name: 'Alex Morgan',
    role: 'owner',
  },
  organisation: {
    id: 'org_1',
    name: 'Harrington Vale LLP',
    plan: 'private_beta',
  },
}

const authModule = { ...(await import('./auth')) }
mock.module('./auth', () => ({
  ...authModule,
  useAuth: () => ({ session: { user: { id: 'usr_1' } }, isPending: false }),
}))

const currentUserModule = { ...(await import('./current-user')) }
mock.module('./current-user', () => ({
  ...currentUserModule,
  currentUserQueryOptions: () => ({
    queryKey: ['current-user'],
    queryFn: async () => me,
    staleTime: Infinity,
  }),
  useCurrentUser: () => ({ data: me }),
}))

const mattersModule = { ...(await import('./matters')) }
mock.module('./matters', () => ({
  ...mattersModule,
  useMattersList: () => ({ data: mocks.matters }),
  useMatter: () => ({ data: mocks.matters[0], isPending: false }),
}))

const documentsModule = { ...(await import('./documents')) }
mock.module('./documents', () => ({
  ...documentsModule,
  useMatterDocuments: () => ({ data: mocks.documents, isPending: false }),
  useCitationTargets: () => ({ data: [] }),
  useRecentlyOpenedDocument: () => ({ data: null }),
}))

const redactionModule = { ...(await import('./redaction-runs')) }
mock.module('./redaction-runs', () => ({
  ...redactionModule,
  useRedactionRunsList: () => ({ data: { runs: [] }, isPending: false }),
}))

const verificationModule = { ...(await import('./verification-runs')) }
mock.module('./verification-runs', () => ({
  ...verificationModule,
  useOrganisationVerificationRuns: () => ({
    runs: [],
    isPending: false,
    isError: false,
  }),
}))

const { ShellFrame } = await import('./frame')

function renderShell(path: string, platform: AppPlatform) {
  const rootRoute = createRootRoute()
  const page = () => (
    <ShellFrame platform={platform}>
      <p>page</p>
    </ShellFrame>
  )
  const paths = [
    '/',
    '/matters',
    '/matters/$matterId',
    '/verify',
    '/redact',
    '/search',
    '/settings',
  ]
  const router = createRouter({
    routeTree: rootRoute.addChildren(
      paths.map((routePath) =>
        createRoute({
          getParentRoute: () => rootRoute,
          path: routePath,
          component: page,
        }),
      ),
    ),
    history: createMemoryHistory({ initialEntries: [path] }),
    context: { queryClient: new QueryClient() },
  })
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

function titleBar(): HTMLElement {
  const header = document.querySelector('header')
  if (!header) throw new Error('the shell rendered no title bar')
  return header
}

function uncoveredControls(header: HTMLElement): Element[] {
  return Array.from(header.querySelectorAll('a, button')).filter(
    (control) => control.closest('.app-no-drag') === null,
  )
}

function stubDesktopOs(osPlatform: string) {
  Object.defineProperty(window, 'obiterDesktop', {
    value: { osPlatform, onUpdateReady: () => () => {} },
    configurable: true,
  })
}

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  mocks.matters = []
  mocks.documents = []
  delete (window as Window & { obiterDesktop?: unknown }).obiterDesktop
})

for (const layout of ['tabs', 'clean'] as const) {
  describe(`desktop title bar in ${layout} layout`, () => {
    function renderLayout() {
      window.localStorage.setItem('obiter.layout', layout)
      renderShell('/', 'desktop')
    }

    it('makes the title bar row a window drag region', async () => {
      renderLayout()
      await screen.findByRole('button', { name: 'Search Obiter' })
      expect(titleBar().className).toContain('app-drag')
    })

    it('keeps every title bar control clickable outside the drag region', async () => {
      renderLayout()
      await screen.findByRole('button', { name: 'Search Obiter' })
      if (layout === 'tabs') {
        await screen.findByRole('button', { name: 'Account menu' })
      }
      expect(uncoveredControls(titleBar())).toEqual([])
    })

    it('clears the macOS traffic lights when no sidebar holds the top-left', async () => {
      stubDesktopOs('darwin')
      renderLayout()
      await screen.findByRole('button', { name: 'Search Obiter' })
      expect(titleBar().className).toContain('pl-20')
    })

    it('keeps the default padding beside the traffic lights on Windows', async () => {
      stubDesktopOs('win32')
      renderLayout()
      await screen.findByRole('button', { name: 'Search Obiter' })
      expect(titleBar().className).not.toContain('pl-20')
    })
  })
}

describe('desktop title bar drag regions', () => {
  it('leaves the traffic lights to the sidebar in sidebar layout on macOS', async () => {
    stubDesktopOs('darwin')
    renderShell('/', 'desktop')
    await screen.findByRole('navigation', { name: 'Workspace' })
    expect(titleBar().className).not.toContain('pl-20')
    expect(titleBar().className).toContain('app-drag')
  })

  it('clears the macOS traffic lights in focus mode, where no sidebar is shown', async () => {
    stubDesktopOs('darwin')
    renderShell('/', 'desktop')
    await screen.findByRole('navigation', { name: 'Workspace' })
    fireEvent.keyDown(window, { key: '.', metaKey: true })
    await screen.findByRole('button', { name: 'Leave focus mode' })
    expect(screen.queryByRole('navigation', { name: 'Workspace' })).toBeNull()
    expect(titleBar().className).toContain('pl-20')
  })

  it('renders no drag region or traffic-light padding in the web build', async () => {
    stubDesktopOs('darwin')
    window.localStorage.setItem('obiter.layout', 'tabs')
    renderShell('/', 'web')
    await screen.findByRole('button', { name: 'Search Obiter' })
    expect(titleBar().className).not.toContain('app-drag')
    expect(titleBar().className).not.toContain('pl-20')
  })

  it('keeps the clean menu popup outside the title bar drag region', async () => {
    window.localStorage.setItem('obiter.layout', 'clean')
    renderShell('/', 'desktop')
    const mark = await screen.findByRole('button', {
      name: 'Open Obiter menu',
    })
    fireEvent.click(mark)
    const dialog = await screen.findByRole('dialog', { name: 'Obiter menu' })
    expect(titleBar().contains(dialog)).toBe(false)
    expect(dialog.closest('.app-drag')).toBeNull()
  })
})
