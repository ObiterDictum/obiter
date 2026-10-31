import '@obiter/test-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { vi } from '../../../scripts/test/vitest-compat'
import type { RedactionRun } from './types'

const apiFetch = vi.hoisted(() => vi.fn())

const appShellKeys = Object.fromEntries(
  Object.keys(await import('@obiter/app-shell')).map((key) => [key, undefined]),
)
mock.module('@obiter/app-shell', () =>
  Object.assign(
    { ...appShellKeys },
    {
      apiFetch: (...args: unknown[]) => apiFetch(...args),
      useCurrentUser: () => ({ data: { user: { id: 'usr_reviewer' } } }),
      PageScaffold: ({
        title,
        description,
        actions,
        children,
      }: {
        title: string
        description?: string
        actions?: React.ReactNode
        children: React.ReactNode
      }) => (
        <div>
          <h1>{title}</h1>
          {description ? <p>{description}</p> : null}
          {actions}
          {children}
        </div>
      ),
    },
  ),
)

const { RedactionReviewView } = await import('./review')

const run: RedactionRun = {
  id: 'red_load',
  matterId: null,
  matterName: null,
  documentId: null,
  documentVersionId: null,
  sourceFilename: 'synthetic-note.txt',
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
  outputId: null,
  detectorVersion: null,
  detectionMode: 'model+supplement',
  replacesRunId: null,
  replacementRunId: null,
  returnedDocumentVersionId: null,
  createdAt: '2026-07-09T00:00:00.000Z',
  updatedAt: '2026-07-09T00:00:00.000Z',
}

const text = 'A synthetic note with no personal data.'

function emptyCacheView() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <RedactionReviewView runId={run.id} onOpenRun={() => undefined} />
    </QueryClientProvider>,
  )
}

function serveRun() {
  apiFetch.mockImplementation((path: string) =>
    Promise.resolve(path.endsWith('/document-text') ? { text } : { run }),
  )
}

beforeEach(() => {
  apiFetch.mockReset()
})

describe('a run that fails to load from an empty cache', () => {
  it('shows the load error and recovers through Try again when the run is gone', async () => {
    apiFetch.mockRejectedValue(
      new Error('This redaction run could not be found.'),
    )
    emptyCacheView()

    expect(
      await screen.findByText('This redaction run could not be loaded'),
    ).toBeTruthy()
    expect(
      screen.getByText('This redaction run could not be found.'),
    ).toBeTruthy()

    serveRun()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(
      await screen.findByText(
        'No sensitive data was detected in this document',
      ),
    ).toBeTruthy()
  })

  it('shows the load error and recovers through Try again after a network failure', async () => {
    apiFetch.mockRejectedValue(new Error('Failed to fetch'))
    emptyCacheView()

    expect(
      await screen.findByText('This redaction run could not be loaded'),
    ).toBeTruthy()
    expect(screen.getByText('Failed to fetch')).toBeTruthy()

    serveRun()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(
      await screen.findByText(
        'No sensitive data was detected in this document',
      ),
    ).toBeTruthy()
  })
})
