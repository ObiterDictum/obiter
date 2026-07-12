import { describe, expect, it, vi } from 'vitest'
import { ApiError } from './api'
import {
  matterQueryOptions,
  mattersKeys,
  mattersListQueryOptions,
} from './matters'

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }))

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>()
  return { ...actual, apiFetch: api.apiFetch }
})

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
