import '@obiter/test-dom'
import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'

import type { LegalSearchFetchResponse } from './searchTypes'

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
        className,
        ...props
      }: {
        children: ReactNode
        className?: string
        [key: string]: unknown
      }) => (
        <a className={className} {...props}>
          {children}
        </a>
      ),
    }))(),
  ),
)

// Loaded after the registrations above: bun does not hoist mock.module the
// way vi.mock was hoisted, and these modules capture mocked imports at
// module scope, so they must evaluate once the mocks are in place.
const { SearchResults } = await import('./SearchResults')

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let root: ReturnType<typeof createRoot> | null = null
let container: HTMLElement | null = null

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})
afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

function renderResults(overrides: Partial<LegalSearchFetchResponse>) {
  container = document.createElement('div')
  document.body.append(container)
  const renderedRoot = createRoot(container)
  root = renderedRoot

  act(() => {
    renderedRoot.render(
      <SearchResults
        response={{
          hits: [],
          cached: true,
          indexedCount: 0,
          skippedCount: 0,
          ...overrides,
        }}
        selectedIndex={0}
        onSelectIndex={() => {}}
      />,
    )
  })

  return { container, root }
}

const citingHit = {
  id: 'ewca-civ-2026-99',
  title: 'Later judgment discussing [2023] EWCA Civ 123',
  neutralCitation: '[2026] EWCA Civ 99',
  court: 'ewca-civ',
  dateDecided: '2026-01-01',
  sourceUrl: 'https://caselaw.nationalarchives.gov.uk/ewca/civ/2026/99',
  canonicalUrl: '/case/later-judgment-2026-ewca-civ-99',
  matchReason: 'title_match' as const,
  citationMatch: 'citing' as const,
  retrievalPath: 'live_provider' as const,
  retrievalRank: 1,
  retrievalScore: 0.8,
}

const currentHit = {
  id: 'ukpga/2010/15/section/13',
  resultGroup: 'legislation' as const,
  legislationStatus: 'current' as const,
  title: 'Equality Act 2010',
  provisionLabel: 's. 13',
  labelPath: 'section/13',
  documentIdentity: 'ukpga/2010/15',
  extent: 'E+W+S',
  text: 'Direct discrimination applies here.',
  snippets: [{ text: 'Direct discrimination applies here.' }],
  officialUrl: 'https://www.legislation.gov.uk/ukpga/2010/15/section/13',
  sourceUrl: 'https://www.legislation.gov.uk/ukpga/2010/15',
}

const withheldHit = {
  id: 'ukpga/2010/15/section/80',
  resultGroup: 'legislation' as const,
  legislationStatus: 'amended_not_held' as const,
  title: 'Equality Act 2010',
  provisionLabel: 's. 80',
  labelPath: 'section/80',
  documentIdentity: 'ukpga/2010/15',
  extent: 'E+W+S',
  officialUrl: 'https://www.legislation.gov.uk/ukpga/2010/15/section/80',
  sourceUrl: 'https://www.legislation.gov.uk/ukpga/2010/15',
  notice:
    'This provision is affected by amendments that have been recorded but not yet applied.',
}

describe('SearchResults citation distinction', () => {
  it('stays neutral for pathless non-cached results', () => {
    const {
      citationMatch: _citationMatch,
      retrievalPath: _retrievalPath,
      ...pathless
    } = citingHit
    const { container } = renderResults({
      hits: [{ ...pathless }],
      cached: false,
      outcome: 'results',
    })

    expect(container.textContent).toContain('1 result from legal sources')
    expect(container.textContent).not.toContain('from Find Case Law')
  })
})

