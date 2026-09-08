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
