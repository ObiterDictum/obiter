import '@obiter/test-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { vi } from '../../../scripts/test/vitest-compat'
import type { RedactionRun } from './types'

const apiFetch = vi.hoisted(() => vi.fn())

const appShell = await import('@obiter/app-shell')
const { isTypingTarget } = appShell
const appShellKeys = Object.fromEntries(
  Object.keys(appShell).map((key) => [key, undefined]),
)
const splitScale = Object.fromEntries(
  Object.entries(appShell).filter(([key]) => /split/i.test(key)),
)
mock.module('@obiter/app-shell', () =>
  Object.assign(
    { ...appShellKeys, ...splitScale },
    {
      isTypingTarget,
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
  return client
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

it.each(['pending', 'detecting'] as const)(
  'waits for detection to finish before requesting document text while %s',
  async (status) => {
    const path = `/api/redaction-runs/${run.id}`
    apiFetch.mockResolvedValue({ run: { ...run, status } })
    const client = emptyCacheView()
    expect(await screen.findByText('Detecting…')).toBeTruthy()
    expect(apiFetch.mock.calls).toEqual([[path]])

    serveRun()
    act(() => {
      client.setQueryData(['redaction-run', run.id], run)
    })
    expect(
      await screen.findByText(
        'No sensitive data was detected in this document',
      ),
    ).toBeTruthy()
    expect(apiFetch.mock.calls.slice(1)).toEqual([[`${path}/document-text`]])
  },
)

it('saves from the document, list and body, wraps past decided spans and allows revising a decision', async () => {
  const reviewRun: RedactionRun = {
    ...run,
    spans: ['Jane', 'John', 'Joan'].map((name, index) => ({
      id: `span_${index + 1}`,
      text: name,
      start: index * 5,
      end: index * 5 + 4,
      category: 'person_name',
      source: 'rampart_model',
      confidence: 'high',
      suggestion: 'redact',
    })),
    decisions: {
      span_2: {
        decision: 'accept',
        decidedBy: 'usr_reviewer',
        decidedAt: run.updatedAt,
      },
    },
    summary: {
      ...run.summary,
      totalSpans: 3,
      reviewedCount: 1,
      unreviewedCount: 2,
    },
  }
  apiFetch.mockImplementation((path: string, options?: RequestInit) => {
    if (path.endsWith('/document-text'))
      return Promise.resolve({ text: 'Jane John Joan' })
    const spanId = path.split('/').at(-2)
    if (options?.method === 'POST' && spanId) {
      reviewRun.decisions = {
        ...reviewRun.decisions,
        [spanId]: {
          decision:
            options.body === '{"decision":"reject"}' ? 'reject' : 'accept',
          decidedBy: 'usr_reviewer',
          decidedAt: run.updatedAt,
        },
      }
    }
    return Promise.resolve({ run: { ...reviewRun } })
  })
  emptyCacheView()

  const original = await screen.findByRole('article', {
    name: 'Original document text',
  })
  const joan = within(original).getByRole('button', { name: /Joan/u })
  fireEvent.click(joan)
  joan.focus()
  fireEvent.keyDown(joan, { key: 'r' })

  const list = screen.getByRole('listbox', { name: 'Detected spans' })
  const bar = screen.getByRole('region', { name: 'Decide the selected span' })
  expect(await within(bar).findByText('1 of 3')).toBeTruthy()
  expect(document.activeElement).toBe(list)
  expect(apiFetch).toHaveBeenCalledWith(
    `/api/redaction-runs/${run.id}/spans/span_3/decision`,
    { method: 'POST', body: '{"decision":"reject"}' },
  )

  fireEvent.keyDown(list, { key: 'Enter' })
  expect(
    await screen.findByText('All spans decided. Choose Finalise to continue.'),
  ).toBeTruthy()
  expect(within(bar).queryByRole('button', { name: /Redact/u })).toBeNull()

  fireEvent.click(within(list).getByRole('option', { name: /Joan/u }))
  fireEvent.keyDown(document.body, { key: 'Enter' })
  expect(
    await within(list).findByRole('option', { name: /Redacted.*Joan/u }),
  ).toBeTruthy()
  expect(apiFetch).toHaveBeenCalledWith(
    `/api/redaction-runs/${run.id}/spans/span_3/decision`,
    { method: 'POST', body: '{"decision":"accept"}' },
  )
})
