import '@obiter/test-dom'
import { Suspense, type ReactNode } from 'react'
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { vi } from '../../../../scripts/test/vitest-compat'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
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

interface Case {
  id: string
  court: string
  citation: string
  text: string
  pageMarkers: string[]
}

const cases: Case[] = [
  {
    id: 'ewhc-ch-2024-946',
    court: 'ewhc/ch',
    citation: '[2024] EWHC 946 (Ch)',
    text: 'The Company carries on business providing family entertainment facilities primarily located at retail and leisure parks and the Company has a total of fifty-two centres across the UK.',
    pageMarkers: ['4', '[Page 5]'],
  },
  {
    id: 'ewhc-kb-2022-3476',
    court: 'ewhc/kb',
    citation: '[2022] EWHC 3476 (KB)',
    text: 'The Council also sent an email to Serco on 21 November at 5.50 p.m. conveying the same information as had previously been given to the first and third defendants and asking for an undertaking in similar terms.',
    pageMarkers: ['7', '8'],
  },
  {
    id: 'ewhc-comm-2022-3522',
    court: 'ewhc/comm',
    citation: '[2022] EWHC 3522 (Comm)',
    text: 'Before me, Mr Jonathan Cohen QC and Mr Ashley Cukier appear on behalf of the Claimant, and Mr Adam Zellick QC and Mr Christopher Longley appear on behalf of the Defendant.',
    pageMarkers: ['2'],
  },
  {
    id: 'ewca-crim-2021-268',
    court: 'ewca/crim',
    citation: '[2021] EWCA Crim 268',
    text: 'This is an appeal against sentence brought by leave of the single judge.',
    pageMarkers: ['Page 3', '6'],
  },
  {
    id: 'ewhc-admin-2020-2465',
    court: 'ewhc/admin',
    citation: '[2020] EWHC 2465 (Admin)',
    text: 'He was convicted in September 2011. On 5 October 2011 he was sentenced to a suspended sentence of one year and two months’ imprisonment suspended for three years, with probation supervision and an obligation to pay compensation.',
    pageMarkers: ['10', '11', '12'],
  },
]

function payload(item: Case, extra: Record<string, unknown> = {}) {
  const paragraphs = [
    { id: 'p1', paragraphNumber: 1, level: 1, text: item.text },
    ...item.pageMarkers.map((text, index) => ({
      id: `m${index}`,
      paragraphNumber: 2,
      level: 1,
      text,
    })),
    {
      id: 'p2',
      paragraphNumber: 3,
      level: 1,
      text: '1999',
    },
  ]
  return {
    document: {
      id: item.id,
      title: 'Stored judgment',
      neutralCitation: item.citation,
      court: item.court,
      dateDecided: '2024-01-31',
      sourceUrl: `https://caselaw.nationalarchives.gov.uk/${item.id}`,
      paragraphs,
    },
    courtParagraphNumbers: true,
    ...extra,
  }
}

function renderCase(body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => body }) as Response),
  )
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(
    <ToastProvider>
      <QueryClientProvider client={queryClient}>
        <Suspense fallback={<div>Loading case…</div>}>
          <CaseLawDocumentView caseId="stored-judgment" />
        </Suspense>
      </QueryClientProvider>
    </ToastProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('judgment page markers printed in the source text', () => {
  for (const item of cases) {
    it(`drops the page markers a ${item.court} transcript carries in its paragraph text`, async () => {
      renderCase(payload(item))

      const document = await screen.findByRole('document')
      expect(within(document).getByText(item.text)).toBeTruthy()
      for (const marker of item.pageMarkers) {
        expect(within(document).queryByText(marker)).toBeNull()
      }
      expect(within(document).getByText('1999')).toBeTruthy()
    })
  }

  it('keeps the PDF page jump when the page map starts at a stored page marker', async () => {
    const item = cases[0]!
    renderCase(
      payload(item, {
        pages: [
          { page: 47, paragraphNumber: 1, offset: 4 },
          { page: 48, paragraphNumber: 2, offset: 0 },
        ],
        pageCount: 80,
      }),
    )

    const document = await screen.findByRole('document')
    const marker = within(document).getByText('Page 47')
    expect(marker.parentElement?.id).toBe('page-47')
  })
})
