import '@obiter/test-dom'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { vi } from '../../../scripts/test/vitest-compat'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, waitFor } from '@testing-library/react'

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }))
const session = vi.hoisted(() => ({ signedIn: false }))

const apiModule = { ...(await import('./api')) }
mock.module('./api', () => ({ ...apiModule, apiFetch: api.apiFetch }))

const authModule = { ...(await import('./auth')) }
mock.module('./auth', () => ({
  ...authModule,
  useSignedIn: () => session.signedIn,
}))

const { useMattersList } = await import('./matters')
const { useCitationTargets } = await import('./documents')

function Probe() {
  useMattersList()
  useCitationTargets()
  return null
}

function renderProbe() {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <Probe />
    </QueryClientProvider>,
  )
}

function requestedPaths(): string[] {
  return api.apiFetch.mock.calls.map((call) => String(call[0]))
}

beforeEach(() => {
  vi.clearAllMocks()
  api.apiFetch.mockImplementation(async (path: string) =>
    path === '/api/matters' ? { matters: [] } : { documents: [] },
  )
})

afterEach(() => {
  cleanup()
})

describe('session-gated shell queries', () => {
  it('requests neither matters nor citation targets without a session', async () => {
    session.signedIn = false
    renderProbe()

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(api.apiFetch).not.toHaveBeenCalled()
  })

  it('requests matters and citation targets once signed in', async () => {
    session.signedIn = true
    renderProbe()

    await waitFor(() => {
      expect(requestedPaths()).toEqual(
        expect.arrayContaining([
          '/api/matters',
          '/api/documents/citation-targets',
        ]),
      )
    })
  })
})
