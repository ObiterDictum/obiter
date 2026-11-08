import '@obiter/test-dom'
import { Suspense, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { vi } from '../../../../scripts/test/vitest-compat'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { ToastProvider } from '@obiter/ui'

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
      useNavigate: () => () => undefined,
    }))(),
  ),
)

const { CaseLawDocumentView } = await import('./CaseLawDocumentView')

const DOCUMENT_PAYLOAD = {
  document: {
    id: 'uksc-2024-3',
    title: 'Potanina v Potanin',
    neutralCitation: '[2024] UKSC 3',
    court: 'uksc',
    dateDecided: '2024-01-31',
    sourceUrl: 'https://caselaw.nationalarchives.gov.uk/uksc/2024/3',
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
    if (
      url.includes(`/api/search/documents/${encodeURIComponent('uksc-2024-3')}`)
    ) {
      return jsonResponse(DOCUMENT_PAYLOAD)
    }
    if (url.includes('/api/documents/citation-targets')) {
      return jsonResponse({ documents: [] })
    }
    return jsonResponse({})
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function renderView(caseId = 'uksc-2024-3') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(
    <ToastProvider>
      <QueryClientProvider client={queryClient}>
        <Suspense fallback={<div>Loading case…</div>}>
          <CaseLawDocumentView caseId={caseId} />
        </Suspense>
      </QueryClientProvider>
    </ToastProvider>,
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

    const documentLandmark = await screen.findByRole('document')
    expect(documentLandmark).toBeTruthy()

    expect(
      (await screen.findAllByText('Potanina v Potanin')).length,
    ).toBeGreaterThan(0)
    expect(
      (await screen.findAllByText(/\[2024\] UKSC 3/)).length,
    ).toBeGreaterThan(0)
    expect((await screen.findAllByText(/UKSC/)).length).toBeGreaterThan(0)
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
    expect(screen.queryByText('Judges')).toBeNull()
    expect(screen.queryByText('Panel')).toBeNull()
  })

  it('shows the published bench and the court summary, labelled with its source', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          ...DOCUMENT_PAYLOAD,
          judges: ['Lord Reed, President', 'Lord Briggs', 'Lady Rose'],
          summary: {
            kind: 'press_summary',
            paragraphs: [
              'This appeal concerns the right to manage.',
              'The respondent disputed the appellant’s entitlement.',
            ],
            sourceUrl:
              'https://caselaw.nationalarchives.gov.uk/uksc/2024/3/press-summary',
          },
        }),
      ),
    )
    renderView()

    await screen.findByRole('document')
    expect(
      screen.getByText('Coram: Lord Reed, President · Lord Briggs · Lady Rose'),
    ).toBeTruthy()
    expect(screen.getByText(/Press summary, UK Supreme Court/)).toBeTruthy()
    expect(
      screen.getByText('This appeal concerns the right to manage.'),
    ).toBeTruthy()
    const summaryCard = screen.getByRole('region', { name: 'Summary' })
    expect(
      within(summaryCard)
        .getByRole('link', { name: 'Open original' })
        .getAttribute('href'),
    ).toBe('https://caselaw.nationalarchives.gov.uk/uksc/2024/3/press-summary')
  })

  it('shows no bench and no summary when the source publishes neither', async () => {
    mockFetch()
    renderView()

    await screen.findByRole('document')
    expect(screen.queryByText(/Coram:/)).toBeNull()
    expect(screen.queryByText(/Press summary/)).toBeNull()
  })

  it('shows the recorded retrieval date when the source carries one', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          ...DOCUMENT_PAYLOAD,
          acquiredAt: '2026-09-06T14:49:54.709Z',
        }),
      ),
    )
    renderView()

    await screen.findByRole('document')
    expect(screen.getByText('Retrieved 6 Sept 2026')).toBeTruthy()
    expect(screen.queryByText('Retrieval date not recorded')).toBeNull()
  })

  it('offers the original on The National Archives when the load fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockRejectedValue(new Error('network down')),
    )
    renderView('uksc/2024/3')

    expect(
      await screen.findByText('Judgment could not be loaded', undefined, {
        timeout: 3000,
      }),
    ).toBeTruthy()
    expect(
      screen
        .getByRole('link', {
          name: /Open original on The National Archives/,
        })
        .getAttribute('href'),
    ).toBe('https://caselaw.nationalarchives.gov.uk/uksc/2024/3')
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

