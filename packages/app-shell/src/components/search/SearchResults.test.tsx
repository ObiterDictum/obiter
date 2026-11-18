import '@obiter/test-dom'
import { describe, expect, it, mock } from 'bun:test'
import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'

const routerKeys = Object.fromEntries(
  Object.keys(await import('@tanstack/react-router')).map((key) => [
    key,
    undefined,
  ]),
)
mock.module('@tanstack/react-router', () =>
  Object.assign(
    { ...routerKeys },
    {
      Link: ({
        children,
        to,
        hash,
        params,
        ...props
      }: {
        children: ReactNode
        to?: string
        hash?: string
        params?: Record<string, string>
        [key: string]: unknown
      }) => {
        const path = (to ?? '').replace(
          /\$([A-Za-z0-9_]+)/g,
          (_, key: string) => params?.[key] ?? '',
        )
        return (
          <a href={`${path}${hash ? `#${hash}` : ''}`} {...props}>
            {children}
          </a>
        )
      },
    },
  ),
)

const { SearchResultList } = await import('./SearchResultList')
const { SearchPreview } = await import('./SearchPreview')
const { searchResultRows } = await import('./searchResultRows')
import type {
  LegalSearchFetchResponse,
  LegalSearchResult,
  LegislationSearchResultHit,
} from './searchTypes'

const judgment: LegalSearchResult = {
  id: 'uksc-2018-24',
  title: 'Rock Advertising Ltd v MWB Business Exchange Centres Ltd',
  neutralCitation: '[2018] UKSC 24',
  court: 'uksc',
  dateDecided: '2018-05-16',
  sourceUrl: 'https://caselaw.nationalarchives.gov.uk/uksc/2018/24',
  canonicalUrl:
    '/case/rock-advertising-ltd-v-mwb-business-exchange-centres-ltd-2018-uksc-24',
  matchReason: 'body_text_match',
  snippets: [
    {
      paragraphNumber: 7,
      text: 'At common law there are no formal requirements for the validity of a simple contract.',
      matchedTerms: ['no oral modification'],
    },
  ],
}

const provision: LegislationSearchResultHit = {
  id: 'ukpga/2010/15/section/13',
  resultGroup: 'legislation',
  legislationStatus: 'current',
  title: 'Equality Act 2010',
  year: 2010,
  provisionLabel: 's. 13',
  labelPath: 'section/13',
  documentIdentity: 'ukpga/2010/15',
  extent: 'E+W+S',
  text: 'A person (A) discriminates against another (B) if, because of a protected characteristic, A treats B less favourably.',
  officialUrl: 'https://www.legislation.gov.uk/ukpga/2010/15/section/13',
  sourceUrl: 'https://www.legislation.gov.uk/ukpga/2010/15',
}

const withheld: LegislationSearchResultHit = {
  ...provision,
  id: 'ukpga/2010/15/section/80',
  labelPath: 'section/80',
  provisionLabel: 's. 80',
  legislationStatus: 'amended_not_held',
  text: undefined,
  notice: 'Amended wording has not been incorporated.',
  officialUrl: 'https://www.legislation.gov.uk/ukpga/2010/15/section/80',
}

function response(
  overrides: Partial<LegalSearchFetchResponse> = {},
): LegalSearchFetchResponse {
  return {
    hits: [judgment],
    groups: [{ key: 'legislation', label: 'Legislation', hits: [provision] }],
    cached: true,
    indexedCount: 0,
    skippedCount: 0,
    ...overrides,
  }
}

describe('SearchResultList provenance', () => {
  it('labels a stored snippet as a judgment extract with its pinpoint', () => {
    render(
      <SearchResultList
        rows={searchResultRows(response())}
        selectedIndex={0}
        onSelectIndex={() => {}}
        onPreview={() => {}}
      />,
    )

    expect(screen.getByText('Judgment extract · judgment [7]')).toBeTruthy()
    expect(screen.queryByText(/Obiter summary/)).toBeNull()
    expect(
      screen.getByRole('link', { name: 'Open paragraph' }).getAttribute('href'),
    ).toBe(
      '/case/rock-advertising-ltd-v-mwb-business-exchange-centres-ltd-2018-uksc-24#para-7',
    )
  })

  it('does not invent a summary when the result has no extracted text', () => {
    render(
      <SearchResultList
        rows={searchResultRows(
          response({
            hits: [{ ...judgment, snippets: undefined }],
            groups: [],
          }),
        )}
        selectedIndex={0}
        onSelectIndex={() => {}}
        onPreview={() => {}}
      />,
    )

    expect(screen.getByText(/No extracted text for this result/)).toBeTruthy()
    expect(screen.queryByText(/Obiter summary/)).toBeNull()
  })

  it('distinguishes current legislation text from withheld amended wording', () => {
    render(
      <SearchResultList
        rows={searchResultRows(
          response({
            hits: [],
            groups: [
              { key: 'legislation', label: 'Legislation', hits: [withheld] },
            ],
          }),
        )}
        selectedIndex={0}
        onSelectIndex={() => {}}
        onPreview={() => {}}
      />,
    )

    expect(screen.getByText('Amended wording withheld')).toBeTruthy()
    expect(
      screen.getByText('Amended wording has not been incorporated.'),
    ).toBeTruthy()
    expect(screen.queryByText(/Stale amended wording/)).toBeNull()
  })
})

describe('SearchPreview provenance', () => {
  it('shows the source extract and says it is not an Obiter summary', () => {
    render(<SearchPreview row={searchResultRows(response())[0]} />)

    expect(
      screen.getByText(/Extracted from the judgment, not an Obiter summary/),
    ).toBeTruthy()
    expect(
      screen.queryByText('The National Archives (Find Case Law)'),
    ).toBeNull()
    expect(screen.getAllByText('Judgment extract').length).toBeGreaterThan(0)
  })

  it('shows the legislation source and the missing point-in-time warning', () => {
    render(<SearchPreview row={searchResultRows(response())[1]} />)

    expect(screen.getByText('Legislation extract · s. 13')).toBeTruthy()
    expect(screen.getByText(/Point-in-time date not recorded/)).toBeTruthy()
    expect(
      screen.getByRole('link', { name: 'legislation.gov.uk' }),
    ).toBeTruthy()
  })
})

it('presents an Act result and preview with a primary reader link', () => {
  const actHit: LegislationSearchResultHit = {
    ...provision,
    id: provision.documentIdentity,
    labelPath: '',
    provisionLabel: '2010 c. 15',
    text: undefined,
    officialUrl: provision.sourceUrl,
    act: {
      status: 'in_force',
      enactmentDate: '2010-04-08',
      totalCount: 561,
      withheldCount: 116,
      outline: ['Part 1 · Socio-economic inequalities'],
    },
  }
  const rows = searchResultRows(
    response({
      hits: [],
      groups: [{ key: 'legislation', label: 'Legislation', hits: [actHit] }],
    }),
  )
  render(
    <>
      <SearchResultList
        rows={rows}
        selectedIndex={0}
        onSelectIndex={() => {}}
        onPreview={() => {}}
      />
      <SearchPreview row={rows[0]} />
    </>,
  )
  expect(screen.getAllByText('561 provisions · 116 withheld')).toHaveLength(2)
  expect(
    screen.getAllByText('Part 1 · Socio-economic inequalities'),
  ).toHaveLength(2)
  expect(screen.getAllByText('Royal Assent 8 Apr 2010')).toHaveLength(2)
  expect(
    screen
      .getAllByRole('link', { name: 'Read the Act' })
      .map((link) => link.getAttribute('href')),
  ).toEqual(['/ln/ukpga/2010/15', '/ln/ukpga/2010/15'])
  expect(screen.queryByText('No unapplied amendments')).toBeNull()
  expect(screen.queryByText(/No extracted provision text/)).toBeNull()
})
