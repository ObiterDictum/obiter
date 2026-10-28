import '@obiter/test-dom'
import { Suspense, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { vi } from '../../../../scripts/test/vitest-compat'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

// The view renders <Link to="/search"> and reads useNavigate-free; mock the
// router pieces it touches so the test does not need a full router tree.
// The real module's export names as undefined: bun links named imports
// statically and rejects a mock that omits one, while vitest left an
// unlisted export undefined. Overrides win.
const tanstackReactRouterModuleKeys = Object.fromEntries(
  Object.keys(await import('@tanstack/react-router')).map((key) => [
    key,
    undefined,
  ]),
)
mock.module('@tanstack/react-router', () =>
  Object.assign(
    { ...tanstackReactRouterModuleKeys },
    (() => ({
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
    }))(),
  ),
)

// Loaded after the registrations above: bun does not hoist mock.module the
// way vi.mock was hoisted, and these modules capture mocked imports at
// module scope, so they must evaluate once the mocks are in place.
const { CaseLawDocumentView } = await import('./CaseLawDocumentView')

const DOCUMENT_PAYLOAD = {
  document: {
    id: 'uksc-2024-3',
    title: 'Potanina v Potanin',
    neutralCitation: '[2024] UKSC 3',
    court: 'uksc',
    dateDecided: '2024-01-31',
    sourceUrl: 'https://caselaw.nationalarchives.gov.uk/uksc/2024/3',
    // Stored as LegalDocML parses it: the court's `<num>` in paragraphNumber,
    // not in the text, and not equal to the paragraph's position.
    paragraphs: [
      {
        id: 'p1',
        paragraphNumber: 10,
        text: 'The appellant appeals the decision below.',
      },
      {
        id: 'p2',
        paragraphNumber: 11,
        text: 'The central issue is jurisdiction.',
      },
    ],
  },
  courtParagraphNumbers: true,
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
    if (
      url.includes(`/api/search/documents/${encodeURIComponent('uksc-2024-3')}`)
    ) {
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
    expect(
      (await screen.findAllByText('Potanina v Potanin')).length,
    ).toBeGreaterThan(0)
    expect(
      (await screen.findAllByText(/\[2024\] UKSC 3/)).length,
    ).toBeGreaterThan(0)
    // The readable court label for 'uksc' resolves to 'UKSC'.
    expect((await screen.findAllByText(/UKSC/)).length).toBeGreaterThan(0)
    // The header formats the date; 2024-01-31 should appear somewhere.
    expect((await screen.findAllByText(/31 Jan 2024/)).length).toBeGreaterThan(
      0,
    )
  })

  it('renders each paragraph with its stored court number and anchor', async () => {
    mockFetch()
    renderView()

    const label = await screen.findByLabelText('Paragraph 11')
    expect(label.textContent).toBe('11')
    expect(label.closest('p')?.id).toBe('para-11')
    expect(screen.queryByLabelText('Paragraph 2')).toBeNull()
  })

  it('fetches the document from the stored-case documents endpoint', async () => {
    const fetchMock = mockFetch()
    renderView()

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).includes(
            `/api/search/documents/${encodeURIComponent('uksc-2024-3')}`,
          ),
        ),
      ).toBe(true)
    })
  })

  it('names the source and records that no retrieval date is stored', async () => {
    mockFetch()
    renderView()

    await screen.findByRole('document')
    expect(
      screen.getAllByText('The National Archives (Find Case Law)').length,
    ).toBeGreaterThan(0)
    expect(screen.getAllByText('Retrieval date not recorded').length).toBe(1)
    // The payload carries no judge or party fields; the page must not invent
    // them from the title.
    expect(screen.queryByText('Judges')).toBeNull()
    expect(screen.queryByText('Panel')).toBeNull()
  })

  it('shows a source failure with a retry instead of an empty judgment', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error('network down'))
    vi.stubGlobal('fetch', fetchMock)
    renderView()

    expect(
      await screen.findByText('Judgment could not be loaded', undefined, {
        timeout: 3000,
      }),
    ).toBeTruthy()
    fetchMock.mockResolvedValueOnce(jsonResponse(DOCUMENT_PAYLOAD))
    screen.getByRole('button', { name: 'Retry' }).click()
    expect(await screen.findByRole('document')).toBeTruthy()
  })

  it('renders stored metadata with the full-text-unavailable state for a summary-only row', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          document: {
            id: 'uksc-2024-3',
            title: 'Potanina v Potanin',
            neutralCitation: '[2024] UKSC 3',
            court: 'uksc',
            dateDecided: '2024-01-31',
            sourceUrl: 'https://caselaw.nationalarchives.gov.uk/uksc/2024/3',
          },
        }),
      ),
    )
    renderView()

    expect(
      (await screen.findAllByText('Potanina v Potanin')).length,
    ).toBeGreaterThan(0)
    expect(await screen.findByText('Full text unavailable')).toBeTruthy()
    expect(
      screen.getByText(
        'The authority metadata is cached, but no paragraph text is stored for this case yet.',
      ),
    ).toBeTruthy()
  })
})