it('renders a PDF page marker at the exact stored offset and explains its source', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      jsonResponse({
        ...DOCUMENT_PAYLOAD,
        pages: [{ page: 47, paragraphNumber: 10, offset: 14 }],
        pageCount: 101,
      }),
    ),
  )
  renderView()
  const marker = await screen.findByText('Page 47')
  expect(marker.parentElement?.id).toBe('page-47')
  expect(
    marker.parentElement?.parentElement?.previousSibling?.textContent,
  ).toBe('The appellant ')
  expect(screen.getByText('p. 47')).toBeTruthy()
  expect(
    screen.getByText(
      "Page numbers are from the court's PDF as published by Find Case Law.",
    ),
  ).toBeTruthy()
})

const STRUCTURED_PAYLOAD = {
  ...DOCUMENT_PAYLOAD,
  document: {
    ...DOCUMENT_PAYLOAD.document,
    title: 'Test Claimants v HMRC',
    neutralCitation: '[2021] UKSC 31',
    cover: {
      lines: [
        { kind: 'term', text: 'Trinity Term' },
        { kind: 'citation', text: '[2021] UKSC 31' },
        { kind: 'appeal', text: 'On appeals from: [2010] EWCA Civ 103' },
        { kind: 'label', text: 'JUDGMENT' },
        {
          kind: 'title',
          text: 'Test Claimants (Respondents) v HMRC (Appellant)',
          parties: [
            { name: 'Test Claimants', role: 'Respondents' },
            { name: 'HMRC', role: 'Appellant' },
          ],
        },
        { kind: 'label', text: 'before' },
        { kind: 'judge', text: 'Lord Reed, President' },
        { kind: 'judge', text: 'Lord Briggs' },
        { kind: 'label', text: 'JUDGMENT GIVEN ON' },
        { kind: 'date', text: '23 July 2021' },
        { kind: 'heard', text: 'Heard on 7, 8, 9 and 10 December 2020' },
      ],
      counsel: [
        ['HMRC', 'Test Claimants'],
        ['David Ewart QC', 'Graham Aaronson QC'],
      ],
    },
    paragraphs: [
      {
        id: 's1',
        paragraphNumber: 1,
        label: '1.',
        level: 1,
        text: 'This is the third occasion on which these questions arise.',
        headings: [
          {
            kind: 'opinion',
            text: 'LORD REED AND LORD HODGE: (with whom Lord Briggs, Lord Sales and Lord Hamblen agree)',
          },
        ],
      },
      {
        id: 's2',
        paragraphNumber: 2,
        label: '2.',
        level: 1,
        text: 'The matters are dealt with in the following order:',
      },
      {
        id: 's3',
        paragraphNumber: 2,
        label: '(1)',
        level: 2,
        text: 'General introduction (paras 3-9).',
      },
      {
        id: 's4',
        paragraphNumber: 2,
        label: '(2)',
        level: 2,
        text: 'Overview of the tax provisions.',
      },
      {
        id: 's5',
        paragraphNumber: 2,
        level: 1,
        style: 'quote',
        text: '“A passage quoted from the statute.”',
      },
      {
        id: 's6',
        paragraphNumber: 3,
        label: '3.',
        level: 1,
        text: 'The group litigation was established in 2003.',
        headings: [{ kind: 'section', text: '1. General Introduction' }],
      },
      {
        id: 's7',
        paragraphNumber: 4,
        label: '4.',
        level: 1,
        text: 'I agree.',
        headings: [{ kind: 'opinion', text: 'LORD BRIGGS:' }],
      },
    ],
  },
}

function renderStructured(payload: unknown = STRUCTURED_PAYLOAD) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => jsonResponse(payload)),
  )
  return renderView()
}

