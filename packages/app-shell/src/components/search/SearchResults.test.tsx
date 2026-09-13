// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SearchResults } from './SearchResults'
import type { LegalSearchFetchResponse } from './searchTypes'

vi.mock('@tanstack/react-router', () => ({
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
}))

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

function renderResults(response: LegalSearchFetchResponse) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)

  act(() => {
    root.render(
      <SearchResults
        response={response}
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

describe('SearchResults citation distinction', () => {
  let root: ReturnType<typeof createRoot> | null
  let container: HTMLElement | null

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    root = null
    container = null
  })

  afterEach(() => {
    if (root) {
      act(() => root?.unmount())
    }
    container?.remove()
  })

  it('marks citing hits and names the not-held count', () => {
    const rendered = renderResults({
      hits: [citingHit],
      cached: false,
      indexedCount: 0,
      skippedCount: 0,
      hydrationQueued: true,
      outcome: 'results',
      citation: { recognised: true, status: 'not_held' },
    })
    root = rendered.root
    container = rendered.container

    expect(container.textContent).toContain('Cites the queried citation')
    expect(container.textContent).toContain(
      'Citation not held · 1 citing result from Find Case Law',
    )
  })

  it('stays neutral when not-held hits carry no citing label', () => {
    const rendered = renderResults({
      hits: [
        {
          ...citingHit,
          citationMatch: 'none' as const,
          matchReason: 'keyword_match' as const,
        },
      ],
      cached: false,
      indexedCount: 0,
      skippedCount: 0,
      hydrationQueued: true,
      outcome: 'results',
      citation: { recognised: true, status: 'not_held' },
    })
    root = rendered.root
    container = rendered.container

    expect(container.textContent).toContain(
      'Citation not held · 1 result from Find Case Law',
    )
    expect(container.textContent).not.toContain('citing')
    expect(container.textContent).not.toContain('Cites the queried citation')
  })

  it('renders the partial title match label distinctly from a full title match', () => {
    const rendered = renderResults({
      hits: [{ ...citingHit, matchReason: 'partial_title_match' as const }],
      cached: false,
      indexedCount: 0,
      skippedCount: 0,
      outcome: 'results',
    })
    root = rendered.root
    container = rendered.container

    expect(container.textContent).toContain('Partial title match')
    expect(container.textContent).not.toContain('Body text match')
  })

  it('stays quiet on citationMatch for ordinary matches', () => {
    const rendered = renderResults({
      hits: [
        {
          ...citingHit,
          citationMatch: 'exact',
          matchReason: 'exact_neutral_citation' as const,
        },
      ],
      cached: true,
      indexedCount: 0,
      skippedCount: 0,
      outcome: 'results',
      citation: { recognised: true, status: 'held_exact' },
    })
    root = rendered.root
    container = rendered.container

    expect(container.textContent).toContain('Exact citation')
    expect(container.textContent).not.toContain('Cites the queried citation')
    expect(container.textContent).not.toContain('Citation not held')
  })

  it('attributes stored hits to stored sources even when not cached', () => {
    const rendered = renderResults({
      hits: [
        {
          ...citingHit,
          retrievalPath: 'stored_index' as const,
          citationMatch: undefined,
        },
      ],
      cached: false,
      indexedCount: 0,
      skippedCount: 0,
      outcome: 'results',
    })
    root = rendered.root
    container = rendered.container

    expect(container.textContent).toContain(
      '1 result from stored legal sources',
    )
    expect(container.textContent).not.toContain('from Find Case Law')
  })

  it('names both sources for mixed stored and live hits', () => {
    const rendered = renderResults({
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
      indexedCount: 0,
      skippedCount: 0,
      outcome: 'results',
    })
    root = rendered.root
    container = rendered.container

    expect(container.textContent).toContain(
      '2 results from stored legal sources and Find Case Law',
    )
  })

  it('stays neutral for pathless non-cached results', () => {
    const {
      citationMatch: _citationMatch,
      retrievalPath: _retrievalPath,
      ...pathless
    } = citingHit
    const rendered = renderResults({
      hits: [{ ...pathless }],
      cached: false,
      indexedCount: 0,
      skippedCount: 0,
      outcome: 'results',
    })
    root = rendered.root
    container = rendered.container

    expect(container.textContent).toContain('1 result from legal sources')
    expect(container.textContent).not.toContain('from Find Case Law')
  })
})

describe('SearchResults legislation group', () => {
  let root: ReturnType<typeof createRoot> | null
  let container: HTMLElement | null

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    root = null
    container = null
  })

  afterEach(() => {
    if (root) {
      act(() => root?.unmount())
    }
    container?.remove()
  })

  it('renders provision text when current and the notice without text when amended', () => {
    const rendered = renderResults({
      hits: [],
      groups: [
        {
          key: 'legislation',
          label: 'Legislation',
          hits: [
            {
              id: 'ukpga/2010/15/section/13',
              resultGroup: 'legislation',
              legislationStatus: 'current',
              title: 'Equality Act 2010',
              provisionLabel: 's. 13',
              labelPath: 'section/13',
              documentIdentity: 'ukpga/2010/15',
              extent: 'E+W+S',
              text: 'Direct discrimination applies here.',
              snippets: [{ text: 'Direct discrimination applies here.' }],
              officialUrl:
                'https://www.legislation.gov.uk/ukpga/2010/15/section/13',
              sourceUrl: 'https://www.legislation.gov.uk/ukpga/2010/15',
              canonicalUrl: '/ln/ukpga/2010/15/section/13',
              year: 2010,
            },
            {
              id: 'ukpga/2010/15/section/80',
              resultGroup: 'legislation',
              legislationStatus: 'amended_not_held',
              title: 'Equality Act 2010',
              provisionLabel: 's. 80',
              labelPath: 'section/80',
              documentIdentity: 'ukpga/2010/15',
              extent: 'E+W+S',
              // Defence in depth: the API never sends text on amended hits,
              // but even a caller that passes it must not see it rendered.
              text: 'Stale amended wording that must never render.',
              officialUrl:
                'https://www.legislation.gov.uk/ukpga/2010/15/section/80',
              sourceUrl: 'https://www.legislation.gov.uk/ukpga/2010/15',
              canonicalUrl: '/ln/ukpga/2010/15/section/80',
              year: 2010,
              notice:
                'This provision is affected by amendments that have been recorded but not yet applied.',
            },
          ],
        },
      ],
      cached: true,
      indexedCount: 0,
      skippedCount: 0,
      outcome: 'results',
    })
    root = rendered.root
    container = rendered.container

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
    const rendered = renderResults({
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
      cached: true,
      indexedCount: 0,
      skippedCount: 0,
      outcome: 'results',
    })
    root = rendered.root
    container = rendered.container

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
    const rendered = renderResults({
      hits: [citingHit],
      primaryGroup: 'legislation',
      groups: [
        {
          key: 'legislation',
          label: 'Legislation',
          hits: [
            {
              id: 'ukpga/2010/15/section/13',
              resultGroup: 'legislation',
              legislationStatus: 'current',
              title: 'Equality Act 2010',
              year: 2010,
              provisionLabel: 's. 13',
              labelPath: 'section/13',
              documentIdentity: 'ukpga/2010/15',
              extent: 'E+W+S',
              canonicalUrl: '/ln/ukpga/2010/15/section/13',
              officialUrl:
                'https://www.legislation.gov.uk/ukpga/2010/15/section/13',
              sourceUrl: 'https://www.legislation.gov.uk/ukpga/2010/15',
              text: 'Direct discrimination applies here.',
            },
          ],
        },
      ],
      cached: true,
      indexedCount: 0,
      skippedCount: 0,
      outcome: 'results',
    })
    root = rendered.root
    container = rendered.container
    const headings = Array.from(container.querySelectorAll('h2')).map(
      (heading) => heading.textContent,
    )
    expect(headings).toEqual(['Legislation', 'Case law'])
  })

  it('keeps case law first when the query is not a statute citation', () => {
    const rendered = renderResults({
      hits: [citingHit],
      groups: [
        {
          key: 'legislation',
          label: 'Legislation',
          hits: [
            {
              id: 'ukpga/2010/15/section/13',
              resultGroup: 'legislation',
              legislationStatus: 'current',
              title: 'Equality Act 2010',
              year: 2010,
              provisionLabel: 's. 13',
              labelPath: 'section/13',
              documentIdentity: 'ukpga/2010/15',
              extent: 'E+W+S',
              canonicalUrl: '/ln/ukpga/2010/15/section/13',
              officialUrl:
                'https://www.legislation.gov.uk/ukpga/2010/15/section/13',
              sourceUrl: 'https://www.legislation.gov.uk/ukpga/2010/15',
              text: 'Direct discrimination applies here.',
            },
          ],
        },
      ],
      cached: true,
      indexedCount: 0,
      skippedCount: 0,
      outcome: 'results',
    })
    root = rendered.root
    container = rendered.container
    const headings = Array.from(container.querySelectorAll('h2')).map(
      (heading) => heading.textContent,
    )
    expect(headings).toEqual(['Case law', 'Legislation'])
  })

  it('names an unheld Act instead of a not-held judgment citation', () => {
    const rendered = renderResults({
      hits: [citingHit],
      cached: true,
      indexedCount: 0,
      skippedCount: 0,
      outcome: 'recognised_not_held',
      citation: { recognised: true, status: 'not_held' },
      diagnostics: {
        legislationNote: 'Children Act 1989 is not held.',
        legislationNotHeld: true,
      },
    })
    root = rendered.root
    container = rendered.container

    // The legislation half recognised the Act and served nothing. The page
    // must say the Act is not held, not that a judgment citation is not held.
    expect(container.textContent).toContain('Children Act 1989 is not held.')
    expect(container.textContent).not.toContain('Citation not held')
  })

  it('does not surface a legislation outage as a not-held notice', () => {
    const rendered = renderResults({
      hits: [citingHit],
      cached: true,
      indexedCount: 0,
      skippedCount: 0,
      outcome: 'results',
      diagnostics: { legislationNote: 'Legislation store unavailable.' },
    })
    root = rendered.root
    container = rendered.container

    // An outage note is not a not-held verdict; the legislation half still
    // fails open and the judgment results still stand.
    expect(container.textContent).not.toContain(
      'Legislation store unavailable.',
    )
    expect(container.textContent).toContain(citingHit.title)
  })

  it('names an unresolved legislation title above judgment results', () => {
    const rendered = renderResults({
      hits: [citingHit],
      cached: true,
      indexedCount: 0,
      skippedCount: 0,
      outcome: 'results',
      diagnostics: {
        legislationNote:
          'No exact legislation title match was found for "Children Act 1989".',
        legislationTitleUnresolved: true,
      },
    })
    root = rendered.root
    container = rendered.container

    // The note says only what is known; it must never claim the Act is
    // absent while judgment results are on the page.
    expect(container.textContent).toContain(
      'No exact legislation title match was found for "Children Act 1989".',
    )
    expect(container.textContent).not.toContain('is not held')
    expect(container.textContent).toContain(citingHit.title)
  })

  it('names an ambiguous legislation title above judgment results', () => {
    const rendered = renderResults({
      hits: [citingHit],
      cached: true,
      indexedCount: 0,
      skippedCount: 0,
      outcome: 'legislation_ambiguous',
      diagnostics: {
        legislationNote:
          '“Sample Act 2020” names more than one stored Act. Candidates: A; B',
        legislationAmbiguous: true,
      },
    })
    root = rendered.root
    container = rendered.container

    expect(container.textContent).toContain('names more than one stored Act')
    expect(container.textContent).toContain(citingHit.title)
  })

  it('shows an underspecified-schedule corrective above judgment results', () => {
    const rendered = renderResults({
      hits: [citingHit],
      cached: true,
      indexedCount: 0,
      skippedCount: 0,
      outcome: 'results',
      diagnostics: {
        legislationNote: 'Sch. para. 2 of Equality Act 2010 names no schedule.',
        legislationScheduleGuidance: {
          example: 'Schedule 1 paragraph 2',
          actTitle: 'Equality Act 2010',
        },
      },
    })
    root = rendered.root
    container = rendered.container

    // The corrective is a prompt, not a verdict: it must appear alongside the
    // judgment results, never replace them, and never claim the Act is absent.
    expect(container.textContent).toContain('Schedule 1 paragraph 2')
    expect(container.textContent).toContain('Equality Act 2010')
    expect(container.textContent).toContain(citingHit.title)
    expect(container.textContent).not.toContain('is not held')
  })
})

describe('SearchResults withheld distinction and group headings', () => {
  let root: ReturnType<typeof createRoot> | null
  let container: HTMLElement | null

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    root = null
    container = null
  })

  afterEach(() => {
    if (root) {
      act(() => root?.unmount())
    }
    container?.remove()
  })

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

  function renderMixed() {
    const rendered = renderResults({
      hits: [citingHit],
      groups: [
        {
          key: 'legislation',
          label: 'Legislation',
          hits: [currentHit, withheldHit],
        },
      ],
      cached: true,
      indexedCount: 0,
      skippedCount: 0,
      outcome: 'results',
    })
    root = rendered.root
    container = rendered.container
    return rendered.container
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
    const rendered = renderResults({
      hits: [],
      groups: [
        {
          key: 'legislation',
          label: 'Legislation',
          hits: [withheldHit],
        },
      ],
      cached: true,
      indexedCount: 0,
      skippedCount: 0,
      outcome: 'results',
    })
    root = rendered.root
    container = rendered.container

    const headings = Array.from(container.querySelectorAll('h2')).map(
      (heading) => heading.textContent,
    )
    expect(headings).not.toContain('Case law')
    expect(headings).toContain('Legislation')
  })
})
