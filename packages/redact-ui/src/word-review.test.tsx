import '@obiter/test-dom'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, it, mock, spyOn } from 'bun:test'
import {
  EMPTY_DOCUMENT_MARKINGS,
  type RedactionWordLayout,
} from '@obiter/contracts'
import {
  RedactionReviewView,
  appShell,
  decidedRun,
  hooks,
  onOpenRun,
} from './review.test-fixture'

const storyPartName = 'word/document.xml'
const paragraphId = 'body'
const wordLayout: RedactionWordLayout = {
  model: {
    version: 1,
    stories: [
      {
        kind: 'document',
        partName: storyPartName,
        paragraphs: [
          {
            id: paragraphId,
            preservedXmlFragments: ['<w:pPr><w:jc w:val="right"/></w:pPr>'],
            runs: [
              { id: 'first', text: 'Claimant Ja', preservedXmlFragments: [] },
              {
                id: 'second',
                text: 'ne',
                preservedXmlFragments: ['<w:rPr><w:b/></w:rPr>'],
              },
            ],
          },
        ],
        preservedXmlFragments: [],
        unanchoredFieldParagraphIds: [],
        fields: [],
      },
    ],
    relationships: [],
    numbering: [],
    styles: [],
    preservedXmlFragments: [],
    changes: [],
    trackRevisions: false,
    comments: [],
    markings: EMPTY_DOCUMENT_MARKINGS,
  },
  spans: [
    {
      spanId: 'span_1',
      complete: true,
      ranges: [
        { storyPartName, paragraphId, runId: 'first', from: 9, to: 11 },
        { storyPartName, paragraphId, runId: 'second', from: 0, to: 2 },
      ],
    },
    {
      spanId: 'span_2',
      complete: true,
      ranges: [
        {
          storyPartName,
          paragraphId: 'unrendered',
          runId: 'off-page',
          from: 0,
          to: 10,
        },
      ],
    },
  ],
}

function renderWordReview() {
  hooks.useRedactionRun.mockReturnValue({
    isPending: false,
    data: {
      ...decidedRun,
      sourceFilename: 'synthetic.docx',
      sourcePreview: { kind: 'docx', available: true },
    },
  })
  hooks.useRedactionDocumentText.mockReturnValue({
    isPending: false,
    data: { text: 'Jane (born 9 May 1988) filed.' },
  })
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } })
  return render(
    <QueryClientProvider client={client}>
      <RedactionReviewView runId={decidedRun.id} onOpenRun={onOpenRun} />
    </QueryClientProvider>,
  )
}

it('paints exact run slices, focuses a list selection, and keeps an unrendered candidate in the queue', async () => {
  appShell.apiFetch.mockResolvedValue(wordLayout)
  const mutate = mock()
  hooks.useSpanDecision.mockReturnValue({ mutate, isPending: false })
  const box = new DOMRect(1, 1, 2, 2)
  const marksGeometry = spyOn(
    HTMLElement.prototype,
    'getClientRects',
  ).mockReturnValue(
    Object.assign([box], { item: (index: number) => [box][index] ?? null }),
  )
  const sheetGeometry = spyOn(
    HTMLElement.prototype,
    'getBoundingClientRect',
  ).mockReturnValue(new DOMRect(0, 0, 100, 100))
  const scroll = spyOn(HTMLElement.prototype, 'scrollIntoView')
  try {
    renderWordReview()
    const document = await screen.findByRole('article', {
      name: 'Document page',
    })
    const marks = within(document).getAllByRole('button', {
      name: 'Person name: Jane',
    })
    expect(marks.map((mark) => mark.textContent)).toEqual(['Ja', 'ne'])
    expect(marks[1]?.parentElement?.style.fontWeight).toBe('700')
    expect(await screen.findByText('Not shown on the page')).toBeTruthy()
    const hidden = screen.getByRole('option', { name: /9 May 1988/u })
    expect(within(hidden).getByText('Not shown on the page')).toBeTruthy()
    fireEvent.click(screen.getByRole('option', { name: /Jane/u }))
    await waitFor(() => expect(window.document.activeElement).toBe(marks[0]))
    expect(scroll).toHaveBeenCalled()
    if (!marks[0]) throw new Error('Expected the mapped highlight')
    fireEvent.keyDown(marks[0], { key: 'Enter' })
    expect(mutate).toHaveBeenCalledWith(
      { spanId: 'span_1', decision: 'accept' },
      expect.any(Object),
    )
    fireEvent.click(hidden)
    expect(marks[0]?.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(marks[0])
    expect(
      screen
        .getByRole('option', { name: /Jane/u })
        .getAttribute('aria-selected'),
    ).toBe('true')
  } finally {
    marksGeometry.mockRestore()
    sheetGeometry.mockRestore()
    scroll.mockRestore()
  }
})

it('explains the text fallback when the Word layout is unavailable', async () => {
  appShell.apiFetch.mockRejectedValue(new Error('Word layout unavailable'))
  renderWordReview()
  expect(
    await screen.findByText(/Word layout could not be matched/u),
  ).toBeTruthy()
  expect(
    screen.getByRole('article', { name: 'Original document text' }),
  ).toBeTruthy()
  expect(screen.getAllByRole('option')).toHaveLength(2)
})