describe('SearchResults legislation group', () => {
  it('renders provision text when current and the notice without text when amended', () => {
    const { container } = renderResults({
      hits: [],
      groups: [
        {
          key: 'legislation',
          label: 'Legislation',
          hits: [
            {
              ...currentHit,
              canonicalUrl: '/ln/ukpga/2010/15/section/13',
              year: 2010,
            },
            {
              ...withheldHit,
              text: 'Stale amended wording that must never render.',
              canonicalUrl: '/ln/ukpga/2010/15/section/80',
              year: 2010,
            },
          ],
        },
      ],
      outcome: 'results',
    })

    expect(container.textContent).toContain('Legislation')
    expect(container.textContent).toContain(
      'Direct discrimination applies here.',
    )
    expect(container.textContent).toContain(
      'amendments that have been recorded but not yet applied',
    )
    expect(container.textContent).toContain('Amended wording withheld')
    expect(container.textContent).not.toContain(
      'Stale amended wording that must never render',
    )
    const amendedItem = container.querySelector(
      '[data-legislation-status="amended_not_held"]',
    )
    const currentItem = container.querySelector(
      '[data-legislation-status="current"]',
    )
    expect(amendedItem).not.toBeNull()
    expect(currentItem).not.toBeNull()
    expect(amendedItem?.className).toContain('border-warning')
    expect(amendedItem?.className).toContain('hover:bg-warning/15')
    expect(currentItem?.className).not.toContain('border-warning')
    expect(amendedItem?.textContent).not.toContain('Direct discrimination')
    expect(
      container.querySelector('a[href="/ln/ukpga/2010/15/section/13"]'),
    ).not.toBeNull()
    expect(
      amendedItem?.querySelector(
        'a[href="https://www.legislation.gov.uk/ukpga/2010/15/section/80"]',
      ),
    ).not.toBeNull()
  })

  it('links an act-level hit through to the Act page', () => {
    const { container } = renderResults({
      hits: [],
      groups: [
        {
          key: 'legislation',
          label: 'Legislation',
          hits: [
            {
              id: 'ukpga/2010/15',
              resultGroup: 'legislation',
              legislationStatus: 'current',
              title: 'Equality Act 2010',
              provisionLabel: '2010 c. 15',
              labelPath: '',
              documentIdentity: 'ukpga/2010/15',
              extent: 'E+W+S',
              officialUrl: 'https://www.legislation.gov.uk/ukpga/2010/15',
              sourceUrl: 'https://www.legislation.gov.uk/ukpga/2010/15',
              notice:
                'Open the Act to browse its Parts, sections and schedules.',
            },
          ],
        },
      ],
      outcome: 'results',
    })

    expect(container.textContent).toContain(
      'Open the Act to browse its Parts, sections and schedules.',
    )
    // The Act hit is a link to the Act contents page, not static guidance.
    const actLink = container.querySelector('a[href="/ln/ukpga/2010/15"]')
    expect(actLink).not.toBeNull()
    // Title once, chapter once — never the title twice.
    expect(actLink?.textContent).toContain('2010 c. 15 · Equality Act 2010')
  })

  it('leads with legislation when the API marks the query as statute-shaped', () => {
    const { container } = renderResults({
      hits: [citingHit],
      primaryGroup: 'legislation',
      groups: [
        {
          key: 'legislation',
          label: 'Legislation',
          hits: [
            {
              ...currentHit,
              year: 2010,
              canonicalUrl: '/ln/ukpga/2010/15/section/13',
            },
          ],
        },
      ],
      outcome: 'results',
    })
    const headings = Array.from(container.querySelectorAll('h2')).map(
      (heading) => heading.textContent,
    )
    expect(headings).toEqual(['Legislation', 'Case law'])
  })

  it('keeps case law first when the query is not a statute citation', () => {
    const { container } = renderResults({
      hits: [citingHit],
      groups: [
        {
          key: 'legislation',
          label: 'Legislation',
          hits: [
            {
              ...currentHit,
              year: 2010,
              canonicalUrl: '/ln/ukpga/2010/15/section/13',
            },
          ],
        },
      ],
      outcome: 'results',
    })
    const headings = Array.from(container.querySelectorAll('h2')).map(
      (heading) => heading.textContent,
    )
    expect(headings).toEqual(['Case law', 'Legislation'])
  })
})

