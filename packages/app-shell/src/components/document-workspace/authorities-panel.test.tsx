import '@obiter/test-dom'
import { createElement, type PropsWithChildren } from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { vi } from '../../../../../scripts/test/vitest-compat'
import type {
  VerificationRun,
  VerificationRunListResponse,
} from '@obiter/contracts'

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }))
const apiModule = { ...(await import('../../api')) }
mock.module('../../api', () => ({ ...apiModule, apiFetch: api.apiFetch }))

const documentHook = vi.hoisted(() => ({ useDocument: vi.fn() }))
const documentsModule = { ...(await import('../../documents')) }
mock.module('../../documents', () => ({
  ...documentsModule,
  useDocument: documentHook.useDocument,
}))

const modelHook = vi.hoisted(() => ({ useDocumentModel: vi.fn() }))
const documentWorkspaceApiModule = {
  ...(await import('../../document-workspace-api')),
}
mock.module('../../document-workspace-api', () => ({
  ...documentWorkspaceApiModule,
  useDocumentModel: modelHook.useDocumentModel,
}))

const { VerificationWorkspaceProvider } =
  await import('../verification/verification-context')
const { DocumentAuthoritiesPanel } = await import('./authorities-panel')

function completedRun(): VerificationRun {
  return {
    id: 'vrun_1',
    organisationId: 'org_1',
    matterId: 'mtr_1',
    documentId: 'doc_1',
    documentVersionId: 'ver_1',
    status: 'completed',
    failureCode: null,
    createdBy: 'usr_1',
    createdAt: '2026-11-05T00:00:00.000Z',
    startedAt: '2026-11-05T00:00:01.000Z',
    completedAt: '2026-11-05T00:00:02.000Z',
    summary: {
      findingCount: 1,
      flaggedCount: 0,
      reviewRequiredCount: 0,
      dismissedCount: 0,
      notCheckedCount: 0,
    },
    documentCurrentVersionId: 'ver_1',
    stale: false,
  }
}

function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const wrapper = ({ children }: PropsWithChildren) =>
    createElement(QueryClientProvider, { client }, children)
  return render(
    <VerificationWorkspaceProvider documentId="doc_1" mappable={false}>
      <DocumentAuthoritiesPanel
        citations={[
          { paragraphId: 'p1', start: 0, end: 13, citation: '[2065] UKSC 4' },
        ]}
        onSelect={() => undefined}
      />
    </VerificationWorkspaceProvider>,
    { wrapper },
  )
}

beforeEach(() => {
  documentHook.useDocument.mockReturnValue({
    isPending: false,
    isError: false,
    data: {
      document: { currentVersion: { id: 'ver_1', documentStatus: 'ready' } },
    },
  })
  modelHook.useDocumentModel.mockReturnValue({ data: null })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('authorities panel verification state', () => {
  it('asks for a citation check rather than claiming findings are loading when the document has never been verified', async () => {
    api.apiFetch.mockImplementation(() =>
      Promise.resolve<VerificationRunListResponse>({
        runs: [],
        nextCursor: null,
      }),
    )
    mount()

    await waitFor(() => {
      expect(screen.getByText(/Check citations to compare these/)).toBeTruthy()
    })
    expect(screen.queryByText(/still loading/)).toBeNull()
  })

  it('says the findings are loading while the latest run’s findings are in flight', async () => {
    api.apiFetch.mockImplementation((url: string) =>
      String(url).includes('/findings')
        ? new Promise(() => undefined)
        : Promise.resolve<VerificationRunListResponse>({
            runs: [completedRun()],
            nextCursor: null,
          }),
    )
    mount()

    await waitFor(() => {
      expect(
        screen.getByText(/Verification findings are still loading/),
      ).toBeTruthy()
    })
  })
})