describe('CaseLawDocumentView judgment structure', () => {
  it('shows the court front page as centred text with counsel in a table', async () => {
    renderStructured()
    const cover = await screen.findByRole('banner', { name: 'Front page' })
    const text = within(cover)
    expect(text.getByText('Trinity Term')).toBeTruthy()
    expect(text.getByText('On appeals from: [2010] EWCA Civ 103')).toBeTruthy()
    expect(text.getAllByText('Test Claimants')).toHaveLength(2)
    expect(text.getByText('(Respondents)')).toBeTruthy()
    expect(text.getByText('(Appellant)')).toBeTruthy()
    expect(text.getByText('Before')).toBeTruthy()
    expect(text.getByText('Lord Reed, President')).toBeTruthy()
    expect(text.getByText('Lord Briggs')).toBeTruthy()
    expect(text.getByText('Judgment given on')).toBeTruthy()
    expect(text.getByText('23 July 2021')).toBeTruthy()
    expect(text.getByText('Heard on 7, 8, 9 and 10 December 2020')).toBeTruthy()
    const counsel = text.getByRole('table', { name: 'Counsel' })
    expect(
      within(counsel).getByRole('columnheader', { name: 'HMRC' }),
    ).toBeTruthy()
    expect(within(counsel).getByText('Graham Aaronson QC')).toBeTruthy()
    expect(cover.querySelector('img')).toBeNull()
  })

  it('divides the opinions and lists them with their paragraph ranges', async () => {
    renderStructured()
    await screen.findByRole('document')
    const opinion = screen.getByRole('heading', {
      level: 2,
      name: 'Lord Reed and Lord Hodge',
    })
    expect(opinion.parentElement?.textContent).toContain(
      'with whom Lord Briggs, Lord Sales and Lord Hamblen agree',
    )
    expect(
      screen.getByRole('heading', {
        level: 3,
        name: '1. General Introduction',
      }),
    ).toBeTruthy()
    const list = screen.getByRole('list')
    const links = within(list).getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual([
      'Lord Reed and Lord Hodge[1]–[3]',
      'Lord Briggs[4]',
    ])
    const target = links[0]?.getAttribute('href')?.slice(1) ?? ''
    expect(document.getElementById(target)?.contains(opinion)).toBe(true)
  })

  it('indents labelled sub-items and keeps the court number on level-1 paragraphs only', async () => {
    renderStructured()
    await screen.findByRole('document')
    const label = screen.getByText('(1)')
    const item = label.closest('p')
    expect(item?.className).toContain('ml-8')
    expect(item?.getAttribute('data-court-paragraph')).toBe('2')
    expect(item?.id).toBe('')
    expect(
      screen.getAllByLabelText(/^Paragraph \d+$/).map((n) => n.textContent),
    ).toEqual(['1', '2', '3', '4'])
    expect(document.querySelectorAll('[id="para-2"]')).toHaveLength(1)
    expect(document.getElementById('para-2')?.textContent).toContain(
      'The matters are dealt with',
    )
    expect(screen.getByLabelText('Paragraph 1').closest('p')?.id).toBe('para-1')
  })

  it('sets block quotes indented and smaller without a number or anchor', async () => {
    renderStructured()
    const quote = await screen.findByText(
      '“A passage quoted from the statute.”',
    )
    expect(quote.closest('span.pl-6')?.className).toContain('text-[15px]')
    expect(quote.closest('p')?.id).toBe('')
  })

  it('copies a court paragraph with its labelled sub-items and cites it as one paragraph', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    renderStructured()
    ;(
      await screen.findByRole('button', { name: 'Paragraph 2 actions' })
    ).click()
    ;(
      await screen.findByRole('menuitem', { name: 'Copy with citation' })
    ).click()
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        'The matters are dealt with in the following order:\n(1) General introduction (paras 3-9).\n(2) Overview of the tax provisions.\n“A passage quoted from the statute.”\nTest Claimants v HMRC [2021] UKSC 31 [2]',
      ),
    )
  })

  it('leaves the cover, headings and Opinions list out while searching within the case', async () => {
    renderStructured()
    await screen.findByRole('document')
    const search = screen.getByRole('searchbox', { name: 'Search within case' })
    fireEvent.change(search, { target: { value: 'tax provisions' } })
    await waitFor(() =>
      expect(screen.queryByRole('banner', { name: 'Front page' })).toBeNull(),
    )
    expect(
      screen.queryByRole('heading', { name: 'Lord Reed and Lord Hodge' }),
    ).toBeNull()
    expect(screen.queryByText('Opinions')).toBeNull()
    expect(screen.getByText('(2)')).toBeTruthy()
  })

  it('renders an old-format document exactly as before', async () => {
    mockFetch()
    renderView()
    const article = await screen.findByRole('document')
    expect(screen.queryByRole('banner', { name: 'Front page' })).toBeNull()
    expect(screen.queryByText('Opinions')).toBeNull()
    expect(
      Array.from(article.querySelectorAll('[data-court-paragraph]')).map(
        (p) => [p.id, p.className],
      ),
    ).toEqual([
      [
        'para-10',
        'grid scroll-mt-6 grid-cols-[34px_minmax(0,1fr)] gap-3 text-[16px] leading-[1.8] ',
      ],
      [
        'para-11',
        'grid scroll-mt-6 grid-cols-[34px_minmax(0,1fr)] gap-3 text-[16px] leading-[1.8] ',
      ],
    ])
  })
})
