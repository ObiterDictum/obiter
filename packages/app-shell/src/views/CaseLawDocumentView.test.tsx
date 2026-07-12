// @vitest-environment jsdom
import { Suspense, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { CaseLawDocumentView } from './CaseLawDocumentView'

// The view renders <Link to="/search"> and reads useNavigate-free; mock the
// router pieces it touches so the test does not need a full router tree.
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    ...props
  }: {
    children: ReactNode
    to: string
    [key: string]: unknown
  }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}))

const DOCUMENT_PAYLOAD = {
  document: {
    id: 'uksc-2024-3',
    title: 'Potanina v Potanin',
    neutralCitation: '[2024] UKSC 3',
    court: 'uksc',
    dateDecided: '2024-01-31',
    sourceUrl: 'https://example.org/uksc/2024/3',
    paragraphs: [
      { id: 'p1', paragraphNumber: 1, text: '1. The appellant appeals the decision below.' },
      { id: 'p2', paragraphNumber: 2, text: '2. The central issue is jurisdiction.' },
    ],
  },
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    json: async () => body,
  } as Response
}

function mockFetch(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (url: string) => {
    // The view's queryFn fetches `/api/search/documents/:caseId`.
    if (url.includes(`/api/search/documents/${encodeURIComponent('uksc-2024-3')}`)) {
      return jsonResponse(DOCUMENT_PAYLOAD)
    }
    return jsonResponse({})
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/**
 * CaseLawDocumentView uses useSuspenseQuery, which suspends until the query
 * resolves. Wrap it in a Suspense boundary so the render can complete: while
 * suspended the fallback shows, and once the query resolves the content appears.
 * Callers use findBy* (which awaits the suspended content) rather than getBy*.
 */
function renderView(caseId = 'uksc-2024-3') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={<div>Loading case…</div>}>
        <CaseLawDocumentView caseId={caseId} />
      </Suspense>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('CaseLawDocumentView', () => {
  it('renders the case header (citation, title, court, date) and the judgment document landmark', async () => {
    mockFetch()
    renderView()

    // findBy* awaits the Suspense boundary resolving.
    const documentLandmark = await screen.findByRole('document')
    expect(documentLandmark).toBeTruthy()

    // Header (rendered once in the case metadata, once in the judgment body).
    expect((await screen.findAllByText('Potanina v Potanin')).length).toBeGreaterThan(0)
    expect((await screen.findAllByText(/\[2024\] UKSC 3/)).length).toBeGreaterThan(0)
    // The readable court label for 'uksc' resolves to 'UKSC'.
    expect((await screen.findAllByText(/UKSC/)).length).toBeGreaterThan(0)
    // The header formats the date; 2024-01-31 should appear somewhere.
    expect((await screen.findAllByText(/31 Jan 2024/)).length).toBeGreaterThan(0)
  })

  it('renders paragraphs with their accessible paragraph labels', async () => {
    mockFetch()
    renderView()

    await screen.findByRole('document')

    expect((await screen.findAllByLabelText('Paragraph 1')).length).toBe(1)
    expect((await screen.findAllByLabelText('Paragraph 2')).length).toBe(1)
  })

  it('fetches the document from the stored-case documents endpoint', async () => {
    const fetchMock = mockFetch()
    renderView()

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).includes(`/api/search/documents/${encodeURIComponent('uksc-2024-3')}`),
        ),
      ).toBe(true)
    })
  })
})
