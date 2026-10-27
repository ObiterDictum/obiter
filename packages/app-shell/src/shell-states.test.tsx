import '@obiter/test-dom'
import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ApiErrorCode } from '@obiter/contracts'
import { ApiError } from './api'
import {
  ShellError,
  ShellNotFound,
  ShellOfflineBanner,
  ShellPermissionDenied,
  classifyShellFailure,
} from './shell-states'

function apiError(code: ApiErrorCode) {
  return new ApiError(code, 'failed', 400, 'req_test')
}

function renderAt(path: string, element: () => React.ReactNode) {
  const rootRoute = createRootRoute()
  const route = createRoute({
    getParentRoute: () => rootRoute,
    path: path === '/' ? '/' : `${path}/$`,
    component: element,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([route]),
    history: createMemoryHistory({ initialEntries: [path] }),
    context: { queryClient: new QueryClient() },
  })
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

afterEach(cleanup)

describe('classifyShellFailure', () => {
  it('treats a permission refusal as its own state, not an error to retry', () => {
    expect(classifyShellFailure(apiError('forbidden'))).toBe('forbidden')
    expect(classifyShellFailure(apiError('no_organisation'))).toBe('forbidden')
  })

  it('treats a missing record as not found', () => {
    expect(classifyShellFailure(apiError('matter_not_found'))).toBe('not-found')
    expect(classifyShellFailure(apiError('document_not_found'))).toBe(
      'not-found',
    )
    expect(classifyShellFailure(apiError('redaction_run_not_found'))).toBe(
      'not-found',
    )
  })

  it('treats an outage and anything unclassified as a retryable error', () => {
    expect(classifyShellFailure(apiError('storage_unavailable'))).toBe('error')
    expect(classifyShellFailure(new Error('boom'))).toBe('error')
    expect(classifyShellFailure('not even an error')).toBe('error')
  })
})

describe('ShellError', () => {
  it('offers a retry for an outage', async () => {
    renderAt('/', () => (
      <ShellError error={apiError('storage_unavailable')} reset={() => {}} />
    ))
    await screen.findByRole('heading', { name: 'This page did not load' })
    expect(screen.getByRole('button', { name: /Try again/ })).toBeTruthy()
  })

  it('never says "something went wrong" for a refused permission', async () => {
    renderAt('/', () => <ShellError error={apiError('forbidden')} />)
    await screen.findByRole('heading', {
      name: 'You do not have access to this page',
    })
    expect(screen.queryByText(/Something went wrong/i)).toBeNull()
  })

  it('renders the not-found state for a missing matter', async () => {
    renderAt('/', () => <ShellError error={apiError('matter_not_found')} />)
    await screen.findByRole('heading', { name: 'We cannot find that page' })
  })
})

describe('ShellOfflineBanner', () => {
  it('stays out of the way while the connection is up', async () => {
    renderAt('/', () => <ShellOfflineBanner />)
    await waitFor(() => expect(document.body.textContent).toBe(''))
  })

  it('claims only what is true offline: reading already-loaded pages', async () => {
    const original = window.navigator.onLine
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      get: () => false,
    })
    renderAt('/', () => <ShellOfflineBanner />)
    await screen.findByText('You are offline')
    expect(screen.getByRole('status').textContent).toContain(
      'saving, uploads and search will fail',
    )
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      get: () => original,
    })
  })
})

describe('shell state pages', () => {
  it('offers real destinations from the not-found page', async () => {
    renderAt('/', () => <ShellNotFound />)
    await screen.findByRole('heading', { name: 'We cannot find that page' })
    expect(screen.getByRole('link', { name: 'Go to Home' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open your matters' })).toBeTruthy()
  })

  it('offers a way back from the permission-denied page', async () => {
    renderAt('/', () => <ShellPermissionDenied />)
    await screen.findByRole('heading', {
      name: 'You do not have access to this page',
    })
    expect(screen.getByRole('link', { name: 'Back to matters' })).toBeTruthy()
  })
})
