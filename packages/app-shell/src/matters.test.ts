import '@obiter/test-dom'
import { createElement, type PropsWithChildren } from 'react'
import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, mock } from 'bun:test'
import { vi } from '../../../scripts/test/vitest-compat'
import { ApiError } from './api'

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
const { documentsKeys } = await import('./documents')
const {
  matterQueryOptions,
  mattersKeys,
  mattersListQueryOptions,
  useDeleteMatter,
} = await import('./matters')

function sampleMatter(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mtr_1',
    organisationId: 'org_1',
    name: 'Share purchase',
    description: null,
    primaryJurisdiction: 'england_and_wales',
    secondaryJurisdictions: [],
    legalDomains: ['corporate'],
    clientReference: '',
    status: 'active',
    createdBy: 'usr_1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    ...overrides,
  }
}

function queryWrapper(client: QueryClient) {
  return ({ children }: PropsWithChildren) =>
    createElement(QueryClientProvider, { client }, children)
}

describe('mattersKeys', () => {
  it('uses a stable nested structure for lists vs detail', () => {
    expect(mattersKeys.all).toEqual(['matters'])
    expect(mattersKeys.lists()).toEqual(['matters', 'list'])
    expect(mattersKeys.detail('mtr_1')).toEqual(['matters', 'detail', 'mtr_1'])
  })
})

describe('mattersListQueryOptions', () => {
  it('resolves the list through GET /api/matters', async () => {
    api.apiFetch.mockResolvedValueOnce({ matters: [sampleMatter()] })

    const options = mattersListQueryOptions()
    const result = await options.queryFn?.({} as never)

    expect(result).toEqual([sampleMatter()])
    expect(api.apiFetch).toHaveBeenCalledWith('/api/matters')
  })

  it('returns an empty array wrapper as an empty list', async () => {
    api.apiFetch.mockResolvedValueOnce({ matters: [] })

    const options = mattersListQueryOptions()
    const result = await options.queryFn?.({} as never)

    expect(result).toEqual([])
  })
})

describe('useDeleteMatter', () => {
  it('invalidates document and redaction-run caches after a cascade delete', async () => {
    api.apiFetch.mockResolvedValueOnce({})
    const client = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { retry: false },
      },
    })
    const invalidate = vi
      .spyOn(client, 'invalidateQueries')
      .mockResolvedValue(undefined)
    const remove = vi.spyOn(client, 'removeQueries')
    const { result } = renderHook(() => useDeleteMatter(), {
      wrapper: queryWrapper(client),
    })

    await act(async () => {
      await result.current.mutateAsync('mtr_1')
    })

    expect(remove).toHaveBeenCalledWith({
      queryKey: mattersKeys.detail('mtr_1'),
    })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: mattersKeys.lists(),
    })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: documentsKeys.byMatter('mtr_1'),
    })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['redaction-runs'] })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['document-redaction-runs'],
    })
  })
})

describe('matterQueryOptions', () => {
  it('resolves a single matter through GET /api/matters/:id', async () => {
    api.apiFetch.mockResolvedValueOnce({
      matter: sampleMatter({ id: 'mtr_42' }),
    })

    const options = matterQueryOptions('mtr_42')
    const result = await options.queryFn?.({} as never)

    expect(result).toEqual(sampleMatter({ id: 'mtr_42' }))
    expect(api.apiFetch).toHaveBeenCalledWith('/api/matters/mtr_42')
  })

  it('throws the typed ApiError on a missing matter', async () => {
    api.apiFetch.mockRejectedValueOnce(
      new ApiError('matter_not_found', 'Matter not found.', 404, 'req_1'),
    )

    const options = matterQueryOptions('mtr_missing')
    await expect(options.queryFn?.({} as never)).rejects.toMatchObject({
      code: 'matter_not_found',
      status: 404,
    })
  })
})
