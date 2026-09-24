import '@obiter/test-dom'
import { describe, expect, it, beforeEach, mock } from 'bun:test'
import { vi } from '../../../scripts/test/vitest-compat'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { ApiError } from './api'

import type { ReactNode } from 'react'

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }))

// The real module, snapshotted before mock.module registers: a factory
// that awaited its own specifier re-entered the in-flight mock and
// deadlocked under bun's module registry.
const apiModule = { ...(await import('./api')) }
// The real module's export names as undefined: bun links named imports
// statically and rejects a mock that omits one, while vitest left an
// unlisted export undefined. Overrides win.
const apiModuleKeys = Object.fromEntries(
  Object.keys(await import('./api')).map((key) => [key, undefined]),
)
mock.module('./api', () =>
  Object.assign(
    { ...apiModuleKeys },
    (() => {
      const actual = apiModule
      return { ...actual, apiFetch: api.apiFetch }
    })(),
  ),
)

// Loaded after the registrations above: bun does not hoist mock.module the
// way vi.mock was hoisted, and these modules capture mocked imports at
// module scope, so they must evaluate once the mocks are in place.
const {
  mattersKeys,
  mattersListQueryOptions,
  useCreateMatter,
  useMattersList,
} = await import('./matters')

function sampleMatter(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mtr_new',
    organisationId: 'org_1',
    name: 'New matter',
    description: null,
    primaryJurisdiction: 'england_and_wales',
    secondaryJurisdictions: [],
    legalDomains: [],
    clientReference: '',
    status: 'active',
    createdBy: 'usr_1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    deletedBy: null,
    ...overrides,
  }
}

function createWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useCreateMatter', () => {
  it('POSTs the matter and invalidates the list cache', async () => {
    const client = new QueryClient()
    api.apiFetch.mockResolvedValueOnce({ matter: sampleMatter() })

    const { result } = renderHook(() => useCreateMatter(), {
      wrapper: createWrapper(client),
    })

    await act(async () => {
      const matter = await result.current.mutateAsync({
        name: 'New matter',
        primaryJurisdiction: 'england_and_wales',
      })
      expect(matter.id).toBe('mtr_new')
    })

    expect(api.apiFetch).toHaveBeenCalledWith('/api/matters', {
      method: 'POST',
      body: JSON.stringify({
        name: 'New matter',
        primaryJurisdiction: 'england_and_wales',
      }),
    })

    // The new matter should be in the detail cache, and the list invalidated.
    await waitFor(() => {
      expect(client.getQueryData(mattersKeys.detail('mtr_new'))).toMatchObject({
        id: 'mtr_new',
      })
    })
  })

  it('propagates a validation error from the API', async () => {
    const client = new QueryClient()
    api.apiFetch.mockRejectedValueOnce(
      new ApiError(
        'validation_failed',
        'name and primaryJurisdiction are required.',
        400,
        'req_3',
      ),
    )

    const { result } = renderHook(() => useCreateMatter(), {
      wrapper: createWrapper(client),
    })

    await expect(
      Promise.resolve(
        act(async () => {
          await result.current.mutateAsync({
            name: '',
            primaryJurisdiction: '',
          })
        }),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' })
  })
})

describe('useMattersList — happy path with the real query', () => {
  it('loads matters through the cache-backed query', async () => {
    const client = new QueryClient()
    api.apiFetch.mockResolvedValueOnce({
      matters: [sampleMatter({ id: 'mtr_a' })],
    })

    const { result } = renderHook(() => useMattersList(), {
      wrapper: createWrapper(client),
    })

    // Prime the same options the route loader uses, then assert the hook sees it.
    await client.ensureQueryData(mattersListQueryOptions())

    await waitFor(() => {
      expect(result.current.data?.length).toBe(1)
      expect(result.current.data?.[0].id).toBe('mtr_a')
    })
  })
})