describe('SearchResults withheld distinction and group headings', () => {
  function renderMixed() {
    const { container } = renderResults({
      hits: [citingHit],
      groups: [
        {
          key: 'legislation',
          label: 'Legislation',
          hits: [currentHit, withheldHit],
        },
      ],
      outcome: 'results',
    })
    return container
  }

  it('badges the withheld provision while the current row stays plain', () => {
    const host = renderMixed()

    expect(host.textContent).toContain('Amended wording withheld')
    // Wording and the official link stay intact beside the badge.
    expect(host.textContent).toContain(
      'amendments that have been recorded but not yet applied',
    )
    expect(
      host.querySelector(
        'a[href="https://www.legislation.gov.uk/ukpga/2010/15/section/80"]',
      ),
    ).not.toBeNull()

    const withheldItem = host.querySelector(
      '[data-legislation-status="amended_not_held"]',
    )
    const currentItem = host.querySelector(
      '[data-legislation-status="current"]',
    )
    expect(withheldItem?.className).toContain('border-warning/40')
    expect(withheldItem?.className).toContain('bg-warning/10')
    expect(withheldItem?.className).toContain('hover:bg-warning/15')
    expect(currentItem?.className).not.toContain('border-warning/40')
    expect(currentItem?.className).not.toContain('bg-warning')
    expect(host.textContent).not.toContain('Text not shown')
    const badge = Array.from(host.querySelectorAll('span')).find(
      (span) =>
        span.className.includes('bg-warning') &&
        span.textContent?.includes('Amended wording withheld'),
    )
    expect(badge?.textContent).toContain('Amended wording withheld')
  })

  it('labels the case-law list so both groups carry a heading', () => {
    const host = renderMixed()

    const headings = Array.from(host.querySelectorAll('h2')).map(
      (heading) => heading.textContent,
    )
    expect(headings).toContain('Case law')
    expect(headings).toContain('Legislation')
  })

  it('omits the case-law heading when no case-law hits render', () => {
    const { container } = renderResults({
      hits: [],
      groups: [
        {
          key: 'legislation',
          label: 'Legislation',
          hits: [withheldHit],
        },
      ],
      outcome: 'results',
    })

    const headings = Array.from(container.querySelectorAll('h2')).map(
      (heading) => heading.textContent,
    )
    expect(headings).not.toContain('Case law')
    expect(headings).toContain('Legislation')
  })
})

