import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useFinalizeRun } from './hooks'
import type { FinalizeResponse, RedactionRun } from './types'

const apiFetch = vi.hoisted(() => vi.fn())

vi.mock('@obiter/app-shell', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}))

const baseRun: RedactionRun = {
  id: 'red_1',
  matterId: null,
  matterName: null,
  documentId: null,
  documentVersionId: null,
  sourceFilename: 'note.txt',
  status: 'ready_for_review',
  policyMode: 'internal_ai_minimisation',
  spans: [],
  decisions: {},
  summary: {
    totalSpans: 0,
    byCategory: {
      person_name: 0,
      email: 0,
      phone: 0,
      address: 0,
      date: 0,
      government_id: 0,
      account_number: 0,
      passport: 0,
      drivers_license: 0,
      url: 0,
      ip_address: 0,
      national_insurance: 0,
      case_reference: 0,
      organisation_name: 0,
      secret: 0,
    },
    bySource: { rampartModel: 0, rampartDeterministic: 0, ukSupplement: 0 },
    reviewedCount: 0,
    unreviewedCount: 0,
  },
  outputArtifactId: null,
  detectorVersion: null,
  detectionMode: 'model+supplement',
  createdAt: '2026-07-09T00:00:00.000Z',
  updatedAt: '2026-07-09T00:00:00.000Z',
}

function createWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

describe('useFinalizeRun cache updates', () => {
  beforeEach(() => {
    apiFetch.mockReset()
  })

  it('writes the finalized run into the detail cache and invalidates list/output keys', async () => {
    const client = new QueryClient()
    client.setQueryData(['redaction-run', 'red_1'], baseRun)
    client.setQueryData(['redaction-runs'], { runs: [baseRun] })

    const finalized: RedactionRun = {
      ...baseRun,
      status: 'finalized',
      outputArtifactId: 'art_1',
      updatedAt: '2026-07-09T00:01:00.000Z',
    }
    const response: FinalizeResponse = {
      run: finalized,
      artifact: {
        id: 'art_1',
        objectKey: 'org/x/artifacts/art_1',
        artifactType: 'redaction_output',
      },
      warnings: { unreviewedSpanIds: [] },
    }
    apiFetch.mockResolvedValueOnce(response)

    const invalidateSpy = vi.spyOn(client, 'invalidateQueries')

    const { result } = renderHook(() => useFinalizeRun('red_1'), {
      wrapper: createWrapper(client),
    })

    await act(async () => {
      result.current.mutate({ outputMode: 'redacted' })
    })

    await waitFor(() => {
      expect(client.getQueryData(['redaction-run', 'red_1'])).toEqual(finalized)
    })

    expect(apiFetch).toHaveBeenCalledWith(
      '/api/redaction-runs/red_1/finalize',
      {
        method: 'POST',
        body: JSON.stringify({ outputMode: 'redacted' }),
      },
    )
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['redaction-run', 'red_1'],
    })
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['redaction-run-output', 'red_1'],
    })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['redaction-runs'] })
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['document-redaction-runs'],
    })
  })
})