for (const { name, response, contains, excludes } of [
  {
    name: 'marks citing hits and names the not-held count',
    response: {
      hits: [citingHit],
      cached: false,
      hydrationQueued: true,
      outcome: 'results',
      citation: { recognised: true, status: 'not_held' },
    },
    contains: [
      'Cites the queried citation',
      'Citation not held · 1 citing result from Find Case Law',
    ],
    excludes: [],
  },
  {
    name: 'attributes not-held citing hits to stored sources when the path is stored',
    response: {
      hits: [{ ...citingHit, retrievalPath: 'stored_index' as const }],
      cached: false,
      outcome: 'results',
      citation: { recognised: true, status: 'not_held' },
    },
    contains: ['Citation not held · 1 citing result from stored legal sources'],
    excludes: ['Find Case Law'],
  },
  {
    name: 'stays neutral when not-held hits carry no citing label',
    response: {
      hits: [
        {
          ...citingHit,
          citationMatch: 'none' as const,
          matchReason: 'keyword_match' as const,
        },
      ],
      cached: false,
      hydrationQueued: true,
      outcome: 'results',
      citation: { recognised: true, status: 'not_held' },
    },
    contains: ['Citation not held · 1 result from Find Case Law'],
    excludes: ['citing', 'Cites the queried citation'],
  },
  {
    name: 'renders the partial title match label distinctly from a full title match',
    response: {
      hits: [{ ...citingHit, matchReason: 'partial_title_match' as const }],
      cached: false,
      outcome: 'results',
    },
    contains: ['Partial title match'],
    excludes: ['Body text match'],
  },
  {
    name: 'stays quiet on citationMatch for ordinary matches',
    response: {
      hits: [
        {
          ...citingHit,
          citationMatch: 'exact',
          matchReason: 'exact_neutral_citation' as const,
        },
      ],
      outcome: 'results',
      citation: { recognised: true, status: 'held_exact' },
    },
    contains: ['Exact citation'],
    excludes: ['Cites the queried citation', 'Citation not held'],
  },
  {
    name: 'attributes stored hits to stored sources even when not cached',
    response: {
      hits: [
        {
          ...citingHit,
          retrievalPath: 'stored_index' as const,
          citationMatch: undefined,
        },
      ],
      cached: false,
      outcome: 'results',
    },
    contains: ['1 result from stored legal sources'],
    excludes: ['from Find Case Law'],
  },
  {
    name: 'names both sources for mixed stored and live hits',
    response: {
      hits: [
        {
          ...citingHit,
          retrievalPath: 'stored_index' as const,
          citationMatch: undefined,
        },
        {
          ...citingHit,
          id: 'live-2',
          retrievalPath: 'live_provider' as const,
          citationMatch: undefined,
        },
      ],
      cached: false,
      outcome: 'results',
    },
    contains: ['2 results from stored legal sources and Find Case Law'],
    excludes: [],
  },
  {
    name: 'names an unheld Act instead of a not-held judgment citation',
    response: {
      hits: [citingHit],
      outcome: 'recognised_not_held',
      citation: { recognised: true, status: 'not_held' },
      diagnostics: {
        legislationNote: 'Children Act 1989 is not held.',
        legislationNotHeld: true,
      },
    },
    contains: ['Children Act 1989 is not held.'],
    excludes: ['Citation not held'],
  },
  {
    name: 'does not surface a legislation outage as a not-held notice',
    response: {
      hits: [citingHit],
      outcome: 'results',
      diagnostics: { legislationNote: 'Legislation store unavailable.' },
    },
    contains: [citingHit.title],
    excludes: ['Legislation store unavailable.'],
  },
  {
    name: 'names an unresolved legislation title above judgment results',
    response: {
      hits: [citingHit],
      outcome: 'results',
      diagnostics: {
        legislationNote:
          'No exact legislation title match was found for "Children Act 1989".',
        legislationTitleUnresolved: true,
      },
    },
    contains: [
      'No exact legislation title match was found for "Children Act 1989".',
      citingHit.title,
    ],
    excludes: ['is not held'],
  },
  {
    name: 'names an ambiguous legislation title above judgment results',
    response: {
      hits: [citingHit],
      outcome: 'legislation_ambiguous',
      diagnostics: {
        legislationNote:
          '“Sample Act 2020” names more than one stored Act. Candidates: A; B',
        legislationAmbiguous: true,
      },
    },
    contains: ['names more than one stored Act', citingHit.title],
    excludes: [],
  },
  {
    name: 'shows an underspecified-schedule corrective above judgment results',
    response: {
      hits: [citingHit],
      outcome: 'results',
      diagnostics: {
        legislationNote: 'Sch. para. 2 of Equality Act 2010 names no schedule.',
        legislationScheduleGuidance: {
          example: 'Schedule 1 paragraph 2',
          actTitle: 'Equality Act 2010',
        },
      },
    },
    contains: ['Schedule 1 paragraph 2', 'Equality Act 2010', citingHit.title],
    excludes: ['is not held'],
  },
  {
    name: 'states partial coverage when the legislation half failed',
    response: {
      hits: [citingHit],
      outcome: 'results',
      diagnostics: { legislationSearchFailed: true },
    },
    contains: ['Legislation could not be searched this time', citingHit.title],
    excludes: [],
  },
  {
    name: 'states partial coverage when the judgment half failed',
    response: {
      hits: [
        {
          ...citingHit,
          id: 'ukpga-2010-15',
          title: 'Equality Act 2010',
          retrievalPath: 'stored_exact_lookup',
        },
      ],
      outcome: 'results',
      diagnostics: { judgmentSearchFailed: true },
    },
    contains: ['Case law could not be searched this time'],
    excludes: [],
  },
  {
    name: 'names both halves when both failed',
    response: {
      hits: [citingHit],
      outcome: 'results',
      diagnostics: {
        judgmentSearchFailed: true,
        legislationSearchFailed: true,
      },
    },
    contains: ['Part of this search failed'],
    excludes: [],
  },
  {
    name: 'shows no incomplete banner when both halves completed',
    response: {
      hits: [citingHit],
      outcome: 'results',
      diagnostics: { legislationSearched: true },
    },
    contains: [],
    excludes: ['may be incomplete'],
  },
] satisfies {
  name: string
  response: Partial<LegalSearchFetchResponse>
  contains: string[]
  excludes: string[]
}[]) {
  it(name, () => {
    const { container } = renderResults(response)
    for (const text of contains) expect(container.textContent).toContain(text)
    for (const text of excludes)
      expect(container.textContent).not.toContain(text)
  })
}
